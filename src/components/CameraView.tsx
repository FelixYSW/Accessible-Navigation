/**
 * CameraView.tsx
 *
 * Renders the live camera feed using react-native-vision-camera v4/v5.
 * Features:
 *  - Requests camera permission on mount.
 *  - Attaches a Worklet-based frame processor that simulates hazard detection
 *    every 15 seconds using a timestamp guard (no real ML in this prototype —
 *    documented clearly for the academic report).
 *  - On hazard "detection": triggers expo-speech audio warning via runOnJS.
 *  - In 'navigating' state: renders an animated AR directional overlay card.
 *
 * This component owns the camera lifecycle only. Routing logic lives in hooks.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { runOnJS } from 'react-native-reanimated';
import * as Speech from 'expo-speech';
import type { AppState } from '../hooks/useAppStateMachine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CameraViewProps {
  /** Current app state — controls AR overlay visibility. */
  appState: AppState;
  /**
   * Next-turn instruction string displayed in the AR overlay.
   * e.g. "Turn right onto Strand in 50 m"
   */
  nextInstruction?: string;
}

// ─── Hazard speech throttle ───────────────────────────────────────────────────

/** How long (ms) between consecutive hazard announcements. */
const HAZARD_THROTTLE_MS = 15_000;

// ─── Component ────────────────────────────────────────────────────────────────

export function CameraView({ appState, nextInstruction }: CameraViewProps): React.JSX.Element {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Tracks the JS-side timestamp of the last speech announcement.
  const lastSpeechTime = useRef<number>(0);

  // Animated value for the hazard alert flash overlay.
  const hazardOpacity = useRef(new Animated.Value(0)).current;

  // Animated value for the AR overlay slide-in.
  const arSlideY = useRef(new Animated.Value(-120)).current;

  // ── Permission request on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  // ── AR overlay animation ─────────────────────────────────────────────────
  useEffect(() => {
    if (appState === 'navigating') {
      Animated.spring(arSlideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    } else {
      Animated.spring(arSlideY, {
        toValue: -120,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    }
  }, [appState, arSlideY]);

  // ── Hazard detected callback (runs on JS thread via runOnJS) ────────────
  const onHazardDetected = useCallback(() => {
    const now = Date.now();
    if (now - lastSpeechTime.current < HAZARD_THROTTLE_MS) return;
    lastSpeechTime.current = now;

    // Flash red overlay
    Animated.sequence([
      Animated.timing(hazardOpacity, {
        toValue: 0.35,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(hazardOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    // Audio warning via expo-speech
    Speech.speak('Hazard ahead, please proceed with caution.', {
      language: 'en-GB',
      rate: 0.95,
      pitch: 1.0,
    });
  }, [hazardOpacity]);

  // ── Frame Processor ──────────────────────────────────────────────────────
  /**
   * SIMULATION NOTE (for academic report):
   * A real implementation would run a Core ML / YOLO model here using a
   * VisionCamera Frame Processor Plugin. For this prototype, we simulate
   * detection by checking the elapsed time inside the Worklet. The call to
   * `onHazardDetected` is bridged back to the JS thread via `runOnJS`.
   *
   * Frame processors run on a high-priority background thread (Worklet).
   * We do NOT do heavy work here — the guard check is O(1).
   */
  // We track the last detection time in a shared value to avoid Worklet ↔ JS
  // round-trips for the throttle check.
  const lastDetectionWorkletTime = useRef<number>(0);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      // Access width/height to prove we're in a real frame processor context.
      void frame.width;
      void frame.height;

      const now = Date.now();
      // Fire hazard detection simulation every HAZARD_THROTTLE_MS milliseconds.
      if (now - lastDetectionWorkletTime.current >= HAZARD_THROTTLE_MS) {
        lastDetectionWorkletTime.current = now;
        runOnJS(onHazardDetected)();
      }
    },
    [onHazardDetected],
  );

  // ── Permission / device not ready states ────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.centreContainer}>
        <Text style={styles.permissionText}>
          Camera permission required for hazard detection.
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={() => void requestPermission()}
          accessibilityRole="button"
          accessibilityLabel="Grant camera permission"
        >
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.centreContainer}>
        <Text style={styles.permissionText}>
          No back camera found on this device.
        </Text>
      </View>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Live camera feed — fills the entire screen */}
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
        accessibilityLabel="Live camera feed for hazard detection"
      />

      {/* Red flash overlay — fires when a hazard is "detected" */}
      <Animated.View
        style={[styles.hazardFlash, { opacity: hazardOpacity }]}
        pointerEvents="none"
      />

      {/* ── AR Directional Overlay (navigating state only) ─────────────── */}
      <Animated.View
        style={[
          styles.arOverlay,
          { transform: [{ translateY: arSlideY }] },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          nextInstruction ? `Navigation: ${nextInstruction}` : 'Navigating'
        }
      >
        {/* Direction arrow */}
        <View style={styles.arArrowContainer}>
          <Text style={styles.arArrow}>↑</Text>
        </View>

        {/* Instruction text */}
        <View style={styles.arTextContainer}>
          <Text style={styles.arLabel}>NEXT TURN</Text>
          <Text
            style={styles.arInstruction}
            numberOfLines={2}
            adjustsFontSizeToFit
          >
            {nextInstruction ?? 'Continue straight ahead'}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centreContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 32,
    gap: 16,
  },
  permissionText: {
    color: '#94a3b8',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  permissionButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  // Red flash overlay for hazard detection feedback
  hazardFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ef4444',
  },
  // AR overlay pill at the top of the camera view
  arOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 20,
    padding: 16,
    gap: 14,
    // Glassmorphism border
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  arArrowContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arArrow: {
    fontSize: 24,
    color: '#fff',
  },
  arTextContainer: {
    flex: 1,
    gap: 2,
  },
  arLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#60a5fa',
    letterSpacing: 1.5,
  },
  arInstruction: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f1f5f9',
    lineHeight: 22,
  },
});
