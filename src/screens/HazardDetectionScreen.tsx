import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { CameraStage } from '../components/CameraStage';
import { HazardOverlay } from '../components/HazardOverlay';
import { PulsingDot } from '../components/PulsingDot';
import { VoiceCuePill } from '../components/VoiceCuePill';
import { useSettings } from '../theme/SettingsContext';
import { HAZARD_COLORS, RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { HAZARD_CLASSES } from '../types/hazard';
import { useStubHazardDetector } from '../services/hazardDetector';

// Standalone hazard scanning: the same detection treatment as AR Navigation,
// but with no route required - the third tab in the redesign.
export function HazardDetectionScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { T, F, scaled, hazardActive } = useSettings();

  const activeClasses = useMemo(
    () => HAZARD_CLASSES.filter((hazardClass) => hazardActive[hazardClass]),
    [hazardActive],
  );

  // Only run the camera and the detector while this tab is on screen, so
  // switching to Navigate or Settings releases the camera instead of holding
  // it open in the background.
  const detections = useStubHazardDetector(isFocused, activeClasses);

  return (
    <CameraStage isActive={isFocused}>
      <ScanReticle color={T.green} />

      <HazardOverlay detections={detections} />

      <View style={[styles.topRow, { top: insets.top + 4 }]}>
        <View style={styles.scanPill}>
          <PulsingDot color={HAZARD_COLORS.pothole} size={scaled(8)} />
          <Text style={[styles.scanPillText, { fontSize: F.xs }]}>Scanning for hazards</Text>
        </View>
        {/* Only the hazard half here: there is no route on this screen, so
            there are no turns to speak. Spoken turn cues stay whatever the
            user last set them to. */}
        <VoiceCuePill cue="hazards" />
      </View>

      {/* No bottom safe-area padding here: this is a tab screen, and the tab
          bar below it already covers the home indicator. */}
      <View style={styles.sheet}>
        <Text style={[styles.sheetTitle, { fontSize: F.body }]}>
          Point your camera at the path ahead
        </Text>
        <Text style={[styles.sheetSubtitle, { fontSize: F.tinySm }]}>
          Hazards are flagged in real time, no route needed
        </Text>
      </View>
    </CameraStage>
  );
}

// Four L-shaped brackets forming a viewfinder frame, drawn in the app's green
// at low opacity so they frame the path without competing with detections.
function ScanReticle({ color }: { color: string }) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox="0 0 402 700"
      preserveAspectRatio="none"
      opacity={0.55}
      pointerEvents="none"
    >
      <Path
        d="M60 220 v-30 a6 6 0 0 1 6-6 h30"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M342 220 v-30 a6 6 0 0 0-6-6 h-30"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M60 480 v30 a6 6 0 0 0 6 6 h30"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M342 480 v30 a6 6 0 0 1-6 6 h-30"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  topRow: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  scanPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  scanPillText: { color: '#fff', fontWeight: '700' },
  sheet: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    bottom: 32,
    backgroundColor: 'rgba(20,20,20,0.72)',
    borderRadius: RADIUS.section,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  sheetTitle: { color: '#fff', fontWeight: '700' },
  sheetSubtitle: { color: 'rgba(255,255,255,0.6)', marginTop: 2 },
});
