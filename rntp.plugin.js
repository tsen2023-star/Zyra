/**
 * Custom Expo config plugin for react-native-track-player (RNTP 4.x).
 *
 * Does three things:
 *  1. Adds JitPack Maven repo directly to android/build.gradle (RNTP depends on
 *     com.github.doublesymmetry:kotlinaudio:v2.1.0 from JitPack — without this
 *     the Gradle build fails with "Could not resolve" or "unknown error").
 *  2. Registers MusicService + MediaButtonReceiver in AndroidManifest.xml.
 *  3. Adds Gradle JVM memory settings to avoid Kotlin OOM during compilation.
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs   = require('fs');
const path = require('path');

// ─── 1. Patch android/build.gradle to include JitPack ────────────────────────
function withJitPackRepo(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const buildGradle = path.join(cfg.modRequest.platformProjectRoot, 'build.gradle');

      if (!fs.existsSync(buildGradle)) return cfg;

      let content = fs.readFileSync(buildGradle, 'utf8');

      if (content.includes('jitpack.io')) {
        return cfg; // already present
      }

      // Try to insert inside existing allprojects.repositories block
      const allprojectsPattern = /(allprojects\s*\{[^}]*repositories\s*\{)/;
      if (allprojectsPattern.test(content)) {
        content = content.replace(
          allprojectsPattern,
          '$1\n        maven { url "https://jitpack.io" }'
        );
      } else {
        // No allprojects block — append one
        content += '\nallprojects {\n    repositories {\n        maven { url "https://jitpack.io" }\n    }\n}\n';
      }

      fs.writeFileSync(buildGradle, content, 'utf8');
      console.log('[rntp.plugin.js] ✅ Added JitPack to android/build.gradle');

      return cfg;
    },
  ]);
}

// ─── 2. Patch gradle.properties for Kotlin JVM memory ────────────────────────
function withGradleJvmArgs(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const gradleProps = path.join(cfg.modRequest.platformProjectRoot, 'gradle.properties');

      if (!fs.existsSync(gradleProps)) return cfg;

      let content = fs.readFileSync(gradleProps, 'utf8');

      // Increase heap for Kotlin compilation
      if (!content.includes('org.gradle.jvmargs')) {
        content += '\norg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g\n';
        fs.writeFileSync(gradleProps, content, 'utf8');
        console.log('[rntp.plugin.js] ✅ Set Gradle JVM args (4 GB heap)');
      } else if (!content.includes('Xmx4g') && !content.includes('Xmx3g') && !content.includes('Xmx2g')) {
        // Already has jvmargs but with lower memory — bump it
        content = content.replace(
          /org\.gradle\.jvmargs=.*/,
          'org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g'
        );
        fs.writeFileSync(gradleProps, content, 'utf8');
        console.log('[rntp.plugin.js] ✅ Bumped Gradle JVM heap to 4 GB');
      }

      return cfg;
    },
  ]);
}

// ─── 3. Add RNTP entries to AndroidManifest.xml ──────────────────────────────
function withRntpManifest(config) {
  return withAndroidManifest(config, async (cfg) => {
    const app = cfg.modResults.manifest.application[0];

    // Service: MusicService (the ACTUAL class — verified from node_modules)
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

    // Receiver: MediaButtonReceiver (earbud / Bluetooth media buttons)
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
}

// ─── Compose all three mods ──────────────────────────────────────────────────
module.exports = function withTrackPlayer(config) {
  config = withJitPackRepo(config);
  config = withGradleJvmArgs(config);
  config = withRntpManifest(config);
  return config;
};
