import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import { useTheme } from '../theme/SettingsContext';
import { RADIUS } from '../theme/tokens';

// The dark backdrop both camera screens sit on. Matches the design's #0a0a0a
// so the permission state, the loading gap before the first frame, and the
// live preview all read as the same surface.
const STAGE_BACKGROUND = '#0a0a0a';

interface CameraStageProps {
  /** Whether the camera session should be streaming. Screens pass `false`
   *  when they are not the focused tab, so the camera is released. */
  isActive: boolean;
  children: React.ReactNode;
}

// Shared shell for AR Navigation and Hazard Detection: the permission gate,
// the live camera view and the dark surface behind the overlays. Both screens
// present identical camera chrome, so keeping it here stops the two from
// drifting apart.
export function CameraStage({ isActive, children }: CameraStageProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const { F } = useTheme();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  if (!hasPermission) {
    return (
      <View style={styles.permission}>
        {isActive && <StatusBar style="light" />}
        <Text style={[styles.permissionText, { fontSize: F.body }]}>
          Camera access is required for hazard detection.
        </Text>
        <Pressable style={styles.permissionButton} onPress={requestPermission}>
          <Text style={[styles.permissionButtonText, { fontSize: F.body }]}>
            Grant Camera Access
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stage}>
      {/* Both camera screens are dark regardless of the Dark Mode setting, so
          the status bar is forced light here rather than following the theme.
          Only while active, though: this screen stays mounted after the user
          switches tabs, and a still-mounted StatusBar would keep overriding
          the theme's own setting on whichever screen they moved to. */}
      {isActive && <StatusBar style="light" />}
      <Camera style={StyleSheet.absoluteFill} isActive={isActive} device="back" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: STAGE_BACKGROUND },
  permission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: STAGE_BACKGROUND,
  },
  permissionText: { color: '#fff', textAlign: 'center', marginBottom: 16 },
  permissionButton: {
    backgroundColor: '#0A84FF',
    borderRadius: RADIUS.small,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  permissionButtonText: { color: '#fff', fontWeight: '700' },
});
