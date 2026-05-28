/**
 * Custom Expo config plugin for react-native-track-player (RNTP 4.x).
 *
 * IMPORTANT: RNTP 4.x already declares MusicService in its OWN AndroidManifest.xml:
 *   android:name="com.doublesymmetry.trackplayer.service.MusicService"
 *   android:exported="true"
 *   android:foregroundServiceType="mediaPlayback"
 *
 * DO NOT re-declare MusicService here — duplicate entries with conflicting attributes
 * (especially exported="false" vs exported="true") cause a manifest merger failure
 * that EAS reports as "Gradle build failed with unknown error".
 *
 * This plugin ONLY adds MediaButtonReceiver, which is NOT in RNTP's manifest
 * but is required for earbud / Bluetooth media button routing on Android.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withTrackPlayer(config) {
  return withAndroidManifest(config, async (cfg) => {
    const app = cfg.modResults.manifest.application[0];

    // ── MediaButtonReceiver: routes earbud / BT media buttons to MusicService ─
    // RNTP's MusicService handles MEDIA_BUTTON intents via its own intent-filter,
    // but MediaButtonReceiver is needed to properly route button presses from the
    // system's media session API (lock screen, Bluetooth, earbuds).
    if (!app.receiver) app.receiver = [];
    const alreadyHasReceiver = app.receiver.some(
      r => r.$?.['android:name'] === 'androidx.media.session.MediaButtonReceiver'
    );
    if (!alreadyHasReceiver) {
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
