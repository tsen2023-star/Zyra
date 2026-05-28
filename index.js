/**
 * Custom Expo entry point — must register the RNTP playback service
 * BEFORE the root component mounts, so it runs in the native foreground service.
 */
import { registerRootComponent } from 'expo';
import TrackPlayer from 'react-native-track-player';

import App from './App';
import { PlaybackService } from './service';

// Register once at startup
TrackPlayer.registerPlaybackService(() => PlaybackService);

registerRootComponent(App);
