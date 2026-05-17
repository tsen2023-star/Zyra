import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, Switch, StatusBar, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Alert, Animated, Easing, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Accelerometer } from 'expo-sensors';

const BACKEND_URL = 'https://zyra-backend-9nvt.onrender.com';

export default function App() {
  const [isAppReady, setIsAppReady] = useState(false);

  // 0. AUTHENTICATION & NAVIGATION STATE
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [currentScreen, setCurrentScreen] = useState('all_songs'); // 'all_songs', 'library', 'settings', 'downloads', 'playlist_view'

  // 3. PERSISTENT LIBRARY STATE
  const [favorites, setFavorites] = useState<any[]>([]);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string, name: string, songs: any[] }[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);

  // 1. FULL SCREEN PLAYER STATE
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [shakeEnabled, setShakeEnabled] = useState(false);

  // Dynamic API States
  const [searchQuery, setSearchQuery] = useState('');
  const [songsList, setSongsList] = useState<any[]>([]);

  // Audio Playback States
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [activeTrack, setActiveTrack] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // TRACK PROGRESS STATES
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressBarWidthRef = useRef<number>(0);

  // PLAYLIST MODAL STATES
  const [isPlaylistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistSongTarget, setPlaylistSongTarget] = useState<any>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isMenuVisible, setMenuVisible] = useState(false);

  const typingTimeoutRef = useRef<any>(null);
  const playNextRef = useRef<any>(null);

  // Animation values for the 3 ripples
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let t1: any, t2: any;
    if (isPlaying) {
      ring1.setValue(0);
      ring2.setValue(0);
      ring3.setValue(0);

      const animate = (anim: Animated.Value) => {
        Animated.loop(
          Animated.timing(anim, {
            toValue: 1,
            duration: 3000,
            easing: Easing.linear,
            useNativeDriver: true
          })
        ).start();
      };

      animate(ring1);
      t1 = setTimeout(() => animate(ring2), 1000);
      t2 = setTimeout(() => animate(ring3), 2000);
    } else {
      ring1.stopAnimation();
      ring2.stopAnimation();
      ring3.stopAnimation();
      // Optional: don't reset to 0 so it pauses in place, or reset if preferred
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isPlaying]);

  useEffect(() => {
    let subscription: any;
    if (shakeEnabled) {
      Accelerometer.setUpdateInterval(500);
      let lastShakeTime = 0;
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        const acceleration = Math.sqrt(x * x + y * y + z * z);
        if (acceleration > 2.5) { // Threshold for a firm shake
          const now = Date.now();
          if (now - lastShakeTime > 1500) {
            lastShakeTime = now;
            if (playNextRef.current) playNextRef.current();
          }
        }
      });
    }
    return () => {
      if (subscription) subscription.remove();
    };
  }, [shakeEnabled]);

  // INITIAL LOAD
  useEffect(() => {
    const loadData = async () => {
      try {
        const user = await AsyncStorage.getItem('user');
        if (user) {
          setIsLoggedIn(true);
          setUsername(user);
        }
        const favs = await AsyncStorage.getItem('favorites');
        if (favs) setFavorites(JSON.parse(favs));

        const dl = await AsyncStorage.getItem('downloads');
        if (dl) setDownloads(JSON.parse(dl));

        const pl = await AsyncStorage.getItem('playlists');
        if (pl) setPlaylists(JSON.parse(pl));
      } catch (e) {
        console.error("Error loading persisted data", e);
      } finally {
        setIsAppReady(true);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    return sound ? () => { sound.unloadAsync(); } : undefined;
  }, [sound]);

  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setSongsList([]);
      return;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      fetchLiveTracks(searchQuery);
    }, 500);

    return () => clearTimeout(typingTimeoutRef.current);
  }, [searchQuery]);

  const formatTime = (millis: number) => {
    if (!millis || isNaN(millis)) return "0:00";
    const minutes = Math.floor(millis / 60000);
    const seconds = Math.floor((millis % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const getProgressPercent = () => {
    if (duration > 0) return (position / duration) * 100;
    return 0;
  };

  const handleProgressBarTap = async (event: any) => {
    if (!sound || duration === 0) return;
    const touchX = event.nativeEvent.locationX;
    if (progressBarWidthRef.current > 0) {
      const percentage = touchX / progressBarWidthRef.current;
      const targetPosition = Math.floor(percentage * duration);
      setPosition(targetPosition);
      await sound.setPositionAsync(targetPosition);
    }
  };

  const handleAuth = async () => {
    if (!username || !password) return;
    setIsLoading(true);
    setTimeout(async () => {
      setIsLoading(false);
      setIsLoggedIn(true);
      setCurrentScreen('all_songs');
      const uName = username || 'Bablu';
      setUsername(uName);
      await AsyncStorage.setItem('user', uName);
    }, 800);
  };

  const logout = async () => {
    if (sound) await sound.unloadAsync();
    setSound(null);
    setActiveTrack(null);
    setIsLoggedIn(false);
    setAuthMode('login');
    setUsername('');
    setPassword('');
    setPosition(0);
    setDuration(0);
    await AsyncStorage.removeItem('user');
  };

  const toggleFavorite = async (song: any) => {
    let newFavs;
    const isFav = favorites.some(fav => fav.id === song.id);
    if (isFav) {
      newFavs = favorites.filter(fav => fav.id !== song.id);
    } else {
      newFavs = [...favorites, song];
    }
    setFavorites(newFavs);
    await AsyncStorage.setItem('favorites', JSON.stringify(newFavs));
  };

  const isTrackFavorite = (id: string) => favorites.some(fav => fav.id === id);

  const downloadSong = async (song: any) => {
    if (downloads.some(d => d.id === song.id)) {
      Alert.alert("Already Downloaded", "This song is already in your Downloads folder.");
      return;
    }

    try {
      Alert.alert("Downloading...", "Please wait while the song downloads.");
      const fileUri = FileSystem.documentDirectory + `${song.id}.mp3`;
      let urlToDownload = song.url;

      try {
        const res = await fetch(`${BACKEND_URL}/api/refresh?id=${song.id}`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
        const json = await res.json();
        if (json.success && json.data?.url) {
          urlToDownload = json.data.url;
        }
      } catch (e) {
        console.error("Refresh for download failed");
      }

      const downloadRes = await FileSystem.downloadAsync(urlToDownload, fileUri);

      const newDownload = { ...song, localUri: downloadRes.uri };
      const newDownloads = [...downloads, newDownload];
      setDownloads(newDownloads);
      await AsyncStorage.setItem('downloads', JSON.stringify(newDownloads));
      Alert.alert("Success", "Song downloaded successfully for offline listening!");
    } catch (error) {
      console.error("Download Error", error);
      Alert.alert("Error", "Failed to download song.");
    }
  };

  const addToPlaylist = async (playlistId: string) => {
    if (!playlistSongTarget) return;
    const updatedPlaylists = playlists.map(p => {
      if (p.id === playlistId) {
        if (!p.songs.some(s => s.id === playlistSongTarget.id)) {
          return { ...p, songs: [...p.songs, playlistSongTarget] };
        }
      }
      return p;
    });
    setPlaylists(updatedPlaylists);
    await AsyncStorage.setItem('playlists', JSON.stringify(updatedPlaylists));
    setPlaylistModalVisible(false);
    setPlaylistSongTarget(null);
    Alert.alert("Added", "Song added to playlist.");
  };

  const createNewPlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    const newPlaylist = {
      id: Date.now().toString(),
      name: newPlaylistName,
      songs: playlistSongTarget ? [playlistSongTarget] : []
    };
    const updatedPlaylists = [...playlists, newPlaylist];
    setPlaylists(updatedPlaylists);
    await AsyncStorage.setItem('playlists', JSON.stringify(updatedPlaylists));
    setNewPlaylistName('');
    if (playlistSongTarget) {
      setPlaylistModalVisible(false);
      setPlaylistSongTarget(null);
      Alert.alert("Created", "Playlist created and song added.");
    }
  };

  async function fetchLiveTracks(query: string) {
    try {
      setIsSearching(true);
      const response = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(query)}`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
      const json = await response.json();

      if (json.success && json.data?.results) {
        setSongsList(json.data.results);
      } else {
        setSongsList([]);
      }
    } catch (error) {
      console.error("API Fetch Error:", error);
      setSongsList([]);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleTrackPress(track: any) {
    try {
      setIsLoading(true);
      setPosition(0);
      setDuration(0);

      if (sound) {
        await sound.unloadAsync();
        setSound(null);
      }

      setActiveTrack(track);

      let playUrl = track.url;
      const downloadedTrack = downloads.find(d => d.id === track.id);
      let newSound: any;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false,
      });

      if (downloadedTrack && downloadedTrack.localUri) {
        // Play from local file storage (Offline mode!)
        const result = await Audio.Sound.createAsync(
          { uri: downloadedTrack.localUri },
          { shouldPlay: true }
        );
        newSound = result.sound;
      } else {
        // FAST PLAY: Try the original URL first!
        try {
          const result = await Audio.Sound.createAsync(
            { uri: playUrl },
            { shouldPlay: true }
          );
          newSound = result.sound;
        } catch (error) {
          // If original URL fails (likely expired 403), refresh it in background
          console.log("Original URL failed, refreshing...");
          const res = await fetch(`${BACKEND_URL}/api/refresh?id=${track.id}`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
          const json = await res.json();
          if (json.success && json.data?.url) {
            playUrl = json.data.url;
            const retryResult = await Audio.Sound.createAsync(
              { uri: playUrl },
              { shouldPlay: true }
            );
            newSound = retryResult.sound;
          } else {
            throw new Error("Could not refresh expired link");
          }
        }
      }

      setSound(newSound);
      setIsPlaying(true);

      newSound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.isLoaded) {
          setPosition(status.positionMillis);
          setDuration(status.durationMillis || 0);
          if (status.didJustFinish && playNextRef.current) playNextRef.current();
        }
      });

    } catch (error) {
      console.error("Playback System Error:", error);
      Alert.alert("Playback Error", "Ensure you are connected to the internet if the song is not downloaded.");
    } finally {
      setIsLoading(false);
    }
  }

  async function togglePlayPause() {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }

  const getActiveList = () => {
    if (currentScreen === 'library') return favorites;
    if (currentScreen === 'downloads') return downloads;
    if (currentScreen === 'playlist_view' && activePlaylistId) {
      const pl = playlists.find(p => p.id === activePlaylistId);
      return pl ? pl.songs : [];
    }
    return songsList;
  };

  const playNext = async () => {
    if (!activeTrack) return;
    const activeList = getActiveList();

    // Play the next song sequentially to ensure instant transitions
    if (activeList.length > 0) {
      const currentIndex = activeList.findIndex((s: any) => s.id === activeTrack.id);
      if (currentIndex !== -1) {
        let nextIndex = currentIndex + 1;
        if (nextIndex < activeList.length) {
          await handleTrackPress(activeList[nextIndex]);
          return;
        }
      }
    }

    // SPOTIFY STYLE AUTOPLAY: Random track!
    // (Happens if we finish a playlist or reach the end of search results)
    try {
      setIsLoading(true);
      const res = await fetch(`${BACKEND_URL}/api/random`, { headers: { "Bypass-Tunnel-Reminder": "true" } });
      const json = await res.json();
      if (json.success && json.data?.song) {
        await handleTrackPress(json.data.song);
        return;
      }
    } catch (e) {
      console.error("Autoplay random failed", e);
    } finally {
      setIsLoading(false);
    }

    // Fallback if random fails: loop to start of current list
    if (activeList.length > 0) {
      await handleTrackPress(activeList[0]);
    }
  };

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const playPrevious = async () => {
    if (!activeTrack) return;
    const activeList = getActiveList();
    if (activeList.length === 0) return;

    const currentIndex = activeList.findIndex((s: any) => s.id === activeTrack.id);
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = activeList.length - 1;

    await handleTrackPress(activeList[prevIndex]);
  };

  const renderTrackCard = (song: any, isCurrent: boolean, isFav: boolean) => (
    <TouchableOpacity key={song.id} style={[styles.trackCard, isCurrent && styles.activeTrackCard]} onPress={() => handleTrackPress(song)}>
      <View style={styles.albumArtPlaceholder}>
        <Ionicons name={isCurrent && isPlaying ? "pause" : "disc-outline"} size={24} color={isCurrent ? "#00ffcc" : "#8e8e93"} />
      </View>
      <View style={styles.trackInfo}>
        <Text numberOfLines={1} style={[styles.trackTitle, isCurrent && { color: '#00ffcc' }]}>{song.title}</Text>
        <Text numberOfLines={1} style={styles.trackArtist}>{song.artist}</Text>
      </View>
      <TouchableOpacity onPress={() => toggleFavorite(song)} style={{ padding: 8 }}>
        <Ionicons name={isFav ? "heart" : "heart-outline"} size={22} color={isFav ? "#00ffcc" : "#3a3a50"} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setPlaylistSongTarget(song); setPlaylistModalVisible(true); }} style={{ padding: 8 }}>
        <Ionicons name="add-circle-outline" size={22} color="#8e8e93" />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => downloadSong(song)} style={{ padding: 8 }}>
        <Ionicons name={downloads.some(d => d.id === song.id) ? "cloud-done" : "cloud-download-outline"} size={22} color={downloads.some(d => d.id === song.id) ? "#00ffcc" : "#8e8e93"} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  if (!isAppReady) {
    return <View style={styles.container}><ActivityIndicator color="#00ffcc" size="large" style={{ marginTop: '50%' }} /></View>;
  }

  if (!isLoggedIn) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authBox}>
          <Ionicons name="pulse" size={64} color="#00ffcc" style={{ marginBottom: 20 }} />
          <Text style={styles.authTitle}>ZYRA</Text>
          <Text style={styles.authSubtitle}>{authMode === 'login' ? 'Sign in to continue' : 'Create a new account'}</Text>

          <TextInput
            style={styles.authInput}
            placeholder="Username"
            placeholderTextColor="#666"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.authInput}
            placeholder="Password"
            placeholderTextColor="#666"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.authBtn} onPress={handleAuth} disabled={isLoading}>
            {isLoading ? <ActivityIndicator color="#050515" /> : <Text style={styles.authBtnText}>{authMode === 'login' ? 'LOGIN' : 'SIGN UP'}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} style={{ marginTop: 20 }}>
            <Text style={styles.authSwitchText}>
              {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Login"}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {currentScreen === 'all_songs' ? 'ZYRA' : currentScreen === 'library' ? 'LIBRARY' : currentScreen === 'downloads' ? 'DOWNLOADS' : currentScreen === 'playlist_view' ? 'PLAYLIST' : 'SETTINGS'}
        </Text>
      </View>

      <View style={styles.content}>

        {/* ALL SONGS DASHBOARD */}
        {currentScreen === 'all_songs' && (
          <View style={styles.screenBody}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#666" style={{ marginRight: 10 }} />
              <TextInput
                placeholder="Search tracks on your server..."
                placeholderTextColor="#666"
                style={styles.input}
                value={searchQuery}
                onChangeText={(text) => setSearchQuery(text)}
              />
              {isSearching ? <ActivityIndicator size="small" color="#00ffcc" /> : searchQuery.length > 0 ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={18} color="#8e8e93" /></TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.sectionHeader}>{searchQuery.trim().length > 0 ? 'Results' : 'Connect to Database'}</Text>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {songsList.map((song) => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* LIBRARY / PLAYLISTS */}
        {currentScreen === 'library' && (
          <View style={styles.screenBody}>
            <Text style={styles.sectionHeader}>Your Playlists</Text>
            <ScrollView horizontal style={{ maxHeight: 120, marginBottom: 20 }} showsHorizontalScrollIndicator={false}>
              <TouchableOpacity style={styles.playlistCard} onPress={() => { setPlaylistSongTarget(null); setPlaylistModalVisible(true); }}>
                <Ionicons name="add" size={32} color="#00ffcc" />
                <Text style={styles.playlistName}>New</Text>
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
              {favorites.map((song) => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
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
              {playlists.find(p => p.id === activePlaylistId)?.songs.map((song) => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
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
                {downloads.map((song) => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
              </ScrollView>
            )}
          </View>
        )}

        {/* SETTINGS PANEL */}
        {currentScreen === 'settings' && (
          <View style={styles.screenBody}>
            <View style={[styles.settingRow, { marginBottom: 15 }]}>
              <View style={styles.textGroup}>
                <Text style={styles.settingTitle}>Signed in as {username}</Text>
                <Text style={styles.settingDesc}>Connected to local backend</Text>
              </View>
              <TouchableOpacity onPress={logout} style={{ padding: 10, backgroundColor: '#1a1a2e', borderRadius: 8 }}>
                <Text style={{ color: '#ff4444', fontWeight: 'bold' }}>Logout</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingRow}>
              <View style={styles.textGroup}>
                <Text style={styles.settingTitle}>Shake to change song</Text>
                <Text style={styles.settingDesc}>Physically shake phone device to trigger skip controls</Text>
              </View>
              <Switch
                value={shakeEnabled}
                onValueChange={setShakeEnabled}
                trackColor={{ false: '#252545', true: '#00ffcc' }}
                thumbColor={shakeEnabled ? '#ffffff' : '#8e8e93'}
              />
            </View>
          </View>
        )}
      </View>

      {/* MINI PLAYER */}
      {activeTrack && (
        <TouchableOpacity style={styles.miniPlayer} activeOpacity={0.9} onPress={() => setIsFullScreen(true)}>
          <View style={styles.miniPlayerLeft}>
            <Ionicons name="musical-note" size={20} color="#00ffcc" />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text numberOfLines={1} style={styles.miniPlayerTitle}>{activeTrack.title}</Text>
              <Text numberOfLines={1} style={styles.miniPlayerArtist}>{activeTrack.artist}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={togglePlayPause} style={styles.miniPlayerPlayBtn}>
              {isLoading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={isPlaying ? "pause" : "play"} size={22} color="#ffffff" />}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* BOTTOM NAVIGATION TABS */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navButton} onPress={() => setCurrentScreen('all_songs')}>
          <Ionicons name="musical-notes" size={24} color={currentScreen === 'all_songs' ? '#00ffcc' : '#8e8e93'} />
          <Text style={[styles.navText, { color: currentScreen === 'all_songs' ? '#00ffcc' : '#8e8e93' }]}>Search</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navButton} onPress={() => setCurrentScreen('library')}>
          <Ionicons name="library" size={24} color={currentScreen === 'library' || currentScreen === 'playlist_view' ? '#00ffcc' : '#8e8e93'} />
          <Text style={[styles.navText, { color: currentScreen === 'library' || currentScreen === 'playlist_view' ? '#00ffcc' : '#8e8e93' }]}>Library</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navButton} onPress={() => setCurrentScreen('downloads')}>
          <Ionicons name="folder" size={24} color={currentScreen === 'downloads' ? '#00ffcc' : '#8e8e93'} />
          <Text style={[styles.navText, { color: currentScreen === 'downloads' ? '#00ffcc' : '#8e8e93' }]}>Downloads</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navButton} onPress={() => setCurrentScreen('settings')}>
          <Ionicons name="settings" size={24} color={currentScreen === 'settings' ? '#00ffcc' : '#8e8e93'} />
          <Text style={[styles.navText, { color: currentScreen === 'settings' ? '#00ffcc' : '#8e8e93' }]}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* PLAYLIST MODAL */}
      <Modal animationType="fade" transparent={true} visible={isPlaylistModalVisible} onRequestClose={() => setPlaylistModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.mainText}>{playlistSongTarget ? 'Add to Playlist' : 'Create Playlist'}</Text>

            <TextInput
              placeholder="New Playlist Name"
              placeholderTextColor="#666"
              style={[styles.authInput, { marginTop: 15 }]}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
            />
            <TouchableOpacity style={styles.authBtn} onPress={createNewPlaylist}>
              <Text style={styles.authBtnText}>Create {playlistSongTarget && "& Add"}</Text>
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

      {/* FULL SCREEN PLAYER MODAL */}
      <Modal animationType="slide" transparent={false} visible={isFullScreen} onRequestClose={() => setIsFullScreen(false)}>
        <View style={styles.fullScreenContainer}>
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity onPress={() => setIsFullScreen(false)} style={{ padding: 10 }}>
              <Ionicons name="chevron-down" size={32} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.fullScreenHeaderText}>NOW PLAYING</Text>
            <TouchableOpacity onPress={() => setMenuVisible(true)} style={{ padding: 10 }}>
              <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.animationContainer}>
            {/* Breathing Shadow */}
            <Animated.View style={[styles.breathingShadow, {
              transform: [{ scale: ring1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.15, 1] }) }],
              opacity: ring1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.35, 0.6, 0.35] })
            }]} />

            {/* Ripples */}
            {[ring1, ring2, ring3].map((anim, index) => (
              <Animated.View key={index} style={[styles.rippleRing, {
                transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
                opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] })
              }]} />
            ))}

            <View style={styles.albumArtLarge}>
              {activeTrack?.artwork ? (
                <Image source={{ uri: activeTrack.artwork }} style={styles.albumImage} />
              ) : (
                <Ionicons name="disc-outline" size={100} color="#00ffcc" />
              )}
            </View>
          </View>

          <View style={styles.fullScreenInfo}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={styles.fullScreenTitle}>{activeTrack?.title}</Text>
              <Text numberOfLines={1} style={styles.fullScreenArtist}>{activeTrack?.artist}</Text>
            </View>
            <TouchableOpacity onPress={() => activeTrack && toggleFavorite(activeTrack)}>
              <Ionicons name={activeTrack && isTrackFavorite(activeTrack.id) ? "heart" : "heart-outline"} size={32} color={activeTrack && isTrackFavorite(activeTrack.id) ? "#00ffcc" : "#8e8e93"} />
            </TouchableOpacity>
          </View>

          <View style={styles.sliderSection}>
            <TouchableOpacity
              activeOpacity={1}
              style={styles.progressBarBg}
              onPress={handleProgressBarTap}
              onLayout={(e) => progressBarWidthRef.current = e.nativeEvent.layout.width}
            >
              <View style={[styles.progressBarFill, { width: `${getProgressPercent()}%` }]} />
              <View style={[styles.progressDot, { left: `${getProgressPercent()}%` }]} />
            </TouchableOpacity>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>

          {/* PLAYBACK CONTROLS */}
          <View style={styles.controlsContainer}>
            <TouchableOpacity onPress={playPrevious}>
              <Ionicons name="play-skip-back" size={40} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity onPress={togglePlayPause} style={styles.largePlayBtn}>
              {isLoading ? <ActivityIndicator size="large" color="#050515" /> : <Ionicons name={isPlaying ? "pause" : "play"} size={40} color="#050515" style={{ marginLeft: isPlaying ? 0 : 5 }} />}
            </TouchableOpacity>

            <TouchableOpacity onPress={playNext}>
              <Ionicons name="play-skip-forward" size={40} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* OPTIONS MENU MODAL */}
      <Modal animationType="slide" transparent={true} visible={isMenuVisible} onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={{ backgroundColor: '#121225', paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <View style={{ width: 40, height: 5, backgroundColor: '#3a3a50', borderRadius: 3, alignSelf: 'center', marginTop: 15, marginBottom: 15 }} />

            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) { setPlaylistSongTarget(activeTrack); setPlaylistModalVisible(true); } }}>
              <Ionicons name="add-circle-outline" size={24} color="#00ffcc" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Playlist</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) toggleFavorite(activeTrack); }}>
              <Ionicons name={activeTrack && isTrackFavorite(activeTrack?.id) ? "heart" : "heart-outline"} size={24} color={activeTrack && isTrackFavorite(activeTrack?.id) ? "#00ffcc" : "#fff"} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>{activeTrack && isTrackFavorite(activeTrack?.id) ? "Remove from Favourites" : "Add to Favourites"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) downloadSong(activeTrack); }}>
              <Ionicons name={downloads.some(d => d.id === activeTrack?.id) ? "cloud-done" : "cloud-download-outline"} size={24} color={downloads.some(d => d.id === activeTrack?.id) ? "#00ffcc" : "#fff"} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>{downloads.some(d => d.id === activeTrack?.id) ? "Downloaded" : "Download Offline"}</Text>
            </TouchableOpacity>

          </View>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05050f' },
  header: { backgroundColor: '#050515', height: 90, paddingTop: 45, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#121225' },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  content: { flex: 1 },
  screenBody: { flex: 1, padding: 20 },
  centeredBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },

  authContainer: { flex: 1, backgroundColor: '#05050f', justifyContent: 'center', padding: 30 },
  authBox: { alignItems: 'center', backgroundColor: '#0b0b18', padding: 30, borderRadius: 20, borderWidth: 1, borderColor: '#121225' },
  authTitle: { color: '#fff', fontSize: 28, fontWeight: 'bold', letterSpacing: 3, marginBottom: 5 },
  authSubtitle: { color: '#8e8e93', fontSize: 14, marginBottom: 30 },
  authInput: { width: '100%', backgroundColor: '#121225', color: '#fff', borderRadius: 10, height: 55, paddingHorizontal: 15, marginBottom: 15, fontSize: 16 },
  authBtn: { width: '100%', backgroundColor: '#00ffcc', height: 55, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  authBtnText: { color: '#050515', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  authSwitchText: { color: '#00ffcc', fontSize: 14 },

  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121225', paddingHorizontal: 15, borderRadius: 12, height: 50, marginBottom: 20 },
  input: { color: '#fff', flex: 1, fontSize: 16 },
  sectionHeader: { color: '#8e8e93', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15, letterSpacing: 1 },
  trackCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0b0b18', padding: 12, borderRadius: 14, marginBottom: 12, borderWidth: 1, borderColor: 'transparent' },
  activeTrackCard: { borderColor: '#00ffcc44', backgroundColor: '#0c1d24' },
  albumArtPlaceholder: { width: 48, height: 48, backgroundColor: '#151530', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  trackInfo: { flex: 1, marginRight: 10 },
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  trackArtist: { color: '#8e8e93', fontSize: 12 },
  mainText: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subText: { color: '#8e8e93', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  playlistCard: { width: 100, height: 100, backgroundColor: '#151530', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  playlistName: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 8 },
  playlistListItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#121225', borderRadius: 8, marginBottom: 8 },

  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0b0b18', padding: 20, borderRadius: 16 },
  textGroup: { flex: 1, paddingRight: 15 },
  settingTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 6 },
  settingDesc: { color: '#8e8e93', fontSize: 13, lineHeight: 18 },

  miniPlayer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0a1622', paddingHorizontal: 20, height: 65, borderTopWidth: 1, borderTopColor: '#00ffcc22' },
  miniPlayerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  miniPlayerTitle: { color: '#ffffff', fontSize: 14, fontWeight: 'bold' },
  miniPlayerArtist: { color: '#00ffcc', fontSize: 12, marginTop: 2 },
  miniPlayerPlayBtn: { backgroundColor: '#00ffcc', width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center', marginLeft: 15 },
  bottomNav: { flexDirection: 'row', backgroundColor: '#050515', height: 75, borderTopWidth: 1, borderTopColor: '#121225', paddingBottom: 15, justifyContent: 'space-around', alignItems: 'center' },
  navButton: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  navText: { fontSize: 11, marginTop: 4, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', backgroundColor: '#0b0b18', padding: 25, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: '#121225' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 25 },

  fullScreenContainer: { flex: 1, backgroundColor: '#05050f', padding: 20, paddingTop: 50 },
  fullScreenHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  fullScreenHeaderText: { color: '#8e8e93', fontSize: 12, fontWeight: 'bold', letterSpacing: 2 },
  animationContainer: { width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 40, height: 300 },
  albumArtLarge: { width: 200, height: 200, borderRadius: 100, backgroundColor: '#0b0b18', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#121225', overflow: 'hidden', zIndex: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.6, shadowRadius: 30, elevation: 15 },
  albumImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  breathingShadow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0,255,255,0.25)', zIndex: 1 },
  rippleRing: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 1.5, borderColor: 'rgba(0,255,255,0.4)', zIndex: 2 },
  fullScreenInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 25 },
  fullScreenTitle: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 8 },
  fullScreenArtist: { color: '#00ffcc', fontSize: 18 },

  sliderSection: { width: '100%', marginBottom: 40, paddingHorizontal: 5 },
  progressBarBg: { width: '100%', height: 6, backgroundColor: '#1c1c3a', borderRadius: 3, justifyContent: 'center', position: 'relative' },
  progressBarFill: { height: '100%', backgroundColor: '#00ffcc', borderRadius: 3, position: 'absolute' },
  progressDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ffffff', position: 'absolute', marginTop: -4, marginLeft: -7, shadowColor: '#00ffcc', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  timeText: { color: '#8e8e93', fontSize: 12, fontWeight: '500' },

  controlsContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 },
  largePlayBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#00ffcc', justifyContent: 'center', alignItems: 'center' }
});