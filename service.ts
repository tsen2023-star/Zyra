import TrackPlayer, { Event, AppKilledPlaybackBehavior } from 'react-native-track-player';

/**
 * PlaybackService — runs in a native Android foreground service.
 * Handles remote control events from earbuds, Bluetooth, lock screen, and notification player.
 */
export async function PlaybackService() {
  // Earbud / Bluetooth / lock-screen PLAY
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());

  // Earbud / Bluetooth / lock-screen PAUSE
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());

  // Earbud double-press / notification NEXT
  TrackPlayer.addEventListener(Event.RemoteNext, async () => {
    try { await TrackPlayer.skipToNext(); }
    catch { /* queue empty — App.tsx handles PlaybackQueueEnded */ }
  });

  // Earbud triple-press / notification PREVIOUS
  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    try { await TrackPlayer.skipToPrevious(); }
    catch { await TrackPlayer.seekTo(0); }
  });

  // Notification STOP / headphone unplug
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());

  // Audio focus duck (e.g., incoming call / navigation prompt)
  TrackPlayer.addEventListener(Event.RemoteDuck, async ({ paused, permanent }: any) => {
    if (permanent) await TrackPlayer.reset();
    else if (paused) await TrackPlayer.pause();
    // Do not automatically resume playback to prevent random unpauses
  });
}
