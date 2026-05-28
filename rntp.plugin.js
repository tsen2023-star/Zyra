/**
 * Custom Expo config plugin for react-native-track-player.
 * Adds the required AndroidManifest.xml entries for the RNTP foreground service
 * (HeadlessJsMediaService + MediaBrowserService + MediaButtonReceiver).
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withTrackPlayer(config) {
  return withAndroidManifest(config, async (cfg) => {
    const manifest   = cfg.modResults;
    const app        = manifest.manifest.application[0];

    // ── Service: HeadlessJsMediaService ─────────────────────────────────────
    if (!app.service) app.service = [];

    const serviceExists = app.service.some(
      s => s.$?.['android:name'] === 'com.doublesymmetry.trackplayer.service.HeadlessJsMediaService'
    );
    if (!serviceExists) {
      app.service.push({
        $: {
          'android:name':                'com.doublesymmetry.trackplayer.service.HeadlessJsMediaService',
          'android:exported':            'false',
          'android:foregroundServiceType': 'mediaPlayback',
        },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.media.browse.MediaBrowserService' } }],
        }],
      });
    }

    // ── Receiver: MediaButtonReceiver ────────────────────────────────────────
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
