import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity,
  Switch, StatusBar, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Alert, Animated, Easing, Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Accelerometer } from 'expo-sensors';

const BACKEND_URL = 'https://zyra-backend-9nvt.onrender.com';

// ─── Mood Colours ─────────────────────────────────────────────────────────────
const MOOD_COLORS: Record<string, string> = {
  romantic:  '#ff6b9d',
  sad:       '#7b9bff',
  item:      '#ffd700',
  '90s':     '#ff8c42',
  bhajan:    '#b8a9ff',
  energetic: '#00ffcc',
  default:   '#00ffcc',
};

export default function App() {
  const [isAppReady, setIsAppReady]   = useState(false);

  // ── Auth ──
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [authMode, setAuthMode]       = useState<'login'|'signup'>('login');
  const [email, setEmail]             = useState('');
  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [userToken, setUserToken]     = useState<string|null>(null);
  const [userId, setUserId]           = useState<string|null>(null);

  // ── Navigation ──
  const [currentScreen, setCurrentScreen] = useState('all_songs');

  // ── User data (synced with MongoDB) ──
  const [favorites,  setFavorites]  = useState<any[]>([]);
  const [downloads,  setDownloads]  = useState<any[]>([]);
  const [playlists,  setPlaylists]  = useState<{id:string,name:string,songs:any[]}[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string|null>(null);

  // ── Player ──
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [sound,            setSound]            = useState<Audio.Sound|null>(null);
  const [activeTrack,      setActiveTrack]      = useState<any>(null);
  const [isPlaying,        setIsPlaying]        = useState(false);
  const [isLoading,        setIsLoading]        = useState(false);
  const [position,         setPosition]         = useState(0);
  const [duration,         setDuration]         = useState(0);
  const [isYoutubeFallback, setIsYoutubeFallback] = useState(false);  // true when streaming via YouTube
  const progressBarWidthRef = useRef<number>(0);

  // ── Search ──
  const [searchQuery,    setSearchQuery]    = useState('');
  const [songsList,      setSongsList]      = useState<any[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const [searchHistory,  setSearchHistory]  = useState<string[]>([]);
  const [isSearchFocused,setIsSearchFocused]= useState(false);

  // ── Smart Autoplay ──
  const [smartAutoplay,   setSmartAutoplay]   = useState(true);
  const [currentMood,     setCurrentMood]     = useState<string>('default');
  const [autoplayReason,  setAutoplayReason]  = useState<string>('');
  const [autoplayQueue,   setAutoplayQueue]   = useState<any[]>([]);
  const [shakeEnabled,    setShakeEnabled]    = useState(false);

  // ── Modals ──
  const [isPlaylistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistSongTarget,     setPlaylistSongTarget]   = useState<any>(null);
  const [newPlaylistName,        setNewPlaylistName]      = useState('');
  const [isMenuVisible,          setMenuVisible]          = useState(false);

  const typingTimeoutRef = useRef<any>(null);
  const playNextRef      = useRef<any>(null);
  const autoNextRef      = useRef<any>(null);

  // ── Animations ──
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  // ─── Ring animations ────────────────────────────────────────────────────────
  useEffect(() => {
    let t1: any, t2: any;
    if (isPlaying) {
      ring1.setValue(0); ring2.setValue(0); ring3.setValue(0);
      const animate = (anim: Animated.Value) =>
        Animated.loop(Animated.timing(anim, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })).start();
      animate(ring1);
      t1 = setTimeout(() => animate(ring2), 1000);
      t2 = setTimeout(() => animate(ring3), 2000);
    } else {
      ring1.stopAnimation(); ring2.stopAnimation(); ring3.stopAnimation();
    }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isPlaying]);

  // ─── Shake sensor ────────────────────────────────────────────────────────────
  useEffect(() => {
    let subscription: any;
    if (shakeEnabled) {
      Accelerometer.setUpdateInterval(300);
      let lastShakeTime = 0;
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        const acc = Math.sqrt(x*x + y*y + z*z);
        if (acc > 1.8) {
          const now = Date.now();
          if (now - lastShakeTime > 1000) {
            lastShakeTime = now;
            // Always read .current so we get the latest playNext closure
            if (playNextRef.current) playNextRef.current();
          }
        }
      });
    }
    return () => { if (subscription) subscription.remove(); };
  }, [shakeEnabled]);

  // ─── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const storedToken    = await AsyncStorage.getItem('token');
        const storedUserId   = await AsyncStorage.getItem('userId');
        const storedUsername = await AsyncStorage.getItem('username');
        const storedSH       = await AsyncStorage.getItem('searchHistory');

        if (storedSH) setSearchHistory(JSON.parse(storedSH));

        if (storedToken && storedUserId) {
          setUserToken(storedToken);
          setUserId(storedUserId);
          setUsername(storedUsername || '');
          setIsLoggedIn(true);
          await loadUserData(storedToken);
        }
      } catch (e) {
        console.error('Init error', e);
      } finally {
        setIsAppReady(true);
      }
    };
    init();
  }, []);

  // ─── Sound cleanup ───────────────────────────────────────────────────────────
  useEffect(() => { return sound ? () => { sound.unloadAsync(); } : undefined; }, [sound]);

  // ─── Search debounce ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchQuery.trim().length === 0) { setSongsList([]); return; }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => fetchLiveTracks(searchQuery), 500);
    return () => clearTimeout(typingTimeoutRef.current);
  }, [searchQuery]);

  // ─── API helper ──────────────────────────────────────────────────────────────
  const apiCall = async (endpoint: string, method = 'GET', body: any = null, token?: string) => {
    const t = token || userToken;
    const headers: any = { 'Content-Type': 'application/json' };
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const opts: any = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${BACKEND_URL}${endpoint}`, opts);
    return resp.json();
  };

  // ─── Load user data from server ──────────────────────────────────────────────
  const loadUserData = async (token: string) => {
    try {
      const [favsRes, plRes, dlRes, settingsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/user/favorites`,  { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND_URL}/api/user/playlists`,  { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND_URL}/api/user/downloads`,  { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND_URL}/api/user/profile`,    { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [favs, pls, dls, profile] = await Promise.all([favsRes.json(), plRes.json(), dlRes.json(), settingsRes.json()]);
      if (favs.success)    setFavorites(favs.data.favorites);
      if (pls.success)     setPlaylists(pls.data.playlists);
      if (dls.success)     setDownloads(dls.data.downloads);
      if (profile.success) {
        const s = profile.data.settings || {};
        setShakeEnabled(!!s.shake_enabled);
        setSmartAutoplay(s.smart_autoplay !== false);
      }
    } catch (e) { console.error('loadUserData error', e); }
  };

  // ─── Auth ────────────────────────────────────────────────────────────────────
  const handleAuth = async () => {
    if (!email || !password) { Alert.alert('Missing Fields', 'Enter email and password.'); return; }
    setIsLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body: any = { email: email.trim().toLowerCase(), password };
      if (authMode === 'signup') body.username = username || email.split('@')[0];

      const resp = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      let json: any;
      const rawText = await resp.text();
      try { json = JSON.parse(rawText); }
      catch { Alert.alert('Server Error', `Status ${resp.status}: ${rawText.slice(0, 200)}`); setIsLoading(false); return; }

      if (json.success) {
        const { token, userId: uid, username: uname } = json;
        setUserToken(token); setUserId(uid); setUsername(uname);
        await AsyncStorage.setItem('token', token);
        await AsyncStorage.setItem('userId', uid);
        await AsyncStorage.setItem('username', uname);
        setIsLoggedIn(true);
        await loadUserData(token);
      } else {
        Alert.alert('Error', json.error || 'Authentication failed');
      }
    } catch (e: any) {
      Alert.alert('Network Error', e?.message || 'Could not connect to server.');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    if (sound) await sound.unloadAsync();
    setSound(null); setActiveTrack(null); setIsLoggedIn(false);
    setAuthMode('login'); setEmail(''); setPassword(''); setUsername('');
    setUserToken(null); setUserId(null); setPosition(0); setDuration(0);
    setFavorites([]); setPlaylists([]); setDownloads([]);
    await AsyncStorage.multiRemove(['token', 'userId', 'username']);
  };

  // ─── Favorites ───────────────────────────────────────────────────────────────
  const toggleFavorite = async (song: any) => {
    try {
      const json = await apiCall('/api/user/favorites', 'POST', song);
      if (json.success) setFavorites(json.data.favorites);
    } catch (e) { console.error('toggleFavorite error', e); }
  };
  const isTrackFavorite = (id: string) => favorites.some(f => f.id === id);

  // ─── Playlists ───────────────────────────────────────────────────────────────
  const createNewPlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    try {
      const json = await apiCall('/api/user/playlists', 'POST', { name: newPlaylistName, song: playlistSongTarget });
      if (json.success) {
        setPlaylists(json.data.playlists);
        setNewPlaylistName('');
        if (playlistSongTarget) { setPlaylistModalVisible(false); setPlaylistSongTarget(null); Alert.alert('Created', 'Playlist created!'); }
      }
    } catch (e) { console.error('createPlaylist error', e); }
  };

  const addToPlaylist = async (playlistId: string) => {
    if (!playlistSongTarget) return;
    try {
      const json = await apiCall(`/api/user/playlists/${playlistId}/songs`, 'POST', playlistSongTarget);
      if (json.success) { setPlaylists(json.data.playlists); setPlaylistModalVisible(false); setPlaylistSongTarget(null); Alert.alert('Added', 'Song added to playlist.'); }
    } catch (e) { console.error('addToPlaylist error', e); }
  };

  // ─── Downloads ───────────────────────────────────────────────────────────────
  const downloadSong = async (song: any) => {
    if (downloads.some(d => d.id === song.id)) { Alert.alert('Already Downloaded', 'This song is already saved.'); return; }
    try {
      Alert.alert('Downloading...', 'Please wait.');
      const fileUri = FileSystem.documentDirectory + `${song.id}.mp3`;
      let urlToDownload = `${BACKEND_URL}/api/stream?id=${song.id}`;
      const downloadRes = await FileSystem.downloadAsync(urlToDownload, fileUri);
      const entry = { ...song, localUri: downloadRes.uri };
      const json  = await apiCall('/api/user/downloads', 'POST', entry);
      if (json.success) { setDownloads(json.data.downloads); Alert.alert('\u2705 Downloaded', 'Available offline!'); }
    } catch (e) { console.error('Download error', e); Alert.alert('Error', 'Download failed.'); }
  };

  const deleteDownload = async (song: any) => {
    Alert.alert(
      'Remove Download',
      `Remove "${song.title}" from downloads?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            try {
              // Delete local file if it exists
              if (song.localUri) {
                try { await FileSystem.deleteAsync(song.localUri, { idempotent: true }); } catch {}
              }
              // Remove from backend
              const json = await apiCall(`/api/user/downloads/${song.id}`, 'DELETE');
              if (json.success) {
                setDownloads(json.data.downloads);
                // If currently playing this downloaded song, keep playing (stream will now use online)
              } else {
                // Optimistic local remove if backend fails
                setDownloads(prev => prev.filter(d => d.id !== song.id));
              }
            } catch (e) {
              console.error('Delete download error', e);
              // Optimistic remove anyway
              setDownloads(prev => prev.filter(d => d.id !== song.id));
            }
          }
        }
      ]
    );
  };


  // ─── Search ──────────────────────────────────────────────────────────────────
  const fetchLiveTracks = async (query: string) => {
    try {
      setIsSearching(true);
      const resp = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(query)}`);
      const json = await resp.json();
      setSongsList(json.success ? json.data.results : []);
    } catch (e) { setSongsList([]); }
    finally { setIsSearching(false); }
  };

  const saveSearchHistory = async (query: string) => {
    if (!query.trim()) return;
    setSearchHistory(prev => {
      const filtered = prev.filter(h => h.toLowerCase() !== query.trim().toLowerCase());
      const updated  = [query.trim(), ...filtered].slice(0, 50);
      AsyncStorage.setItem('searchHistory', JSON.stringify(updated));
      return updated;
    });
  };

  const removeSearchHistory = (item: string) => {
    setSearchHistory(prev => {
      const updated = prev.filter(h => h !== item);
      AsyncStorage.setItem('searchHistory', JSON.stringify(updated));
      return updated;
    });
  };

  // ─── Fetch autoplay queue ────────────────────────────────────────────────────
  const fetchQueue = async (songId: string, mood: string) => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/recommendations/queue?songId=${songId}&userId=${userId||''}&mood=${mood}`);
      const json = await resp.json();
      if (json.success) setAutoplayQueue(json.queue || []);
    } catch (e) { /* silent */ }
  };

  // ─── Play track ──────────────────────────────────────────────────────────────
  async function handleTrackPress(track: any) {
    try {
      setIsLoading(true); setPosition(0); setDuration(0); setIsYoutubeFallback(false);
      if (sound) { await sound.unloadAsync(); setSound(null); }
      setActiveTrack(track);
      if (searchQuery.trim()) saveSearchHistory(searchQuery.trim());

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, playThroughEarpieceAndroid: false });

      let newSound: any;
      let usedYoutube = false;
      const downloadedTrack = downloads.find(d => d.id === track.id);

      if (downloadedTrack?.localUri) {
        // ─ Tier 0: offline download ─
        const res = await Audio.Sound.createAsync({ uri: downloadedTrack.localUri }, { shouldPlay: true });
        newSound = res.sound;
      } else if (track.id?.startsWith('yt_')) {
        // ─ Tier YouTube: song came from YouTube search — stream directly via /api/stream with yt_ id ─
        const titleEnc  = encodeURIComponent(track.title  || '');
        const artistEnc = encodeURIComponent(track.artist || '');
        const streamUrl = `${BACKEND_URL}/api/stream?id=${track.id}&title=${titleEnc}&artist=${artistEnc}`;
        const res = await Audio.Sound.createAsync({ uri: streamUrl }, { shouldPlay: true });
        newSound = res.sound;
        usedYoutube = true;
      } else {
        // ─ Tier 1: JioSaavn stream (title+artist passed so backend can auto-fallback) ─
        const titleEnc  = encodeURIComponent(track.title  || '');
        const artistEnc = encodeURIComponent(track.artist || '');
        const streamUrl = `${BACKEND_URL}/api/stream?id=${track.id}&title=${titleEnc}&artist=${artistEnc}`;
        try {
          const res = await Audio.Sound.createAsync({ uri: streamUrl }, { shouldPlay: true });
          newSound = res.sound;
        } catch {
          // ─ Tier 2: /api/refresh (clears stale JioSaavn cache and retries) ─
          try {
            const refreshRes  = await fetch(`${BACKEND_URL}/api/refresh?id=${track.id}`);
            const refreshJson = await refreshRes.json();
            if (refreshJson.success) {
              const res = await Audio.Sound.createAsync({ uri: refreshJson.data.url }, { shouldPlay: true });
              newSound = res.sound;
            } else {
              throw new Error('refresh failed');
            }
          } catch {
            // ─ Tier 3: explicit YouTube fallback ─
            const ytRes  = await fetch(`${BACKEND_URL}/api/youtube-fallback?title=${titleEnc}&artist=${artistEnc}`);
            const ytJson = await ytRes.json();
            if (ytJson.success && ytJson.url) {
              const res = await Audio.Sound.createAsync({ uri: ytJson.url }, { shouldPlay: true });
              newSound = res.sound;
              usedYoutube = true;
            } else {
              throw new Error('Song unavailable on JioSaavn and YouTube');
            }
          }
        }
      }

      setSound(newSound);
      setIsPlaying(true);
      setIsYoutubeFallback(usedYoutube);

      // Eagerly populate the queue immediately with current mood (don't wait for history)
      fetchQueue(track.id, currentMood || 'default');

      // Post to history + detect mood, then refresh queue with better mood
      if (userToken) {
        apiCall('/api/user/history', 'POST', { id: track.id, title: track.title, artist: track.artist, image: track.image }).then(json => {
          if (json.success) {
            const mood = json.mood || 'default';
            setCurrentMood(mood);
            setAutoplayReason('');
            fetchQueue(track.id, mood);   // refresh queue with detected mood
          }
        });
      }


      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded) {
          setPosition(status.positionMillis);
          setDuration(status.durationMillis || 0);
          // Song ended naturally → play a genre-random recommendation
          if (status.didJustFinish && autoNextRef.current) autoNextRef.current();
        }
      });
    } catch (e: any) {
      console.error('Playback error:', e);
      Alert.alert('Song Unavailable', 'This song could not be played from JioSaavn or YouTube. Try another song.');
    } finally {
      setIsLoading(false);
    }
  }


  // ─── Controls ────────────────────────────────────────────────────────────────
  const togglePlayPause = async () => {
    if (!sound) return;
    if (isPlaying) { await sound.pauseAsync(); setIsPlaying(false); }
    else           { await sound.playAsync();  setIsPlaying(true);  }
  };

  const formatTime = (millis: number) => {
    if (!millis || isNaN(millis)) return '0:00';
    const m = Math.floor(millis / 60000), s = Math.floor((millis % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getProgressPercent = () => duration > 0 ? (position / duration) * 100 : 0;

  const handleProgressBarTap = async (event: any) => {
    if (!sound || duration === 0) return;
    const pct = event.nativeEvent.locationX / progressBarWidthRef.current;
    const target = Math.floor(pct * duration);
    setPosition(target);
    await sound.setPositionAsync(target);
  };

  // ─── Active list helper ──────────────────────────────────────────────────────
  const getActiveList = () => {
    if (currentScreen === 'library') return favorites;
    if (currentScreen === 'downloads') return downloads;
    if (currentScreen === 'playlist_view' && activePlaylistId) {
      const pl = playlists.find(p => p.id === activePlaylistId);
      return pl ? pl.songs : [];
    }
    return songsList;
  };

  // ─── Smart autoplay ──────────────────────────────────────────────────────────
  const playNext = async () => {
    if (!activeTrack) return;
    const list = getActiveList();

    // 1. Try sequential next in current list
    if (list.length > 0) {
      const idx = list.findIndex((s: any) => s.id === activeTrack.id);
      if (idx !== -1 && idx + 1 < list.length) { await handleTrackPress(list[idx + 1]); return; }
    }

    // 2. Smart autoplay from JioSaavn mood recommendations
    if (smartAutoplay) {
      try {
        setIsLoading(true);
        const qs  = `songId=${activeTrack.id}&userId=${userId||''}&mood=${currentMood}`;
        const res = await fetch(`${BACKEND_URL}/api/autoplay?${qs}`);
        const json = await res.json();
        if (json.success) {
          setAutoplayReason(json.reason);
          setCurrentMood(json.mood || 'default');
          await handleTrackPress(json.song);
          return;
        }
      } catch (e) { console.error('Smart autoplay failed', e); }
      finally { setIsLoading(false); }
    }

    // 3. Fallback: random
    try {
      const res  = await fetch(`${BACKEND_URL}/api/random`);
      const json = await res.json();
      if (json.success && json.data?.song) { await handleTrackPress(json.data.song); return; }
    } catch (e) { /* silent */ }

    if (list.length > 0) await handleTrackPress(list[0]);
  };

  const playPrevious = async () => {
    if (!activeTrack) return;
    const list = getActiveList();
    if (list.length === 0) return;
    const idx = list.findIndex((s: any) => s.id === activeTrack.id);
    await handleTrackPress(list[Math.max(0, idx - 1)]);
  };

  // Assign ref in render body — always fresh, no useEffect needed
  // This guarantees shake + playback-end callbacks always call the latest version
  playNextRef.current = playNext;

  // ─── Genre-random auto-next (called when a song ENDS naturally) ──────────────
  const handleAutoNext = async () => {
    if (!activeTrack) return;
    // Always use smart autoplay for genre-random pick
    if (smartAutoplay) {
      try {
        setIsLoading(true);
        const qs  = `songId=${activeTrack.id}&userId=${userId||''}&mood=${currentMood}`;
        const res = await fetch(`${BACKEND_URL}/api/autoplay?${qs}`);
        const json = await res.json();
        if (json.success) {
          setAutoplayReason(json.reason);
          setCurrentMood(json.mood || 'default');
          await handleTrackPress(json.song);
          return;
        }
      } catch (e) { console.error('Auto-next failed', e); }
      finally { setIsLoading(false); }
    }
    // Fallback: random song
    try {
      const res  = await fetch(`${BACKEND_URL}/api/random`);
      const json = await res.json();
      if (json.success && json.data?.song) { await handleTrackPress(json.data.song); }
    } catch (e) { /* silent */ }
  };

  // Keep autoNextRef in sync so playback-end callback always calls the latest version
  autoNextRef.current = handleAutoNext;

  // ─── Settings sync ───────────────────────────────────────────────────────────
  const updateSetting = async (key: string, value: boolean) => {
    try { await apiCall('/api/user/settings', 'POST', { [key]: value }); }
    catch (e) { /* silent */ }
  };

  // ─── Track card render ───────────────────────────────────────────────────────
  const renderTrackCard = (song: any, isCurrent: boolean, isFav: boolean) => (
    <TouchableOpacity key={song.id} style={[styles.trackCard, isCurrent && styles.activeTrackCard]} onPress={() => handleTrackPress(song)}>
      <View style={[styles.albumArtPlaceholder, { overflow: 'hidden' }]}>
        {song.image ? (
          <Image source={{ uri: song.image }} style={{ width: 48, height: 48, borderRadius: 8 }} />
        ) : (
          <Ionicons name={isCurrent && isPlaying ? 'pause' : 'disc-outline'} size={24} color={isCurrent ? '#00ffcc' : '#8e8e93'} />
        )}
      </View>
      <View style={styles.trackInfo}>
        <Text numberOfLines={1} style={[styles.trackTitle, isCurrent && { color: MOOD_COLORS[currentMood] || '#00ffcc' }]}>{song.title}</Text>
        <Text numberOfLines={1} style={styles.trackArtist}>{song.artist}</Text>
      </View>
      <TouchableOpacity onPress={() => toggleFavorite(song)} style={{ padding: 8 }}>
        <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? '#ff6b9d' : '#3a3a50'} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setPlaylistSongTarget(song); setPlaylistModalVisible(true); }} style={{ padding: 8 }}>
        <Ionicons name="add-circle-outline" size={22} color="#8e8e93" />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => downloadSong(song)} style={{ padding: 8 }}>
        <Ionicons name={downloads.some(d => d.id === song.id) ? 'cloud-done' : 'cloud-download-outline'} size={22} color={downloads.some(d => d.id === song.id) ? '#00ffcc' : '#8e8e93'} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // ─── Loading screen ──────────────────────────────────────────────────────────
  if (!isAppReady) return (
    <View style={styles.container}>
      <ActivityIndicator color="#00ffcc" size="large" style={{ marginTop: '50%' }} />
    </View>
  );

  // ─── Auth screen ─────────────────────────────────────────────────────────────
  if (!isLoggedIn) return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.authContainer}>
      <StatusBar barStyle="light-content" />
      <View style={styles.authBox}>
        <Ionicons name="pulse" size={64} color="#00ffcc" style={{ marginBottom: 20 }} />
        <Text style={styles.authTitle}>ZYRA</Text>
        <Text style={styles.authSubtitle}>{authMode === 'login' ? 'Sign in to continue' : 'Create your account'}</Text>

        {authMode === 'signup' && (
          <TextInput style={styles.authInput} placeholder="Username" placeholderTextColor="#666" value={username} onChangeText={setUsername} autoCapitalize="none" />
        )}
        <TextInput style={styles.authInput} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextInput style={styles.authInput} placeholder="Password" placeholderTextColor="#666" secureTextEntry value={password} onChangeText={setPassword} />

        <TouchableOpacity style={styles.authBtn} onPress={handleAuth} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>{authMode === 'login' ? 'LOGIN' : 'SIGN UP'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={{ marginTop: 20 }}>
          <Text style={styles.authSwitchText}>{authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Login"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );

  // ─── Main App ────────────────────────────────────────────────────────────────
  const moodColor = MOOD_COLORS[currentMood] || '#00ffcc';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {currentScreen === 'all_songs' ? 'ZYRA' : currentScreen === 'library' ? 'LIBRARY' : currentScreen === 'downloads' ? 'DOWNLOADS' : currentScreen === 'playlist_view' ? 'PLAYLIST' : 'SETTINGS'}
        </Text>
        {autoplayReason.length > 0 && currentScreen === 'all_songs' && (
          <Text style={[styles.autoplayBanner, { color: moodColor }]}>{autoplayReason}</Text>
        )}
      </View>

      <View style={styles.content}>

        {/* ALL SONGS / SEARCH */}
        {currentScreen === 'all_songs' && (
          <View style={styles.screenBody}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#666" style={{ marginRight: 10 }} />
              <TextInput
                placeholder="Search songs, artists..."
                placeholderTextColor="#666"
                style={styles.input}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
              />
              {isSearching ? <ActivityIndicator size="small" color="#00ffcc" /> : searchQuery.length > 0 ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={18} color="#8e8e93" /></TouchableOpacity>
              ) : null}
            </View>

            {/* Search history */}
            {isSearchFocused && searchQuery.trim().length === 0 && searchHistory.length > 0 && (
              <View style={styles.historyDropdown}>
                <Text style={styles.historyHeader}>Recent Searches</Text>
                {searchHistory.map((item, i) => (
                  <View key={i} style={styles.historyItem}>
                    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { setSearchQuery(item); setIsSearchFocused(false); }}>
                      <Ionicons name="time-outline" size={16} color="#8e8e93" style={{ marginRight: 10 }} />
                      <Text style={styles.historyItemText} numberOfLines={1}>{item}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeSearchHistory(item)} style={{ padding: 6 }}>
                      <Ionicons name="close" size={16} color="#8e8e93" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionHeader}>{searchQuery.trim().length > 0 ? 'Results' : 'Search for music'}</Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {songsList.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* LIBRARY */}
        {currentScreen === 'library' && (
          <View style={styles.screenBody}>
            <Text style={styles.sectionHeader}>Your Playlists</Text>
            <ScrollView horizontal style={{ maxHeight: 120, marginBottom: 20 }} showsHorizontalScrollIndicator={false}>
              <TouchableOpacity style={styles.playlistCard} onPress={() => { setPlaylistSongTarget(null); setPlaylistModalVisible(true); }}>
                <Ionicons name="add" size={32} color="#00ffcc" /><Text style={styles.playlistName}>New</Text>
              </TouchableOpacity>
              {playlists.map(pl => (
                <TouchableOpacity key={pl.id} style={styles.playlistCard} onPress={() => { setActivePlaylistId(pl.id); setCurrentScreen('playlist_view'); }}>
                  <Ionicons name="albums-outline" size={32} color="#fff" />
                  <Text numberOfLines={1} style={styles.playlistName}>{pl.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.sectionHeader}>Saved Tracks ({favorites.length})</Text>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {favorites.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* PLAYLIST VIEW */}
        {currentScreen === 'playlist_view' && activePlaylistId && (
          <View style={styles.screenBody}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
              <TouchableOpacity onPress={() => setCurrentScreen('library')} style={{ paddingRight: 15 }}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={[styles.mainText, { marginBottom: 0 }]}>{playlists.find(p => p.id === activePlaylistId)?.name}</Text>
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {playlists.find(p => p.id === activePlaylistId)?.songs.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* DOWNLOADS */}
        {currentScreen === 'downloads' && (
          <View style={styles.screenBody}>
            <Text style={styles.sectionHeader}>Offline Folder ({downloads.length})</Text>
            {downloads.length === 0 ? (
              <View style={styles.centeredBody}>
                <Ionicons name="cloud-offline-outline" size={64} color="#3a3a50" style={{ marginBottom: 15 }} />
                <Text style={styles.mainText}>No Downloads</Text>
                <Text style={styles.subText}>Download tracks to listen without internet.</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {downloads.map(song => {
                  const isCurrent = activeTrack?.id === song.id;
                  const isFav = isTrackFavorite(song.id);
                  return (
                    <TouchableOpacity key={song.id} style={[styles.trackCard, isCurrent && styles.activeTrackCard]} onPress={() => handleTrackPress(song)}>
                      <View style={[styles.albumArtPlaceholder, { overflow: 'hidden' }]}>
                        {song.image ? (
                          <Image source={{ uri: song.image }} style={{ width: 48, height: 48, borderRadius: 8 }} />
                        ) : (
                          <Ionicons name={isCurrent && isPlaying ? 'pause' : 'disc-outline'} size={24} color={isCurrent ? '#00ffcc' : '#8e8e93'} />
                        )}
                      </View>
                      <View style={styles.trackInfo}>
                        <Text numberOfLines={1} style={[styles.trackTitle, isCurrent && { color: MOOD_COLORS[currentMood] || '#00ffcc' }]}>{song.title}</Text>
                        <Text numberOfLines={1} style={styles.trackArtist}>{song.artist}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                          <Ionicons name="cloud-done" size={11} color="#00ffcc" />
                          <Text style={{ color: '#00ffcc', fontSize: 10, marginLeft: 3 }}>Downloaded</Text>
                        </View>
                      </View>
                      <TouchableOpacity onPress={() => toggleFavorite(song)} style={{ padding: 8 }}>
                        <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? '#ff6b9d' : '#3a3a50'} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteDownload(song)} style={{ padding: 8 }}>
                        <Ionicons name="trash-outline" size={22} color="#ff4444" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        {/* SETTINGS */}
        {currentScreen === 'settings' && (
          <View style={styles.screenBody}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Profile card */}
              <View style={[styles.settingRow, { marginBottom: 15 }]}>
                <View style={styles.textGroup}>
                  <Text style={styles.settingTitle}>Signed in as {username}</Text>
                  <Text style={styles.settingDesc}>{email}</Text>
                </View>
                <TouchableOpacity onPress={logout} style={{ padding: 10, backgroundColor: '#1a1a2e', borderRadius: 8 }}>
                  <Text style={{ color: '#ff4444', fontWeight: 'bold' }}>Logout</Text>
                </TouchableOpacity>
              </View>

              {/* Smart Autoplay toggle */}
              <View style={[styles.settingRow, { marginBottom: 15 }]}>
                <View style={styles.textGroup}>
                  <Text style={styles.settingTitle}>🤖 Smart Auto-Play</Text>
                  <Text style={styles.settingDesc}>Plays songs based on your current mood automatically</Text>
                </View>
                <Switch value={smartAutoplay} onValueChange={(v) => { setSmartAutoplay(v); updateSetting('smart_autoplay', v); }}
                  trackColor={{ false: '#252545', true: '#00ffcc' }} thumbColor="#ffffff" />
              </View>

              {/* Shake toggle */}
              <View style={[styles.settingRow, { marginBottom: 15 }]}>
                <View style={styles.textGroup}>
                  <Text style={styles.settingTitle}>📳 Shake to Skip</Text>
                  <Text style={styles.settingDesc}>Shake your phone to skip to the next song</Text>
                </View>
                <Switch value={shakeEnabled} onValueChange={(v) => { setShakeEnabled(v); updateSetting('shake_enabled', v); }}
                  trackColor={{ false: '#252545', true: '#00ffcc' }} thumbColor="#ffffff" />
              </View>

              {/* Stats */}
              <View style={[styles.settingRow, { marginBottom: 15, flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={[styles.settingTitle, { marginBottom: 15 }]}>📊 Your Stats</Text>
                <View style={{ flexDirection: 'row', gap: 20, flexWrap: 'wrap' }}>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{favorites.length}</Text><Text style={styles.statLabel}>Favorites</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{playlists.length}</Text><Text style={styles.statLabel}>Playlists</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{downloads.length}</Text><Text style={styles.statLabel}>Downloads</Text></View>
                </View>
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {/* MINI PLAYER */}
      {activeTrack && (
        <TouchableOpacity style={[styles.miniPlayer, { borderTopColor: moodColor + '44' }]} activeOpacity={0.9} onPress={() => setIsFullScreen(true)}>
          <View style={styles.miniPlayerLeft}>
            {activeTrack.image ? (
              <Image source={{ uri: activeTrack.image }} style={{ width: 38, height: 38, borderRadius: 6, marginRight: 10 }} />
            ) : (
              <Ionicons name="musical-note" size={20} color={moodColor} style={{ marginRight: 10 }} />
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={[styles.miniPlayerTitle, { flex: 1 }]}>{activeTrack.title}</Text>
                {isYoutubeFallback && (
                  <View style={{ backgroundColor: '#ff0000', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>YT</Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={1} style={[styles.miniPlayerArtist, { color: moodColor }]}>{activeTrack.artist}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity onPress={playPrevious}>
              <Ionicons name="play-skip-back" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={[styles.miniPlayerPlayBtn, { backgroundColor: moodColor }]}>
              {isLoading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#050515" />}
            </TouchableOpacity>
            <TouchableOpacity onPress={playNext}>
              <Ionicons name="play-skip-forward" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* BOTTOM NAV */}
      <View style={styles.bottomNav}>
        {[
          { screen: 'all_songs',   icon: 'musical-notes', label: 'Search' },
          { screen: 'library',     icon: 'library',        label: 'Library' },
          { screen: 'downloads',   icon: 'folder',         label: 'Downloads' },
          { screen: 'settings',    icon: 'settings',       label: 'Settings' },
        ].map(tab => {
          const active = currentScreen === tab.screen || (tab.screen === 'library' && currentScreen === 'playlist_view');
          return (
            <TouchableOpacity key={tab.screen} style={styles.navButton} onPress={() => setCurrentScreen(tab.screen)}>
              <Ionicons name={tab.icon as any} size={24} color={active ? moodColor : '#8e8e93'} />
              <Text style={[styles.navText, { color: active ? moodColor : '#8e8e93' }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* PLAYLIST MODAL */}
      <Modal animationType="fade" transparent visible={isPlaylistModalVisible} onRequestClose={() => setPlaylistModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.mainText}>{playlistSongTarget ? 'Add to Playlist' : 'Create Playlist'}</Text>
            <TextInput placeholder="New Playlist Name" placeholderTextColor="#666" style={[styles.authInput, { marginTop: 15 }]} value={newPlaylistName} onChangeText={setNewPlaylistName} />
            <TouchableOpacity style={styles.authBtn} onPress={createNewPlaylist}>
              <Text style={styles.authBtnText}>Create {playlistSongTarget && '& Add'}</Text>
            </TouchableOpacity>
            {playlistSongTarget && playlists.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { marginTop: 20 }]}>Existing Playlists</Text>
                <ScrollView style={{ maxHeight: 150, width: '100%' }}>
                  {playlists.map(pl => (
                    <TouchableOpacity key={pl.id} style={styles.playlistListItem} onPress={() => addToPlaylist(pl.id)}>
                      <Ionicons name="albums-outline" size={20} color="#00ffcc" style={{ marginRight: 10 }} />
                      <Text style={{ color: '#fff', fontSize: 16 }}>{pl.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
            <TouchableOpacity onPress={() => { setPlaylistModalVisible(false); setPlaylistSongTarget(null); }} style={{ marginTop: 20 }}>
              <Text style={{ color: '#8e8e93' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* FULL SCREEN PLAYER */}
      <Modal animationType="slide" transparent={false} visible={isFullScreen} onRequestClose={() => setIsFullScreen(false)}>
        <View style={[styles.fullScreenContainer, { backgroundColor: '#05050f' }]}>
          {/* Header */}
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity onPress={() => setIsFullScreen(false)} style={{ padding: 10 }}>
              <Ionicons name="chevron-down" size={32} color="#fff" />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.fullScreenHeaderText}>NOW PLAYING</Text>
                {isYoutubeFallback && (
                  <View style={{ backgroundColor: '#ff0000', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>YT</Text>
                  </View>
                )}
              </View>
              {currentMood !== 'default' && (
                <View style={[styles.moodBadge, { backgroundColor: moodColor + '22', borderColor: moodColor + '55' }]}>
                  <Text style={[styles.moodBadgeText, { color: moodColor }]}>
                    {currentMood === 'romantic' ? 'Romantic ❤️' : currentMood === 'sad' ? 'Sad 😢' : currentMood === 'item' ? 'Party 🎉' : currentMood === '90s' ? 'Retro 🎶' : currentMood === 'bhajan' ? 'Devotional 🙏' : currentMood === 'energetic' ? 'Energetic ⚡' : ''}
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={() => setMenuVisible(true)} style={{ padding: 10 }}>
              <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Album Art + Ripples */}
          <View style={styles.animationContainer}>
            <Animated.View style={[styles.breathingShadow, {
              backgroundColor: moodColor + '40',
              transform: [{ scale: ring1.interpolate({ inputRange: [0,0.5,1], outputRange: [1,1.15,1] }) }],
              opacity: ring1.interpolate({ inputRange: [0,0.5,1], outputRange: [0.35,0.6,0.35] }),
            }]} />
            {[ring1, ring2, ring3].map((anim, i) => (
              <Animated.View key={i} style={[styles.rippleRing, { borderColor: moodColor + '66',
                transform: [{ scale: anim.interpolate({ inputRange: [0,1], outputRange: [1,1.5] }) }],
                opacity: anim.interpolate({ inputRange: [0,1], outputRange: [0.5,0] }),
              }]} />
            ))}
            <View style={styles.albumArtLarge}>
              {activeTrack?.image ? (
                <Image source={{ uri: activeTrack.image }} style={styles.albumImage} />
              ) : (
                <Ionicons name="disc-outline" size={100} color={moodColor} />
              )}
            </View>
          </View>

          {/* Song info */}
          <View style={styles.fullScreenInfo}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={styles.fullScreenTitle}>{activeTrack?.title}</Text>
              <Text numberOfLines={1} style={[styles.fullScreenArtist, { color: moodColor }]}>{activeTrack?.artist}</Text>
              {autoplayReason.length > 0 && (
                <Text style={[styles.autoplayReasonText, { color: moodColor + 'cc' }]}>{autoplayReason}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => activeTrack && toggleFavorite(activeTrack)}>
              <Ionicons name={activeTrack && isTrackFavorite(activeTrack.id) ? 'heart' : 'heart-outline'} size={32} color={activeTrack && isTrackFavorite(activeTrack.id) ? '#ff6b9d' : '#8e8e93'} />
            </TouchableOpacity>
          </View>

          {/* Progress bar */}
          <View style={styles.sliderSection}>
            <TouchableOpacity activeOpacity={1} style={styles.progressBarBg} onPress={handleProgressBarTap} onLayout={e => progressBarWidthRef.current = e.nativeEvent.layout.width}>
              <View style={[styles.progressBarFill, { width: `${getProgressPercent()}%`, backgroundColor: moodColor }]} />
              <View style={[styles.progressDot, { left: `${getProgressPercent()}%`, shadowColor: moodColor }]} />
            </TouchableOpacity>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>

          {/* Controls */}
          <View style={styles.controlsContainer}>
            <TouchableOpacity onPress={playPrevious}><Ionicons name="play-skip-back" size={40} color="#fff" /></TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={[styles.largePlayBtn, { backgroundColor: moodColor }]}>
              {isLoading ? <ActivityIndicator size="large" color="#050515" /> : <Ionicons name={isPlaying ? 'pause' : 'play'} size={40} color="#050515" style={{ marginLeft: isPlaying ? 0 : 5 }} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={playNext}><Ionicons name="play-skip-forward" size={40} color="#fff" /></TouchableOpacity>
          </View>

          {/* Smart Autoplay Queue */}
          {smartAutoplay && autoplayQueue.length > 0 && (
            <View style={styles.queueContainer}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Ionicons name="sparkles" size={14} color={moodColor} style={{ marginRight: 6 }} />
                <Text style={[styles.queueHeader, { color: moodColor }]}>Up Next — Smart Queue</Text>
              </View>
              {autoplayQueue.map((s, i) => (
                <TouchableOpacity key={i} style={styles.queueItem} onPress={() => { setIsFullScreen(false); handleTrackPress(s); }}>
                  {s.image ? <Image source={{ uri: s.image }} style={{ width: 36, height: 36, borderRadius: 4, marginRight: 10 }} /> : <Ionicons name="musical-note" size={16} color="#8e8e93" style={{ marginRight: 10 }} />}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{s.title}</Text>
                    <Text numberOfLines={1} style={{ color: '#8e8e93', fontSize: 11 }}>{s.artist}</Text>
                  </View>
                  <Text style={{ color: moodColor, fontSize: 11 }}>#{i + 1}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </Modal>

      {/* OPTIONS MENU */}
      <Modal animationType="slide" transparent visible={isMenuVisible} onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={{ backgroundColor: '#121225', paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <View style={{ width: 40, height: 5, backgroundColor: '#3a3a50', borderRadius: 3, alignSelf: 'center', marginTop: 15, marginBottom: 15 }} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) { setPlaylistSongTarget(activeTrack); setPlaylistModalVisible(true); } }}>
              <Ionicons name="add-circle-outline" size={24} color="#00ffcc" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Playlist</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) toggleFavorite(activeTrack); }}>
              <Ionicons name={activeTrack && isTrackFavorite(activeTrack?.id) ? 'heart' : 'heart-outline'} size={24} color={activeTrack && isTrackFavorite(activeTrack?.id) ? '#ff6b9d' : '#fff'} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>{activeTrack && isTrackFavorite(activeTrack?.id) ? 'Remove from Favourites' : 'Add to Favourites'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) downloadSong(activeTrack); }}>
              <Ionicons name={downloads.some(d => d.id === activeTrack?.id) ? 'cloud-done' : 'cloud-download-outline'} size={24} color={downloads.some(d => d.id === activeTrack?.id) ? '#00ffcc' : '#fff'} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>{downloads.some(d => d.id === activeTrack?.id) ? 'Downloaded' : 'Download Offline'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#05050f' },
  header:      { backgroundColor: '#050515', paddingTop: 50, paddingBottom: 10, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#121225' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  autoplayBanner: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  content:     { flex: 1 },
  screenBody:  { flex: 1, padding: 20 },
  centeredBody:{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },

  authContainer: { flex: 1, backgroundColor: '#05050f', justifyContent: 'center', padding: 30 },
  authBox:       { alignItems: 'center', backgroundColor: '#0b0b18', padding: 30, borderRadius: 20, borderWidth: 1, borderColor: '#121225' },
  authTitle:     { color: '#fff', fontSize: 28, fontWeight: 'bold', letterSpacing: 3, marginBottom: 5 },
  authSubtitle:  { color: '#8e8e93', fontSize: 14, marginBottom: 30 },
  authInput:     { width: '100%', backgroundColor: '#121225', color: '#fff', borderRadius: 10, height: 55, paddingHorizontal: 15, marginBottom: 15, fontSize: 16 },
  authBtn:       { width: '100%', backgroundColor: '#00ffcc', height: 55, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  authBtnText:   { color: '#050515', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  authSwitchText:{ color: '#00ffcc', fontSize: 14 },

  searchBox:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121225', paddingHorizontal: 15, borderRadius: 12, height: 50, marginBottom: 8 },
  input:           { color: '#fff', flex: 1, fontSize: 16 },
  historyDropdown: { backgroundColor: '#0e0e22', borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e3a', overflow: 'hidden' },
  historyHeader:   { color: '#8e8e93', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 15, paddingTop: 12, paddingBottom: 6 },
  historyItem:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#151530' },
  historyItemText: { color: '#ccc', fontSize: 15, flex: 1 },
  sectionHeader:   { color: '#8e8e93', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15, letterSpacing: 1 },

  trackCard:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0b0b18', padding: 12, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: 'transparent' },
  activeTrackCard:    { borderColor: '#00ffcc44', backgroundColor: '#0c1d24' },
  albumArtPlaceholder:{ width: 48, height: 48, backgroundColor: '#151530', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  trackInfo:          { flex: 1, marginRight: 10 },
  trackTitle:         { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  trackArtist:        { color: '#8e8e93', fontSize: 12 },
  mainText:           { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subText:            { color: '#8e8e93', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  playlistCard:     { width: 100, height: 100, backgroundColor: '#151530', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  playlistName:     { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 8 },
  playlistListItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#121225', borderRadius: 8, marginBottom: 8 },

  settingRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0b0b18', padding: 20, borderRadius: 16 },
  textGroup:   { flex: 1, paddingRight: 15 },
  settingTitle:{ color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 6 },
  settingDesc: { color: '#8e8e93', fontSize: 13, lineHeight: 18 },

  statBadge:  { backgroundColor: '#121225', padding: 12, borderRadius: 10, alignItems: 'center', minWidth: 70 },
  statNumber: { color: '#00ffcc', fontSize: 22, fontWeight: 'bold' },
  statLabel:  { color: '#8e8e93', fontSize: 11, marginTop: 4 },

  miniPlayer:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0a1622', paddingHorizontal: 15, height: 70, borderTopWidth: 1 },
  miniPlayerLeft:   { flexDirection: 'row', alignItems: 'center', flex: 1 },
  miniPlayerTitle:  { color: '#ffffff', fontSize: 14, fontWeight: 'bold' },
  miniPlayerArtist: { fontSize: 12, marginTop: 2 },
  miniPlayerPlayBtn:{ width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },

  bottomNav:  { flexDirection: 'row', backgroundColor: '#050515', height: 75, borderTopWidth: 1, borderTopColor: '#121225', paddingBottom: 15, justifyContent: 'space-around', alignItems: 'center' },
  navButton:  { alignItems: 'center', justifyContent: 'center', flex: 1 },
  navText:    { fontSize: 11, marginTop: 4, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#0b0b18', padding: 25, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: '#121225' },
  menuItem:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 25 },

  fullScreenContainer:  { flex: 1, padding: 20, paddingTop: 50 },
  fullScreenHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  fullScreenHeaderText: { color: '#8e8e93', fontSize: 12, fontWeight: 'bold', letterSpacing: 2 },
  moodBadge:            { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, marginTop: 4 },
  moodBadgeText:        { fontSize: 11, fontWeight: '600' },
  animationContainer:   { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 30, height: 260 },
  albumArtLarge:        { width: 200, height: 200, borderRadius: 100, backgroundColor: '#0b0b18', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#121225', overflow: 'hidden', zIndex: 10, elevation: 15 },
  albumImage:           { width: '100%', height: '100%', resizeMode: 'cover' },
  breathingShadow:      { position: 'absolute', width: 220, height: 220, borderRadius: 110, zIndex: 1 },
  rippleRing:           { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 1.5, zIndex: 2 },
  fullScreenInfo:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 15 },
  fullScreenTitle:      { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 6 },
  fullScreenArtist:     { fontSize: 16 },
  autoplayReasonText:   { fontSize: 12, marginTop: 6, fontStyle: 'italic' },

  sliderSection:    { width: '100%', marginBottom: 30, paddingHorizontal: 5 },
  progressBarBg:    { width: '100%', height: 6, backgroundColor: '#1c1c3a', borderRadius: 3, justifyContent: 'center', position: 'relative' },
  progressBarFill:  { height: '100%', borderRadius: 3, position: 'absolute' },
  progressDot:      { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff', position: 'absolute', marginTop: -4, marginLeft: -7, elevation: 4 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  timeText:         { color: '#8e8e93', fontSize: 12 },

  controlsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40, marginBottom: 20 },
  largePlayBtn:      { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center' },

  queueContainer: { borderTopWidth: 1, borderTopColor: '#1a1a30', paddingTop: 15 },
  queueHeader:    { fontSize: 12, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase' },
  queueItem:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
});