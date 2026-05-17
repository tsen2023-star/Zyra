import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function AllSongs() {
  // Dummy data array to layout row items safely without data fetching
  const mockSongs = [
    { id: '1', title: 'Stairway to Heaven', artist: 'The Smithies' },
    { id: '2', title: 'Baarish Mein Phir', artist: 'Saahel' },
    { id: '3', title: 'Midnight Drive', artist: 'Echo Project' },
    { id: '4', title: 'Neon Dreams', artist: 'Zyra Core' },
  ];

  return (
    <View style={styles.container}>
      {/* Visual Search Row */}
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color="#666" style={{ marginRight: 10 }} />
        <TextInput 
          placeholder="Search for tracks, artists..." 
          placeholderTextColor="#666" 
          style={styles.input}
          editable={false} // UI Layout Focus only right now
        />
      </View>

      <Text style={styles.sectionHeader}>Tracks</Text>

      {/* Main List Scroller Layout */}
      <ScrollView style={styles.list}>
        {mockSongs.map((song) => (
          <TouchableOpacity key={song.id} style={styles.trackCard}>
            <View style={styles.albumArtPlaceholder}>
              <Ionicons name="disc-outline" size={24} color="#00ffcc" />
            </View>
            <View style={styles.trackInfo}>
              <Text style={styles.trackTitle}>{song.title}</Text>
              <Text style={styles.trackArtist}>{song.artist}</Text>
            </View>
            <Ionicons name="ellipsis-vertical" size={20} color="#8e8e93" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05050f', padding: 20 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121225', paddingHorizontal: 15, borderRadius: 12, height: 50, marginBottom: 25 },
  input: { color: '#fff', flex: 1, fontSize: 16 },
  sectionHeader: { color: '#8e8e93', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 15, letterSpacing: 1 },
  list: { flex: 1 },
  trackCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0b0b18', padding: 12, borderRadius: 14, marginBottom: 12 },
  albumArtPlaceholder: { width: 48, height: 48, backgroundColor: '#151530', borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  trackInfo: { flex: 1 },
  trackTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  trackArtist: { color: '#8e8e93', fontSize: 13 },
});