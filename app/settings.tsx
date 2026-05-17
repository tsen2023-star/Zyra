import { View, Text, StyleSheet, Switch } from 'react-native';
import { useState } from 'react';

export default function Settings() {
  const [shakeEnabled, setShakeEnabled] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05050f', padding: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0b0b18', padding: 20, borderRadius: 16 },
  textGroup: { flex: 1, paddingRight: 15 },
  settingTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 6 },
  settingDesc: { color: '#8e8e93', fontSize: 13, lineHeight: 18 }
});