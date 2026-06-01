import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity,
  Switch, StatusBar, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Animated, Easing, Image, BackHandler, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  Capability, Event, State, AppKilledPlaybackBehavior,
  usePlaybackState, useProgress, useTrackPlayerEvents, RepeatMode,
} from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Accelerometer } from 'expo-sensors';

const BACKEND_URL = 'https://zyra-backend-9nvt.onrender.com';

// ─── Mood Colours ─────────────────────────────────────────────────────────────
const MOOD_COLORS: Record<string, string> = {
  romantic:  '#d41051',
  sad:       '#502db0',
  item:      '#ff1900',
  '90s':     '#d55e14',
  bhajan:    '#e51ae8',
  energetic: '#4000ff',
  default:   '#00ffcc',
};

// ─── ZyraAlert ────────────────────────────────────────────────────────────────
interface AlertButton { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default'; }
interface ZyraAlertProps { visible: boolean; title: string; message: string; buttons: AlertButton[]; onDismiss: () => void; }
function ZyraAlert({ visible, title, message, buttons, onDismiss }: ZyraAlertProps) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDismiss} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', alignItems: 'center', padding: 30 }}>
        <View style={{ width: '100%', backgroundColor: '#09091a', borderRadius: 22, borderWidth: 1.5, borderColor: '#00ffcc55', padding: 28, alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#00ffcc18', borderWidth: 2, borderColor: '#00ffcc88', justifyContent: 'center', alignItems: 'center', marginBottom: 18 }}>
            <Ionicons name="pulse" size={32} color="#00ffcc" />
          </View>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10, textAlign: 'center' }}>{title}</Text>
          <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 22, textTransform: 'uppercase', letterSpacing: 0.4 }}>{message}</Text>
          {buttons.map((btn, i) => (
            <TouchableOpacity key={i} onPress={() => { onDismiss(); btn.onPress?.(); }}
              style={{ width: '80%', height: 46, borderRadius: 23, marginBottom: i < buttons.length - 1 ? 10 : 0, backgroundColor: btn.style === 'cancel' ? 'transparent' : btn.style === 'destructive' ? '#ff4444' : '#00ffcc', borderWidth: btn.style === 'cancel' ? 1 : 0, borderColor: '#333', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: btn.style === 'cancel' ? '#aaa' : '#050515', fontWeight: 'bold', fontSize: 14, letterSpacing: 1 }}>{btn.text}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [isAppReady, setIsAppReady] = useState(false);

  // ── Auth ──
  const [isLoggedIn, setIsLoggedIn]   = useState(false);
  const [authMode, setAuthMode]       = useState<'login'|'signup'|'forgot'|'verify_otp'|'reset_password'>('login');
  const [email, setEmail]             = useState('');
  const [username, setUsername]       = useState('');
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword]           = useState(false);
  const [showNewPassword, setShowNewPassword]     = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [userToken, setUserToken]     = useState<string|null>(null);
  const [userId, setUserId]           = useState<string|null>(null);
  const [otpValue, setOtpValue]             = useState('');
  const [resetEmail, setResetEmail]         = useState('');
  const [newPassword, setNewPassword]       = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // ── Navigation ──
  const [currentScreen, setCurrentScreen] = useState('all_songs');

  // ── User data ──
  const [favorites,  setFavorites]  = useState<any[]>([]);
  const [downloads,  setDownloads]  = useState<any[]>([]);
  const [playlists,  setPlaylists]  = useState<{id:string,name:string,songs:any[]}[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string|null>(null);

  // ── Player ──
  const [isFullScreen, setIsFullScreen]     = useState(false);
  const [activeTrack,  setActiveTrack]      = useState<any>(null);
  const [isLoading,    setIsLoading]        = useState(false);
  const [isYoutubeFallback, setIsYoutubeFallback] = useState(false);
  const progressBarWidthRef = useRef<number>(0);

  // ── RNTP hooks (must be at top level) ──
  const playerState = usePlaybackState();
  const isPlaying   = playerState.state === State.Playing;
  const { position: posRaw, duration: durRaw } = useProgress(500);
  const position = posRaw  * 1000;
  const duration = durRaw  * 1000;

  // ── Repeat & Shuffle ──
  const [repeatMode, setRepeatMode] = useState<'off'|'all'|'one'>('off');
  const [isShuffled, setIsShuffled] = useState(false);

  // ── Sleep Timer ──
  const [sleepTimer,    setSleepTimer]    = useState<number>(0);
  const [sleepTimerEnd, setSleepTimerEnd] = useState<number>(0);
  const sleepTimerRef = useRef<any>(null);

  // ── Lyrics ──
  const [lyrics,         setLyrics]         = useState<string>('');
  const [lyricsLoading,  setLyricsLoading]  = useState(false);
  const [showLyrics,     setShowLyrics]     = useState(false);

  // ── Crossfade ──
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false);

  // ── Equalizer ──
  const [showEqualizerModal, setShowEqualizerModal] = useState(false);
  const [eqBass,   setEqBass]   = useState(0.5);
  const [eqMid,    setEqMid]    = useState(0.5);
  const [eqTreble, setEqTreble] = useState(0.5);

  // ── Recently Played ──
  const [recentlyPlayed, setRecentlyPlayed] = useState<any[]>([]);

  // ── Trending ──
  const [trendingSongs, setTrendingSongs] = useState<any[]>([]);

  // ── Custom Alert ──
  const [alertVisible,  setAlertVisible]  = useState(false);
  const [alertTitle,    setAlertTitle]    = useState('');
  const [alertMessage,  setAlertMessage]  = useState('');
  const [alertButtons,  setAlertButtons]  = useState<AlertButton[]>([{ text: 'OK' }]);

  // ── Long-press Context Menu ──
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuSong,    setContextMenuSong]    = useState<any>(null);

  // ── Search ──
  const [searchQuery,    setSearchQuery]    = useState('');
  const [songsList,      setSongsList]      = useState<any[]>([]);
  const [isSearching,    setIsSearching]    = useState(false);
  const [searchHistory,  setSearchHistory]  = useState<string[]>([]);
  const [isSearchFocused,setIsSearchFocused]= useState(false);

  // ── Smart Autoplay ──
  const [smartAutoplay,  setSmartAutoplay]  = useState(true);
  const [currentMood,    setCurrentMood]    = useState<string>('default');
  const [autoplayReason, setAutoplayReason] = useState<string>('');
  const [autoplayQueue,  setAutoplayQueue]  = useState<any[]>([]);
  const [shakeEnabled,   setShakeEnabled]   = useState(false);

  // ── Album / Movie ──
  const [albumResults,    setAlbumResults]    = useState<any[]>([]);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string|null>(null);

  // ── Artists ──
  const [topArtists,    setTopArtists]    = useState<any[]>([]);
  const [activeArtist,  setActiveArtist]  = useState<any>(null);
  const [artistTracks,  setArtistTracks]  = useState<any[]>([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [isArtistMode,  setIsArtistMode]  = useState(false);
  const artistPlayedRef = useRef<Set<string>>(new Set());

  // ── Theme ──
  const [isDarkMode, setIsDarkMode] = useState(true);

  // ── Modals ──
  const [isPlaylistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistSongTarget,     setPlaylistSongTarget]   = useState<any>(null);
  const [newPlaylistName,        setNewPlaylistName]      = useState('');
  const [isMenuVisible,          setMenuVisible]          = useState(false);

  const typingTimeoutRef   = useRef<any>(null);
  const playNextRef        = useRef<any>(null);
  const handleAutoNextRef  = useRef<any>(null);
  const handleShakeNextRef = useRef<any>(null);
  const trackMetaRef       = useRef<Map<string, any>>(new Map());
  const queueCtxRef = useRef({
    activeTrack: null as any,
    userId:      null as string | null,
    userToken:   null as string | null,
    currentMood: 'default',
    downloads:   [] as any[],
  });
  const screenRef     = useRef('all_songs');
  const fullScreenRef = useRef(false);

  // ── Animations ──
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  // ─── Custom Alert Helper ──────────────────────────────────────────────────────
  const showAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertButtons(buttons || [{ text: 'OK' }]);
    setAlertVisible(true);
  }, []);

  // ─── Ring animations ─────────────────────────────────────────────────────────
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

  // ─── Shake sensor (FIXED: calls handleShakeNext not queue skip) ──────────────
  useEffect(() => {
    let subscription: any;
    if (shakeEnabled) {
      Accelerometer.setUpdateInterval(200);
      let lastShakeTime = 0;
      let lastAcc = 0;
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        const acc   = Math.sqrt(x * x + y * y + z * z);
        const delta = Math.abs(acc - lastAcc);
        lastAcc = acc;
        if (delta > 1.0) {
          const now = Date.now();
          if (now - lastShakeTime > 1500) {
            lastShakeTime = now;
            // FIXED: dedicated shake handler — calls smart autoplay API directly
            if (handleShakeNextRef.current) handleShakeNextRef.current();
          }
        }
      });
    }
    return () => { if (subscription) subscription.remove(); };
  }, [shakeEnabled]);

  // ─── Initial load ─────────────────────────────────────────────────────────────
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
          loadRecentlyPlayed(storedToken);
        }
      } catch (e) { console.error('Init error', e); }
      finally { setIsAppReady(true); }
    };
    init();
    // Keep Render server warm — ping every 4 minutes to prevent cold starts
    const keepAlive = setInterval(() => {
      fetch(`${BACKEND_URL}/ping`).catch(() => {});
    }, 4 * 60 * 1000);
    // Load trending and top artists in background
    fetch(`${BACKEND_URL}/api/trending`).then(r => r.json()).then(j => { if (j.success) setTrendingSongs(j.songs || []); }).catch(() => {});
    fetch(`${BACKEND_URL}/api/artists/top`).then(r => r.json()).then(j => { if (j.success) setTopArtists(j.artists || []); }).catch(() => {});
    return () => clearInterval(keepAlive);
  }, []);

  // ─── RNTP setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await TrackPlayer.setupPlayer({ minBuffer: 3, maxBuffer: 30, playBuffer: 1 });
        await TrackPlayer.updateOptions({
          capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.Stop, Capability.SeekTo],
          compactCapabilities: [Capability.SkipToPrevious, Capability.Play, Capability.SkipToNext],
          notificationCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.Stop],
          progressUpdateEventInterval: 1,
          android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification },
        });
      } catch { /* already initialized on hot reload */ }
    })();
  }, []);

  // ─── Sync state refs ─────────────────────────────────────────────────────────
  useEffect(() => { queueCtxRef.current = { activeTrack, userId, userToken, currentMood, downloads }; });

  // ─── RNTP track-changed ───────────────────────────────────────────────────────
  useTrackPlayerEvents([Event.PlaybackTrackChanged], async (event: any) => {
    if (event.nextTrack !== undefined && event.nextTrack !== null) {
      try {
        const queue = await TrackPlayer.getQueue();
        const nextTrack = queue[event.nextTrack];
        if (nextTrack) {
          const meta = trackMetaRef.current.get(String(nextTrack.id));
          if (meta) setActiveTrack(meta);
          const { userToken: tok } = queueCtxRef.current;
          if (tok && meta) {
            fetch(`${BACKEND_URL}/api/user/history`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify(meta) }).catch(() => {});
          }
          const remaining = queue.length - event.nextTrack - 1;
          if (remaining <= 1) prefillQueue();
        }
      } catch {}
    }
  });

  // ─── RNTP queue-ended ─────────────────────────────────────────────────────────
  useTrackPlayerEvents([Event.PlaybackQueueEnded], async () => { prefillQueue(); });

  // ─── BackHandler refs ─────────────────────────────────────────────────────────
  useEffect(() => { screenRef.current = currentScreen; }, [currentScreen]);
  useEffect(() => { fullScreenRef.current = isFullScreen; }, [isFullScreen]);
  useEffect(() => {
    const onBack = (): boolean => {
      if (fullScreenRef.current) { setIsFullScreen(false); return true; }
      if (screenRef.current !== 'all_songs') { setCurrentScreen('all_songs'); return true; }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []);

  // ─── Search debounce ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchQuery.trim().length === 0) { setSongsList([]); setAlbumResults([]); setExpandedAlbumId(null); return; }
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

  // ─── Load user data ───────────────────────────────────────────────────────────
  const loadUserData = async (token: string) => {
    try {
      const [favsRes, plRes, dlRes, profileRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/user/favorites`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND_URL}/api/user/playlists`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND_URL}/api/user/downloads`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BACKEND_URL}/api/user/profile`,   { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const [favs, pls, dls, profile] = await Promise.all([favsRes.json(), plRes.json(), dlRes.json(), profileRes.json()]);
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

  // ─── Load recently played ─────────────────────────────────────────────────────
  const loadRecentlyPlayed = async (token?: string) => {
    const t = token || userToken;
    if (!t) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/user/history`, { headers: { Authorization: `Bearer ${t}` } });
      const json = await resp.json();
      if (json.success) setRecentlyPlayed((json.data?.history || []).slice(0, 10));
    } catch {}
  };

  // ─── Auth ────────────────────────────────────────────────────────────────────
  const handleAuth = async () => {
    if (!email || !password) { showAlert('Missing Fields', 'Enter email and password.'); return; }
    setIsLoading(true);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body: any = { email: email.trim().toLowerCase(), password };
      if (authMode === 'signup') body.username = username || email.split('@')[0];
      const resp = await fetch(`${BACKEND_URL}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let json: any;
      const rawText = await resp.text();
      try { json = JSON.parse(rawText); }
      catch { showAlert('Server Error', `Status ${resp.status}: ${rawText.slice(0, 200)}`); setIsLoading(false); return; }
      if (json.success) {
        const { token, userId: uid, username: uname } = json;
        setUserToken(token); setUserId(uid); setUsername(uname);
        await AsyncStorage.setItem('token', token);
        await AsyncStorage.setItem('userId', uid);
        await AsyncStorage.setItem('username', uname);
        setIsLoggedIn(true);
        await loadUserData(token);
        loadRecentlyPlayed(token);
      } else {
        showAlert('Error', json.error || 'Authentication failed');
      }
    } catch (e: any) {
      showAlert('Network Error', e?.message || 'Could not connect to server.');
    } finally { setIsLoading(false); }
  };

  const logout = async () => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    await TrackPlayer.reset();
    setActiveTrack(null); setIsLoggedIn(false);
    setAuthMode('login'); setEmail(''); setPassword(''); setUsername('');
    setUserToken(null); setUserId(null);
    setFavorites([]); setPlaylists([]); setDownloads([]); setRecentlyPlayed([]);
    setSleepTimer(0); setSleepTimerEnd(0);
    trackMetaRef.current.clear();
    await AsyncStorage.multiRemove(['token', 'userId', 'username']);
  };

  const updateSetting = async (key: string, value: any) => {
    try { await apiCall('/api/user/settings', 'POST', { [key]: value }); }
    catch (e) { console.error('updateSetting error', e); }
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
    const name = newPlaylistName.trim();
    if (!name) { showAlert('Name Required', 'Please enter a playlist name.'); return; }
    if (playlists.some(p => p.name.toLowerCase() === name.toLowerCase())) { showAlert('Duplicate Name', 'A playlist with this name already exists.'); return; }
    try {
      const json = await apiCall('/api/user/playlists', 'POST', { name, song: playlistSongTarget });
      if (json.success) {
        setPlaylists(json.data.playlists); setNewPlaylistName('');
        if (playlistSongTarget) { setPlaylistModalVisible(false); setPlaylistSongTarget(null); showAlert('Created', 'Playlist created and song added!'); }
        else { showAlert('Created', `"${name}" playlist created!`); }
      }
    } catch (e) { console.error('createPlaylist error', e); }
  };

  const addToPlaylist = async (playlistId: string) => {
    if (!playlistSongTarget) return;
    try {
      const json = await apiCall(`/api/user/playlists/${playlistId}/songs`, 'POST', playlistSongTarget);
      if (json.success) { setPlaylists(json.data.playlists); setPlaylistModalVisible(false); setPlaylistSongTarget(null); showAlert('Added', 'Song added to playlist.'); }
    } catch (e) { console.error('addToPlaylist error', e); }
  };

  // ─── Downloads ───────────────────────────────────────────────────────────────
  const downloadSong = async (song: any) => {
    if (downloads.some(d => d.id === song.id)) { showAlert('Already Downloaded', 'This song is already saved offline.'); return; }
    try {
      showAlert('Downloading', 'Please wait, downloading song...');
      const fileUri = FileSystem.documentDirectory + `zyra_${song.id}.mp3`;
      const titleEnc  = encodeURIComponent(song.title  || '');
      const artistEnc = encodeURIComponent(song.artist || '');
      const urlToDownload = `${BACKEND_URL}/api/stream?id=${song.id}&title=${titleEnc}&artist=${artistEnc}`;
      const downloadRes = await FileSystem.downloadAsync(urlToDownload, fileUri);
      if (!downloadRes.uri) throw new Error('Download failed');
      const entry = { ...song, localUri: downloadRes.uri };
      const json  = await apiCall('/api/user/downloads', 'POST', entry);
      if (json.success) { setDownloads(json.data.downloads); showAlert('Downloaded', 'Song saved for offline listening!'); }
    } catch (e) { console.error('Download error', e); showAlert('Error', 'Download failed. Please try again.'); }
  };

  const deleteDownload = async (song: any) => {
    showAlert('Remove Download', `Remove "${song.title}" from downloads?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          if (song.localUri) { try { await FileSystem.deleteAsync(song.localUri, { idempotent: true }); } catch {} }
          const json = await apiCall(`/api/user/downloads/${song.id}`, 'DELETE');
          if (json.success) setDownloads(json.data.downloads);
          else setDownloads(prev => prev.filter(d => d.id !== song.id));
        } catch (e) { console.error('Delete download error', e); setDownloads(prev => prev.filter(d => d.id !== song.id)); }
      }},
    ]);
  };

  // ─── Search ──────────────────────────────────────────────────────────────────
  const fetchLiveTracks = async (query: string) => {
    try {
      setIsSearching(true);
      const resp = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(query)}`);
      const json = await resp.json();
      if (json.success) { setSongsList(json.data.results || []); setAlbumResults(json.data.albums || []); }
      else { setSongsList([]); setAlbumResults([]); }
    } catch (e) { setSongsList([]); setAlbumResults([]); }
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

  // ─── Fetch autoplay queue ─────────────────────────────────────────────────────
  const fetchQueue = async (songId: string, mood: string) => {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/recommendations/queue?songId=${songId}&userId=${userId||''}&mood=${mood}`);
      const json = await resp.json();
      if (json.success) setAutoplayQueue(json.queue || []);
    } catch {}
  };

  // ─── Stream URL resolver (ASYNC — bypasses Render entirely for JioSaavn) ───────
  // Priority order:
  //  1. Local download (instant)
  //  2. Fresh CDN url already in song object from search (instant, direct)
  //  3. Fetch fresh URL directly from saavn.dev API in-app (~300-800ms, NO Render)
  //  4. Render backend only for YouTube songs (needs yt-dlp)
  const resolveStreamUrl = useCallback(async (song: any): Promise<string> => {
    // 1. Local download
    const dl = downloads.find((d: any) => d.id === song.id);
    if (dl?.localUri) return dl.localUri;

    // 2. YouTube → must use backend (needs yt-dlp server-side)
    if (song.id?.startsWith('yt_')) {
      const te = encodeURIComponent(song.title  || '');
      const ae = encodeURIComponent(song.artist || '');
      return `${BACKEND_URL}/api/stream?id=${song.id}&title=${te}&artist=${ae}`;
    }

    // 3. Fresh CDN url from search results → use directly, no backend at all!
    if (song.url && typeof song.url === 'string' && song.url.includes('saavncdn')) {
      return song.url;
    }

    // 4. No URL saved → fetch fresh from saavn.dev directly in-app (no Render cold start)
    try {
      const res  = await fetch(`https://saavn.dev/api/songs/${song.id}`, { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      const urls: any[] = json?.data?.[0]?.downloadUrl || [];
      const best = urls.find((u: any) => u.quality === '320kbps')
                || urls.find((u: any) => u.quality === '160kbps')
                || urls[urls.length - 1];
      if (best?.url) return best.url;
    } catch (e) {
      console.warn('saavn.dev direct fetch failed, falling back to backend:', e);
    }

    // 5. Final fallback: Render backend
    const te = encodeURIComponent(song.title  || '');
    const ae = encodeURIComponent(song.artist || '');
    return `${BACKEND_URL}/api/stream?id=${song.id}&title=${te}&artist=${ae}`;
  }, [downloads]);

  // ─── Add songs to RNTP queue ──────────────────────────────────────────────────
  const addSongsToQueue = useCallback(async (songs: any[], limitN = 5) => {
    let added = 0;
    for (const song of songs) {
      if (added >= limitN) break;
      if (!song?.id) continue;
      if (trackMetaRef.current.get(String(song.id))) continue;
      trackMetaRef.current.set(String(song.id), song);
      try {
        const url = await resolveStreamUrl(song);
        await TrackPlayer.add({ id: String(song.id), url, title: song.title || '', artist: song.artist || '', artwork: song.image || '' });
        added++;
      } catch {}
    }
  }, [resolveStreamUrl]);

  // ─── Pre-fill queue ───────────────────────────────────────────────────────────
  const prefillQueue = useCallback(async () => {
    const { activeTrack: at, userId: uid, currentMood: mood } = queueCtxRef.current;
    if (!at) return;
    try {
      const qs  = `songId=${at.id}&userId=${uid||''}&mood=${mood}`;
      const res = await fetch(`${BACKEND_URL}/api/autoplay?${qs}`);
      const json = await res.json();
      if (json.success && json.song) {
        await addSongsToQueue([json.song], 1);
        const q = await TrackPlayer.getQueue();
        if (q.length === 1) await TrackPlayer.play();
      }
    } catch {}
  }, [addSongsToQueue]);

  // ─── Fetch artist tracks ──────────────────────────────────────────────────────
  const fetchArtist = async (artist: any) => {
    setActiveArtist(artist); setArtistTracks([]); setArtistLoading(true);
    setIsArtistMode(true); artistPlayedRef.current = new Set();
    setCurrentScreen('artist_profile');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/artist?name=${encodeURIComponent(artist.name)}`);
      const json = await resp.json();
      if (json.success) setArtistTracks(json.tracks || []);
    } catch (e) { console.error('fetchArtist error', e); }
    finally { setArtistLoading(false); }
  };

  // ─── Remove from recently played ─────────────────────────────────────────────
  const removeFromHistory = async (song: any) => {
    // Optimistic update immediately
    setRecentlyPlayed(prev => prev.filter(s => s.id !== song.id));
    try {
      await apiCall(`/api/user/history/${song.id}`, 'DELETE');
    } catch (e) {
      // Rollback on failure
      loadRecentlyPlayed();
    }
  };

  // ─── Play track ───────────────────────────────────────────────────────────────
  async function handleTrackPress(track: any) {
    setIsLoading(true);
    setIsYoutubeFallback(track.id?.startsWith('yt_') || false);
    setActiveTrack(track);
    setShowLyrics(false); setLyrics('');
    if (searchQuery.trim()) saveSearchHistory(searchQuery.trim());

    try {
      // Resolve the stream URL FIRST (directly from saavn.dev, no Render cold start)
      const streamUrl = await resolveStreamUrl(track);

      await TrackPlayer.reset();
      trackMetaRef.current.clear();
      trackMetaRef.current.set(String(track.id), track);
      await TrackPlayer.add({
        id:      String(track.id),
        url:     streamUrl,
        title:   track.title  || '',
        artist:  track.artist || '',
        artwork: track.image  || '',
      });
      await TrackPlayer.play();
      setIsLoading(false);

      // Queue next songs in background
      const list = getActiveList();
      if (list.length > 0) {
        const idx = list.findIndex((s: any) => s.id === track.id);
        const nextSongs = idx >= 0 ? list.slice(idx + 1, idx + 6) : [];
        if (nextSongs.length > 0) addSongsToQueue(nextSongs, 5);
      }

      // Post history + detect mood (background, non-blocking)
      if (userToken) {
        apiCall('/api/user/history', 'POST', { id: track.id, title: track.title, artist: track.artist, image: track.image })
          .then(json => {
            if (json.success) {
              const mood = json.mood || 'default';
              setCurrentMood(mood); setAutoplayReason('');
              fetchQueue(track.id, mood);
            }
          }).catch(() => {});
        loadRecentlyPlayed();
      }
    } catch (e: any) {
      console.error('Playback failed:', e);
      showAlert('Song Unavailable', 'Could not play this song. Please try another.');
      setIsLoading(false);
    }
  }

  // ─── Controls ────────────────────────────────────────────────────────────────
  const togglePlayPause = async () => {
    if (!activeTrack) return;
    if (isPlaying) await TrackPlayer.pause();
    else           await TrackPlayer.play();
  };

  const formatTime = (millis: number) => {
    if (!millis || isNaN(millis)) return '0:00';
    const m = Math.floor(millis / 60000), s = Math.floor((millis % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getProgressPercent = () => duration > 0 ? (position / duration) * 100 : 0;

  const handleProgressBarTap = async (event: any) => {
    if (!activeTrack || duration === 0) return;
    const pct    = event.nativeEvent.locationX / progressBarWidthRef.current;
    await TrackPlayer.seekTo(pct * durRaw);
  };

  // ─── Repeat ──────────────────────────────────────────────────────────────────
  const toggleRepeat = async () => {
    const modes: ('off'|'all'|'one')[] = ['off', 'all', 'one'];
    const next = modes[(modes.indexOf(repeatMode) + 1) % 3];
    setRepeatMode(next);
    if (next === 'off') await TrackPlayer.setRepeatMode(RepeatMode.Off);
    else if (next === 'all') await TrackPlayer.setRepeatMode(RepeatMode.Queue);
    else await TrackPlayer.setRepeatMode(RepeatMode.Track);
  };

  // ─── Shuffle ─────────────────────────────────────────────────────────────────
  const toggleShuffle = async () => {
    const next = !isShuffled;
    setIsShuffled(next);
    if (next && activeTrack) {
      const list = getActiveList();
      if (list.length > 1) {
        const shuffled = [...list].sort(() => Math.random() - 0.5);
        addSongsToQueue(shuffled.slice(0, 6), 6);
      }
    }
  };

  // ─── Sleep Timer ─────────────────────────────────────────────────────────────
  const setSleepTimerDuration = async (minutes: number) => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    setSleepTimer(minutes);
    if (minutes > 0) {
      const endTime = Date.now() + minutes * 60 * 1000;
      setSleepTimerEnd(endTime);
      sleepTimerRef.current = setTimeout(async () => {
        await TrackPlayer.pause();
        setSleepTimer(0); setSleepTimerEnd(0);
        showAlert('Sleep Timer', 'Playback paused. Goodnight!');
      }, minutes * 60 * 1000);
    } else {
      setSleepTimerEnd(0);
    }
  };

  // ─── Lyrics ──────────────────────────────────────────────────────────────────
  const fetchLyrics = async (song: any) => {
    if (!song) return;
    setLyricsLoading(true); setLyrics('');
    try {
      const resp = await fetch(`${BACKEND_URL}/api/lyrics?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`);
      const json = await resp.json();
      if (json.success && json.lyrics) setLyrics(json.lyrics);
      else setLyrics('Lyrics not available for this song.');
    } catch { setLyrics('Could not load lyrics.'); }
    finally { setLyricsLoading(false); }
  };

  // ─── Share ───────────────────────────────────────────────────────────────────
  const shareSong = async (song: any) => {
    try {
      await Share.share({ title: song.title, message: `🎵 Listening to "${song.title}" by ${song.artist} on Zyra Music!` });
    } catch {}
  };

  // ─── Add single song to queue (long-press) ────────────────────────────────────
  const addSingleToQueue = async (song: any) => {
    if (!song?.id) return;
    if (trackMetaRef.current.get(String(song.id))) { showAlert('Already in Queue', 'This song is already in the up next queue.'); return; }
    trackMetaRef.current.set(String(song.id), song);
    try {
      const url = await resolveStreamUrl(song);
      await TrackPlayer.add({ id: String(song.id), url, title: song.title || '', artist: song.artist || '', artwork: song.image || '' });
      showAlert('Added to Queue', `"${song.title}" added to up next.`);
    } catch { showAlert('Error', 'Could not add to queue.'); }
  };

  // ─── Active list helper ───────────────────────────────────────────────────────
  const getActiveList = () => {
    if (currentScreen === 'library') return favorites;
    if (currentScreen === 'downloads') return downloads;
    if (currentScreen === 'playlist_view' && activePlaylistId) {
      const pl = playlists.find(p => p.id === activePlaylistId);
      return pl ? pl.songs : [];
    }
    return songsList;
  };

  // ─── playNext / playPrevious ──────────────────────────────────────────────────
  const playNext = async () => {
    if (!activeTrack) return;
    if (repeatMode === 'one') { await TrackPlayer.seekTo(0); await TrackPlayer.play(); return; }
    try { await TrackPlayer.skipToNext(); }
    catch { await handleAutoNext(); }
  };

  const playPrevious = async () => {
    if (!activeTrack) return;
    if (posRaw > 3) await TrackPlayer.seekTo(0);
    else { try { await TrackPlayer.skipToPrevious(); } catch { await TrackPlayer.seekTo(0); } }
  };

  playNextRef.current = playNext;

  // ─── Genre-smart auto-next ────────────────────────────────────────────────────
  const handleAutoNext = async () => {
    if (!activeTrack) return;
    if (smartAutoplay) {
      try {
        setIsLoading(true);
        const qs  = `songId=${activeTrack.id}&userId=${userId||''}&mood=${currentMood}`;
        const res = await fetch(`${BACKEND_URL}/api/autoplay?${qs}`);
        const json = await res.json();
        if (json.success) { setAutoplayReason(json.reason); setCurrentMood(json.mood || 'default'); await handleTrackPress(json.song); return; }
      } catch (e) { console.error('Auto-next failed', e); }
      finally { setIsLoading(false); }
    }
    try {
      const res  = await fetch(`${BACKEND_URL}/api/random`);
      const json = await res.json();
      if (json.success && json.data?.song) await handleTrackPress(json.data.song);
    } catch {}
  };
  handleAutoNextRef.current = handleAutoNext;

  // ─── Shake-specific: smart autoplay API directly (FIXED) ─────────────────────
  const handleShakeNext = async () => {
    const { activeTrack: at, userId: uid, currentMood: mood } = queueCtxRef.current;
    if (!at) return;
    try {
      setIsLoading(true);
      const qs  = `songId=${at.id}&userId=${uid||''}&mood=${mood}`;
      const res = await fetch(`${BACKEND_URL}/api/autoplay?${qs}`);
      const json = await res.json();
      if (json.success && json.song) {
        setAutoplayReason(json.reason || '✨ Shaken to same genre');
        setCurrentMood(json.mood || 'default');
        await handleTrackPress(json.song);
        return;
      }
      // Fallback: random
      const r2   = await fetch(`${BACKEND_URL}/api/random`);
      const j2   = await r2.json();
      if (j2.success && j2.data?.song) await handleTrackPress(j2.data.song);
    } catch (e) { console.error('Shake next failed', e); }
    finally { setIsLoading(false); }
  };
  handleShakeNextRef.current = handleShakeNext;

  // ─── Theme ───────────────────────────────────────────────────────────────────
  const theme = {
    bg:      isDarkMode ? '#05050f' : '#f0f0fa',
    card:    isDarkMode ? '#0b0b18' : '#ffffff',
    surface: isDarkMode ? '#121225' : '#e8e8f8',
    header:  isDarkMode ? '#050515' : '#e0e0f5',
    text:    isDarkMode ? '#ffffff' : '#111133',
    subtext: isDarkMode ? '#8e8e93' : '#555577',
    border:  isDarkMode ? '#121225' : '#d0d0e8',
    input:   isDarkMode ? '#121225' : '#eaeaf8',
    navBg:   isDarkMode ? '#050515' : '#e0e0f5',
    miniPlayerBg: isDarkMode ? '#0a1622' : '#dde8f5',
  };

  // ─── Track card ───────────────────────────────────────────────────────────────
  const renderTrackCard = (song: any, isCurrent: boolean, isFav: boolean) => (
    <TouchableOpacity
      key={song.id}
      style={[styles.trackCard, { backgroundColor: theme.card, borderColor: isCurrent ? moodColor + '44' : 'transparent' }]}
      onPress={() => handleTrackPress(song)}
      onLongPress={() => { setContextMenuSong(song); setContextMenuVisible(true); }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
        {song.image ? <Image source={{ uri: song.image }} style={{ width: 48, height: 48 }} /> : <Ionicons name={isCurrent && isPlaying ? 'pause' : 'disc-outline'} size={24} color={isCurrent ? moodColor : '#8e8e93'} />}
      </View>
      <View style={styles.trackInfo}>
        <Text numberOfLines={1} style={[styles.trackTitle, { color: isCurrent ? moodColor : theme.text }]}>{song.title}</Text>
        <Text numberOfLines={1} style={[styles.trackArtist, { color: theme.subtext }]}>{song.artist}</Text>
      </View>
      <TouchableOpacity onPress={() => toggleFavorite(song)} style={{ padding: 8 }}>
        <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={22} color={isFav ? '#ff6b9d' : '#3a3a50'} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setPlaylistSongTarget(song); setPlaylistModalVisible(true); }} style={{ padding: 8 }}>
        <Ionicons name="add-circle-outline" size={22} color="#8e8e93" />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => downloadSong(song)} style={{ padding: 8 }}>
        <Ionicons name={downloads.some(d => d.id === song.id) ? 'cloud-done' : 'cloud-download-outline'} size={22} color={downloads.some(d => d.id === song.id) ? moodColor : '#8e8e93'} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  // ─── Loading ──────────────────────────────────────────────────────────────────
  if (!isAppReady) return (
    <View style={styles.container}>
      <ActivityIndicator color="#00ffcc" size="large" style={{ marginTop: '50%' }} />
    </View>
  );

  // ─── Auth screen ──────────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    const handleForgotPassword = async () => {
      if (!resetEmail) { showAlert('Error', 'Please enter your email.'); return; }
      setIsLoading(true);
      try {
        const resp = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail.trim().toLowerCase() }) });
        const json = await resp.json();
        if (json.success) { showAlert('OTP Sent', json.message); setAuthMode('verify_otp'); }
        else showAlert('Error', json.error || 'Failed to send OTP');
      } catch { showAlert('Error', 'Network error. Please check your connection.'); }
      finally { setIsLoading(false); }
    };
    const handleVerifyOtp = async () => {
      if (!otpValue || otpValue.length !== 6) { showAlert('Error', 'Please enter the 6-digit OTP.'); return; }
      setIsLoading(true);
      try {
        const resp = await fetch(`${BACKEND_URL}/api/auth/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail, otp: otpValue }) });
        const json = await resp.json();
        if (json.success) { showAlert('Verified', json.message); setAuthMode('reset_password'); }
        else showAlert('Error', json.error || 'OTP verification failed');
      } catch { showAlert('Error', 'Network error. Please check your connection.'); }
      finally { setIsLoading(false); }
    };
    const handleResetPassword = async () => {
      if (!newPassword || newPassword.length < 6) { showAlert('Error', 'Password must be at least 6 characters.'); return; }
      if (newPassword !== confirmPassword) { showAlert('Error', 'Passwords do not match.'); return; }
      setIsLoading(true);
      try {
        const resp = await fetch(`${BACKEND_URL}/api/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail, otp: otpValue, password: newPassword }) });
        const json = await resp.json();
        if (json.success) {
          showAlert('Success', json.message, [{ text: 'Login Now', onPress: () => { setAuthMode('login'); setOtpValue(''); setResetEmail(''); setNewPassword(''); setConfirmPassword(''); } }]);
        } else showAlert('Error', json.error || 'Password reset failed');
      } catch { showAlert('Error', 'Network error. Please check your connection.'); }
      finally { setIsLoading(false); }
    };

    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <ZyraAlert visible={alertVisible} title={alertTitle} message={alertMessage} buttons={alertButtons} onDismiss={() => setAlertVisible(false)} />
        <View style={styles.authBox}>
          <Ionicons name="pulse" size={64} color="#00ffcc" style={{ marginBottom: 20 }} />
          <Text style={styles.authTitle}>ZYRA</Text>

          {authMode === 'login' && (<>
            <Text style={styles.authSubtitle}>Sign in to continue</Text>
            <TextInput style={styles.authInput} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <View style={styles.passwordRow}>
              <TextInput style={[styles.authInput, { flex: 1, marginBottom: 0 }]} placeholder="Password" placeholderTextColor="#666" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#8e8e93" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.authBtn} onPress={handleAuth} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>LOGIN</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setResetEmail(email); setAuthMode('forgot'); }} style={{ marginTop: 14 }}>
              <Text style={{ color: '#8e8e93', fontSize: 14 }}>Forgot Password?</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAuthMode('signup')} style={{ marginTop: 14 }}>
              <Text style={styles.authSwitchText}>Don't have an account? Sign Up</Text>
            </TouchableOpacity>
          </>)}

          {authMode === 'signup' && (<>
            <Text style={styles.authSubtitle}>Create your account</Text>
            <TextInput style={styles.authInput} placeholder="Username" placeholderTextColor="#666" value={username} onChangeText={setUsername} autoCapitalize="none" />
            <TextInput style={styles.authInput} placeholder="Email" placeholderTextColor="#666" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <View style={styles.passwordRow}>
              <TextInput style={[styles.authInput, { flex: 1, marginBottom: 0 }]} placeholder="Password" placeholderTextColor="#666" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off' : 'eye'} size={22} color="#8e8e93" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.authBtn} onPress={handleAuth} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>SIGN UP</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAuthMode('login')} style={{ marginTop: 20 }}>
              <Text style={styles.authSwitchText}>Already have an account? Login</Text>
            </TouchableOpacity>
          </>)}

          {authMode === 'forgot' && (<>
            <Text style={styles.authSubtitle}>Enter your registered email</Text>
            <TextInput style={styles.authInput} placeholder="Email" placeholderTextColor="#666" value={resetEmail} onChangeText={setResetEmail} autoCapitalize="none" keyboardType="email-address" />
            <TouchableOpacity style={styles.authBtn} onPress={handleForgotPassword} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>SEND OTP</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAuthMode('login')} style={styles.backToLoginBtn}>
              <Ionicons name="arrow-back" size={16} color="#00ffcc" />
              <Text style={styles.backToLoginText}>Back to Login</Text>
            </TouchableOpacity>
          </>)}

          {authMode === 'verify_otp' && (<>
            <Text style={styles.authSubtitle}>Enter the 6-digit OTP sent to</Text>
            <Text style={{ color: '#00ffcc', fontSize: 13, marginBottom: 16 }}>{resetEmail}</Text>
            <TextInput style={styles.authInput} placeholder="6-digit OTP" placeholderTextColor="#666" value={otpValue} onChangeText={setOtpValue} keyboardType="number-pad" maxLength={6} />
            <TouchableOpacity style={styles.authBtn} onPress={handleVerifyOtp} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>VERIFY OTP</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleForgotPassword} style={{ marginTop: 14 }}>
              <Text style={{ color: '#8e8e93', fontSize: 14 }}>Resend OTP</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAuthMode('login')} style={styles.backToLoginBtn}>
              <Ionicons name="arrow-back" size={16} color="#00ffcc" />
              <Text style={styles.backToLoginText}>Back to Login</Text>
            </TouchableOpacity>
          </>)}

          {authMode === 'reset_password' && (<>
            <Text style={styles.authSubtitle}>Create a new password</Text>
            <View style={styles.passwordRow}>
              <TextInput style={[styles.authInput, { flex: 1, marginBottom: 0 }]} placeholder="New Password" placeholderTextColor="#666" secureTextEntry={!showNewPassword} value={newPassword} onChangeText={setNewPassword} />
              <TouchableOpacity onPress={() => setShowNewPassword(v => !v)} style={styles.eyeBtn}>
                <Ionicons name={showNewPassword ? 'eye-off' : 'eye'} size={22} color="#8e8e93" />
              </TouchableOpacity>
            </View>
            <View style={styles.passwordRow}>
              <TextInput style={[styles.authInput, { flex: 1, marginBottom: 0 }]} placeholder="Confirm Password" placeholderTextColor="#666" secureTextEntry={!showConfirmPassword} value={confirmPassword} onChangeText={setConfirmPassword} />
              <TouchableOpacity onPress={() => setShowConfirmPassword(v => !v)} style={styles.eyeBtn}>
                <Ionicons name={showConfirmPassword ? 'eye-off' : 'eye'} size={22} color="#8e8e93" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.authBtn} onPress={handleResetPassword} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>RESET PASSWORD</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAuthMode('login')} style={styles.backToLoginBtn}>
              <Ionicons name="arrow-back" size={16} color="#00ffcc" />
              <Text style={styles.backToLoginText}>Back to Login</Text>
            </TouchableOpacity>
          </>)}
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── Main App ─────────────────────────────────────────────────────────────────
  const moodColor = MOOD_COLORS[currentMood] || '#00ffcc';
  const sleepRemaining = sleepTimer > 0 && sleepTimerEnd > 0 ? Math.max(0, Math.floor((sleepTimerEnd - Date.now()) / 1000)) : 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.header} />

      {/* CUSTOM ALERT */}
      <ZyraAlert visible={alertVisible} title={alertTitle} message={alertMessage} buttons={alertButtons} onDismiss={() => setAlertVisible(false)} />

      {/* HEADER */}
      <View style={[styles.header, { backgroundColor: theme.header }]}>
        <View style={[styles.headerPill, { backgroundColor: moodColor + '18', borderColor: moodColor + '44' }]}>
          <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : theme.text }]}>
            {currentScreen === 'all_songs' ? 'HOME' : currentScreen === 'library' ? 'LIBRARY' : currentScreen === 'downloads' ? 'DOWNLOADS' : currentScreen === 'playlist_view' ? 'PLAYLIST' : currentScreen === 'artist_profile' ? (activeArtist?.name || 'ARTIST').toUpperCase() : 'SETTINGS'}
          </Text>
        </View>
        {sleepTimer > 0 && (
          <Text style={{ color: '#ff9944', fontSize: 11, marginTop: 4, fontWeight: '600' }}>
            😴 Sleep in {Math.floor(sleepRemaining / 60)}:{String(sleepRemaining % 60).padStart(2, '0')}
          </Text>
        )}
        {autoplayReason.length > 0 && currentScreen === 'all_songs' && sleepTimer === 0 && (
          <Text style={[styles.autoplayBanner, { color: moodColor }]}>{autoplayReason}</Text>
        )}
      </View>

      <View style={styles.content}>

        {/* HOME */}
        {currentScreen === 'all_songs' && (
          <View style={styles.screenBody}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#666" style={{ marginRight: 10 }} />
              <TextInput placeholder="Search songs, artists..." placeholderTextColor="#666" style={styles.input} value={searchQuery} onChangeText={setSearchQuery} onFocus={() => setIsSearchFocused(true)} onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)} />
              {isSearching ? <ActivityIndicator size="small" color="#00ffcc" /> : searchQuery.length > 0 ? (<TouchableOpacity onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={18} color="#8e8e93" /></TouchableOpacity>) : null}
            </View>

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

            {searchQuery.trim().length > 0 ? (
              <>
                {albumResults.length > 0 && (
                  <>
                    <Text style={[styles.sectionHeader, { color: '#00ffcc' }]}>🎬 Albums / Movies</Text>
                    {albumResults.map(album => (
                      <View key={album.id} style={{ marginBottom: 8 }}>
                        <TouchableOpacity style={[styles.trackCard, { backgroundColor: theme.card, borderColor: '#00ffcc33' }]} onPress={() => setExpandedAlbumId(expandedAlbumId === album.id ? null : album.id)}>
                          <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                            {album.image ? <Image source={{ uri: album.image }} style={{ width: 48, height: 48 }} /> : <Ionicons name="film-outline" size={24} color="#00ffcc" />}
                          </View>
                          <View style={styles.trackInfo}>
                            <Text numberOfLines={1} style={[styles.trackTitle, { color: '#00ffcc' }]}>{album.name}</Text>
                            <Text style={[styles.trackArtist, { color: theme.subtext }]}>{album.songs.length} songs</Text>
                          </View>
                          <Ionicons name={expandedAlbumId === album.id ? 'chevron-up' : 'chevron-down'} size={20} color="#00ffcc" style={{ marginRight: 4 }} />
                        </TouchableOpacity>
                        {expandedAlbumId === album.id && (
                          <View style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#00ffcc33', marginLeft: 16, marginTop: 4 }}>
                            {album.songs.map((song: any) => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
                          </View>
                        )}
                      </View>
                    ))}
                    <View style={{ height: 1, backgroundColor: theme.border, marginBottom: 16 }} />
                  </>
                )}
                <Text style={styles.sectionHeader}>Results</Text>
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  {songsList.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
                </ScrollView>
              </>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>

                {/* Recently Played */}
                {recentlyPlayed.length > 0 && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text style={[styles.sectionHeader, { color: theme.subtext, marginBottom: 0 }]}>Recently Played</Text>
                      <Text style={{ color: '#ff444488', fontSize: 11 }}>Hold to remove</Text>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                      {recentlyPlayed.map((song, i) => (
                        <TouchableOpacity
                          key={i}
                          style={styles.recentCard}
                          onPress={() => handleTrackPress(song)}
                          onLongPress={() =>
                            showAlert('Remove Song', `Remove "${song.title}" from recently played?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Remove', style: 'destructive', onPress: () => removeFromHistory(song) },
                            ])
                          }
                        >
                          <View style={{ width: 68, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.surface, marginBottom: 8, borderWidth: activeTrack?.id === song.id ? 2 : 0, borderColor: moodColor }}>
                            {song.image ? <Image source={{ uri: song.image }} style={{ width: 68, height: 68 }} /> : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="musical-note" size={24} color={moodColor} /></View>}
                          </View>
                          <Text numberOfLines={1} style={{ color: activeTrack?.id === song.id ? moodColor : theme.text, fontSize: 11, fontWeight: '600', width: 72, textAlign: 'center' }}>{song.title}</Text>
                          <Text numberOfLines={1} style={{ color: theme.subtext, fontSize: 10, width: 72, textAlign: 'center' }}>{song.artist}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* Browse by Mood */}
                <Text style={[styles.sectionHeader, { color: theme.subtext }]}>Browse by Mood</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                  {[
                    { label: '❤️ Romantic', mood: 'romantic', color: '#d41051' },
                    { label: '😢 Sad',      mood: 'sad',      color: '#502db0' },
                    { label: '🎉 Party',    mood: 'item',     color: '#ff1900' },
                    { label: '🎶 90s',      mood: '90s',      color: '#d55e14' },
                    { label: '🙏 Bhajan',   mood: 'bhajan',   color: '#e51ae8' },
                    { label: '⚡ Energy',   mood: 'energetic',color: '#4000ff' },
                  ].map(g => (
                    <TouchableOpacity key={g.mood}
                      style={{ width: '31%', backgroundColor: g.color + '22', borderWidth: 1.5, borderColor: g.color + '88', borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => { setCurrentMood(g.mood); setSearchQuery(g.label.split(' ').slice(1).join(' ') + ' songs'); }}>
                      <Text style={{ fontSize: 22, marginBottom: 4 }}>{g.label.split(' ')[0]}</Text>
                      <Text style={{ color: g.color, fontWeight: '700', fontSize: 12 }}>{g.label.split(' ').slice(1).join(' ')}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Trending Now */}
                <Text style={[styles.sectionHeader, { color: theme.subtext }]}>Trending Now 🔥</Text>
                {trendingSongs.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                    {trendingSongs.map((song, i) => (
                      <TouchableOpacity key={i} style={styles.trendingCard} onPress={() => handleTrackPress(song)}>
                        <View style={{ width: 120, height: 120, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.surface, marginBottom: 8 }}>
                          {song.image ? <Image source={{ uri: song.image }} style={{ width: 120, height: 120 }} /> : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="musical-note" size={32} color={moodColor} /></View>}
                          <View style={styles.trendingRank}><Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>#{i + 1}</Text></View>
                        </View>
                        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12, fontWeight: '600', width: 120 }}>{song.title}</Text>
                        <Text numberOfLines={1} style={{ color: theme.subtext, fontSize: 11, width: 120 }}>{song.artist}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={{ height: 80, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
                    <ActivityIndicator size="small" color={moodColor} />
                    <Text style={{ color: theme.subtext, fontSize: 12, marginTop: 8 }}>Loading trending songs...</Text>
                  </View>
                )}

                {/* Top Artists */}
                <Text style={[styles.sectionHeader, { color: theme.subtext }]}>Top Artists</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 }}>
                  {topArtists.map((artist, i) => (
                    <TouchableOpacity key={i} style={{ width: '48%', backgroundColor: theme.card, borderRadius: 14, padding: 12, marginBottom: 12, alignItems: 'center', borderWidth: 1, borderColor: theme.border }} onPress={() => fetchArtist(artist)}>
                      <View style={{ width: 72, height: 72, borderRadius: 36, overflow: 'hidden', backgroundColor: theme.surface, borderWidth: 2.5, borderColor: moodColor + '55', marginBottom: 8 }}>
                        {artist.image ? (<Image source={{ uri: artist.image }} style={{ width: 72, height: 72, borderRadius: 36 }} defaultSource={require('./assets/icon.png')} />) : (
                          <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: moodColor + '33' }}>
                            <Text style={{ color: '#fff', fontSize: 26, fontWeight: 'bold' }}>{artist.name.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{artist.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* ARTIST PROFILE */}
        {currentScreen === 'artist_profile' && (
          <View style={styles.screenBody}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setCurrentScreen('all_songs')} style={{ paddingRight: 14 }}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              {activeArtist?.image ? (<Image source={{ uri: activeArtist.image }} style={{ width: 50, height: 50, borderRadius: 25, marginRight: 12 }} />) : (
                <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: '#1a1a3e', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Ionicons name="person" size={24} color="#00ffcc" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>{activeArtist?.name}</Text>
                <Text style={{ color: '#00ffcc', fontSize: 12 }}>{artistTracks.length} songs</Text>
              </View>
            </View>
            {artistLoading ? (
              <View style={styles.centeredBody}><ActivityIndicator color="#00ffcc" size="large" /><Text style={[styles.subText, { marginTop: 12 }]}>Loading songs...</Text></View>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {artistTracks.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
              </ScrollView>
            )}
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
                <TouchableOpacity key={pl.id} style={[styles.playlistCard, { position: 'relative' }]}
                  onPress={() => { setActivePlaylistId(pl.id); setCurrentScreen('playlist_view'); }}
                  onLongPress={() => {
                    showAlert('Delete Playlist', `Delete "${pl.name}"? This cannot be undone.`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: async () => {
                        try {
                          const json = await apiCall(`/api/user/playlists/${pl.id}`, 'DELETE');
                          if (json.success) setPlaylists(json.data.playlists);
                          else setPlaylists(prev => prev.filter(p => p.id !== pl.id));
                        } catch { setPlaylists(prev => prev.filter(p => p.id !== pl.id)); }
                      }},
                    ]);
                  }}>
                  <Ionicons name="albums-outline" size={32} color="#fff" />
                  <Text numberOfLines={1} style={styles.playlistName}>{pl.name}</Text>
                  <Text style={{ color: '#ff444466', fontSize: 9, marginTop: 2 }}>Hold to delete</Text>
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
                    <TouchableOpacity key={song.id}
                      style={[styles.trackCard, { backgroundColor: theme.card, borderColor: isCurrent ? moodColor + '44' : 'transparent' }]}
                      onPress={() => handleTrackPress(song)}
                      onLongPress={() => { setContextMenuSong(song); setContextMenuVisible(true); }}>
                      <View style={{ width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                        {song.image ? <Image source={{ uri: song.image }} style={{ width: 48, height: 48 }} /> : <Ionicons name={isCurrent && isPlaying ? 'pause' : 'disc-outline'} size={24} color={isCurrent ? moodColor : '#8e8e93'} />}
                      </View>
                      <View style={styles.trackInfo}>
                        <Text numberOfLines={1} style={[styles.trackTitle, { color: isCurrent ? moodColor : theme.text }]}>{song.title}</Text>
                        <Text numberOfLines={1} style={[styles.trackArtist, { color: theme.subtext }]}>{song.artist}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                          <Ionicons name="cloud-done" size={11} color={moodColor} />
                          <Text style={{ color: moodColor, fontSize: 10, marginLeft: 3 }}>Downloaded</Text>
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
              {/* Profile */}
              <View style={[styles.settingRow, { marginBottom: 15 }]}>
                <View style={styles.textGroup}>
                  <Text style={styles.settingTitle}>Signed in as {username}</Text>
                  <Text style={styles.settingDesc}>{email}</Text>
                </View>
                <TouchableOpacity onPress={logout} style={{ padding: 10, backgroundColor: '#1a1a2e', borderRadius: 8 }}>
                  <Text style={{ color: '#ff4444', fontWeight: 'bold' }}>Logout</Text>
                </TouchableOpacity>
              </View>

              {/* Dark mode */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1 }]}>
                <View style={styles.textGroup}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>{isDarkMode ? '🌙 Dark Mode' : '☀️ Light Mode'}</Text>
                  <Text style={[styles.settingDesc, { color: theme.subtext }]}>{isDarkMode ? 'Switch to light theme' : 'Switch to dark theme'}</Text>
                </View>
                <Switch value={isDarkMode} onValueChange={setIsDarkMode} trackColor={{ false: '#ccc', true: moodColor }} thumbColor="#ffffff" />
              </View>

              {/* Smart Autoplay */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card }]}>
                <View style={styles.textGroup}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>🤖 Smart Auto-Play</Text>
                  <Text style={[styles.settingDesc, { color: theme.subtext }]}>Plays songs based on your mood automatically</Text>
                </View>
                <Switch value={smartAutoplay} onValueChange={(v) => { setSmartAutoplay(v); updateSetting('smart_autoplay', v); }} trackColor={{ false: '#252545', true: moodColor }} thumbColor="#ffffff" />
              </View>

              {/* Shake */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card }]}>
                <View style={styles.textGroup}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>📳 Shake to Skip</Text>
                  <Text style={[styles.settingDesc, { color: theme.subtext }]}>Shake phone to play a same-genre song</Text>
                </View>
                <Switch value={shakeEnabled} onValueChange={(v) => { setShakeEnabled(v); updateSetting('shake_enabled', v); }} trackColor={{ false: '#252545', true: moodColor }} thumbColor="#ffffff" />
              </View>

              {/* Sleep Timer */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={[styles.settingTitle, { color: theme.text, marginBottom: 12 }]}>
                  😴 Sleep Timer {sleepTimer > 0 ? `— ${Math.floor(sleepRemaining / 60)}:${String(sleepRemaining % 60).padStart(2, '0')} left` : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                  {[0, 15, 30, 60].map(min => (
                    <TouchableOpacity key={min}
                      style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: sleepTimer === min ? moodColor : '#1a1a3e', borderWidth: 1, borderColor: sleepTimer === min ? moodColor : '#333' }}
                      onPress={() => setSleepTimerDuration(min)}>
                      <Text style={{ color: sleepTimer === min ? '#050515' : '#fff', fontWeight: '600', fontSize: 13 }}>{min === 0 ? 'Off' : `${min} min`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Crossfade */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card }]}>
                <View style={styles.textGroup}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>🎵 Crossfade</Text>
                  <Text style={[styles.settingDesc, { color: theme.subtext }]}>Smooth transition between songs</Text>
                </View>
                <Switch value={crossfadeEnabled} onValueChange={setCrossfadeEnabled} trackColor={{ false: '#252545', true: moodColor }} thumbColor="#ffffff" />
              </View>

              {/* Equalizer */}
              <TouchableOpacity style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card }]} onPress={() => setShowEqualizerModal(true)}>
                <View style={styles.textGroup}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>🎛️ Equalizer</Text>
                  <Text style={[styles.settingDesc, { color: theme.subtext }]}>Adjust Bass, Mid & Treble</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.subtext} />
              </TouchableOpacity>

              {/* Stats */}
              <View style={[styles.settingRow, { marginBottom: 15, flexDirection: 'column', alignItems: 'flex-start', backgroundColor: theme.card }]}>
                <Text style={[styles.settingTitle, { marginBottom: 15, color: theme.text }]}>📊 Your Stats</Text>
                <View style={{ flexDirection: 'row', gap: 20, flexWrap: 'wrap' }}>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{favorites.length}</Text><Text style={styles.statLabel}>Favorites</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{playlists.length}</Text><Text style={styles.statLabel}>Playlists</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{downloads.length}</Text><Text style={styles.statLabel}>Downloads</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{recentlyPlayed.length}</Text><Text style={styles.statLabel}>Listened</Text></View>
                </View>
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {/* MINI PLAYER */}
      {activeTrack && (
        <TouchableOpacity style={[styles.miniPlayer, { backgroundColor: theme.miniPlayerBg, borderTopColor: moodColor + '44' }]} activeOpacity={0.9} onPress={() => setIsFullScreen(true)}>
          {/* Left: artwork + title/artist — flex:1 so it never overlaps controls */}
          <View style={styles.miniPlayerLeft}>
            {activeTrack.image
              ? <Image source={{ uri: activeTrack.image }} style={{ width: 42, height: 42, borderRadius: 8, marginRight: 10, flexShrink: 0 }} />
              : <View style={{ width: 42, height: 42, borderRadius: 8, backgroundColor: moodColor + '22', justifyContent: 'center', alignItems: 'center', marginRight: 10, flexShrink: 0 }}><Ionicons name="musical-note" size={20} color={moodColor} /></View>
            }
            <View style={{ flex: 1, overflow: 'hidden' }}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.miniPlayerTitle, { color: theme.text }]}>{activeTrack.title}</Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.miniPlayerArtist, { color: moodColor }]}>{activeTrack.artist}</Text>
            </View>
          </View>
          {/* Right: controls — fixed width, no shrink */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <TouchableOpacity onPress={playPrevious} hitSlop={{ top:10,bottom:10,left:8,right:8 }}><Ionicons name="play-skip-back" size={22} color={theme.text} /></TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={[styles.miniPlayerPlayBtn, { backgroundColor: moodColor }]}>
              {isLoading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#050515" />}
            </TouchableOpacity>
            <TouchableOpacity onPress={playNext} hitSlop={{ top:10,bottom:10,left:8,right:8 }}><Ionicons name="play-skip-forward" size={22} color={theme.text} /></TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* BOTTOM NAV */}
      <View style={[styles.bottomNav, { backgroundColor: theme.navBg, borderTopColor: theme.border }]}>
        {[
          { screen: 'all_songs', icon: 'home',     label: 'Home'      },
          { screen: 'library',   icon: 'library',  label: 'Library'   },
          { screen: 'downloads', icon: 'folder',   label: 'Downloads' },
          { screen: 'settings',  icon: 'settings', label: 'Settings'  },
        ].map(tab => {
          const active = currentScreen === tab.screen
            || (tab.screen === 'library'   && currentScreen === 'playlist_view')
            || (tab.screen === 'all_songs' && currentScreen === 'artist_profile');
          return (
            <TouchableOpacity key={tab.screen} style={styles.navButton} onPress={() => {
              if (tab.screen === 'all_songs') { setSearchQuery(''); setIsArtistMode(false); }
              setCurrentScreen(tab.screen);
            }}>
              <Ionicons name={tab.icon as any} size={24} color={active ? moodColor : theme.subtext} />
              <Text style={[styles.navText, { color: active ? moodColor : theme.subtext }]}>{tab.label}</Text>
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
            {playlistSongTarget && playlists.length > 0 && (<>
              <Text style={[styles.sectionHeader, { marginTop: 20 }]}>Existing Playlists</Text>
              <ScrollView style={{ maxHeight: 150, width: '100%' }}>
                {playlists.map(pl => (
                  <TouchableOpacity key={pl.id} style={styles.playlistListItem} onPress={() => addToPlaylist(pl.id)}>
                    <Ionicons name="albums-outline" size={20} color="#00ffcc" style={{ marginRight: 10 }} />
                    <Text style={{ color: '#fff', fontSize: 16 }}>{pl.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>)}
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
                {isYoutubeFallback && (<View style={{ backgroundColor: '#ff0000', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold' }}>YT</Text></View>)}
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
            <Animated.View style={[styles.breathingShadow, { backgroundColor: moodColor + '40', transform: [{ scale: ring1.interpolate({ inputRange: [0,0.5,1], outputRange: [1,1.15,1] }) }], opacity: ring1.interpolate({ inputRange: [0,0.5,1], outputRange: [0.35,0.6,0.35] }) }]} />
            {[ring1, ring2, ring3].map((anim, i) => (
              <Animated.View key={i} style={[styles.rippleRing, { borderColor: moodColor + '66', transform: [{ scale: anim.interpolate({ inputRange: [0,1], outputRange: [1,1.5] }) }], opacity: anim.interpolate({ inputRange: [0,1], outputRange: [0.5,0] }) }]} />
            ))}
            <View style={styles.albumArtLarge}>
              {activeTrack?.image ? <Image source={{ uri: activeTrack.image }} style={styles.albumImage} /> : <Ionicons name="disc-outline" size={100} color={moodColor} />}
            </View>
          </View>

          {/* Song info */}
          <View style={styles.fullScreenInfo}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={styles.fullScreenTitle}>{activeTrack?.title}</Text>
              <Text numberOfLines={1} style={[styles.fullScreenArtist, { color: moodColor }]}>{activeTrack?.artist}</Text>
              {autoplayReason.length > 0 && <Text style={[styles.autoplayReasonText, { color: moodColor + 'cc' }]}>{autoplayReason}</Text>}
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

          {/* Controls row: Shuffle | Prev | Play | Next | Repeat */}
          <View style={styles.controlsContainer}>
            <TouchableOpacity onPress={toggleShuffle}>
              <Ionicons name="shuffle" size={26} color={isShuffled ? moodColor : '#444466'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={playPrevious}>
              <Ionicons name="play-skip-back" size={40} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={[styles.largePlayBtn, { backgroundColor: moodColor }]}>
              {isLoading ? <ActivityIndicator size="large" color="#050515" /> : <Ionicons name={isPlaying ? 'pause' : 'play'} size={40} color="#050515" style={{ marginLeft: isPlaying ? 0 : 5 }} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={playNext}>
              <Ionicons name="play-skip-forward" size={40} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleRepeat} style={{ position: 'relative' }}>
              <Ionicons name={repeatMode === 'one' ? 'repeat-outline' : 'repeat'} size={26} color={repeatMode !== 'off' ? moodColor : '#444466'} />
              {repeatMode === 'one' && (
                <View style={{ position: 'absolute', top: -4, right: -5, width: 12, height: 12, borderRadius: 6, backgroundColor: moodColor, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#000', fontSize: 7, fontWeight: 'bold' }}>1</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* Lyrics / Queue tabs */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 10 }}>
            <TouchableOpacity onPress={() => setShowLyrics(false)}
              style={{ paddingHorizontal: 20, paddingVertical: 7, borderRadius: 20, backgroundColor: !showLyrics ? moodColor + '22' : 'transparent', borderWidth: 1, borderColor: !showLyrics ? moodColor : '#333' }}>
              <Text style={{ color: !showLyrics ? moodColor : '#555', fontSize: 12, fontWeight: '700' }}>♪ QUEUE</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowLyrics(true); if (!lyrics && !lyricsLoading) fetchLyrics(activeTrack); }}
              style={{ paddingHorizontal: 20, paddingVertical: 7, borderRadius: 20, backgroundColor: showLyrics ? moodColor + '22' : 'transparent', borderWidth: 1, borderColor: showLyrics ? moodColor : '#333' }}>
              <Text style={{ color: showLyrics ? moodColor : '#555', fontSize: 12, fontWeight: '700' }}>📝 LYRICS</Text>
            </TouchableOpacity>
          </View>

          {/* Lyrics view */}
          {showLyrics ? (
            <ScrollView style={styles.queueContainer} showsVerticalScrollIndicator={false}>
              {lyricsLoading ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <ActivityIndicator color={moodColor} />
                  <Text style={{ color: '#666', marginTop: 8, fontSize: 13 }}>Loading lyrics...</Text>
                </View>
              ) : (
                <Text style={{ color: '#ccc', fontSize: 15, lineHeight: 26, textAlign: 'center', padding: 10 }}>{lyrics || 'Tap LYRICS to load'}</Text>
              )}
            </ScrollView>
          ) : (
            smartAutoplay && autoplayQueue.length > 0 ? (
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
            ) : null
          )}
        </View>
      </Modal>

      {/* OPTIONS MENU (3-dot) */}
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
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) shareSong(activeTrack); }}>
              <Ionicons name="share-outline" size={24} color="#fff" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Share Song</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* LONG-PRESS CONTEXT MENU */}
      <Modal animationType="slide" transparent visible={contextMenuVisible} onRequestClose={() => setContextMenuVisible(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setContextMenuVisible(false)}>
          <View style={{ backgroundColor: '#121225', paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <View style={{ width: 40, height: 5, backgroundColor: '#3a3a50', borderRadius: 3, alignSelf: 'center', marginTop: 15, marginBottom: 5 }} />
            {contextMenuSong && (
              <View style={{ paddingHorizontal: 25, paddingBottom: 12 }}>
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{contextMenuSong.title}</Text>
                <Text numberOfLines={1} style={{ color: '#8e8e93', fontSize: 13 }}>{contextMenuSong.artist}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) handleTrackPress(contextMenuSong); }}>
              <Ionicons name="play-circle-outline" size={24} color={moodColor} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Play Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) addSingleToQueue(contextMenuSong); }}>
              <Ionicons name="list-outline" size={24} color="#fff" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Queue</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) { setPlaylistSongTarget(contextMenuSong); setPlaylistModalVisible(true); } }}>
              <Ionicons name="add-circle-outline" size={24} color="#fff" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Playlist</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) toggleFavorite(contextMenuSong); }}>
              <Ionicons name={contextMenuSong && isTrackFavorite(contextMenuSong?.id) ? 'heart' : 'heart-outline'} size={24} color={contextMenuSong && isTrackFavorite(contextMenuSong?.id) ? '#ff6b9d' : '#fff'} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>{contextMenuSong && isTrackFavorite(contextMenuSong?.id) ? 'Remove Favourite' : 'Add to Favourites'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) downloadSong(contextMenuSong); }}>
              <Ionicons name="cloud-download-outline" size={24} color="#fff" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Download</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) shareSong(contextMenuSong); }}>
              <Ionicons name="share-outline" size={24} color="#fff" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Share</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* EQUALIZER MODAL */}
      <Modal animationType="slide" transparent visible={showEqualizerModal} onRequestClose={() => setShowEqualizerModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', alignItems: 'center', padding: 28 }}>
          <View style={{ width: '100%', backgroundColor: '#09091a', borderRadius: 22, borderWidth: 1.5, borderColor: moodColor + '55', padding: 28 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
              <Ionicons name="pulse" size={22} color={moodColor} style={{ marginRight: 10 }} />
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 }}>EQUALIZER</Text>
            </View>
            {[
              { label: '🔊 Bass', value: eqBass, set: setEqBass },
              { label: '🎵 Mid', value: eqMid, set: setEqMid },
              { label: '🔆 Treble', value: eqTreble, set: setEqTreble },
            ].map(eq => (
              <View key={eq.label} style={{ marginBottom: 22 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ color: '#ccc', fontWeight: '600', fontSize: 14 }}>{eq.label}</Text>
                  <Text style={{ color: moodColor, fontWeight: '700', fontSize: 14 }}>{Math.round((eq.value - 0.5) * 20) >= 0 ? '+' : ''}{Math.round((eq.value - 0.5) * 20)} dB</Text>
                </View>
                {/* Visual bar */}
                <View style={{ height: 5, backgroundColor: '#1a1a3a', borderRadius: 3, marginBottom: 10, overflow: 'hidden' }}>
                  <View style={{ width: `${eq.value * 100}%`, height: '100%', backgroundColor: moodColor, borderRadius: 3 }} />
                </View>
                {/* Tap presets */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  {[-10, -5, 0, 5, 10].map(db => {
                    const v = db / 20 + 0.5;
                    const active = Math.abs(eq.value - v) < 0.08;
                    return (
                      <TouchableOpacity key={db} onPress={() => eq.set(v)}
                        style={{ width: 48, height: 36, borderRadius: 18, backgroundColor: active ? moodColor : '#1a1a3a', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: active ? moodColor : '#2a2a4a' }}>
                        <Text style={{ color: active ? '#000' : '#666', fontSize: 11, fontWeight: '700' }}>{db >= 0 ? '+' : ''}{db}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity onPress={() => { setEqBass(0.5); setEqMid(0.5); setEqTreble(0.5); }}
                style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: '#1a1a3a', justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#888', fontWeight: '600' }}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowEqualizerModal(false)}
                style={{ flex: 1, height: 46, borderRadius: 23, backgroundColor: moodColor, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#050515', fontWeight: 'bold' }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#05050f' },
  header:      { backgroundColor: '#050515', paddingTop: 50, paddingBottom: 12, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#121225' },
  headerPill:  { paddingHorizontal: 24, paddingVertical: 8, borderRadius: 30, borderWidth: 1.5, alignItems: 'center' },
  headerTitle: { color: '#ffffff', fontSize: 15, fontWeight: 'bold', letterSpacing: 2 },
  autoplayBanner: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  content:     { flex: 1 },
  screenBody:  { flex: 1, padding: 20 },
  centeredBody:{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },

  authContainer:  { flex: 1, backgroundColor: '#05050f', justifyContent: 'center', padding: 30 },
  authBox:        { alignItems: 'center', backgroundColor: '#0b0b18', padding: 30, borderRadius: 20, borderWidth: 1, borderColor: '#121225' },
  authTitle:      { color: '#fff', fontSize: 28, fontWeight: 'bold', letterSpacing: 3, marginBottom: 5 },
  authSubtitle:   { color: '#8e8e93', fontSize: 14, marginBottom: 30 },
  authInput:      { width: '100%', backgroundColor: '#121225', color: '#fff', borderRadius: 10, height: 55, paddingHorizontal: 15, marginBottom: 15, fontSize: 16 },
  authBtn:        { width: '100%', backgroundColor: '#00ffcc', height: 55, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  authBtnText:    { color: '#050515', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  authSwitchText: { color: '#00ffcc', fontSize: 14 },
  backToLoginBtn:  { flexDirection: 'row', alignItems: 'center', marginTop: 22, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 25, borderWidth: 1.5, borderColor: '#00ffcc55', backgroundColor: '#00ffcc11', gap: 8 },
  backToLoginText: { color: '#00ffcc', fontSize: 14, fontWeight: '600' },

  searchBox:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121225', paddingHorizontal: 15, borderRadius: 12, height: 50, marginBottom: 8 },
  input:           { color: '#fff', flex: 1, fontSize: 16 },
  historyDropdown: { backgroundColor: '#0e0e22', borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1e1e3a', overflow: 'hidden' },
  historyHeader:   { color: '#8e8e93', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 15, paddingTop: 12, paddingBottom: 6 },
  historyItem:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#151530' },
  historyItemText: { color: '#ccc', fontSize: 15, flex: 1 },
  sectionHeader:   { color: '#8e8e93', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15, letterSpacing: 1 },

  trackCard:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0b0b18', padding: 12, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: 'transparent' },
  activeTrackCard:     { borderColor: '#00ffcc44', backgroundColor: '#0c1d24' },
  albumArtPlaceholder: { width: 48, height: 48, backgroundColor: '#151530', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  trackInfo:           { flex: 1, marginRight: 10 },
  trackTitle:          { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  trackArtist:         { color: '#8e8e93', fontSize: 12 },
  mainText:            { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subText:             { color: '#8e8e93', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  recentCard:    { width: 84, alignItems: 'center', marginRight: 12 },
  trendingCard:  { width: 132, marginRight: 14 },
  trendingRank:  { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },

  playlistCard:     { width: 100, height: 100, backgroundColor: '#151530', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  playlistName:     { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 8 },
  playlistListItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#121225', borderRadius: 8, marginBottom: 8 },

  settingRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0b0b18', padding: 20, borderRadius: 16 },
  textGroup:    { flex: 1, paddingRight: 15 },
  settingTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 6 },
  settingDesc:  { color: '#8e8e93', fontSize: 13, lineHeight: 18 },

  statBadge:  { backgroundColor: '#121225', padding: 12, borderRadius: 10, alignItems: 'center', minWidth: 70 },
  statNumber: { color: '#00ffcc', fontSize: 22, fontWeight: 'bold' },
  statLabel:  { color: '#8e8e93', fontSize: 11, marginTop: 4 },

  miniPlayer:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0a1622', paddingHorizontal: 14, height: 68, borderTopWidth: 1 },
  miniPlayerLeft:   { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10, overflow: 'hidden' },
  miniPlayerTitle:  { color: '#ffffff', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  miniPlayerArtist: { fontSize: 12 },
  miniPlayerPlayBtn:{ width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  passwordRow:      { flexDirection: 'row', alignItems: 'center', width: '100%', backgroundColor: '#121225', borderRadius: 10, marginBottom: 15, paddingRight: 12 },
  eyeBtn:           { padding: 6, justifyContent: 'center', alignItems: 'center' },

  bottomNav: { flexDirection: 'row', backgroundColor: '#050515', height: 75, borderTopWidth: 1, borderTopColor: '#121225', paddingBottom: 15, justifyContent: 'space-around', alignItems: 'center' },
  navButton: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  navText:   { fontSize: 11, marginTop: 4, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#0b0b18', padding: 25, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: '#121225' },
  menuItem:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 25 },

  fullScreenContainer:  { flex: 1, padding: 20, paddingTop: 50 },
  fullScreenHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  fullScreenHeaderText: { color: '#8e8e93', fontSize: 12, fontWeight: 'bold', letterSpacing: 2 },
  moodBadge:            { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, marginTop: 4 },
  moodBadgeText:        { fontSize: 11, fontWeight: '600' },
  animationContainer:   { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 20, height: 240 },
  albumArtLarge:        { width: 190, height: 190, borderRadius: 95, backgroundColor: '#0b0b18', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#121225', overflow: 'hidden', zIndex: 10, elevation: 15 },
  albumImage:           { width: '100%', height: '100%', resizeMode: 'cover' },
  breathingShadow:      { position: 'absolute', width: 210, height: 210, borderRadius: 105, zIndex: 1 },
  rippleRing:           { position: 'absolute', width: 210, height: 210, borderRadius: 105, borderWidth: 1.5, zIndex: 2 },
  fullScreenInfo:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  fullScreenTitle:      { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  fullScreenArtist:     { fontSize: 15 },
  autoplayReasonText:   { fontSize: 12, marginTop: 4, fontStyle: 'italic' },

  sliderSection:   { width: '100%', marginBottom: 16, paddingHorizontal: 5 },
  progressBarBg:   { width: '100%', height: 6, backgroundColor: '#1c1c3a', borderRadius: 3, justifyContent: 'center', position: 'relative' },
  progressBarFill: { height: '100%', borderRadius: 3, position: 'absolute' },
  progressDot:     { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff', position: 'absolute', marginTop: -4, marginLeft: -7, elevation: 4 },
  timeRow:         { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  timeText:        { color: '#8e8e93', fontSize: 12 },

  controlsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginBottom: 14 },
  largePlayBtn:      { width: 78, height: 78, borderRadius: 39, justifyContent: 'center', alignItems: 'center' },

  queueContainer: { borderTopWidth: 1, borderTopColor: '#1a1a30', paddingTop: 12, flex: 1 },
  queueHeader:    { fontSize: 12, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase' },
  queueItem:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
});