import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  Platform,
  Pressable,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

interface Props {
  /**
   * Called with a payload to send as a 'voice' message.
   * The string is a base64 data URI of the recorded audio plus duration metadata.
   * Format: JSON.stringify({ uri: 'data:audio/m4a;base64,...', duration: ms })
   */
  onSend: (payload: string) => void;
  /** Theme color for the mic button background */
  tintColor: string;
}

const MIN_RECORDING_MS = 600;
const MAX_RECORDING_MS = 60 * 1000; // 60s

export const VoiceRecorder: React.FC<Props> = ({ onSend, tintColor }) => {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const [cancelled, setCancelled] = useState(false);

  // For "slide to cancel" gesture
  const slideX = useRef(new Animated.Value(0)).current;
  const startXRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse animation for recording dot
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(0);
    }
  }, [isRecording]);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Microphone Permission', 'Please grant microphone access to record voice messages.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(rec);
      setIsRecording(true);
      setElapsed(0);
      setCancelled(false);
      cancelledRef.current = false;
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsed(sec);
        if (sec >= MAX_RECORDING_MS / 1000) {
          stopAndSend();
        }
      }, 200);
    } catch (e: any) {
      console.warn('Recording start error:', e);
      Alert.alert('Recording Error', e?.message || 'Could not start recording');
    }
  };

  const cleanupTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopAndSend = async () => {
    cleanupTimer();
    const rec = recording;
    setIsRecording(false);
    setRecording(null);
    slideX.setValue(0);

    if (!rec) return;

    const elapsedMs = Date.now() - startTimeRef.current;
    const wasCancelled = cancelledRef.current;

    try {
      await rec.stopAndUnloadAsync();
    } catch (e) {
      console.warn('stopRecording error:', e);
    }

    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {}

    if (wasCancelled) {
      const uri = rec.getURI();
      if (uri && Platform.OS !== 'web') {
        try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
      }
      return;
    }

    if (elapsedMs < MIN_RECORDING_MS) {
      Alert.alert('Too Short', 'Hold the mic button to record. Release to send.');
      const uri = rec.getURI();
      if (uri && Platform.OS !== 'web') {
        try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
      }
      return;
    }

    try {
      const uri = rec.getURI();
      if (!uri) return;

      let base64: string;
      if (Platform.OS === 'web') {
        // On web, the URI is a blob:// URL; convert to base64
        const resp = await fetch(uri);
        const blob = await resp.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            // result is "data:<mime>;base64,<data>"
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
      }

      const mime = Platform.OS === 'ios' ? 'audio/m4a' : 'audio/mp4';
      const dataUri = `data:${mime};base64,${base64}`;
      const payload = JSON.stringify({ uri: dataUri, duration: elapsedMs });
      onSend(payload);
    } catch (e: any) {
      console.warn('Voice send error:', e);
      Alert.alert('Send Error', 'Could not send voice message');
    }
  };

  const cancelRecording = async () => {
    cancelledRef.current = true;
    setCancelled(true);
    await stopAndSend(); // Will detect cancelled flag and discard
  };

  // Handle pressable interactions
  const handlePressIn = (e: any) => {
    startXRef.current = e.nativeEvent?.pageX ?? 0;
    startRecording();
  };

  const handlePressOut = () => {
    if (!isRecording) return;
    if (cancelledRef.current) return;
    stopAndSend();
  };

  // Slide-to-cancel: we approximate using touch move on the overlay
  const handleTouchMove = (e: any) => {
    if (!isRecording) return;
    const currentX = e.nativeEvent?.pageX ?? 0;
    const dx = currentX - startXRef.current;
    // Slide left to cancel
    const clamped = Math.max(-120, Math.min(0, dx));
    slideX.setValue(clamped);
    if (dx < -100 && !cancelledRef.current) {
      cancelRecording();
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  return (
    <>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onTouchMove={handleTouchMove}
        delayLongPress={0}
        style={({ pressed }) => [
          styles.micButton,
          { backgroundColor: tintColor, transform: [{ scale: pressed ? 1.15 : 1 }] },
        ]}
      >
        <Ionicons name="mic" size={20} color="#FFF" />
      </Pressable>

      {isRecording && (
        <View pointerEvents="none" style={styles.overlay}>
          <View style={styles.overlayInner}>
            <Animated.View style={[styles.recordDot, { opacity: dotOpacity }]} />
            <Text style={styles.recordTime}>{formatTime(elapsed)}</Text>

            <Animated.View style={[styles.slideRow, { transform: [{ translateX: slideX }] }]}>
              <Ionicons name="chevron-back" size={16} color="#888" />
              <Text style={styles.slideText}>Slide to cancel</Text>
            </Animated.View>
          </View>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    justifyContent: 'flex-end',
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  overlayInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFFEE',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 4 },
    }),
  },
  recordDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF3B30',
  },
  recordTime: {
    color: '#222',
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  slideRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  slideText: {
    color: '#888',
    fontSize: 14,
  },
});
