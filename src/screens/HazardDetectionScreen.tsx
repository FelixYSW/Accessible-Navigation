import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { CameraStage } from '../components/CameraStage';
import { HazardOverlay } from '../components/HazardOverlay';
import { PulsingDot } from '../components/PulsingDot';
import { useSettings } from '../theme/SettingsContext';
import { HAZARD_COLORS, RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { HAZARD_CLASSES, HAZARD_LABELS, type HazardClass } from '../types/hazard';
import { useStubHazardDetector } from '../services/hazardDetector';

// Standalone hazard scanning: the same detection treatment as AR Navigation,
// but with no route required - the third tab in the redesign.
export function HazardDetectionScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { T, F, hazardActive } = useSettings();

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

      <View style={[styles.scanPill, { top: insets.top + 4 }]}>
        <PulsingDot color={HAZARD_COLORS.pothole} />
        <Text style={[styles.scanPillText, { fontSize: F.xs }]}>Scanning for hazards</Text>
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

        {/* Legend, so the colour coding on the boxes above is readable
            without opening Settings. */}
        <View style={styles.legend}>
          {HAZARD_CLASSES.map((hazardClass) => (
            <LegendEntry key={hazardClass} hazardClass={hazardClass} fontSize={F.tiny} />
          ))}
        </View>
      </View>
    </CameraStage>
  );
}

function LegendEntry({ hazardClass, fontSize }: { hazardClass: HazardClass; fontSize: number }) {
  return (
    <View style={styles.legendEntry}>
      <View style={[styles.legendDot, { backgroundColor: HAZARD_COLORS[hazardClass] }]} />
      <Text style={[styles.legendLabel, { fontSize }]}>{HAZARD_LABELS[hazardClass]}</Text>
    </View>
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
  scanPill: {
    position: 'absolute',
    alignSelf: 'center',
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
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  legendEntry: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
});
