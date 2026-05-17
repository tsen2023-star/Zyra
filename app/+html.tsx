import { useEffect } from 'react';
import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before our navigation tree mounts safely
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Layout() {
  useEffect(() => {
    // Force the splash screen to hide immediately once this component is rendered on the phone
    setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 500);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer
        screenOptions={{
          headerStyle: { backgroundColor: '#050515' },
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: 'bold', letterSpacing: 2 },
          drawerStyle: { backgroundColor: '#0b0b1e', width: 280 },
          drawerActiveBackgroundColor: '#151535',
          drawerActiveTintColor: '#00ffcc',
          drawerInactiveTintColor: '#8e8e93',
          drawerLabelStyle: { fontSize: 16, marginLeft: -10 },
        }}
      >
        <Drawer.Screen
          name="index"
          options={{
            drawerLabel: 'All Songs',
            title: 'ZYRA',
            drawerIcon: ({ color, size }) => <Ionicons name="musical-notes" size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="favorites"
          options={{
            drawerLabel: 'Favorites',
            title: 'Favorites',
            drawerIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            drawerLabel: 'Settings',
            title: 'Settings',
            drawerIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}