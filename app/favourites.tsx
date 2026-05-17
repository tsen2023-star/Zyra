import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function Favorites() {
  return (
    <View style={styles.container}>
      <Ionicons name="heart-dislike-outline" size={64} color="#3a3a50" style={{ marginBottom: 15 }} />
      <Text style={styles.mainText}>No Favourites Yet</Text>
      <Text style={styles.subText}>Songs you mark with a heart icon will populate here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05050f', justifyContent: 'center', alignItems: 'center', padding: 30 },
  mainText: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  subText: { color: '#8e8e93', fontSize: 14, textAlign: 'center', lineHeight: 20 }
});