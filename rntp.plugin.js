/**
 * Custom Expo config plugin for react-native-track-player.
 * Adds the required AndroidManifest.xml entries for RNTP's MusicService foreground service.
 *
 * Correct class: com.doublesymmetry.trackplayer.service.MusicService
 * (verified from node_modules/react-native-track-player/android source)
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withTrackPlayer(config) {
  return withAndroidManifest(config, async (cfg) => {
    const manifest = cfg.modResults;
    const app      = manifest.manifest.application[0];

    // ── Service: MusicService (the actual RNTP foreground service class) ──────
    if (!app.service) app.service = [];

    const serviceExists = app.service.some(
      s => s.$?.['android:name'] === 'com.doublesymmetry.trackplayer.service.MusicService'
    );
    if (!serviceExists) {
      app.service.push({
        $: {
          'android:name':                  'com.doublesymmetry.trackplayer.service.MusicService',
          'android:exported':              'false',
          'android:foregroundServiceType': 'mediaPlayback',
        },
      });
    }

    // ── Receiver: MediaButtonReceiver (handles earbud/Bluetooth media buttons) ─
    if (!app.receiver) app.receiver = [];

    const receiverExists = app.receiver.some(
      r => r.$?.['android:name'] === 'androidx.media.session.MediaButtonReceiver'
    );
    if (!receiverExists) {
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
