import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../src/store/authStore';
import { useCallStore } from '../src/store/callStore';
import { socketService } from '../src/services/socket';
import { webRTCService } from '../src/services/webrtc';
import { IncomingCallOverlay } from '../src/components/IncomingCallOverlay';

// Keep splash visible until fonts are ready
SplashScreen.preventAutoHideAsync().catch(() => {});

function AppInitializer() {
  const { user, token, isAuthenticated } = useAuthStore();
  const { setIncomingCall, isInCall } = useCallStore();

  // Connect socket and initialize WebRTC when authenticated
  useEffect(() => {
    if (isAuthenticated && user && token) {
      // Connect the shared socket
      socketService.connect(user.id, token);

      // Initialize WebRTC signaling listener
      webRTCService.initialize();

      // Listen for incoming calls globally
      const handleIncomingCall = (data: any) => {
        if (data.event === 'incoming_call' && !isInCall) {
          setIncomingCall({
            roomId: data.roomId,
            callerId: data.callerId,
            callerName: data.callerName,
            callerPhoto: data.callerPhoto,
            callType: data.callType,
            isGroupCall: data.isGroupCall || false,
            groupName: data.groupName,
            participantIds: data.participantIds,
          });
        }
      };

      webRTCService.addEventListener(handleIncomingCall);

      return () => {
        webRTCService.removeEventListener(handleIncomingCall);
        webRTCService.deinitialize();
        socketService.disconnect();
      };
    } else {
      // Not authenticated - disconnect
      webRTCService.deinitialize();
      socketService.disconnect();
    }
  }, [isAuthenticated, user?.id, token]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const loadUser = useAuthStore((state) => state.loadUser);

  // Preload Ionicons font to avoid "Font file is empty" issues on Expo Go
  const [fontsLoaded, fontsError] = useFonts({
    ...Ionicons.font,
  });

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontsError]);

  if (!fontsLoaded && !fontsError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AppInitializer />
      <IncomingCallOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="call/[id]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="gift/[id]" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ headerShown: false, presentation: 'card' }} />
        <Stack.Screen name="new-group" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
