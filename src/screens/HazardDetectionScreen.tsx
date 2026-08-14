import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { HazardCameraView, isARGeospatialSupported } from '../../modules/ar-geospatial';
import { CameraStage } from '../components/CameraStage';
import { HazardOverlay } from '../components/HazardOverlay';
import { PulsingDot } from '../components/PulsingDot';
import { VoiceCuePill } from '../components/VoiceCuePill';
import { useSettings } from '../theme/SettingsContext';
import { HAZARD_COLORS, RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { HAZARD_CLASSES } from '../types/hazard';
import { useHazardDetections } from '../services/hazardDetector';

// Standalone hazard scanning: the same detection treatment as AR Navigation,
// but with no route required - the third tab in the redesign.
export function HazardDetectionScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { F, scaled, hazardActive } = useSettings();

  const activeClasses = useMemo(
    () => HAZARD_CLASSES.filter((hazardClass) => hazardActive[hazardClass]),
    [hazardActive],
  );

  // Only run the camera and the detector while this tab is on screen, so
  // switching to Navigate or Settings releases the camera instead of holding
  // it open in the background.
  const { detections, error, onHazards } = useHazardDetections(isFocused, activeClasses);

  // The camera that also runs the model. Same detector as AR Navigation, minus
  // the AR session that screen needs and this one does not.
  const surface = isARGeospatialSupported ? (
    <HazardCameraView
      style={StyleSheet.absoluteFill}
      isActive={isFocused}
      onHazards={onHazards}
    />
  ) : undefined;

  return (
    <CameraStage isActive={isFocused} surface={surface}>
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
          {error ? 'Detection unavailable' : 'Point your camera at the path ahead'}
        </Text>
        {/* A model that failed to load says so. Without this the screen looks
            identical to one pointed at a perfectly clear pavement, and the
            difference between "nothing here" and "nothing will ever be found"
            is the whole diagnosis. */}
        <Text style={[styles.sheetSubtitle, { fontSize: F.tinySm }]}>
          {error ?? 'Hazards are flagged in real time, no route needed'}
        </Text>
      </View>
    </CameraStage>
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
