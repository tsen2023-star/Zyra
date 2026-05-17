import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

// Keep the loading state stable until mounting completes
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Layout() {
  useEffect(() => {
    // Dismiss the splash layer securely 
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#050515' }, // Ultra dark blue matching Echo project
          headerTintColor: '#ffffff',
          headerTitleStyle: { fontWeight: 'bold', letterSpacing: 2 },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen 
          name="index" 
          options={{ 
            title: 'ZYRA' 
          }} 
        />
        <Stack.Screen 
          name="favorites" 
          options={{ 
            title: 'Favorites',
            headerBackTitle: 'Back'
          }} 
        />
        <Stack.Screen 
          name="settings" 
          options={{ 
            title: 'Settings',
            headerBackTitle: 'Back'
          }} 
        />
      </Stack>
    </>
  );
}