/**
 * Custom Expo config plugin for react-native-track-player (RNTP 4.x).
 *
 * Only adds the required AndroidManifest.xml entries — no Gradle patching
 * (Gradle patching via withDangerousMod was causing "repositoriesMode" conflicts
 *  with React Native 0.74's dependency resolution management).
 *
 * Verified correct class names from node_modules/react-native-track-player/android source:
 *   - com.doublesymmetry.trackplayer.service.MusicService  (HeadlessJsTaskService subclass)
 *   - androidx.media.session.MediaButtonReceiver            (earbud/BT media buttons)
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withTrackPlayer(config) {
  return withAndroidManifest(config, async (cfg) => {
    const app = cfg.modResults.manifest.application[0];

    // ── Service: MusicService ────────────────────────────────────────────────
    if (!app.service) app.service = [];
    if (!app.service.some(s => s.$?.['android:name'] === 'com.doublesymmetry.trackplayer.service.MusicService')) {
      app.service.push({
        $: {
          'android:name':                  'com.doublesymmetry.trackplayer.service.MusicService',
          'android:exported':              'false',
          'android:foregroundServiceType': 'mediaPlayback',
        },
      });
    }

    // ── Receiver: MediaButtonReceiver (earbud / Bluetooth media buttons) ─────
    if (!app.receiver) app.receiver = [];
    if (!app.receiver.some(r => r.$?.['android:name'] === 'androidx.media.session.MediaButtonReceiver')) {
      app.receiver.push({
        $: {
          'android:name':     'androidx.media.session.MediaButtonReceiver',
          'android:exported': 'true',
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.intent.action.MEDIA_BUTTON' } }],
        }],
      });
    }

    return cfg;
  });
};
