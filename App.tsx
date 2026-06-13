import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity,
  Switch, StatusBar, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform, Animated, Easing, Image, BackHandler, Share, PanResponder,
  AppState, RefreshControl, FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TrackPlayer, {
  Capability, Event, State, AppKilledPlaybackBehavior,
  usePlaybackState, useProgress, useTrackPlayerEvents, RepeatMode,
} from 'react-native-track-player';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Accelerometer } from 'expo-sensors';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';

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

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

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


// --- GLOBAL FETCH INTERCEPTOR to reroute saavn.dev to Zyra-Backend ---
const originalFetch = global.fetch;
global.fetch = async (...args) => {
  let [url, config] = args;
  if (typeof url === 'string' && url.includes('saavn.dev')) {
    // Reroute to backend
    const originalUrl = url;
    url = url.replace('https://saavn.dev', BACKEND_URL);
    
    // We must fix search/songs because backend uses /api/search
    if (url.includes('/api/search/songs') || url.includes('/api/search/albums') || url.includes('/api/search/playlists') || url.includes('/api/search/artists')) {
      url = url.replace('/api/search/songs', '/api/search');
      url = url.replace('/api/search/albums', '/api/search');
      url = url.replace('/api/search/playlists', '/api/search');
      url = url.replace('/api/search/artists', '/api/search');
      
      const res = await originalFetch(url, config);
      const clone = res.clone();
      try {
        const j = await clone.json();
        // The frontend expects j.data.results, but backend returns j.data.songs, j.data.albums, etc.
        if (j && j.data) {
          if (originalUrl.includes('/search/songs') && j.data.songs) j.data.results = j.data.songs;
          if (originalUrl.includes('/search/albums') && j.data.albums) j.data.results = j.data.albums;
          if (originalUrl.includes('/search/playlists') && j.data.playlists) j.data.results = j.data.playlists;
          if (originalUrl.includes('/search/artists') && j.data.artists) j.data.results = j.data.artists;
        }
        return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
      } catch (e) {
        return res;
      }
    }
    
    // Fix album details
    if (url.includes('/api/albums?id=')) {
      url = url.replace('/api/albums?id=', '/api/albums/');
      const res = await originalFetch(url, config);
      const clone = res.clone();
      try {
        const j = await clone.json();
        // Frontend expects j.data.songs, backend returns j.album.songs
        if (j && j.album) {
          j.data = j.album;
        }
        return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
      } catch(e) {
        return res;
      }
    }

    // Fix playlist details
    if (url.includes('/api/playlists?id=')) {
      url = url.replace('/api/playlists?id=', '/api/playlists/');
      const res = await originalFetch(url, config);
      const clone = res.clone();
      try {
        const j = await clone.json();
        if (j && j.data && !j.data.songs) {
          j.data.songs = j.data.results; // map back if needed
        }
        return new Response(JSON.stringify(j), { status: res.status, headers: res.headers });
      } catch(e) {
        return res;
      }
    }
  }
  return originalFetch(url, config);
};

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
  const [currentScreen, setCurrentScreen] = useState<'all_songs' | 'search' | 'library' | 'downloads' | 'settings' | 'playlist_view' | 'listen_later' | 'artist_profile' | 'album_view'>('all_songs');
  const [selectedAlbum, setSelectedAlbum] = useState<any>(null);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);

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
  const navBarWidthRef       = useRef<number>(0);
  const progressBarWidthRef = useRef<number>(0);
  const lyricsListRef = useRef<any>(null);
  const sessionHistoryRef    = useRef<any[]>([]);

  // ── RNTP hooks (must be at top level) ──
  const playerState = usePlaybackState();
  const isPlaying   = playerState.state === State.Playing;
  // Show spinner when RNTP is buffering OR loading
  const isBuffering = playerState.state === State.Buffering || playerState.state === State.Loading;
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
  const [lyrics,           setLyrics]           = useState<string>('');
  const [lyricsLoading,    setLyricsLoading]    = useState(false);
  const [showLyrics,       setShowLyrics]       = useState(false);
  const [lyricsFontSize,   setLyricsFontSize]   = useState<'sm'|'md'|'lg'>('md');
  const [parsedLyrics,     setParsedLyrics]     = useState<{time:number,text:string}[]>([]);
  const [currentLyricIndex,setCurrentLyricIndex]= useState(-1);
  const lyricsScrollRef = useRef<ScrollView>(null);

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
  const [featuredPlaylists, setFeaturedPlaylists] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [statsData,      setStatsData]      = useState<any>(null);

  // ── Smart Autoplay ──
  const [smartAutoplay,  setSmartAutoplay]  = useState(true);
  const [currentMood,    setCurrentMood]    = useState<string>('default');
  const [autoplayReason, setAutoplayReason] = useState<string>('');
  const [autoplayQueue,  setAutoplayQueue]  = useState<any[]>([]);
  const [shakeEnabled,   setShakeEnabled]   = useState(false);

  // ── Album / Movie ──
  const [albumResults,    setAlbumResults]    = useState<any[]>([]);
  const [expandedAlbumId, setExpandedAlbumId] = useState<string|null>(null);
  const [searchFilter,    setSearchFilter]    = useState<'all'|'songs'|'albums'|'artists'|'movies'>('all');
  const [artistResults,   setArtistResults]   = useState<any[]>([]);
  const [showMoodGenres,  setShowMoodGenres]  = useState(false);
  // ── Movie search ──
  const [movieResults,        setMovieResults]        = useState<any[]>([]);
  const [selectedMovie,       setSelectedMovie]       = useState<any>(null);
  const [movieSongs,          setMovieSongs]          = useState<any[]>([]);
  const [isMovieSongsLoading, setIsMovieSongsLoading] = useState(false);

  // ── Artists ──
  const [topArtists,    setTopArtists]    = useState<any[]>([]);
  const [activeArtist,  setActiveArtist]  = useState<any>(null);
  const [artistTracks,  setArtistTracks]  = useState<any[]>([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [isArtistMode,  setIsArtistMode]  = useState(false);
  const artistPlayedRef = useRef<Set<string>>(new Set());

  // ── Theme ──
  type ThemeMode = 'dark'|'amoled'|'light'|'midnight'|'forest'|'sunset'|'purple'|'ocean'|'rose'|'golden';
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  // ── [VISUAL] Smooth theme transition ──
  const themeTransAnim = useRef(new Animated.Value(1)).current;

  const switchTheme = useCallback((m: ThemeMode) => {
    // Fade out → swap → fade in
    Animated.timing(themeTransAnim, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setThemeMode(m);
      AsyncStorage.setItem('themeMode', m);
      Animated.timing(themeTransAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
  }, []);

  // ── Modals ──
  const [isPlaylistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistSongTarget,     setPlaylistSongTarget]   = useState<any>(null);
  const [newPlaylistName,        setNewPlaylistName]      = useState('');
  const [isMenuVisible,          setMenuVisible]          = useState(false);

  // ── [NEW] Playback Speed ──
  const [playbackSpeed,   setPlaybackSpeedState] = useState(1.0);
  const [showSpeedPicker, setShowSpeedPicker]    = useState(false);

  // ── [NEW] Audio Quality ──
  const [audioQuality, setAudioQuality] = useState<'320kbps'|'160kbps'|'96kbps'>('320kbps');

  // ── [NEW] Song Rating ──
  const [ratedSongs, setRatedSongs] = useState<Record<string,'like'|'dislike'>>({});

  // ── [NEW] Listen Later ──
  const [listenLater, setListenLater] = useState<any[]>([]);

  // ── [NEW] Skip Intro ──
  const [skipIntroEnabled, setSkipIntroEnabled] = useState(false);
  const [introSeconds,     setIntroSeconds]     = useState(15);

  // ── [NEW] Bookmarks (per trackId → array of seconds) ──
  const [bookmarks, setBookmarks] = useState<Record<string,number[]>>({});

  // ── [NEW] Related Songs ──
  const [relatedSongs,   setRelatedSongs]   = useState<any[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [playerTab, setPlayerTab] = useState<'queue'|'lyrics'|'related'>('queue');

  // ── [NEW] Seek Indicator (swipe gesture feedback) ──
  const [seekIndicator, setSeekIndicator] = useState('');
  const seekIndicatorTimeoutRef = useRef<any>(null);

  // ── Refs ──
  const typingTimeoutRef   = useRef<any>(null);
  const playNextRef        = useRef<any>(null);
  const handleAutoNextRef  = useRef<any>(null);
  const handleShakeNextRef = useRef<any>(null);
  const handleShakePrevRef = useRef<any>(null);
  const trackMetaRef       = useRef<Map<string, any>>(new Map());
  const urlCacheRef        = useRef<Map<string, string>>(new Map());
  const queueCtxRef = useRef({
    activeTrack: null as any,
    userId:      null as string | null,
    userToken:   null as string | null,
    currentMood: 'default',
    downloads:   [] as any[],
  });
  const screenRef       = useRef('all_songs');
  const fullScreenRef   = useRef(false);
  const searchQueryRef  = useRef('');
  const searchFocusRef  = useRef(false);
  // For PanResponder — live references to avoid stale closures
  const posRef = useRef(0);
  const durRef = useRef(0);
  const swipeStartPosRef = useRef(0);

  // ── Animations ──
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;
  // ── [VISUAL] Vinyl rotation ──
  const vinylRotation = useRef(new Animated.Value(0)).current;
  // ── [VISUAL] 4-bar EQ animator ──
  const eqBar1 = useRef(new Animated.Value(3)).current;
  const eqBar2 = useRef(new Animated.Value(3)).current;
  const eqBar3 = useRef(new Animated.Value(3)).current;
  const eqBar4 = useRef(new Animated.Value(3)).current;
  // ── [VISUAL] Nav pill position ──
  const navPillAnim = useRef(new Animated.Value(0)).current;

  // ─── Nav pill — animate when screen changes (pixel-based, no stale closure) ──
  const navScreenToIdx = useCallback((screen: string) => {
    if (screen === 'library' || screen === 'playlist_view' || screen === 'listen_later') return 1;
    if (screen === 'downloads') return 2;
    if (screen === 'settings')  return 3;
    return 0;
  }, []);

  useEffect(() => {
    const idx = navScreenToIdx(currentScreen);
    const w = navBarWidthRef.current;
    if (w > 0) {
      Animated.spring(navPillAnim, {
        toValue: idx * (w / 4),
        useNativeDriver: true,
        damping: 22, stiffness: 200, mass: 0.7,
      } as any).start();
    }
  }, [currentScreen]);

  // ─── Mini player swipe-up PanResponder ───────────────────────────────────────
  const miniPlayerPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: async (_, g) => {
        if (g.dy < -40) {
          setIsFullScreen(true);
        } else if (g.dy > 40) {
          await TrackPlayer.pause();
          setActiveTrack(null);
        }
      },
    })
  ).current;

  // ── [NEW] Album art swipe PanResponder ──
  const albumPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8,
      onPanResponderGrant: () => {
        swipeStartPosRef.current = posRef.current;
      },
      onPanResponderMove: (_, gs) => {
        const seekDelta = Math.round(gs.dx / 6);
        setSeekIndicator(seekDelta > 0 ? `+${seekDelta}s` : `${seekDelta}s`);
      },
      onPanResponderRelease: async (_, gs) => {
        const seekDelta = gs.dx / 6;
        const newPos = Math.max(0, Math.min(durRef.current, swipeStartPosRef.current + seekDelta));
        try { await TrackPlayer.seekTo(newPos); } catch {}
        if (seekIndicatorTimeoutRef.current) clearTimeout(seekIndicatorTimeoutRef.current);
        seekIndicatorTimeoutRef.current = setTimeout(() => setSeekIndicator(''), 800);
      },
    })
  ).current;

  // ─── Custom Alert Helper ──────────────────────────────────────────────────────
  const showAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertButtons(buttons || [{ text: 'OK' }]);
    setAlertVisible(true);
  }, []);

  // ─── Keep posRef / durRef in sync ─────────────────────────────────────────────
  useEffect(() => { posRef.current = posRaw; }, [posRaw]);
  useEffect(() => { durRef.current = durRaw; }, [durRaw]);

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

  // ─── [VISUAL] Vinyl rotation ──────────────────────────────────────────────────
  useEffect(() => {
    let vinylLoop: any;
    if (isPlaying) {
      vinylLoop = Animated.loop(
        Animated.timing(vinylRotation, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true })
      );
      vinylLoop.start();
    } else {
      vinylRotation.stopAnimation();
    }
    return () => { if (vinylLoop) vinylLoop.stop(); };
  }, [isPlaying]);

  // ─── Sensor logic ─ always active, ref-based so no stale closure ────────────
  const shakeCountRef    = useRef(0);
  const shakeAboveRef    = useRef(false);
  const lastShakeTsRef   = useRef(0);
  const shakeTimerRef    = useRef<any>(null);
  const shakeSubRef      = useRef<any>(null);

  const shakeEnabledRef  = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { shakeEnabledRef.current = shakeEnabled; }, [shakeEnabled]);

  const startSensors = useCallback(() => {
    if (shakeSubRef.current) { shakeSubRef.current.remove(); shakeSubRef.current = null; }
    if (!shakeEnabledRef.current) return;
    
    const SHAKE_THRESHOLD = 3.0;
    Accelerometer.setUpdateInterval(60); // faster poll
    shakeSubRef.current = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();

      // --- Shake to Skip (Single / Double) ---
      if (shakeEnabledRef.current) {
        const mag = Math.sqrt(x * x + y * y + z * z);
        const isAbove = mag > SHAKE_THRESHOLD;
        
        if (now - lastShakeTsRef.current > 1500) {
          shakeCountRef.current = 0;
          shakeAboveRef.current = false;
        }

        if (isAbove && !shakeAboveRef.current) {
          shakeCountRef.current += 1;
          lastShakeTsRef.current = now;
          
          if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
          
          shakeTimerRef.current = setTimeout(() => {
            const count = shakeCountRef.current;
            shakeCountRef.current = 0;
            if (count >= 4) {
              if (handleShakeNextRef.current) handleShakeNextRef.current();
            } else if (count >= 2) {
              if (handleShakePrevRef.current) handleShakePrevRef.current();
            }
          }, 600); // Wait 600ms after a pulse to resolve the gesture
        }
        shakeAboveRef.current = isAbove;
      }
    });
  }, []); // no deps

  useEffect(() => {
    if (shakeEnabled) { startSensors(); }
    else { if (shakeSubRef.current) { shakeSubRef.current.remove(); shakeSubRef.current = null; } }
  }, [shakeEnabled, startSensors]);

  useEffect(() => {
    // Re-subscribe on foreground (lock screen / minimize)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && shakeEnabledRef.current) startSensors();
    });
    return () => {
      if (shakeSubRef.current) shakeSubRef.current.remove();
      sub.remove();
    };
  }, [startSensors]);


  // ─── [VISUAL] 4-bar equalizer animation ──────────────────────────────────────
  useEffect(() => {
    const barCfg = [
      { bar: eqBar1, dur: 420, delay: 0   },
      { bar: eqBar2, dur: 620, delay: 100 },
      { bar: eqBar3, dur: 510, delay: 50  },
      { bar: eqBar4, dur: 720, delay: 160 },
    ];
    if (isPlaying) {
      barCfg.forEach(({ bar, dur, delay }) => {
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(bar, { toValue: 20, duration: dur, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: false }),
            Animated.timing(bar, { toValue: 3,  duration: dur, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: false }),
          ])
        ).start();
      });
    } else {
      barCfg.forEach(({ bar }) => {
        bar.stopAnimation();
        Animated.timing(bar, { toValue: 3, duration: 200, useNativeDriver: false }).start();
      });
    }
  }, [isPlaying]);



  // ─── [NEW] Save resume position every 5 seconds ───────────────────────────────
  useEffect(() => {
    if (!activeTrack || !isPlaying) return;
    const interval = setInterval(async () => {
      if (posRaw > 5) {
        try { await AsyncStorage.setItem(`resume_${activeTrack.id}`, String(posRaw)); } catch {}
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isPlaying, activeTrack, posRaw]);

  // ─── [NEW] Lyric sync — highlight current line ────────────────────────────────
  useEffect(() => {
    if (parsedLyrics.length === 0) return;
    let idx = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
      if (parsedLyrics[i].time <= posRaw) idx = i;
      else break;
    }
    if (idx !== currentLyricIndex) {
      setCurrentLyricIndex(idx);
      // Auto-scroll to current line
      if (idx >= 0 && lyricsScrollRef.current) {
        lyricsScrollRef.current.scrollTo({ y: idx * 38, animated: true });
      }
    }
  }, [posRaw, parsedLyrics]);

  // ─── Save position every 5s → restore mini player on app reopen ───────────────
  const posRawRef = useRef(0);
  useEffect(() => { posRawRef.current = posRaw; }, [posRaw]);

  useEffect(() => {
    if (!activeTrack?.id) return;
    const tid = setInterval(() => {
      const currentPos = posRawRef.current;
      if (currentPos > 0) {
        AsyncStorage.setItem('lastPosition_' + activeTrack.id, String(currentPos)).catch(() => {});
        AsyncStorage.setItem('lastActiveTrack', JSON.stringify(activeTrack)).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(tid);
  }, [activeTrack?.id]);

  // ─── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    // Safety net: always show the app within 8 seconds even if backend is cold-starting
    const safetyTimer = setTimeout(() => { setIsAppReady(true); }, 8000);

    const init = async () => {
      try {
        const storedToken    = await AsyncStorage.getItem('token');
        const storedUserId   = await AsyncStorage.getItem('userId');
        const storedUsername = await AsyncStorage.getItem('username');
        const storedSH       = await AsyncStorage.getItem('searchHistory');
        const storedQuality  = await AsyncStorage.getItem('audioQuality');
        const storedTheme    = await AsyncStorage.getItem('themeMode');
        const storedSkip     = await AsyncStorage.getItem('skipIntroEnabled');
        const storedIntroSec = await AsyncStorage.getItem('introSeconds');
        const storedLL       = await AsyncStorage.getItem('listenLater');
        // [FIX] Load cached downloads for offline access
        const storedDownloads = await AsyncStorage.getItem('cachedDownloads');
        if (storedDownloads) setDownloads(JSON.parse(storedDownloads));
        const storedBM       = await AsyncStorage.getItem('bookmarks');
        const storedRated    = await AsyncStorage.getItem('ratedSongs');
        if (storedSH)       setSearchHistory(JSON.parse(storedSH));
        if (storedQuality)  setAudioQuality(storedQuality as any);
        if (storedTheme)    setThemeMode(storedTheme as any);
        if (storedSkip)     setSkipIntroEnabled(storedSkip === 'true');
        if (storedIntroSec) setIntroSeconds(parseInt(storedIntroSec));
        if (storedLL)       setListenLater(JSON.parse(storedLL));
        if (storedBM)       setBookmarks(JSON.parse(storedBM));
        if (storedRated)    setRatedSongs(JSON.parse(storedRated));
        if (storedToken && storedUserId) {
          setUserToken(storedToken);
          setUserId(storedUserId);
          setUsername(storedUsername || '');
          setIsLoggedIn(true);
          // [FIX] Load user data with a 10s timeout to avoid hanging on slow backend
          await Promise.race([
            loadUserData(storedToken),
            new Promise(r => setTimeout(r, 10000)),
          ]);
          loadRecentlyPlayed(storedToken);
        }
      } catch (e) { console.error('Init error', e); }
      finally { clearTimeout(safetyTimer); setIsAppReady(true); }
    };
    init();

    const keepAlive = setInterval(() => {
      fetch(`${BACKEND_URL}/ping`).catch(() => {});
    }, 4 * 60 * 1000);
    // ── Trending: fire multiple saavn.dev requests in parallel, pick first with data
    const mapSaavnTrend = (s: any) => {
      const dlUrls: any[] = s.downloadUrl || [];
      const imgs: any[]   = s.image || [];
      const url   = dlUrls.find((u: any) => u.quality === '320kbps')?.url || dlUrls[dlUrls.length - 1]?.url || '';
      const image = imgs.find((i: any) => i.quality === '500x500')?.url || imgs[imgs.length - 1]?.url || '';
      const artist = s.artists?.primary?.map((a: any) => a.name).join(', ') || '';
      return { id: s.id, title: s.name || '', artist, image, url, duration: s.duration || 0 };
    };
    const trendingQueries = [
      'global+top+50',
      'latest+bollywood+hits',
      'trending+hits+2024',
      'best+hindi+songs+2024',
      'new+bollywood+2024',
    ];
    // fetch all in parallel, use backend /api/trending for proper CDN URLs
    (async () => {
      try {
        const tr = await fetch(`${BACKEND_URL}/api/trending`);
        if (tr.ok) {
          const tj = await tr.json();
          if (tj.success && Array.isArray(tj.songs) && tj.songs.length > 0) {
            setTrendingSongs(tj.songs);
            return; // backend worked, skip fallback
          }
        }
      } catch {}
      // fallback: saavn.dev search
      let trendingSet = false;
      trendingQueries.forEach(async (q) => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 9000);
        const r = await fetch(`https://saavn.dev/api/search/songs?query=${q}&limit=15`, { signal: ctrl.signal });
        clearTimeout(tid);
        if (!r.ok) return;
        const j = await r.json();
        if (trendingSet) return;
        const results = j?.data?.results;
        if (Array.isArray(results) && results.length > 0) {
          trendingSet = true;
          setTrendingSongs(results.map(mapSaavnTrend));
        }
      } catch { /* ignore aborted / network errors */ }
      });
    })();

    fetch(`${BACKEND_URL}/api/artists/top`).then(r => r.json()).then(j => { if (j.success) setTopArtists(j.artists || []); }).catch(() => {});
    return () => clearInterval(keepAlive);
  }, []);

  const fetchFeaturedPlaylists = useCallback(async () => {
    try {
      const keywords = [
        { key: 'romantic', title: 'Romance', subtitle: 'Feel the love' },
        { key: 'workout', title: 'Workout', subtitle: 'Pump it up' },
        { key: 'chill', title: 'Chill', subtitle: 'Kick back & relax' },
        { key: 'party', title: 'Party', subtitle: 'Dance the night away' },
        { key: 'lofi', title: 'Lo-Fi', subtitle: 'Beats to study/relax to' },
        { key: 'devotional', title: 'Devotional', subtitle: 'Peaceful & spiritual' },
        { key: 'punjabi', title: 'Punjabi Hits', subtitle: 'Bhangra beats' },
        { key: 'pop', title: 'Pop Sensations', subtitle: 'Top chart bangers' }
      ];
      const results: any[] = [];
      for (const kw of keywords) {
        try {
          const r = await fetch(`${BACKEND_URL}/api/playlists/search?query=${kw.key}&limit=20`);
          const j = await r.json();
          if (j.success && j.data?.results) {
            const playlists = j.data.results.map((p: any) => {
              const imgs = p.image || [];
              const img = imgs.find((i: any) => i.quality === '500x500')?.url || imgs[imgs.length - 1]?.url || '';
              return { id: p.id, title: p.title || p.name || '', subtitle: p.subtitle || p.description || '', image: img };
            }).filter((p: any) => p.image);
            results.push({ title: kw.title, subtitle: kw.subtitle, items: playlists.sort(() => 0.5 - Math.random()).slice(0, 10) });
          }
        } catch {}
      }
      setFeaturedPlaylists(results);
    } catch (e) { console.error('Featured playlists error', e); }
  }, []);

  const onRefreshHome = useCallback(async () => {
    setRefreshing(true);
    await fetchFeaturedPlaylists();
    setRefreshing(false);
  }, [fetchFeaturedPlaylists]);

  useEffect(() => { fetchFeaturedPlaylists(); }, [fetchFeaturedPlaylists]);

  // ─── RNTP setup ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await TrackPlayer.setupPlayer();
        await TrackPlayer.updateOptions({
          capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.Stop, Capability.SeekTo],
          compactCapabilities: [Capability.SkipToPrevious, Capability.Play, Capability.SkipToNext],
          notificationCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.Stop],
          progressUpdateEventInterval: 1,
          // Keep playing when app is killed/backgrounded
          android: { appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback },
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
        }
      } catch {}
    }
  });

  // ─── RNTP queue-ended ─────────────────────────────────────────────────────────
  useTrackPlayerEvents([Event.PlaybackQueueEnded], async () => { if (playNextRef.current) playNextRef.current(); });

  // ─── BackHandler refs ─────────────────────────────────────────────────────────
  useEffect(() => { screenRef.current = currentScreen; }, [currentScreen]);
  useEffect(() => { fullScreenRef.current = isFullScreen; }, [isFullScreen]);
  useEffect(() => { searchQueryRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { searchFocusRef.current = isSearchFocused; }, [isSearchFocused]);
  useEffect(() => {
    const onBack = (): boolean => {
      if (fullScreenRef.current) { setIsFullScreen(false); return true; }
      if (screenRef.current !== 'all_songs') { setCurrentScreen('all_songs'); return true; }
      // [FIX] If search is active, clear it first — don't exit the app
      if (searchQueryRef.current.trim().length > 0) {
        setSearchQuery('');
        setIsSearchFocused(false);
        return true;
      }
      if (searchFocusRef.current) {
        setIsSearchFocused(false);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []);

  // ─── Search debounce & Suggestions ─────────────────────────────────────────────
  const fetchSuggestions = async (query: string) => {
    if (!query.trim()) { setSearchSuggestions([]); return; }
    try {
      const resp = await fetch(`https://www.jiosaavn.com/api.php?__call=autocomplete.get&query=${encodeURIComponent(query)}&_format=json&_marker=0&ctx=android`);
      const json = await resp.json();
      const suggestions: string[] = [];
      ['topquery', 'songs', 'albums', 'artists'].forEach(k => {
        const items = json[k]?.data || [];
        items.forEach((item: any) => {
          let title = item.title || '';
          title = title.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
          if (title && !suggestions.includes(title)) suggestions.push(title);
        });
      });
      setSearchSuggestions(suggestions.slice(0, 10));
    } catch {}
  };

  const openAlbumView = async (albumBase: any) => {
    setIsSearching(true);
    try {
      const r = await fetch(`https://saavn.dev/api/albums?id=${albumBase.id}`);
      const albumData = await r.json();
      if (albumData.success && albumData.data) {
        setSelectedAlbum(albumData.data);
        setCurrentScreen('album_view');
      }
    } catch {
      showAlert('Error', 'Could not load album details');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (searchQuery.trim().length === 0) { setSongsList([]); setAlbumResults([]); setExpandedAlbumId(null); setSearchSuggestions([]); return; }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      fetchLiveTracks(searchQuery);
      fetchSuggestions(searchQuery);
    }, 400);
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
      if (dls.success) {
        setDownloads(dls.data.downloads);
        // [FIX] Cache downloads to AsyncStorage so they load offline
        AsyncStorage.setItem('cachedDownloads', JSON.stringify(dls.data.downloads));
      }
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
      if (json.success) setRecentlyPlayed(json.data?.history || []);
    } catch {}
  };

  // ─── Load Listening Stats ──────────────────────────────────────────────────────
  const loadListeningStats = async () => {
    if (!userToken) return;
    try {
      setIsLoading(true);
      const resp = await fetch(`${BACKEND_URL}/api/user/history`, { headers: { Authorization: `Bearer ${userToken}` } });
      const json = await resp.json();
      if (json.success) {
        const hist = json.data?.history || [];
        const total = hist.length;
        const artistMap: Record<string, number> = {};
        const moodMap: Record<string, number> = {};
        hist.forEach((s: any) => {
          if (s.artist) artistMap[s.artist] = (artistMap[s.artist] || 0) + 1;
          if (s.mood) moodMap[s.mood] = (moodMap[s.mood] || 0) + 1;
        });
        const topArtist = Object.entries(artistMap).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Unknown';
        const topMood   = Object.entries(moodMap).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Chill';
        setStatsData({ total, topArtist, topMood });
        setShowStatsModal(true);
      }
    } catch (e) {
      showAlert('Error', 'Could not load stats');
    } finally {
      setIsLoading(false);
    }
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
      const fileUri = FileSystem.documentDirectory + `zyra_${song.id}.m4a`;
      const titleEnc  = encodeURIComponent(song.title  || '');
      const artistEnc = encodeURIComponent(song.artist || '');
      const urlToDownload = `${BACKEND_URL}/api/stream?id=${song.id}&title=${titleEnc}&artist=${artistEnc}`;
      const downloadRes = await FileSystem.downloadAsync(urlToDownload, fileUri);
      if (!downloadRes.uri) throw new Error('Download failed');
      const entry = { ...song, localUri: downloadRes.uri };
      const json  = await apiCall('/api/user/downloads', 'POST', entry);
      if (json.success) {
        setDownloads(json.data.downloads);
        AsyncStorage.setItem('cachedDownloads', JSON.stringify(json.data.downloads));
        showAlert('Downloaded', 'Song saved for offline listening!');
      }
    } catch (e) { console.error('Download error', e); showAlert('Error', 'Download failed. Please try again.'); }
  };

  const deleteDownload = async (song: any) => {
    showAlert('Remove Download', `Remove "${song.title}" from downloads?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          if (song.localUri) { try { await FileSystem.deleteAsync(song.localUri, { idempotent: true }); } catch {} }
          const json = await apiCall(`/api/user/downloads/${song.id}`, 'DELETE');
          if (json.success) {
            setDownloads(json.data.downloads);
            AsyncStorage.setItem('cachedDownloads', JSON.stringify(json.data.downloads));
          } else {
            setDownloads(prev => {
              const nd = prev.filter(d => d.id !== song.id);
              AsyncStorage.setItem('cachedDownloads', JSON.stringify(nd));
              return nd;
            });
          }
        } catch (e) {
          console.error('Delete download error', e);
          setDownloads(prev => {
            const nd = prev.filter(d => d.id !== song.id);
            AsyncStorage.setItem('cachedDownloads', JSON.stringify(nd));
            return nd;
          });
        }
      }},
    ]);
  };

  // ─── Search ──────────────────────────────────────────────────────────────────
  // ─── Search: movies/albums from saavn.dev ─────────────────────────────────
  const fetchMovieResults = async (query: string) => {
    try {
      const ctrl1 = new AbortController(); const t1 = setTimeout(() => ctrl1.abort(), 8000);
      const r = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(query)}`, { signal: ctrl1.signal });
      clearTimeout(t1);
      const j = await r.json();
      if (j.success && j.data?.albums?.length > 0) {
        const movies = j.data.albums.map((a: any) => {
          return { id: a.id, name: a.name || '', description: a.artist || '', image: a.image, year: '', songCount: 0, artists: a.artist || '' };
        });
        setMovieResults(movies);
        
        // Auto-expand if the movie name exactly matches the search query
        const exactMatch = movies.find((m: any) => m.name.toLowerCase() === query.toLowerCase().trim());
        if (exactMatch) {
          openMovie(exactMatch);
        }
      } else { setMovieResults([]); }
    } catch { setMovieResults([]); }
  };

  // Open a movie — fetch all its songs from saavn.dev albums endpoint
  const openMovie = async (movie: any) => {
    setSelectedMovie(movie);
    setIsMovieSongsLoading(true);
    setMovieSongs([]);
    try {
      const ctrl2 = new AbortController(); const t2 = setTimeout(() => ctrl2.abort(), 10000);
      const r = await fetch(`${BACKEND_URL}/api/albums/${movie.id}`, { signal: ctrl2.signal });
      clearTimeout(t2);
      const j = await r.json();
      if (j.success && j.data?.songs?.length > 0) {
        setMovieSongs(j.data.songs);
      }
    } catch {}
    finally { setIsMovieSongsLoading(false); }
  };

  const fetchLiveTracks = async (query: string) => {
    try {
      setIsSearching(true);
      const resp = await fetch(
        `https://saavn.dev/api/search/songs?query=${encodeURIComponent(query)}&limit=20`,
        { signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 10000); return c.signal; })() }
      );
      const json = await resp.json();
      if (json.success && json.data?.results?.length > 0) {
        const results = json.data.results.map((s: any) => {
          const dlUrls: any[] = s.downloadUrl || [];
          // [NEW] respect selected audio quality
          const audioUrl = dlUrls.find((u: any) => u.quality === audioQuality)?.url
                        || dlUrls.find((u: any) => u.quality === '320kbps')?.url
                        || dlUrls.find((u: any) => u.quality === '160kbps')?.url
                        || dlUrls[dlUrls.length - 1]?.url || '';
          const imgs: any[] = s.image || [];
          const image = imgs.find((i: any) => i.quality === '500x500')?.url
                     || imgs.find((i: any) => i.quality === '150x150')?.url
                     || imgs[imgs.length - 1]?.url || '';
          const artist = s.artists?.primary?.map((a: any) => a.name).join(', ')
                      || s.primaryArtists || '';
          if (audioUrl && s.id) urlCacheRef.current.set(s.id, audioUrl);
          return { id: s.id, title: s.name || '', artist, image, url: audioUrl, duration: s.duration || 0 };
        });
        setSongsList(results);
        setAlbumResults([]);
        // Fire movie search in parallel — don't block song results
        fetchMovieResults(query);
        return;
      }
    } catch (e) {
      console.warn('saavn.dev search failed, falling back to backend:', e);
    }
    try {
      const resp = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(query)}`);
      const json = await resp.json();
      if (json.success) { 
        setSongsList(json.data.songs || json.data.results || []); 
        setAlbumResults(json.data.albums || []); 
        // Populate movieResults with the same albums to prevent empty sections if the user filters by 'movies', but avoid duplicate network calls.
        const movies = (json.data.albums || []).map((a: any) => ({ id: a.id, name: a.name || '', description: a.artist || '', image: a.image, year: '', songCount: 0, artists: a.artist || '' }));
        setMovieResults(movies);
      }
      else { setSongsList([]); setAlbumResults([]); setMovieResults([]); }
    } catch { setSongsList([]); setAlbumResults([]); setMovieResults([]); }
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

  // ─── Stream URL resolver (with audio quality) ────────────────────────────────
  const resolveStreamUrl = useCallback(async (song: any): Promise<string> => {
    const dl = downloads.find((d: any) => d.id === song.id);
    if (dl?.localUri) return dl.localUri;
    if (song.id?.startsWith('yt_')) {
      const te = encodeURIComponent(song.title  || '');
      const ae = encodeURIComponent(song.artist || '');
      return `${BACKEND_URL}/api/stream?id=${song.id}&title=${te}&artist=${ae}`;
    }
    const cached = urlCacheRef.current.get(song.id);
    if (cached) return cached;
    if (song.url && typeof song.url === 'string' && song.url.includes('saavncdn')) {
      return song.url;
    }

    const te = encodeURIComponent(song.title  || '');
    const ae = encodeURIComponent(song.artist || '');
    // Resolve direct streaming URL to reduce TrackPlayer latency
    try {
      const res = await fetch(`${BACKEND_URL}/api/stream?id=${song.id}&title=${te}&artist=${ae}&json=true`);
      const data = await res.json();
      if (data && data.url) return data.url;
    } catch {}

    return `${BACKEND_URL}/api/stream?id=${song.id}&title=${te}&artist=${ae}`;
  }, [downloads, audioQuality]);

  // ─── Restore last played track on app reopen ─────────────────────────────────
  const hasRestoredTrackRef = useRef(false);
  useEffect(() => {
    if (hasRestoredTrackRef.current) return;
    hasRestoredTrackRef.current = true;

    AsyncStorage.getItem('lastActiveTrack').then(async (raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (saved?.id) {
          // 1. SET activeTrack so mini player shows up
          setActiveTrack(saved);

          // 2. Fetch fresh streaming url
          const streamUrl = await resolveStreamUrl(saved);

          // 3. Restore to TrackPlayer
          await TrackPlayer.reset();
          trackMetaRef.current.clear();
          trackMetaRef.current.set(String(saved.id), saved);
          await TrackPlayer.add({
            id: String(saved.id), url: streamUrl,
            title: saved.title || '', artist: saved.artist || '',
            artwork: saved.image || '', duration: saved.duration || 0,
          });

          // 4. Restore position
          const savedPos = await AsyncStorage.getItem('lastPosition_' + saved.id);
          if (savedPos && parseFloat(savedPos) > 5) {
             await TrackPlayer.seekTo(parseFloat(savedPos));
          }
        }
      } catch (e) {
        console.warn("Failed to restore track", e);
      }
    });
  }, [resolveStreamUrl]);

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

  // ─── Pre-fill queue removed ───────────────────────────────────────────────────────────

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
    setRecentlyPlayed(prev => prev.filter(s => s.id !== song.id));
    try { await apiCall(`/api/user/history/${song.id}`, 'DELETE'); }
    catch (e) { loadRecentlyPlayed(); }
  };

  // ─── [NEW] Change playback speed ──────────────────────────────────────────────
  const changePlaybackSpeed = async (speed: number) => {
    setPlaybackSpeedState(speed);
    try { await (TrackPlayer as any).setRate(speed); } catch {}
    setShowSpeedPicker(false);
  };

  // ─── [NEW] Rate song (like / dislike) ────────────────────────────────────────
  const rateSong = async (song: any, rating: 'like'|'dislike') => {
    if (!song) return;
    const current = ratedSongs[song.id];
    const newRating = current === rating ? undefined : rating;
    setRatedSongs(prev => {
      const updated = { ...prev };
      if (newRating) updated[song.id] = newRating;
      else delete updated[song.id];
      AsyncStorage.setItem('ratedSongs', JSON.stringify(updated));
      return updated;
    });
    try { await apiCall('/api/user/rating', 'POST', { songId: song.id, rating: newRating }); } catch {}
  };

  // ─── [NEW] Send skip signal to backend ───────────────────────────────────────
  const sendSkipSignal = async (songId: string) => {
    if (!songId) return;
    try { await apiCall('/api/user/skip', 'POST', { songId }); } catch {}
  };

  // ─── [NEW] Toggle Listen Later ────────────────────────────────────────────────
  // ─── Add to Next (inserts song at next position) ───────
  const addToNext = async (song: any) => {
    if (!song) return;
    try {
      setAutoplayQueue(prev => [song, ...prev.filter(s => s.id !== song.id)]);
      showAlert('Added ▶', `"${song.title}" will play next`);
    } catch {
      showAlert('Error', 'Could not add to queue');
    }
  };

  // ─── [NEW] Add / Remove bookmark at current position ─────────────────────────
  const addBookmark = () => {
    if (!activeTrack) return;
    const sec = Math.floor(posRaw);
    setBookmarks(prev => {
      const existing = prev[activeTrack.id] || [];
      if (existing.includes(sec)) {
        showAlert('Already Bookmarked', `Position ${formatTime(sec * 1000)} already bookmarked.`);
        return prev;
      }
      const updated = { ...prev, [activeTrack.id]: [...existing, sec].sort((a, b) => a - b) };
      AsyncStorage.setItem('bookmarks', JSON.stringify(updated));
      showAlert('Bookmark Added 🔖', `Marked at ${formatTime(sec * 1000)}`);
      return updated;
    });
  };

  const removeBookmark = (trackId: string, sec: number) => {
    setBookmarks(prev => {
      const updated = { ...prev, [trackId]: (prev[trackId] || []).filter(b => b !== sec) };
      AsyncStorage.setItem('bookmarks', JSON.stringify(updated));
      return updated;
    });
  };

  // ─── Fetch related songs ─────────────────────────────────────────────────────
  const fetchRelatedSongs = useCallback(async (song: any) => {
    if (!song) return;
    setRelatedLoading(true);
    setRelatedSongs([]);

    const mapSaavn = (s: any) => {
      const dlUrls: any[] = Array.isArray(s.downloadUrl) ? s.downloadUrl : (Array.isArray(s.media_url) ? s.media_url : []);
      const imgs: any[]   = Array.isArray(s.image) ? s.image : [];
      
      let url = dlUrls.find((u: any) => u.quality === '320kbps')?.url || dlUrls[dlUrls.length - 1]?.url;
      if (!url && typeof s.downloadUrl === 'string') url = s.downloadUrl;
      if (!url && typeof s.media_url === 'string') url = s.media_url;
      if (!url && typeof s.url === 'string') url = s.url;

      let image = imgs.find((i: any) => i.quality === '500x500')?.url || imgs[imgs.length - 1]?.url;
      if (!image && typeof s.image === 'string') image = s.image;

      const artist = s.artists?.primary?.map((a: any) => a.name).join(', ') || s.primaryArtists || s.subtitle || '';
      return { id: s.id, title: s.name || s.title || '', artist, image: image || '', url: url || '', duration: s.duration || 0 };
    };

    const saavnSearch = async (q: string) => {
      try {
        const r = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(q)}&limit=20`);
        const j = await r.json();
        if (j.success && j.data?.results?.length > 0) {
          return j.data.results
            .filter((s: any) => s.id !== song.id)
            .map(mapSaavn)
            .filter((s: any) => s.url)
            .slice(0, 15);
        }
      } catch {}
      return [];
    };

    const primaryArtist = (song.artist || '').split(',')[0].trim();
    const titleWords    = (song.title  || '').split(' ').slice(0, 3).join(' ');

    // 1. Try backend
    try {
      const r = await fetch(`${BACKEND_URL}/api/recommendations/queue?songId=${song.id}&artist=${encodeURIComponent(song.artist || '')}&mood=${currentMood}`);
      const j = await r.json();
      if (j.success && j.queue?.length > 0) {
        setRelatedSongs(j.queue);
        setAutoplayQueue(prev => prev.length === 0 ? j.queue : prev);
        setRelatedLoading(false);
        return;
      }
    } catch {}

    // 2. Try Saavn Suggestions (Best for Related)
    try {
      const r_sugg = await fetch(`https://saavn.dev/api/songs/${song.id}/suggestions`);
      const j_sugg = await r_sugg.json();
      if (j_sugg.success && j_sugg.data && j_sugg.data.length > 0) {
        const songs = j_sugg.data.map(mapSaavn).filter((s: any) => s.url);
        if (songs.length > 0) {
          setRelatedSongs(songs);
          setAutoplayQueue(prev => prev.length === 0 ? songs : prev);
          setRelatedLoading(false);
          return;
        }
      }
    } catch {}

    // 3. Same artist
    if (primaryArtist) {
      const r = await saavnSearch(primaryArtist + ' songs');
      if (r.length > 0) {
        setRelatedSongs(r);
        setAutoplayQueue(prev => prev.length === 0 ? r : prev);
        setRelatedLoading(false);
        return;
      }
    }

    // 4. Title words
    const r2 = await saavnSearch(titleWords);
    if (r2.length > 0) {
      setRelatedSongs(r2);
      setAutoplayQueue(prev => prev.length === 0 ? r2 : prev);
      setRelatedLoading(false);
      return;
    }

    // 5. Fallback: any non-empty songs already loaded
    const fallback = songsList.filter((s: any) => s.id !== song.id && s.url).slice(0, 10);
    if (fallback.length > 0) setRelatedSongs(fallback);
    setRelatedLoading(false);
  }, [currentMood, songsList]);

  // ─── [NEW] Parse LRC lyrics format ───────────────────────────────────────────
  const parseLRC = (lrcText: string): {time:number,text:string}[] => {
    const lines = lrcText.split('\n');
    const result: {time:number,text:string}[] = [];
    for (const line of lines) {
      const match = line.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const fraction = match[3] ? parseFloat('0.' + match[3]) : 0;
        const text    = match[4].trim();
        if (text) result.push({ time: minutes * 60 + seconds + fraction, text });
      }
    }
    return result.sort((a, b) => a.time - b.time);
  };

  // ─── Play track ───────────────────────────────────────────────────────────────
  async function handleTrackPress(track: any) {
    setIsLoading(true);
    setIsYoutubeFallback(track.id?.startsWith('yt_') || false);
    setActiveTrack(track);
    setShowLyrics(false); setLyrics('');
    setParsedLyrics([]); setCurrentLyricIndex(-1);
    setRelatedSongs([]); setPlayerTab('queue');
    if (searchQuery.trim()) saveSearchHistory(searchQuery.trim());

    try {
      const streamUrl = await resolveStreamUrl(track);

      const trackItem = {
        id:      String(track.id),
        url:     streamUrl,
        title:   track.title  || '',
        artist:  track.artist || '',
        artwork: track.image  || '',
      };
      
      await TrackPlayer.reset();
      await TrackPlayer.add(trackItem);
      trackMetaRef.current.clear();
      trackMetaRef.current.set(String(track.id), track);
      await TrackPlayer.play();

      // [NEW] Restore playback speed
      try { if (playbackSpeed !== 1.0) await (TrackPlayer as any).setRate(playbackSpeed); } catch {}

      // [NEW] Skip intro if enabled
      if (skipIntroEnabled && introSeconds > 0) {
        setTimeout(async () => {
          try { await TrackPlayer.seekTo(introSeconds); } catch {}
        }, 1800);
      } else {
        // [NEW] Resume from last saved position
        try {
          const savedPos = await AsyncStorage.getItem(`resume_${track.id}`);
          if (savedPos && parseFloat(savedPos) > 5) {
            setTimeout(async () => {
              try { await TrackPlayer.seekTo(parseFloat(savedPos)); } catch {}
            }, 1500);
          }
        } catch {}
      }

      setIsLoading(false);

      // Post history + detect mood + fetch related (background, non-blocking)
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

      // [NEW] Fetch related songs in background
      fetchRelatedSongs(track);

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
    setLyricsLoading(true); setLyrics(''); setParsedLyrics([]); setCurrentLyricIndex(-1);
    const title = song.title || '';
    const artist = (song.artist || '').split(',')[0].trim();

    // Helper: detect if text is mostly Devanagari / Hindi script
    const isHindi = (text: string) => {
      const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
      return devanagari > 0; // >15% Hindi chars = Hindi lyrics
    };

    // 1️⃣ Saavn API — most reliable for Indian songs
    try {
      const r1 = await fetch(`https://saavn.dev/api/songs/${song.id}/lyrics`);
      const j1 = await r1.json();
      if (j1.success && j1.data?.lyrics) {
        setLyrics(j1.data.lyrics.replace(/<br>/g, "\n"));
        setLyricsLoading(false);
        return;
      }
    } catch {}

    // 2️⃣ lrclib.net — best source for romanized English pronunciation
    try {
      const r2 = await fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`);
      const j2 = await r2.json();
      if (Array.isArray(j2) && j2.length > 0) {
        // Pick first result whose lyrics are NOT Hindi script
        const validEntry = j2.find((entry: any) => {
          const text = entry.syncedLyrics || entry.plainLyrics || '';
          return text.length > 20 && !isHindi(text);
        });
        if (validEntry) {
          const lrcText = validEntry.syncedLyrics || validEntry.plainLyrics || '';
          setLyrics(lrcText);
          const parsed = parseLRC(lrcText);
          if (parsed.length > 0) setParsedLyrics(parsed);
          setLyricsLoading(false); return;
        }
      }
    } catch {}
    // 2️⃣ lyrics.ovh — plain English romanized text
    try {
      const r3 = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
      const j3 = await r3.json();
      if (j3.lyrics && j3.lyrics.length > 20 && !isHindi(j3.lyrics)) {
        setLyrics(j3.lyrics); setLyricsLoading(false); return;
      }
    } catch {}
    // 3️⃣ Backend fallback
    try {
      const resp = await fetch(`${BACKEND_URL}/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
      const json = await resp.json();
      if (json.success && json.lyrics && json.lyrics.length > 20 && !isHindi(json.lyrics)) {
        setLyrics(json.lyrics);
        const parsed = parseLRC(json.lyrics);
        if (parsed.length > 0) setParsedLyrics(parsed);
        setLyricsLoading(false); return;
      }
    } catch {}
    // 4️⃣ Saavn API exact match (Local Fallback)
    try {
      const res = await fetch(`https://saavn.dev/api/songs/${song.id}/lyrics`);
      const json = await res.json();
      if (json.success && json.data?.lyrics) {
        let lx = json.data.lyrics.replace(/<br>/g, '\n');
        setLyrics(lx);
        const parsed = parseLRC(lx);
        if (parsed.length > 0) setParsedLyrics(parsed);
        setLyricsLoading(false); return;
      }
    } catch {}
    setLyrics('Lyrics not available for this song.');
    setLyricsLoading(false);
  };

  // ─── Share ───────────────────────────────────────────────────────────────────
  const shareSong = async (song: any) => {
    try {
      await Share.share({ title: song.title, message: `🎵 Listening to "${song.title}" by ${song.artist} on Zyra!` });
    } catch {}
  };

  // ─── Add single song to queue (adds to end of autoplayQueue) ──────────────────
  const addSingleToQueue = async (song: any) => {
    if (!song?.id) return;
    try {
      setAutoplayQueue(prev => {
        if (prev.some(s => s.id === song.id)) return prev;
        return [...prev, song];
      });
      showAlert('Added to Queue', `"${song.title}" added to up next.`);
    } catch { showAlert('Error', 'Could not add to queue.'); }
  };

  // ─── Active list helper ───────────────────────────────────────────────────────
  const getActiveList = () => {
    if (currentScreen === 'library') return favorites;
    if (currentScreen === 'downloads') return downloads;
    if (currentScreen === 'listen_later') return listenLater;
    if (currentScreen === 'playlist_view' && activePlaylistId) {
      const pl = playlists.find(p => p.id === activePlaylistId);
      return pl ? pl.songs : [];
    }
    if (currentScreen === 'album_view' && selectedAlbum) return selectedAlbum.songs || [];
    return songsList;
  };

  // ─── playNext / playPrevious ──────────────────────────────────────────────────
  const playNext = async () => {
    if (!activeTrack) return;
    if (repeatMode === 'one') { await TrackPlayer.seekTo(0); await TrackPlayer.play(); return; }
    
    sendSkipSignal(activeTrack.id);

    // Play from genre queue if available
    if (autoplayQueue && autoplayQueue.length > 0) {
       const nextSong = autoplayQueue[0];
       setAutoplayQueue(prev => prev.slice(1));
       await handleTrackPress(nextSong);
       return;
    }
    
    // Fallback to auto next
    await handleAutoNext();
  };

  const playPrevious = async () => {
    if (!activeTrack) return;
    if (posRaw > 3) {
      await TrackPlayer.seekTo(0);
      return;
    }
    
    // Pop current song
    if (sessionHistoryRef.current.length > 0 && sessionHistoryRef.current[sessionHistoryRef.current.length - 1].id === activeTrack.id) {
       sessionHistoryRef.current.pop();
    }
    
    // Get previous song
    if (sessionHistoryRef.current.length > 0) {
       const prevSong = sessionHistoryRef.current.pop(); // Pop it so handleTrackPress can re-add it
       await handleTrackPress(prevSong);
    } else {
       await TrackPlayer.seekTo(0);
    }
  };

  playNextRef.current = playNext;

  // ─── Genre-smart auto-next ────────────────────────────────────────────────────
  const handleAutoNext = async () => {
    if (!activeTrack) return;
    const artist = (activeTrack.artist || '').split(',')[0].trim();
    const title  = activeTrack.title || '';
    
    // Use backend queue first if available
    try {
      const qs  = `songId=${activeTrack.id}&userId=${userId||''}&mood=${currentMood}`;
      const res = await fetch(`${BACKEND_URL}/api/recommendations/queue?${qs}`);
      const json = await res.json();
      if (json.success && json.queue && json.queue.length > 0) {
        const nextSong = json.queue[0];
        setAutoplayQueue(json.queue.slice(1));
        await handleTrackPress(nextSong);
        return;
      }
    } catch {}

    // Fallback 1: Backend Random song
    try {
      const res  = await fetch(`${BACKEND_URL}/api/random`);
      const json = await res.json();
      if (json.success && json.data?.song) {
        await handleTrackPress(json.data.song);
        return;
      }
    } catch {}

    // Fallback 2: Saavn API Suggestions (Local)
    try {
       const res = await fetch(`https://saavn.dev/api/songs/${activeTrack.id}/suggestions`);
       const json = await res.json();
       if (json.success && json.data && json.data.length > 0) {
          // Filter out the current track so it doesn't loop repeatedly
          const filteredData = json.data.filter((s: any) => String(s.id) !== String(activeTrack.id));
          if (filteredData.length > 0) {
            const nextSong = filteredData[0];
            setAutoplayQueue(filteredData.slice(1));
            await handleTrackPress(nextSong);
            return;
          }
       }
    } catch {}
    
    // Fallback 3: Saavn API Artist Search (Local)
    try {
       const res = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(artist)}`);
       const json = await res.json();
       if (json.success && json.data?.results?.length > 0) {
          const randIdx = Math.floor(Math.random() * Math.min(10, json.data.results.length));
          await handleTrackPress(json.data.results[randIdx]);
       }
    } catch {}
  };
  handleAutoNextRef.current = handleAutoNext;

  // ─── Shake-specific ──────────────────────────────────────────────────────────
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
      const r2   = await fetch(`${BACKEND_URL}/api/random`);
      const j2   = await r2.json();
      if (j2.success && j2.data?.song) await handleTrackPress(j2.data.song);
    } catch (e) { console.error('Shake next failed', e); }
    finally { setIsLoading(false); }
  };
  handleShakeNextRef.current = handleShakeNext;
  handleShakePrevRef.current = playPrevious;
  // ─── Theme ───────────────────────────────────────────────────────────────────
  const isAmoled = themeMode === 'amoled';
  const isDark   = themeMode !== 'light';
  // Per-theme bg/card overrides
  const themeBg: Record<string,[string,string]> = {
    dark:     ['#0d0d14','#16161f'],  midnight: ['#020a18','#071428'],
    forest:   ['#021208','#0a2010'],  sunset:   ['#1a0808','#280f0f'],
    purple:   ['#0d0118','#180a28'],  ocean:    ['#010e18','#051828'],
    rose:     ['#180810','#280a1a'],  golden:   ['#100c00','#1a1400'],
    amoled:   ['#000000','#0a0a0a'], light:    ['#f2f2fa','#ffffff'],
  };
  const [tbg, tcard] = themeBg[themeMode] ?? themeBg.dark;
  const theme = {
    bg:           isDark ? tbg   : '#f2f2fa',
    card:         isDark ? tcard : '#ffffff',
    surface:      isDark ? tcard : '#eaeaf8',
    header:       isDark ? tbg   : '#e4e4f5',
    text:         isDark ? '#e6e1f5' : '#111133',
    subtext:      isDark ? '#9896a8' : '#555577',
    border:       isAmoled ? 'rgba(255,255,255,0.06)' : isDark ? 'rgba(255,255,255,0.08)' : '#d0d0e8',
    input:        isDark ? tcard : '#eaeaf8',
    navBg:        isDark ? tbg   : '#e4e4f5',
    miniPlayerBg: isDark ? tbg   : '#dde8f5',
    pillActive:   (MOOD_COLORS[currentMood] || '#00ffcc') + '28',
  };

  // ─── [VISUAL] Equalizer bars component ──────────────────────────────────────
  const EqualizerBars = ({ color, height = 16 }: { color: string; height?: number }) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height, marginLeft: 6 }}>
      {[eqBar1, eqBar2, eqBar3, eqBar4].map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: bar,
            backgroundColor: color,
            borderRadius: 2,
            maxHeight: height,
          }}
        />
      ))}
    </View>
  );

  // ─── Track card ───────────────────────────────────────────────────────────────
  const renderTrackCard = (song: any, isCurrent: boolean, isFav: boolean) => (
    <TouchableOpacity
      key={song.id}
      style={[styles.trackCard, {
        backgroundColor: theme.card,
        borderColor: isCurrent ? moodColor + '55' : theme.border,
        borderWidth: isCurrent ? 1.5 : 1,
      }]}
      onPress={() => { setAutoplayQueue([]); handleTrackPress(song); }}
      onLongPress={() => { setContextMenuSong(song); setContextMenuVisible(true); }}
    >
      {/* Album art thumbnail */}
      <View style={{ width: 50, height: 50, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
        {song.image
          ? <Image source={{ uri: song.image }} style={{ width: 50, height: 50 }} />
          : <Ionicons name="disc-outline" size={24} color={isCurrent ? moodColor : theme.subtext} />}
      </View>
      {/* Info */}
      <View style={styles.trackInfo}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={[styles.trackTitle, { color: isCurrent ? moodColor : theme.text, flex: 1 }]}>{song.title}</Text>
          {/* EQ bars for currently playing */}
          {isCurrent && isPlaying && <EqualizerBars color={moodColor} height={14} />}
        </View>
        <Text numberOfLines={1} style={[styles.trackArtist, { color: theme.subtext }]}>{song.artist}</Text>
      </View>
      <TouchableOpacity onPress={() => toggleFavorite(song)} style={{ padding: 8 }}>
        <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={20} color={isFav ? '#ff6b9d' : theme.subtext} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { setPlaylistSongTarget(song); setPlaylistModalVisible(true); }} style={{ padding: 8 }}>
        <Ionicons name="add-circle-outline" size={20} color={theme.subtext} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => downloadSong(song)} style={{ padding: 8 }}>
        <Ionicons name={downloads.some(d => d.id === song.id) ? 'cloud-done' : 'cloud-download-outline'} size={20} color={downloads.some(d => d.id === song.id) ? moodColor : theme.subtext} />
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
  const lyricsFontSizeMap = { sm: 13, md: 15, lg: 18 };

  return (
    <Animated.View style={[styles.container, { backgroundColor: theme.bg, opacity: themeTransAnim }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={theme.header} />

      {/* CUSTOM ALERT */}
      <ZyraAlert visible={alertVisible} title={alertTitle} message={alertMessage} buttons={alertButtons} onDismiss={() => setAlertVisible(false)} />

      {/* HEADER */}
      <View style={[styles.header, { backgroundColor: theme.header, paddingTop: Platform.OS === 'ios' ? 45 : 10 }]}>
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

        {/* ── HOME ─────────────────────────────────────────────────────────── */}
        {currentScreen === 'all_songs' && (
          <View style={styles.screenBody}>
            {/* ── User Welcome ── */}
            <View style={{ paddingHorizontal: 16, marginBottom: 12, marginTop: 10, flexDirection: 'row', alignItems: 'center' }}>
              {isEditingUsername ? (
                <TextInput
                  style={{ flex: 1, color: '#fff', fontSize: 22, fontWeight: '800', borderBottomWidth: 1, borderBottomColor: moodColor, paddingBottom: 4 }}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Enter your name"
                  placeholderTextColor="#666"
                  autoFocus
                  onSubmitEditing={() => { setIsEditingUsername(false); AsyncStorage.setItem('username', username); }}
                  onBlur={() => { setIsEditingUsername(false); AsyncStorage.setItem('username', username); }}
                />
              ) : (
                <TouchableOpacity onPress={() => setIsEditingUsername(true)} style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>
                    {(() => {
                      const h = new Date().getHours();
                      if (h < 12) return 'Good Morning, ';
                      if (h < 17) return 'Good Afternoon, ';
                      return 'Good Evening, ';
                    })()}
                    <Text style={{ color: moodColor }}>{username || 'Zyra'}</Text>
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── HOME FEED ── */}
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshHome} tintColor={moodColor} />}>

                {/* Dummy Search Bar that jumps to Search Tab */}
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: theme.card,
                    borderRadius: 16,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    marginHorizontal: 16,
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: theme.border
                  }}
                  onPress={() => setCurrentScreen('search')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="search" size={20} color="#8e8e93" style={{ marginRight: 10 }} />
                  <Text style={{ color: '#8e8e93', fontSize: 16 }}>Songs, albums, artists...</Text>
                </TouchableOpacity>

                {/* Recently Played */}
                {recentlyPlayed.length > 0 && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={styles.echoSectionLabel}>Recently Played</Text>
                      <Text style={{ color: '#ff444488', fontSize: 11 }}>Hold to remove</Text>
                    </View>
                    <Text style={{ color: theme.subtext, fontSize: 11, fontStyle: 'italic', marginBottom: 12 }}>PICK UP WHERE YOU LEFT OFF</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 28 }}>
                      {recentlyPlayed
                        .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i)
                        .map((song, i) => (
                        <TouchableOpacity key={i} style={styles.recentCard}
                          onPress={() => { setAutoplayQueue([]); handleTrackPress(song); }}
                          onLongPress={() => showAlert('Remove Song', `Remove "${song.title}" from recently played?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Remove', style: 'destructive', onPress: () => removeFromHistory(song) },
                          ])}>
                          <View style={{ width: 80, height: 80, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.surface, marginBottom: 8, borderWidth: activeTrack?.id === song.id ? 2.5 : 0, borderColor: moodColor }}>
                            {song.image ? <Image source={{ uri: song.image }} style={{ width: 80, height: 80 }} /> : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="musical-note" size={28} color={moodColor} /></View>}
                          </View>
                          <Text numberOfLines={1} style={{ color: activeTrack?.id === song.id ? moodColor : theme.text, fontSize: 11, fontWeight: '700', width: 84, textAlign: 'center' }}>{song.title}</Text>
                          <Text numberOfLines={1} style={{ color: theme.subtext, fontSize: 10, fontStyle: 'italic', width: 84, textAlign: 'center' }}>{song.artist}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}


                {/* ── Featured Playlists (Posters) ── */}
                {featuredPlaylists.length > 0 && !isSearchFocused && (
                  <View style={{ marginTop: 10 }}>
                    {featuredPlaylists.map((section: any, sectionIdx: number) => (
                      <View key={sectionIdx} style={{ marginBottom: 28 }}>
                        <Text style={[styles.echoSectionLabel, { marginBottom: 2 }]}>{section.title}</Text>
                        <Text style={{ color: theme.subtext, fontSize: 11, fontStyle: 'italic', marginBottom: 12, textTransform: 'uppercase' }}>{section.subtitle}</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                          {section.items.map((pl: any, i: number) => (
                            <TouchableOpacity key={i} style={{ width: 140, height: 220, marginRight: 14, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.surface }}
                              onPress={async () => {
                                setCurrentMood('default');
                                setIsSearching(true);
                                setSearchQuery(pl.title);
                                try {
                                  const r = await fetch(`${BACKEND_URL}/api/playlists/${pl.id}`);
                                  const pdata = await r.json();
                                  const songsRaw = pdata.data?.songs || [];
                                  if (songsRaw.length > 0) {
                                    const mapped = songsRaw.map((s: any) => {
                                      const dl = s.downloadUrl || []; const im = s.image || [];
                                      return { id: s.id, title: (s.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                                    }).filter((s: any) => s.url);
                                    if (mapped.length > 0) {
                                      setSongsList(mapped);
                                    }
                                  }
                                } catch {}
                                finally { setIsSearching(false); }
                              }}>
                              {pl.image ? <Image source={{ uri: pl.image }} style={{ width: '100%', height: '100%' }} /> : <View style={{ flex: 1, backgroundColor: moodColor }} />}
                              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12, paddingTop: 30 }}>
                                <Text numberOfLines={2} style={{ color: '#fff', fontSize: 14, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 }}>{pl.title}</Text>
                                <Text numberOfLines={1} style={{ color: '#ccc', fontSize: 11, marginTop: 4 }}>{pl.subtitle}</Text>
                              </LinearGradient>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    ))}
                  </View>
                )}


                {/* ── Moods & Genres — 3-column grid ── */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={styles.echoSectionLabel}>Moods &amp; Genres</Text>
                  <TouchableOpacity onPress={() => setShowMoodGenres(true)} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', backgroundColor: moodColor, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' }}>SEE ALL</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color: theme.subtext, fontSize: 11, fontStyle: 'italic', marginBottom: 12 }}>PICK YOUR VIBE FOR TODAY</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
                  {[
                    { label: 'Romantic', emoji: '❤️', mood: 'romantic', color: '#d41051' },
                    { label: 'Sad',      emoji: '😢', mood: 'sad',      color: '#502db0' },
                    { label: 'Party',    emoji: '🎉', mood: 'item',     color: '#ff1900' },
                    { label: '90s',      emoji: '🎶', mood: '90s',      color: '#d55e14' },
                    { label: 'Bhajan',   emoji: '🙏', mood: 'bhajan',   color: '#e51ae8' },
                    { label: 'Energy',   emoji: '⚡', mood: 'energetic',color: '#4000ff' },
                    { label: 'Sleep',    emoji: '😴', mood: 'sleep',    color: '#1a6b8a' },
                    { label: 'Chill',    emoji: '🎵', mood: 'chill',    color: '#2d7a4f' },
                    { label: 'Workout',  emoji: '💪', mood: 'workout',  color: '#b84000' },
                    { label: 'Focus',    emoji: '🎯', mood: 'focus',    color: '#0066cc' },
                    { label: 'Happy',    emoji: '😊', mood: 'happy',    color: '#cc6600' },
                    { label: 'Gaming',   emoji: '🎮', mood: 'gaming',   color: '#6600cc' },
                  ].map(g => (
                    <TouchableOpacity key={g.mood}
                      style={{ backgroundColor: g.color + '22', borderWidth: 1.5, borderColor: g.color + '88', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', width: '31%' }}
                      onPress={async () => {
                        setCurrentMood(g.mood);
                        setShowMoodGenres(true);
                        setIsSearching(true);
                        setSearchQuery(g.label + ' Playlist');
                        try {
                          // Try to fetch an actual playlist for this mood
                          const q = encodeURIComponent(g.label + ' hindi bollywood');
                          const r = await fetch(`${BACKEND_URL}/api/playlists/search?query=${q}&limit=1`);
                          const j = await r.json();
                          if (j.success && j.data?.results?.length > 0) {
                            const pId = j.data.results[0].id;
                            const r2 = await fetch(`${BACKEND_URL}/api/playlists/${pId}`);
                            const pdata = await r2.json();
                            const songsRaw = pdata.data?.songs || [];
                            if (songsRaw.length > 0) {
                              const mapped = songsRaw.map((s: any) => {
                                const dl = s.downloadUrl || []; const im = s.image || [];
                                return { id: s.id, title: (s.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                              }).filter((s: any) => s.url);
                              if (mapped.length > 0) {
                                setSongsList(mapped);
                                setIsSearching(false);
                                return;
                              }
                            }
                          }
                        } catch {}
                        // Fallback to simple search if playlist fails
                        try {
                          const r = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(g.label + ' hits')}`);
                          const j = await r.json();
                          if (j.success && j.data?.results) {
                            const mapped = j.data.results.map((s: any) => {
                              const dl = s.downloadUrl || []; const im = s.image || [];
                              return { id: s.id, title: s.name || '', artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                            }).filter((s: any) => s.url);
                            setSongsList(mapped);
                          }
                        } catch {}
                        finally { setIsSearching(false); }
                      }}>
                      <Text style={{ fontSize: 22, marginBottom: 3 }}>{g.emoji}</Text>
                      <Text style={{ color: g.color, fontWeight: '700', fontSize: 11 }}>{g.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* ── Top Artists (3-column grid) ── */}
                {topArtists.length > 0 && !isSearchFocused && (
                  <View style={{ marginBottom: 28, marginTop: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={styles.echoSectionLabel}>Top Artists</Text>
                    </View>
                    <Text style={{ color: theme.subtext, fontSize: 11, fontStyle: 'italic', marginBottom: 12, textTransform: 'uppercase' }}>DISCOVER TRENDING VOICES</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {topArtists.map((art: any, i: number) => (
                        <TouchableOpacity key={i} style={{ width: '31%', alignItems: 'center', marginBottom: 16 }}
                          onPress={() => fetchArtist(art)}>
                          <View style={{ width: 80, height: 80, borderRadius: 40, overflow: 'hidden', backgroundColor: theme.surface, marginBottom: 8, borderWidth: 2, borderColor: moodColor + '88' }}>
                            {art.image ? (
                              <Image source={{ uri: typeof art.image === 'string' ? art.image : (art.image[art.image.length - 1]?.url || art.image[0]?.url) }} style={{ width: '100%', height: '100%' }} />
                            ) : (
                              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: moodColor + '44' }}>
                                <Ionicons name="person" size={36} color={moodColor} />
                              </View>
                            )}
                          </View>
                          <Text numberOfLines={1} style={{ color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' }}>{art.name || art.title}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Search history — only show when search bar is focused and query is empty */}
                {isSearchFocused && searchHistory.length > 0 && (
                  <View style={{ backgroundColor: theme.card, borderRadius: 16, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border }}>
                    <Text style={{ color: moodColor, fontSize: 12, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, textTransform: 'uppercase' }}>Search history</Text>
                    {searchHistory.slice(0, 5).map((item, i) => (
                      <TouchableOpacity key={i}
                        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: 1, borderTopColor: theme.border + '44' }}
                        onPress={async () => {
                          // Search for the history item and auto-play first result
                          setIsSearchFocused(false);
                          setSearchQuery(item);
                          setIsSearching(true);
                          try {
                            const controller = new AbortController();
                            setTimeout(() => controller.abort(), 8000);
                            const r = await fetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(item)}&limit=10`, { signal: controller.signal });
                            const j = await r.json();
                            if (j.success && j.data?.results?.length > 0) {
                              const s = j.data.results[0];
                              const dlUrls: any[] = s.downloadUrl || [];
                              const url = dlUrls.find((u: any) => u.quality === '320kbps')?.url || dlUrls[dlUrls.length - 1]?.url || '';
                              const imgs: any[] = s.image || [];
                              const image = imgs.find((ig: any) => ig.quality === '500x500')?.url || imgs[imgs.length - 1]?.url || '';
                              const artist = s.artists?.primary?.map((a: any) => a.name).join(', ') || '';
                              const song = { id: s.id, title: s.name || '', artist, image, url, duration: s.duration || 0 };
                              setAutoplayQueue([]); handleTrackPress(song);
                            }
                          } catch {}
                          finally { setIsSearching(false); }
                        }}>
                        <Ionicons name="time-outline" size={16} color={theme.subtext} style={{ marginRight: 14 }} />
                        <Text style={{ flex: 1, color: theme.text, fontSize: 14 }}>{item}</Text>
                        <TouchableOpacity onPress={() => removeSearchHistory(item)} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
                          <Ionicons name="close" size={14} color={theme.subtext} style={{ marginRight: 8 }} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setSearchQuery(item)} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
                          <Ionicons name="arrow-up-outline" size={16} color={moodColor} style={{ transform: [{ rotate: '45deg' }] }} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                                <View style={{ height: 20 }} />
              </ScrollView>

          </View>
        )}
        

        {/* ── SEARCH TAB ──────────────────────────────────────────────────────── */}
        {currentScreen === 'search' && (
          <View style={styles.screenBody}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={20} color="#8e8e93" style={{ marginRight: 10 }} />
              <TextInput
                style={styles.input}
                placeholder="Songs, albums, artists..."
                placeholderTextColor="#8e8e93"
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  setIsSearching(true);
                  if (text.trim().length > 0) setIsSearchFocused(false);
                }}
                onFocus={() => setIsSearchFocused(true)}
                onSubmitEditing={() => {
                  if (searchQuery.trim().length > 0) {
                    if (!searchHistory.includes(searchQuery.trim())) {
                      setSearchHistory(prev => [searchQuery.trim(), ...prev].slice(0, 10));
                    }
                  }
                }}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setIsSearchFocused(false); }}>
                  <Ionicons name="close-circle" size={20} color="#8e8e93" />
                </TouchableOpacity>
              )}
            </View>

            {/* Search History & Suggestions */}
            {isSearchFocused && !searchQuery && searchHistory.length > 0 && (
              <View style={styles.historyDropdown}>
                <Text style={styles.historyHeader}>Recent Searches</Text>
                {searchHistory.map((item, i) => (
                  <TouchableOpacity key={i} style={styles.historyItem} onPress={() => {
                    setSearchQuery(item); setIsSearchFocused(false);
                  }}>
                    <Ionicons name="time-outline" size={16} color="#666" style={{ marginRight: 12 }} />
                    <Text style={styles.historyItemText}>{item}</Text>
                    <TouchableOpacity onPress={() => removeSearchHistory(item)} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
                      <Ionicons name="close" size={16} color="#666" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            
            {isLoading || isSearching ? (
              <View style={styles.centeredBody}>
                <ActivityIndicator size="large" color={moodColor} />
                <Text style={{ color: moodColor, marginTop: 12, fontWeight: '600' }}>Searching...</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {songsList.map((song: any, index: number) => (
                  <TouchableOpacity key={index} style={[styles.searchResultRow, { backgroundColor: activeTrack?.id === song.id ? moodColor + '11' : 'transparent' }]} onPress={() => { setAutoplayQueue(songsList.slice(index + 1)); handleTrackPress(song); }}>
                    <Image source={{ uri: song.image }} style={{ width: 50, height: 50, borderRadius: 12, marginRight: 14 }} />
                    <View style={styles.trackInfo}>
                      <Text numberOfLines={1} style={styles.trackTitle}>{song.title}</Text>
                      <Text numberOfLines={1} style={styles.trackArtist}>{song.artist}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}
          </View>
        )}

{/* ── ALBUM VIEW (Full Screen) ─────────────────────────────────────── */}
        {currentScreen === 'album_view' && selectedAlbum && (
          <View style={[styles.screenBody, { padding: 0 }]}>
            {/* Immersive Header */}
            <View style={{ height: 350, width: '100%', position: 'relative' }}>
              {selectedAlbum.image && (
                <Image source={{ uri: selectedAlbum.image[2]?.url || selectedAlbum.image[1]?.url || selectedAlbum.image[0]?.url || selectedAlbum.image }} style={{ width: '100%', height: '100%', position: 'absolute' }} blurRadius={10} />
              )}
              <LinearGradient colors={['transparent', theme.bg]} style={{ width: '100%', height: '100%', position: 'absolute', bottom: 0 }} />
              <TouchableOpacity onPress={() => setCurrentScreen('all_songs')} style={{ position: 'absolute', top: 40, left: 20, width: 40, height: 40, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, justifyContent: 'center', alignItems: 'center', zIndex: 10 }}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20, alignItems: 'center' }}>
                {selectedAlbum.image && (
                  <View style={{ elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.5, shadowRadius: 10, marginBottom: 15, borderRadius: 10 }}>
                    <Image source={{ uri: selectedAlbum.image[2]?.url || selectedAlbum.image[1]?.url || selectedAlbum.image[0]?.url || selectedAlbum.image }} style={{ width: 160, height: 160, borderRadius: 10 }} />
                  </View>
                )}
                <Text style={{ color: '#fff', fontSize: 28, fontWeight: 'bold', textAlign: 'center' }}>{selectedAlbum.name || selectedAlbum.title}</Text>
                <Text style={{ color: '#aaa', fontSize: 13, marginTop: 5, textAlign: 'center' }}>{selectedAlbum.primaryArtists || 'Various Artists'} • {selectedAlbum.year || ''} • {selectedAlbum.songs?.length || 0} Tracks</Text>
              </View>
            </View>

            <View style={{ paddingHorizontal: 20, marginTop: 10, marginBottom: 20, flexDirection: 'row', justifyContent: 'center' }}>
              <TouchableOpacity
                onPress={() => {
                  if (selectedAlbum.songs?.length > 0) {
                    setAutoplayQueue(selectedAlbum.songs.slice(1));
                    handleTrackPress(selectedAlbum.songs[0]);
                  }
                }}
                style={{ backgroundColor: moodColor, width: 200, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', elevation: 5 }}>
                <Ionicons name="play" size={22} color="#050515" style={{ marginRight: 8 }} />
                <Text style={{ color: '#050515', fontSize: 16, fontWeight: 'bold' }}>Play All</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 150 }} showsVerticalScrollIndicator={false}>
              {selectedAlbum.songs?.map((song: any, index: number) => (
                <TouchableOpacity key={index} style={[styles.searchResultRow, { backgroundColor: activeTrack?.id === song.id ? moodColor + '11' : theme.card }]} onPress={() => { setAutoplayQueue(selectedAlbum.songs.slice(index + 1)); handleTrackPress(song); }}>
                  <View style={{ width: 45, height: 45, borderRadius: 8, overflow: 'hidden', marginRight: 12, backgroundColor: theme.surface }}>
                    {song.image ? <Image source={{ uri: song.image[1]?.url || song.image[0]?.url || song.image }} style={{ width: 45, height: 45 }} /> : <Ionicons name="musical-notes" size={24} color={moodColor} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: activeTrack?.id === song.id ? moodColor : theme.text, fontSize: 15, fontWeight: '600' }}>{song.title || song.name}</Text>
                    <Text numberOfLines={1} style={{ color: theme.subtext, fontSize: 12, marginTop: 2 }}>{song.primaryArtists || song.artist || 'Unknown'}</Text>
                  </View>
                  {activeTrack?.id === song.id && <Ionicons name="stats-chart" size={16} color={moodColor} />}
                  <Ionicons name="ellipsis-vertical" size={18} color={theme.subtext} style={{ marginLeft: 10 }} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
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
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                {artistTracks.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
              </ScrollView>
            )}
          </View>
        )}

        {/* ── LIBRARY ─────────────────────────────────────────────────────── */}
        {currentScreen === 'library' && (
          <View style={styles.screenBody}>
            <Text style={styles.sectionHeader}>Your Playlists</Text>
            <ScrollView horizontal style={{ maxHeight: 120, marginBottom: 20 }} showsHorizontalScrollIndicator={false}>
              <TouchableOpacity style={styles.playlistCard} onPress={() => { setPlaylistSongTarget(null); setPlaylistModalVisible(true); }}>
                <Ionicons name="add" size={32} color="#00ffcc" /><Text style={styles.playlistName}>New</Text>
              </TouchableOpacity>
              {/* [NEW] Listen Later shortcut */}
              <TouchableOpacity style={[styles.playlistCard, { borderColor: moodColor + '88' }]} onPress={() => setCurrentScreen('listen_later')}>
                <Ionicons name="time" size={32} color={moodColor} />
                <Text style={[styles.playlistName, { color: moodColor }]}>Later</Text>
                <Text style={{ color: moodColor + '88', fontSize: 9 }}>{listenLater.length} songs</Text>
              </TouchableOpacity>
              {/* deduplicate by id before rendering */}
              {playlists
                .filter((pl, idx, arr) => arr.findIndex(p => p.id === pl.id) === idx)
                .map(pl => (
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
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              {favorites.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
            </ScrollView>
          </View>
        )}

        {/* ── LISTEN LATER ────────────────────────────────────────────────── */}
        {currentScreen === 'listen_later' && (
          <View style={styles.screenBody}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <TouchableOpacity onPress={() => setCurrentScreen('library')} style={{ paddingRight: 14 }}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={[styles.mainText, { marginBottom: 0 }]}>⏰ Listen Later ({listenLater.length})</Text>
            </View>
            {listenLater.length === 0 ? (
              <View style={styles.centeredBody}>
                <Ionicons name="time-outline" size={64} color="#3a3a50" style={{ marginBottom: 15 }} />
                <Text style={styles.mainText}>Nothing saved yet</Text>
                <Text style={styles.subText}>Long-press any song and tap "Listen Later" to save it here.</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                {listenLater.map(song => renderTrackCard(song, activeTrack?.id === song.id, isTrackFavorite(song.id)))}
              </ScrollView>
            )}
          </View>
        )}

        {/* ── PLAYLIST VIEW ────────────────────────────────────────────────── */}
        {currentScreen === 'playlist_view' && activePlaylistId && (() => {
          const pl = playlists.find(p => p.id === activePlaylistId);
          if (!pl) return null;
          return (
            <View style={styles.screenBody}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <TouchableOpacity onPress={() => setCurrentScreen('library')} style={{ paddingRight: 15 }}>
                  <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.mainText, { marginBottom: 0 }]}>{pl.name}</Text>
                  <Text style={{ color: '#888', fontSize: 11 }}>{pl.songs.length} songs • Hold a song to remove</Text>
                </View>
                {pl.songs.length > 0 && (
                  <TouchableOpacity
                    style={{ backgroundColor: moodColor, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    onPress={() => { setAutoplayQueue(pl.songs.slice(1)); setSongsList(pl.songs); handleTrackPress(pl.songs[0]); }}>
                    <Ionicons name="play" size={14} color="#000" />
                    <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>Play All</Text>
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                {pl.songs.map((song, idx) => (
                  <TouchableOpacity
                    key={song.id + idx}
                    style={[styles.trackCard, activeTrack?.id === song.id && { borderLeftWidth: 3, borderLeftColor: moodColor }]}
                    onPress={() => { setAutoplayQueue(pl.songs.slice(idx + 1)); setSongsList(pl.songs); handleTrackPress(song); }}
                    onLongPress={() => {
                      showAlert('Remove Song', `Remove "${song.title}" from this playlist?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: async () => {
                          try {
                            const json = await apiCall(`/api/user/playlists/${pl.id}/songs/${song.id}`, 'DELETE');
                            if (json.success) setPlaylists(json.data.playlists);
                            else setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, songs: p.songs.filter(s => s.id !== song.id) } : p));
                          } catch {
                            setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, songs: p.songs.filter(s => s.id !== song.id) } : p));
                          }
                        }},
                      ]);
                    }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <Text style={{ color: '#555', width: 22, fontSize: 12, fontWeight: '700' }}>{idx + 1}</Text>
                      <Image source={{ uri: song.image }} style={{ width: 44, height: 44, borderRadius: 6, marginRight: 12 }} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: activeTrack?.id === song.id ? moodColor : '#fff', fontWeight: '700', fontSize: 14 }}>{song.title}</Text>
                        <Text numberOfLines={1} style={{ color: '#888', fontSize: 12 }}>{song.artist}</Text>
                      </View>
                      <Ionicons name={activeTrack?.id === song.id && isPlaying ? 'pause' : 'play'} size={18} color={activeTrack?.id === song.id ? moodColor : '#555'} />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          );
        })()}

        {/* ── DOWNLOADS ───────────────────────────────────────────────────── */}
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
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                {downloads.map(song => {
                  const isCurrent = activeTrack?.id === song.id;
                  const isFav = isTrackFavorite(song.id);
                  return (
                    <TouchableOpacity key={song.id}
                      style={[styles.trackCard, { backgroundColor: theme.card, borderColor: isCurrent ? moodColor + '44' : 'transparent' }]}
                      onPress={() => { setAutoplayQueue([]); handleTrackPress(song); }}
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

        {/* ── SETTINGS ────────────────────────────────────────────────────── */}
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

              {/* ─── THEME SECTION — Premium preview cards ─── */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={[styles.settingTitle, { color: theme.text, marginBottom: 14 }]}>🎨 Appearance</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ width: '100%' }}
                  contentContainerStyle={{ gap: 10, paddingBottom: 6 }}>
                  {([
                    { mode: 'dark'     as const, label: 'Dark',     icon: '🌙', bg: '#0d0d14', card: '#16161f', accent: '#9896a8' },
                    { mode: 'amoled'   as const, label: 'AMOLED',   icon: '⬛', bg: '#000000', card: '#0a0a0a', accent: '#444444' },
                    { mode: 'light'    as const, label: 'Light',     icon: '☀️', bg: '#f2f2fa', card: '#ffffff', accent: '#9896a8' },
                    { mode: 'midnight' as const, label: 'Midnight',  icon: '🔵', bg: '#020a18', card: '#071428', accent: '#1565c0' },
                    { mode: 'forest'   as const, label: 'Forest',    icon: '🌿', bg: '#021208', card: '#0a2010', accent: '#1b5e20' },
                    { mode: 'sunset'   as const, label: 'Sunset',    icon: '🌅', bg: '#1a0808', card: '#280f0f', accent: '#b71c1c' },
                    { mode: 'purple'   as const, label: 'Purple',    icon: '💜', bg: '#0d0118', card: '#180a28', accent: '#6a1b9a' },
                    { mode: 'ocean'    as const, label: 'Ocean',     icon: '🌊', bg: '#010e18', card: '#051828', accent: '#01579b' },
                    { mode: 'rose'     as const, label: 'Rose',      icon: '🌹', bg: '#180810', card: '#280a1a', accent: '#880e4f' },
                    { mode: 'golden'   as const, label: 'Golden',    icon: '✨', bg: '#100c00', card: '#1a1400', accent: '#f57f17' },
                  ]).map(t => {
                    const isActive = themeMode === t.mode;
                    return (
                      <TouchableOpacity
                        key={t.mode}
                        onPress={() => switchTheme(t.mode)}
                        style={{
                          width: 80,
                          borderRadius: 14,
                          overflow: 'hidden',
                          borderWidth: isActive ? 2.5 : 1,
                          borderColor: isActive ? moodColor : 'rgba(255,255,255,0.1)',
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={{ backgroundColor: t.bg, padding: 8, paddingBottom: 4 }}>
                          <View style={{ height: 5, width: '60%', borderRadius: 3, backgroundColor: isActive ? moodColor : t.accent, marginBottom: 4 }} />
                          <View style={{ backgroundColor: t.card, borderRadius: 5, padding: 5, marginBottom: 3, gap: 2 }}>
                            <View style={{ height: 3, width: '80%', borderRadius: 2, backgroundColor: isActive ? moodColor + '88' : t.accent + '88' }} />
                            <View style={{ height: 2, width: '55%', borderRadius: 2, backgroundColor: t.accent + '55' }} />
                          </View>
                          <View style={{ backgroundColor: t.card, borderRadius: 5, padding: 5, gap: 2 }}>
                            <View style={{ height: 3, width: '65%', borderRadius: 2, backgroundColor: t.accent + '77' }} />
                            <View style={{ height: 2, width: '40%', borderRadius: 2, backgroundColor: t.accent + '44' }} />
                          </View>
                        </View>
                        <View style={{ backgroundColor: isActive ? moodColor : t.card, paddingVertical: 6, alignItems: 'center' }}>
                          <Text style={{ fontSize: 12 }}>{t.icon}</Text>
                          <Text style={{ color: isActive ? '#050515' : '#aaa', fontSize: 9, fontWeight: '700', marginTop: 1 }}>{t.label}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Stats */}
              <TouchableOpacity style={[styles.settingRow, { marginBottom: 15, flexDirection: 'column', alignItems: 'stretch', backgroundColor: theme.card }]} onPress={loadListeningStats}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>📊 Listening Stats</Text>
                  <Ionicons name="chevron-forward" size={20} color={theme.subtext} />
                </View>
                <View style={{ flexDirection: 'row', gap: 15, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{favorites.length}</Text><Text style={styles.statLabel}>Favorites</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{playlists.length}</Text><Text style={styles.statLabel}>Playlists</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{downloads.length}</Text><Text style={styles.statLabel}>Downloads</Text></View>
                  <View style={[styles.statBadge, { backgroundColor: moodColor + '22' }]}><Text style={[styles.statNumber, { color: moodColor }]}>Recap</Text><Text style={styles.statLabel}>View Vibe</Text></View>
                </View>
              </TouchableOpacity>

              {/* Smart Autoplay */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card }]}>
                <View style={styles.textGroup}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>🤖 Smart Auto-Play</Text>
                  <Text style={[styles.settingDesc, { color: theme.subtext }]}>Plays songs based on your mood automatically</Text>
                </View>
                <Switch value={smartAutoplay} onValueChange={(v) => { setSmartAutoplay(v); updateSetting('smart_autoplay', v); }} trackColor={{ false: '#252545', true: moodColor }} thumbColor="#ffffff" />
              </View>

              {/* Shake */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card, flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={styles.textGroup}>
                    <Text style={[styles.settingTitle, { color: theme.text, fontSize: 18 }]}>📳 Shake Controls</Text>
                    <Text style={[styles.settingDesc, { color: theme.subtext, fontSize: 13 }]}>Enable motion-based track skipping</Text>
                  </View>
                  <Switch value={shakeEnabled} onValueChange={(v) => { setShakeEnabled(v); updateSetting('shake_enabled', v); }} trackColor={{ false: '#252545', true: moodColor }} thumbColor="#ffffff" />
                </View>
                {shakeEnabled && (
                  <View style={{ marginTop: 12, backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>How to use:</Text>
                    <Text style={{ color: theme.subtext, fontSize: 12, lineHeight: 18 }}>• <Text style={{ color: moodColor, fontWeight: 'bold' }}>Short Shake</Text> (2 pulses): Go to Previous Track</Text>
                    <Text style={{ color: theme.subtext, fontSize: 12, lineHeight: 18 }}>• <Text style={{ color: moodColor, fontWeight: 'bold' }}>Long Shake</Text> (4+ pulses): Auto-play similar track</Text>
                    <Text style={{ color: '#888', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>Note: Shake firmly and hold the phone still for half a second to trigger.</Text>
                  </View>
                )}
              </View>


              {/* [NEW] Audio Quality */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
                <Text style={[styles.settingTitle, { color: theme.text, marginBottom: 12 }]}>🎵 Audio Quality</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(['320kbps','160kbps','96kbps'] as const).map(q => (
                    <TouchableOpacity key={q}
                      style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: audioQuality === q ? moodColor : '#1a1a3e', borderWidth: 1, borderColor: audioQuality === q ? moodColor : '#333' }}
                      onPress={() => { setAudioQuality(q); AsyncStorage.setItem('audioQuality', q); urlCacheRef.current.clear(); }}>
                      <Text style={{ color: audioQuality === q ? '#050515' : '#888', fontWeight: '700', fontSize: 12 }}>{q}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: theme.subtext, fontSize: 11, marginTop: 8 }}>Applies to next songs played. Cache cleared on change.</Text>
              </View>

              {/* [NEW] Skip Intro / Outro */}
              <View style={[styles.settingRow, { marginBottom: 15, backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="play-skip-forward" size={20} color={moodColor} style={{ marginRight: 10 }} />
                    <Text style={[styles.settingTitle, { color: theme.text, fontWeight: '800', fontSize: 16 }]}>Skip Intro</Text>
                  </View>
                  <Switch value={skipIntroEnabled} onValueChange={(v) => { setSkipIntroEnabled(v); AsyncStorage.setItem('skipIntroEnabled', String(v)); }} trackColor={{ false: '#252545', true: moodColor }} thumbColor="#ffffff" />
                </View>
                {skipIntroEnabled && (
                  <>
                    <Text style={{ color: theme.subtext, fontSize: 12, marginBottom: 10 }}>Skip first {introSeconds} seconds of every song</Text>
                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                      {[5, 10, 15, 20, 30].map(s => (
                        <TouchableOpacity key={s}
                          style={{ paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: introSeconds === s ? moodColor : '#1a1a3e', borderWidth: 1, borderColor: introSeconds === s ? moodColor : '#333' }}
                          onPress={() => { setIntroSeconds(s); AsyncStorage.setItem('introSeconds', String(s)); }}>
                          <Text style={{ color: introSeconds === s ? '#050515' : '#888', fontWeight: '600', fontSize: 13 }}>{s}s</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
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

              {/* Equalizer removed as not supported by TrackPlayer natively */}

              {/* Stats */}
              <View style={[styles.settingRow, { marginBottom: 15, flexDirection: 'column', alignItems: 'flex-start', backgroundColor: theme.card }]}>
                <Text style={[styles.settingTitle, { marginBottom: 15, color: theme.text }]}>📊 Your Stats</Text>
                <View style={{ flexDirection: 'row', gap: 20, flexWrap: 'wrap' }}>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{favorites.length}</Text><Text style={styles.statLabel}>Favorites</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{playlists.length}</Text><Text style={styles.statLabel}>Playlists</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{downloads.length}</Text><Text style={styles.statLabel}>Downloads</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{recentlyPlayed.length}</Text><Text style={styles.statLabel}>Listened</Text></View>
                  <View style={styles.statBadge}><Text style={styles.statNumber}>{listenLater.length}</Text><Text style={styles.statLabel}>Later</Text></View>
                </View>
              </View>



            </ScrollView>
          </View>
        )}
      </View>

      {/* ════════════════ MINI PLAYER ════════════════ */}
      {activeTrack && (
        <View
          style={{ position: 'absolute', bottom: Platform.OS === 'ios' ? 120 : 105, left: 16, right: 16, zIndex: 999 }}
          {...miniPlayerPan.panHandlers}
        >
          {/* Circular ring using react-native-svg for smooth rendering */}
          {(() => {
            const SZ = 62; const SW = 3; const radius = (SZ - SW) / 2;
            const circumference = 2 * Math.PI * radius;
            const prog = Math.min(Math.max(getProgressPercent() / 100, 0), 1);
            const strokeDashoffset = circumference - (prog * circumference);
            return (
              <View style={{ position: 'absolute', left: 14, top: '50%', marginTop: -(SZ/2), width: SZ, height: SZ, zIndex: 10, pointerEvents: 'none' }}>
                <Svg width={SZ} height={SZ}>
                  <Circle cx={SZ/2} cy={SZ/2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={SW} fill="none" />
                  <Circle cx={SZ/2} cy={SZ/2} r={radius} stroke={moodColor} strokeWidth={SW} fill="none"
                    strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round"
                    rotation="-90" origin={`${SZ/2}, ${SZ/2}`}
                  />
                </Svg>
              </View>
            );
          })()}

          {/* Card - overflow hidden for frosted background */}
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => setIsFullScreen(true)}
            style={{
              borderRadius: 9999,
              overflow: 'hidden',
              elevation: 22,
              shadowColor: '#000',
              shadowOpacity: 0.6,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
            }}>

          {/* Frosted glass background */}
          {activeTrack.image && (
            <Image
              source={{ uri: activeTrack.image }}
              style={{ position: 'absolute', width: '100%', height: '100%' }}
              blurRadius={24}
            />
          )}
          {/* Dark glass tint */}
          <View style={{ position: 'absolute', width: '100%', height: '100%', backgroundColor: 'rgba(6,6,18,0.82)' }} />
          {/* Top-edge shimmer */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
          {/* Pill border ring */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 9999, borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.10)' }} />

          {/* Content row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 }}>

            {/* Circular thumbnail — ring drawn above as absolute overlay */}
            {(() => {
              const SZ = 62; const SW = 3;
              return (
                <View style={{ width: SZ, height: SZ, position: 'relative', marginRight: 14, flexShrink: 0 }}>
                  {/* Circular image */}
                  <View style={{ position: 'absolute', top: SW, left: SW, width: SZ - SW*2, height: SZ - SW*2, borderRadius: (SZ - SW*2)/2, overflow: 'hidden', backgroundColor: moodColor + '33' }}>
                    {activeTrack.image
                      ? <Image source={{ uri: activeTrack.image }} style={{ width: SZ - SW*2, height: SZ - SW*2 }} />
                      : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="musical-note" size={22} color={moodColor} /></View>}
                    {/* Top gloss */}
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '38%', backgroundColor: 'rgba(255,255,255,0.10)' }} />
                  </View>
                </View>
              );
            })()}

            {/* Song info */}
            <View style={{ flex: 1, overflow: 'hidden', marginRight: 10 }}>
              <Text numberOfLines={1} ellipsizeMode="tail"
                style={{ color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 0.1, marginBottom: 4 }}>
                {activeTrack.title}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="tail"
                style={{ color: moodColor, fontSize: 12, fontWeight: '500' }}>
                {activeTrack.artist}
              </Text>
              {/* Time stamps only — ring shows progress */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }}>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '600' }}>
                  {formatTime(position)}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10 }}>·</Text>
                <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '600' }}>
                  {duration > 0 ? `-${formatTime(duration - position)}` : '--:--'}
                </Text>
              </View>
            </View>

            {/* Playback controls */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0,  }}>
              <TouchableOpacity onPress={playPrevious} hitSlop={{ top:14, bottom:14, left:8, right:8 }}>
                <Ionicons name="play-skip-back" size={20} color="rgba(255,255,255,0.80)" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={togglePlayPause}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: moodColor,
                  justifyContent: 'center', alignItems: 'center',
                  elevation: 8,
                  shadowColor: moodColor, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
                }}>
                {(isLoading || isBuffering)
                  ? <ActivityIndicator size="small" color="#050515" />
                  : <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#050515" />}
              </TouchableOpacity>

              <TouchableOpacity onPress={playNext} hitSlop={{ top:14, bottom:14, left:8, right:8 }}>
                <Ionicons name="play-skip-forward" size={20} color="rgba(255,255,255,0.80)" />
              </TouchableOpacity>
            </View>

          </View>
          </TouchableOpacity>
        </View>
      )}

      {/* BOTTOM NAV */}
      {(() => {
        const tabs = [
          { screen: 'all_songs', icon: 'home-outline',     iconFilled: 'home',     label: 'Home'      },
          { screen: 'library',   icon: 'library-outline',  iconFilled: 'library',  label: 'Library'   },
          { screen: 'downloads', icon: 'folder-outline',   iconFilled: 'folder',   label: 'Downloads' },
          { screen: 'settings',  icon: 'settings-outline', iconFilled: 'settings', label: 'Settings'  },
        ];
        const activeIdx = tabs.findIndex(t =>
          currentScreen === t.screen
          || (t.screen === 'library'   && (currentScreen === 'playlist_view' || currentScreen === 'listen_later'))
          || (t.screen === 'all_songs' && currentScreen === 'artist_profile')
        );
        return (
          <View
            style={[styles.bottomNav, { backgroundColor: isDark ? '#0d0d14' : '#f5f5f7' }]}
            onLayout={e => {
              const w = e.nativeEvent.layout.width;
              navBarWidthRef.current = w;
              // Initial placement — jump to correct position without animation
              navPillAnim.setValue(activeIdx * (w / 4));
            }}
          >
            {/* Sliding pill — uses pixel-based translateX (safe in RN) */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0, bottom: 0, left: 0,
                width: '25%',
                alignItems: 'center',
                transform: [{ translateX: navPillAnim }],
              }}
            >
              <View style={{ width: 64, height: 32, borderRadius: 16, backgroundColor: moodColor + '22', marginTop: 4 }} />
            </Animated.View>
            {tabs.map((tab, idx) => {
              const active = idx === activeIdx;
              return (
                <TouchableOpacity key={tab.screen} style={styles.navButton} onPress={() => {
                  if (tab.screen === 'all_songs') { setSearchQuery(''); setIsSearchFocused(false); setIsArtistMode(false); }
                  setCurrentScreen(tab.screen as any);
                }}>
                  <Ionicons name={(active ? tab.iconFilled : tab.icon) as any} size={22} color={active ? moodColor : theme.subtext} />
                  <Text style={[styles.navText, { color: active ? moodColor : theme.subtext, fontWeight: active ? '700' : '500' }]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })()}

      {/* ── MOVIE DETAIL SCREEN ──────────────────────────────────────────────── */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={!!selectedMovie}
        onRequestClose={() => { setSelectedMovie(null); setMovieSongs([]); }}>
        <View style={{ flex: 1, backgroundColor: '#08080f' }}>
          {/* Blurred poster background */}
          {selectedMovie?.image && (
            <Image
              source={{ uri: selectedMovie.image }}
              style={{ position: 'absolute', width: '100%', height: 320, opacity: 0.55 }}
              blurRadius={20}
            />
          )}
          {/* Dark gradient over poster */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320, backgroundColor: 'rgba(8,8,15,0.45)' }} />
          <View style={{ position: 'absolute', top: 220, left: 0, right: 0, height: 100, backgroundColor: 'rgba(8,8,15,0.95)' }} />

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12, zIndex: 10 }}>
            <TouchableOpacity
              onPress={() => { setSelectedMovie(null); setMovieSongs([]); }}
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', flex: 1 }} numberOfLines={1}>
              {selectedMovie?.name}
            </Text>
          </View>

          {/* Movie poster card */}
          <View style={{ alignItems: 'center', marginBottom: 16, zIndex: 10 }}>
            {selectedMovie?.image ? (
              <View style={{ width: 140, height: 140, borderRadius: 16, overflow: 'hidden', elevation: 18, shadowColor: moodColor, shadowOpacity: 0.5, shadowRadius: 20 }}>
                <Image source={{ uri: selectedMovie.image }} style={{ width: 140, height: 140 }} />
              </View>
            ) : (
              <View style={{ width: 140, height: 140, borderRadius: 16, backgroundColor: moodColor + '22', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="film" size={60} color={moodColor} />
              </View>
            )}
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 14, textAlign: 'center', paddingHorizontal: 24 }} numberOfLines={2}>{selectedMovie?.name}</Text>
            <Text style={{ color: moodColor, fontSize: 13, marginTop: 4 }}>
              {selectedMovie?.year ? `${selectedMovie.year}  ·  ` : ''}
              {movieSongs.length > 0 ? `${movieSongs.length} Songs` : 'Soundtrack'}
            </Text>

            {/* Play All button */}
            {movieSongs.length > 0 && (
              <TouchableOpacity
                onPress={() => { setAutoplayQueue(movieSongs.slice(1)); handleTrackPress(movieSongs[0]); setSelectedMovie(null); setMovieSongs([]); }}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: moodColor, paddingHorizontal: 28, paddingVertical: 11, borderRadius: 30, marginTop: 16, gap: 8 }}>
                <Ionicons name="play" size={18} color="#050515" />
                <Text style={{ color: '#050515', fontWeight: '900', fontSize: 14 }}>Play All</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Song list */}
          <ScrollView
            style={{ flex: 1, backgroundColor: '#08080f' }}
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {isMovieSongsLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={moodColor} />
                <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 12, fontSize: 14 }}>Loading songs…</Text>
              </View>
            ) : movieSongs.length === 0 ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <Ionicons name="musical-notes-outline" size={48} color="rgba(255,255,255,0.2)" />
                <Text style={{ color: 'rgba(255,255,255,0.4)', marginTop: 12, fontSize: 14 }}>No songs found</Text>
              </View>
            ) : movieSongs.map((song: any, idx: number) => (
              <TouchableOpacity
                key={song.id}
                onPress={() => { setAutoplayQueue(movieSongs.slice(idx + 1)); handleTrackPress(song); setSelectedMovie(null); setMovieSongs([]); }}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingHorizontal: 16, paddingVertical: 10,
                  borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
                  backgroundColor: activeTrack?.id === song.id ? moodColor + '18' : 'transparent',
                }}>
                {/* Track number */}
                <View style={{ width: 32, alignItems: 'center' }}>
                  {activeTrack?.id === song.id
                    ? <Ionicons name="musical-note" size={16} color={moodColor} />
                    : <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, fontWeight: '600' }}>{idx + 1}</Text>}
                </View>
                {/* Thumbnail */}
                <View style={{ width: 46, height: 46, borderRadius: 8, overflow: 'hidden', backgroundColor: moodColor + '22', marginRight: 12 }}>
                  {song.image
                    ? <Image source={{ uri: song.image }} style={{ width: 46, height: 46 }} />
                    : <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="musical-note" size={20} color={moodColor} /></View>}
                </View>
                {/* Info */}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: activeTrack?.id === song.id ? moodColor : '#fff', fontSize: 14, fontWeight: '700' }}>{song.title}</Text>
                  <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{song.artist}</Text>
                </View>
                {/* Duration */}
                <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginLeft: 8 }}>
                  {song.duration ? `${Math.floor(song.duration / 60)}:${String(song.duration % 60).padStart(2, '0')}` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

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

      {/* ── FULL SCREEN PLAYER ─────────────────────────────────────────────── */}
      <Modal animationType="slide" transparent={false} visible={isFullScreen} onRequestClose={() => setIsFullScreen(false)}>
        <View style={[styles.fullScreenContainer, { backgroundColor: '#000000', overflow: 'hidden' }]}>
          {/* ── Dominant colour bleeds from top, fades to black at bottom using a massive Blur effect ── */}
          {activeTrack?.image && (
            <Image
              source={{ uri: activeTrack.image }}
              style={{ position: 'absolute', width: '200%', height: '80%', top: '-10%', left: '-50%', opacity: 0.55 }}
              blurRadius={90}
            />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.25)', '#000000', '#000000']}
            locations={[0, 0.45, 1]}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />
          {/* Header */}
          <View style={styles.fullScreenHeader}>
            <TouchableOpacity onPress={() => setIsFullScreen(false)} style={{ padding: 10 }} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
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
            <TouchableOpacity onPress={() => setMenuVisible(true)} style={{ padding: 10 }} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
              <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Album Art OR Lyrics Overlay */}
          <View style={styles.animationContainer}>
            {playerTab === 'lyrics' ? (
              /* Lyrics overlay replaces album art */
              <View style={[styles.albumArtLarge, { width: '92%', borderRadius: 20, position: 'relative' }]}>
                {/* Blurred album art as background */}
                {activeTrack?.image && <Image source={{ uri: activeTrack.image }} style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: 20 }} blurRadius={18} />}
                <View style={{ position: 'absolute', width: '100%', height: '100%', backgroundColor: 'rgba(5,5,20,0.72)', borderRadius: 20 }} />
                {lyricsLoading ? (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator color={moodColor} size="large" />
                    <Text style={{ color: '#aaa', marginTop: 10, fontSize: 13 }}>Loading lyrics...</Text>
                  </View>
                ) : (
                  <ScrollView ref={lyricsScrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 20, paddingHorizontal: 16 }}>
                    {parsedLyrics.length > 0 ? parsedLyrics.map((line, i) => (
                      <TouchableOpacity key={i} onPress={() => TrackPlayer.seekTo(line.time)}>
                        <Text style={{
                          color: i === currentLyricIndex ? '#ffffff' : i < currentLyricIndex ? moodColor + '88' : '#aaaacc',
                          fontSize: i === currentLyricIndex ? 17 : 14,
                          fontWeight: i === currentLyricIndex ? '800' : '500',
                          fontStyle: 'italic',
                          textAlign: 'center',
                          lineHeight: 30,
                          marginVertical: 2,
                        }}>{line.text}</Text>
                      </TouchableOpacity>
                    )) : (
                      <Text style={{ color: '#aaa', textAlign: 'center', fontSize: 14, lineHeight: 26, fontStyle: 'italic', paddingTop: 40 }}>{lyrics || 'Tap LYRICS to load'}</Text>
                    )}
                  </ScrollView>
                )}
              </View>
            ) : (
              <>
                {/* Breathing glow shadow */}
                <Animated.View style={[styles.breathingShadow, {
                  backgroundColor: moodColor + '50',
                  transform: [{ scale: ring1.interpolate({ inputRange: [0,0.5,1], outputRange: [1,1.18,1] }) }],
                  opacity: ring1.interpolate({ inputRange: [0,0.5,1], outputRange: [0.3,0.55,0.3] }),
                }]} />
                {[ring1, ring2, ring3].map((anim, i) => (
                  <Animated.View key={i} style={[styles.rippleRing, {
                    borderColor: moodColor + '55',
                    transform: [{ scale: anim.interpolate({ inputRange: [0,1], outputRange: [1,1.6] }) }],
                    opacity: anim.interpolate({ inputRange: [0,1], outputRange: [0.45,0] }),
                  }]} />
                ))}
                <Animated.View style={[styles.vinylOuter, {
                  borderColor: moodColor + '44',
                  transform: [{ rotate: vinylRotation.interpolate({ inputRange: [0,1], outputRange: ['0deg','360deg'] }) }],
                }]} />
                <View style={styles.albumArtLarge} {...albumPanResponder.panHandlers}>
                  {activeTrack?.image ? <Image source={{ uri: activeTrack.image }} style={styles.albumImage} /> : <Ionicons name="disc-outline" size={110} color={moodColor} />}
                  {seekIndicator.length > 0 && (
                    <View style={{ position: 'absolute', backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 22, paddingVertical: 10, borderRadius: 22, borderWidth: 1.5, borderColor: moodColor + '99' }}>
                      <Text style={{ color: moodColor, fontSize: 24, fontWeight: 'bold' }}>{seekIndicator}</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>

          {/* Song info + favourite only */}
          <View style={styles.fullScreenInfo}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={styles.fullScreenTitle}>{activeTrack?.title}</Text>
              <Text numberOfLines={1} style={[styles.fullScreenArtist, { color: moodColor }]}>{activeTrack?.artist}</Text>
              {autoplayReason.length > 0 && <Text style={[styles.autoplayReasonText, { color: moodColor + 'cc' }]}>{autoplayReason}</Text>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* Download */}
              <TouchableOpacity
                onPress={() => activeTrack && downloadSong(activeTrack)}
                style={{ width: 48, height: 42, backgroundColor: '#ffffff', borderTopLeftRadius: 21, borderBottomLeftRadius: 21, borderTopRightRadius: 4, borderBottomRightRadius: 4, justifyContent: 'center', alignItems: 'center', marginRight: 1.5 }}>
                <Ionicons name="arrow-down-outline" size={20} color="#000" />
              </TouchableOpacity>
              {/* Favourite heart */}
              <TouchableOpacity
                onPress={() => activeTrack && toggleFavorite(activeTrack)}
                style={{ width: 48, height: 42, backgroundColor: '#ffffff', borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: 21, borderBottomRightRadius: 21, justifyContent: 'center', alignItems: 'center', marginLeft: 1.5 }}>
                <Ionicons
                  name={activeTrack && isTrackFavorite(activeTrack.id) ? 'heart' : 'heart-outline'}
                  size={20}
                  color={activeTrack && isTrackFavorite(activeTrack.id) ? '#ff3366' : '#000'}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.sliderSection}>
            <View style={{ position: 'relative' }}>
              <TouchableOpacity activeOpacity={1} style={styles.progressBarBg}
                onPress={handleProgressBarTap}
                onLayout={e => progressBarWidthRef.current = e.nativeEvent.layout.width}>
                <View style={[styles.progressBarFill, { width: `${getProgressPercent()}%`, backgroundColor: moodColor }]} />
                <View style={[styles.progressBarFill, { position: 'absolute', width: `${getProgressPercent()}%`, backgroundColor: moodColor, opacity: 0.35, height: 10, top: -2, borderRadius: 5 }]} />
                <View style={[styles.progressDot, { left: `${getProgressPercent()}%`, shadowColor: moodColor, backgroundColor: '#fff' }]} />
              </TouchableOpacity>
            </View>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(position)}</Text>
              <Text style={styles.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>

          {/* Controls: Shuffle | Prev | Play | Next | Repeat */}
          <View style={styles.controlsContainer}>
            <TouchableOpacity onPress={toggleShuffle}>
              <Ionicons name="shuffle" size={26} color={isShuffled ? moodColor : '#444466'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={playPrevious}>
              <Ionicons name="play-skip-back" size={40} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={[styles.largePlayBtn, { backgroundColor: moodColor, shadowColor: moodColor, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 12 }]}>
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

          {/* Speed Picker */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: showSpeedPicker ? moodColor + '22' : 'transparent', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: showSpeedPicker ? moodColor : '#333' }}
              onPress={() => setShowSpeedPicker(v => !v)}>
              <Ionicons name="speedometer-outline" size={14} color={moodColor} style={{ marginRight: 5 }} />
              <Text style={{ color: moodColor, fontSize: 13, fontWeight: '700' }}>{playbackSpeed}x</Text>
            </TouchableOpacity>
          </View>
          {showSpeedPicker && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', paddingHorizontal: 20 }}>
              {SPEED_OPTIONS.map(s => (
                <TouchableOpacity key={s}
                  style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: playbackSpeed === s ? moodColor : '#1a1a3e', borderWidth: 1, borderColor: playbackSpeed === s ? moodColor : '#333' }}
                  onPress={() => changePlaybackSpeed(s)}>
                  <Text style={{ color: playbackSpeed === s ? '#050515' : '#888', fontWeight: '700', fontSize: 13 }}>{s}x</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* 3-Tab: Queue | Lyrics | Related */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 10, paddingHorizontal: 20 }}>
            {(['queue','lyrics','related'] as const).map(tab => (
              <TouchableOpacity key={tab}
                onPress={() => {
                  setPlayerTab(tab);
                  if (tab === 'lyrics' && !lyrics && !lyricsLoading) fetchLyrics(activeTrack);
                  if (tab === 'related' && relatedSongs.length === 0 && !relatedLoading) fetchRelatedSongs(activeTrack);
                }}
                style={{ flex: 1, paddingVertical: 7, borderRadius: 20, backgroundColor: playerTab === tab ? moodColor + '22' : 'transparent', borderWidth: 1, borderColor: playerTab === tab ? moodColor : '#333', alignItems: 'center' }}>
                <Text style={{ color: playerTab === tab ? moodColor : '#555', fontSize: 11, fontWeight: '700' }}>
                  {tab === 'queue' ? '♪ QUEUE' : tab === 'lyrics' ? '📝 LYRICS' : '🎯 RELATED'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Queue Tab */}
          {playerTab === 'queue' && (
            smartAutoplay && autoplayQueue.length > 0 ? (
              <View style={styles.queueContainer}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <Ionicons name="sparkles" size={14} color={moodColor} style={{ marginRight: 6 }} />
                  <Text style={[styles.queueHeader, { color: moodColor }]}>Up Next — Smart Queue</Text>
                </View>
                <ScrollView showsVerticalScrollIndicator={false}>
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
                </ScrollView>
              </View>
            ) : (
              <View style={[styles.queueContainer, { justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="list-outline" size={40} color="#333" />
                <Text style={{ color: '#555', fontSize: 13, marginTop: 8 }}>Smart queue will appear here</Text>
              </View>
            )
          )}

          {/* Lyrics Tab */}
          {playerTab === 'lyrics' && (
            <View style={styles.queueContainer}>
              {lyricsLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color={moodColor} />
                  <Text style={{ color: '#666', marginTop: 8, fontSize: 13 }}>Fetching lyrics...</Text>
                </View>
              ) : lyrics ? (
                <View style={{ flex: 1 }}>
                  {parsedLyrics.length > 0 ? (
                    <FlatList
                      ref={lyricsListRef}
                      data={parsedLyrics}
                      keyExtractor={(_: any, i: number) => i.toString()}
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={{ paddingVertical: '50%' }}
                      initialNumToRender={50}
                      onScrollToIndexFailed={(info: any) => {
                         const wait = new Promise(resolve => setTimeout(resolve, 500));
                         wait.then(() => lyricsListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }));
                      }}
                      renderItem={({ item: l, index: i }: { item: any, index: number }) => (
                        <TouchableOpacity onPress={() => TrackPlayer.seekTo(l.time)} style={{ paddingVertical: 10, paddingHorizontal: 20 }}>
                          <Text style={{ color: i === currentLyricIndex ? moodColor : 'rgba(255,255,255,0.4)', fontSize: i === currentLyricIndex ? 22 : 16, fontWeight: i === currentLyricIndex ? '800' : '600', textAlign: 'center', lineHeight: i === currentLyricIndex ? 30 : 24, opacity: i === currentLyricIndex ? 1 : 0.6 }}>{l.text}</Text>
                        </TouchableOpacity>
                      )}
                    />
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, paddingTop: 20, paddingHorizontal: 20 }}>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16, lineHeight: 28, textAlign: 'center', fontWeight: '500' }}>{lyrics}</Text>
                    </ScrollView>
                  )}
                </View>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="document-text-outline" size={40} color="#333" />
                  <Text style={{ color: '#555', fontSize: 13, marginTop: 8 }}>No lyrics found</Text>
                </View>
              )}
            </View>
          )}

          {/* Related Songs Tab */}
          {playerTab === 'related' && (
            <View style={styles.queueContainer}>
              {relatedLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color={moodColor} />
                  <Text style={{ color: '#666', marginTop: 8, fontSize: 13 }}>Finding related songs...</Text>
                </View>
              ) : relatedSongs.length === 0 ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="musical-notes-outline" size={40} color="#333" />
                  <Text style={{ color: '#555', fontSize: 13, marginTop: 8 }}>No related songs found</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={{ color: '#555', fontSize: 11, marginBottom: 10, textAlign: 'center' }}>Songs you might like</Text>
                  {relatedSongs.map((s, i) => (
                    <TouchableOpacity key={i} style={styles.queueItem} onPress={() => { setIsFullScreen(false); handleTrackPress(s); }}>
                      {s.image ? <Image source={{ uri: s.image }} style={{ width: 40, height: 40, borderRadius: 6, marginRight: 10 }} /> : <View style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: moodColor + '22', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}><Ionicons name="musical-note" size={18} color={moodColor} /></View>}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{s.title}</Text>
                        <Text numberOfLines={1} style={{ color: '#8e8e93', fontSize: 11 }}>{s.artist}</Text>
                      </View>
                      <TouchableOpacity onPress={() => addSingleToQueue(s)} style={{ padding: 8 }}>
                        <Ionicons name="add-circle-outline" size={22} color={moodColor} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

        </View>
      </Modal>

      {/* OPTIONS MENU (3-dot) */}
      <Modal animationType="slide" transparent visible={isMenuVisible} onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={{ backgroundColor: isAmoled ? '#000' : '#121225', paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <View style={{ width: 40, height: 5, backgroundColor: '#3a3a50', borderRadius: 3, alignSelf: 'center', marginTop: 15, marginBottom: 15 }} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) { setPlaylistSongTarget(activeTrack); setPlaylistModalVisible(true); } }}>
              <Ionicons name="add-circle-outline" size={24} color="#00ffcc" style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Playlist</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) toggleFavorite(activeTrack); }}>
              <Ionicons name={activeTrack && isTrackFavorite(activeTrack?.id) ? 'heart' : 'heart-outline'} size={24} color={activeTrack && isTrackFavorite(activeTrack?.id) ? '#ff6b9d' : '#fff'} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>{activeTrack && isTrackFavorite(activeTrack?.id) ? 'Remove from Favourites' : 'Add to Favourites'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); if (activeTrack) addToNext(activeTrack); }}>
              <Ionicons name="play-skip-forward-circle-outline" size={24} color={moodColor} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Next</Text>
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
          <View style={{ backgroundColor: isAmoled ? '#000' : '#121225', paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
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
            <TouchableOpacity style={styles.menuItem} onPress={() => { setContextMenuVisible(false); if (contextMenuSong) addToNext(contextMenuSong); }}>
              <Ionicons name="play-skip-forward-circle-outline" size={24} color={moodColor} style={{ marginRight: 15 }} />
              <Text style={{ color: '#fff', fontSize: 18 }}>Add to Next</Text>
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

      {/* MOOD & GENRES MODAL */}
      <Modal animationType="slide" transparent={false} visible={showMoodGenres} onRequestClose={() => setShowMoodGenres(false)}>
        <View style={{ flex: 1, backgroundColor: isAmoled ? '#000' : '#07071a' }}>
          <StatusBar barStyle="light-content" backgroundColor={isAmoled ? '#000' : '#07071a'} />
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 54, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#ffffff11' }}>
            <TouchableOpacity onPress={() => setShowMoodGenres(false)} style={{ marginRight: 16 }}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 }}>Mood and Genres</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

            {/* ── Moods & moments ── */}
            <Text style={{ color: moodColor, fontSize: 18, fontWeight: '800', fontStyle: 'italic', marginTop: 24, marginBottom: 14 }}>Moods &amp; moments</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[
                { label: 'Chill',     mood: 'chill',     emoji: '😌' },
                { label: 'Commute',   mood: 'commute',   emoji: '🚌' },
                { label: 'Energize',  mood: 'energetic', emoji: '⚡' },
                { label: 'Feel good', mood: 'happy',     emoji: '😊' },
                { label: 'Focus',     mood: 'focus',     emoji: '🎯' },
                { label: 'Gaming',    mood: 'gaming',    emoji: '🎮' },
                { label: 'Party',     mood: 'item',      emoji: '🎉' },
                { label: 'Romance',   mood: 'romantic',  emoji: '❤️' },
                { label: 'Sad',       mood: 'sad',       emoji: '😢' },
                { label: 'Sleep',     mood: 'sleep',     emoji: '😴' },
                { label: 'Workout',   mood: 'workout',   emoji: '💪' },
              ].map(m => (
                <TouchableOpacity key={m.mood}
                  style={{ width: '47%', backgroundColor: '#ffffff0d', borderWidth: 1, borderColor: '#ffffff18', borderRadius: 14, paddingVertical: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}
                  onPress={async () => {
                    setCurrentMood(m.mood);
                    setShowMoodGenres(false);
                    setIsSearching(true);
                    setSearchQuery(m.label + ' Playlist');
                    try {
                      // Try to fetch an actual playlist for this mood
                      const q = encodeURIComponent(m.label + ' hindi bollywood');
                      const r = await fetch(`${BACKEND_URL}/api/playlists/search?query=${q}&limit=1`);
                      const j = await r.json();
                      if (j.success && j.data?.results?.length > 0) {
                        const pId = j.data.results[0].id;
                        const r2 = await fetch(`${BACKEND_URL}/api/playlists/${pId}`);
                        const pdata = await r2.json();
                        const songsRaw = pdata.data?.songs || [];
                        if (songsRaw.length > 0) {
                          const mapped = songsRaw.map((s: any) => {
                            const dl = s.downloadUrl || []; const im = s.image || [];
                            return { id: s.id, title: (s.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                          }).filter((s: any) => s.url);
                          if (mapped.length > 0) {
                            setSongsList(mapped);
                            setIsSearching(false);
                            return;
                          }
                        }
                      }
                    } catch {}
                    // Fallback to simple search if playlist fails
                    try {
                      const r = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(m.label + ' hits')}`);
                      const j = await r.json();
                      if (j.success && j.data?.results) {
                        const mapped = j.data.results.map((s: any) => {
                          const dl = s.downloadUrl || []; const im = s.image || [];
                          return { id: s.id, title: s.name || '', artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                        }).filter((s: any) => s.url);
                        setSongsList(mapped);
                      }
                    } catch {}
                    finally { setIsSearching(false); }
                  }}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>{m.emoji}</Text>
                  <Text style={{ color: '#fff', fontSize: 15, fontStyle: 'italic', fontWeight: '600' }}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Genres ── */}
            <Text style={{ color: moodColor, fontSize: 18, fontWeight: '800', fontStyle: 'italic', marginTop: 32, marginBottom: 14 }}>Genres</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[
                'African','Arabic','Bengali','Bhojpuri','Carnatic classical','Classical',
                'Country & Americana','Dance & electronic','Decades','Desi hip-hop',
                'Devotional','Family','Folk & acoustic','Ghazal/Sufi','Gujarati',
                'Haryanvi','Hindi','Hindustani classical','Hip-hop','Indian indie',
                'Indian pop','Indie & alternative','J-Pop','Jazz','K-Pop','Kannada',
                'Latin','Malayalam','Marathi','Metal','Monsoon','Pop','Punjabi',
                'R&B & soul','Reggae & caribbean','Rock','Tamil','Telugu',
              ].map(genre => (
                <TouchableOpacity key={genre}
                  style={{ width: '47%', backgroundColor: '#ffffff0d', borderWidth: 1, borderColor: '#ffffff18', borderRadius: 14, paddingVertical: 18, paddingHorizontal: 16 }}
                  onPress={async () => {
                    setShowMoodGenres(false);
                    setIsSearching(true);
                    setSearchQuery(genre + ' Playlist');
                    try {
                      const q = encodeURIComponent(genre + ' songs hindi bollywood');
                      const r = await fetch(`${BACKEND_URL}/api/playlists/search?query=${q}&limit=1`);
                      const j = await r.json();
                      if (j.success && j.data?.results?.length > 0) {
                        const pId = j.data.results[0].id;
                        const r2 = await fetch(`${BACKEND_URL}/api/playlists/${pId}`);
                        const pdata = await r2.json();
                        const songsRaw = pdata.data?.songs || [];
                        if (songsRaw.length > 0) {
                          const mapped = songsRaw.map((s: any) => {
                            const dl = s.downloadUrl || []; const im = s.image || [];
                            return { id: s.id, title: (s.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                          }).filter((s: any) => s.url);
                          if (mapped.length > 0) {
                            setSongsList(mapped);
                            setIsSearching(false);
                            return;
                          }
                        }
                      }
                    } catch {}
                    try {
                      const r = await fetch(`${BACKEND_URL}/api/search?query=${encodeURIComponent(genre + ' songs')}`);
                      const j = await r.json();
                      if (j.success && j.data?.results) {
                        const mapped = j.data.results.map((s: any) => {
                          const dl = s.downloadUrl || []; const im = s.image || [];
                          return { id: s.id, title: s.name || '', artist: s.artists?.primary?.map((a:any) => a.name).join(', ') || '', image: im.find((i:any) => i.quality==='500x500')?.url || im[im.length-1]?.url || '', url: dl.find((u:any) => u.quality==='320kbps')?.url || dl[dl.length-1]?.url || '', duration: s.duration || 0 };
                        }).filter((s: any) => s.url);
                        setSongsList(mapped);
                      }
                    } catch {}
                    finally { setIsSearching(false); }
                  }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontStyle: 'italic', fontWeight: '600' }}>{genre}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal animationType="slide" transparent visible={showEqualizerModal} onRequestClose={() => setShowEqualizerModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', alignItems: 'center', padding: 28 }}>
          <View style={{ width: '100%', backgroundColor: isAmoled ? '#000' : '#09091a', borderRadius: 22, borderWidth: 1.5, borderColor: moodColor + '55', padding: 28 }}>
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
                <View style={{ height: 5, backgroundColor: '#1a1a3a', borderRadius: 3, marginBottom: 10, overflow: 'hidden' }}>
                  <View style={{ width: `${eq.value * 100}%`, height: '100%', backgroundColor: moodColor, borderRadius: 3 }} />
                </View>
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

      {/* Listening Stats Modal */}
      <Modal animationType="slide" transparent visible={showStatsModal} onRequestClose={() => setShowStatsModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(5,5,20,0.85)', justifyContent: 'center', alignItems: 'center', padding: 25 }}>
          <View style={{ width: '100%', backgroundColor: theme.card, borderRadius: 30, overflow: 'hidden', padding: 30, borderWidth: 1, borderColor: moodColor + '40' }}>
            <View style={{ alignItems: 'center', marginBottom: 25 }}>
              <Ionicons name="stats-chart" size={40} color={moodColor} style={{ marginBottom: 10 }} />
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: theme.text, letterSpacing: 1 }}>Your Music Vibe</Text>
              <Text style={{ fontSize: 14, color: theme.subtext, marginTop: 4 }}>Based on your recent listening</Text>
            </View>

            {statsData && (
              <View style={{ gap: 20 }}>
                <View style={{ backgroundColor: '#00000033', padding: 20, borderRadius: 20, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, color: theme.subtext, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 5 }}>Dominant Mood</Text>
                  <Text style={{ fontSize: 32, fontWeight: '900', color: moodColor }}>{statsData.topMood.toUpperCase()}</Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 15 }}>
                  <View style={{ flex: 1, backgroundColor: '#00000033', padding: 18, borderRadius: 20, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: theme.subtext, marginBottom: 5 }}>Top Artist</Text>
                    <Text style={{ fontSize: 16, fontWeight: 'bold', color: theme.text, textAlign: 'center' }} numberOfLines={1}>{statsData.topArtist}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#00000033', padding: 18, borderRadius: 20, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: theme.subtext, marginBottom: 5 }}>Tracks Played</Text>
                    <Text style={{ fontSize: 20, fontWeight: 'bold', color: theme.text }}>{statsData.total}</Text>
                  </View>
                </View>
              </View>
            )}

            <TouchableOpacity onPress={() => setShowStatsModal(false)}
              style={{ marginTop: 30, width: '100%', height: 50, borderRadius: 25, backgroundColor: moodColor, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#050515', fontWeight: 'bold', fontSize: 16 }}>Awesome</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>


    </Animated.View>
  );
}

// ─── Styles — M3-Inspired Visual Refresh ─────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0d0d14' },
  header:      { backgroundColor: '#0d0d14', paddingTop: Platform.OS === 'ios' ? 35 : 0, paddingBottom: 0, alignItems: 'center', justifyContent: 'center' },
  headerPill:  { paddingHorizontal: 26, paddingVertical: 9, borderRadius: 30, borderWidth: 1.5, alignItems: 'center' },
  headerTitle: { color: '#e6e1f5', fontSize: 15, fontWeight: 'bold', letterSpacing: 2.5 },
  autoplayBanner: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  content:     { flex: 1 },
  screenBody:  { flex: 1, padding: 18, paddingTop: 0 },
  centeredBody:{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },

  // Auth
  authContainer:  { flex: 1, backgroundColor: '#0d0d14', justifyContent: 'center', padding: 28 },
  authBox:        { alignItems: 'center', backgroundColor: '#16161f', padding: 30, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  authTitle:      { color: '#e6e1f5', fontSize: 28, fontWeight: 'bold', letterSpacing: 3, marginBottom: 5 },
  authSubtitle:   { color: '#9896a8', fontSize: 14, marginBottom: 30 },
  authInput:      { width: '100%', backgroundColor: '#1e1e2a', color: '#e6e1f5', borderRadius: 12, height: 55, paddingHorizontal: 16, marginBottom: 14, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  authBtn:        { width: '100%', backgroundColor: '#00ffcc', height: 55, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  authBtnText:    { color: '#050515', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  authSwitchText: { color: '#00ffcc', fontSize: 14 },
  backToLoginBtn:  { flexDirection: 'row', alignItems: 'center', marginTop: 22, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 25, borderWidth: 1.5, borderColor: '#00ffcc44', backgroundColor: '#00ffcc0e', gap: 8 },
  backToLoginText: { color: '#00ffcc', fontSize: 14, fontWeight: '600' },
  passwordRow:     { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 14 },
  eyeBtn:          { position: 'absolute', right: 15, height: 55, justifyContent: 'center' },

  // Search
  searchBox:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e2a', borderRadius: 16, paddingHorizontal: 16, marginBottom: 14, height: 50, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  input:       { flex: 1, color: '#e6e1f5', fontSize: 15 },

  // History
  historyDropdown: { backgroundColor: '#16161f', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', marginBottom: 12, overflow: 'hidden' },
  historyHeader:   { color: '#9896a8', fontSize: 11, fontWeight: '700', letterSpacing: 1, padding: 14, paddingBottom: 8, textTransform: 'uppercase' },
  historyItem:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  historyItemText: { color: '#ccc', fontSize: 14, flex: 1 },

  // Track card — M3 tonal surface
  trackCard:   { flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 7, borderRadius: 16, borderWidth: 1 },
  trackInfo:   { flex: 1, marginRight: 4 },
  trackTitle:  { color: '#e6e1f5', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  trackArtist: { color: '#9896a8', fontSize: 12 },

  recentCard:     { alignItems: 'center', marginRight: 14, width: 72 },
  trendingCard:   { marginRight: 14 },
  trendingRank:   { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },

  playlistCard:   { width: 90, height: 100, backgroundColor: '#16161f', borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  playlistName:   { color: '#e6e1f5', fontSize: 11, fontWeight: '700', marginTop: 6, textAlign: 'center', paddingHorizontal: 4 },
  playlistListItem:{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },

  sectionHeader:  { color: '#e6e1f5', fontSize: 14, fontWeight: '700', letterSpacing: 0.5, marginBottom: 14 },
  // Echo Music section label — bold italic, like JioSaavn
  echoSectionLabel: { color: '#e6e1f5', fontSize: 16, fontWeight: '800', fontStyle: 'italic', marginBottom: 14 },
  // Top result card — wide with thick border
  topResultCard:  { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, borderWidth: 1.5, marginBottom: 16 },
  // Generic search result row (albums, artists)
  searchResultRow:{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 8 },
  mainText:       { color: '#e6e1f5', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  subText:        { color: '#9896a8', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // Settings rows
  settingRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  textGroup:      { flex: 1, marginRight: 12 },
  settingTitle:   { color: '#e6e1f5', fontSize: 15, fontWeight: '600', marginBottom: 3 },
  settingDesc:    { color: '#9896a8', fontSize: 12 },
  statBadge:      { alignItems: 'center' },
  statNumber:     { color: '#00ffcc', fontSize: 22, fontWeight: 'bold' },
  statLabel:      { color: '#9896a8', fontSize: 11 },

  // Mini player — rounded rectangle floating above bottom nav
  miniPlayer:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  miniPlayerLeft:    { flex: 1, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', marginRight: 8 },
  miniPlayerTitle:   { fontSize: 14, fontWeight: '600', marginBottom: 1, color: '#e6e1f5' },
  miniPlayerArtist:  { fontSize: 12, color: '#9896a8' },
  miniPlayerPlayBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },

  // Bottom nav — M3 NavigationBar
  bottomNav:   { flexDirection: 'row', borderTopWidth: 0, paddingBottom: Platform.OS === 'ios' ? 20 : 6, paddingTop: 10 },
  navButton:   { flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 1 },
  navText:     { fontSize: 10, fontWeight: '600', marginTop: 2 },

  // Modals
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent:  { width: '100%', backgroundColor: '#16161f', borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },

  // ── Full screen player ──
  fullScreenContainer:  { flex: 1, paddingTop: Platform.OS === 'ios' ? 50 : 32 },
  fullScreenHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8, zIndex: 10, elevation: 10 },
  fullScreenHeaderText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 2.5, textTransform: 'uppercase' },
  moodBadge:            { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  moodBadgeText:        { fontSize: 11, fontWeight: '700' },

  // Album art area — bigger thumbnail as per user request
  animationContainer:   { alignItems: 'center', justifyContent: 'center', height: 340, marginVertical: 4 },
  breathingShadow:      { position: 'absolute', width: 302, height: 302, borderRadius: 151 },
  rippleRing:           { position: 'absolute', width: 302, height: 302, borderRadius: 151, borderWidth: 1.5 },
  // [VISUAL] Vinyl disc outer ring (rotates) — bigger
  vinylOuter:           { position: 'absolute', width: 318, height: 318, borderRadius: 159, borderWidth: 3, borderStyle: 'dashed' },
  albumArtLarge:        { width: 290, height: 290, borderRadius: 28, overflow: 'hidden', backgroundColor: '#1e1e2a', justifyContent: 'center', alignItems: 'center', elevation: 16, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  albumImage:           { width: 290, height: 290 },

  // Track info
  fullScreenInfo:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, marginVertical: 10 },
  fullScreenTitle:      { color: '#e6e1f5', fontSize: 21, fontWeight: 'bold', marginBottom: 4, letterSpacing: 0.2 },
  fullScreenArtist:     { fontSize: 14, fontWeight: '600', letterSpacing: 0.5 },
  autoplayReasonText:   { fontSize: 11, marginTop: 4 },

  // Progress bar — M3 style
  sliderSection:        { paddingHorizontal: 28, marginBottom: 6 },
  progressBarBg:        { height: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'visible' },
  progressBarFill:      { height: 5, borderRadius: 3 },
  progressDot:          { position: 'absolute', top: -6, width: 18, height: 18, borderRadius: 9, marginLeft: -9, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8, elevation: 8 },
  timeRow:              { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  timeText:             { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500' },

  // Controls
  controlsContainer:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 30, marginBottom: 8 },
  largePlayBtn:         { width: 74, height: 74, borderRadius: 37, justifyContent: 'center', alignItems: 'center' },
  queueContainer:       { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  queueHeader:          { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  queueItem:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  menuItem:             { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 25, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
});
