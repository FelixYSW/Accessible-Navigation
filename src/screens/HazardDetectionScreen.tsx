import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { HazardCameraView, isARGeospatialSupported } from '../../modules/ar-geospatial';
import { CameraStage } from '../components/CameraStage';
import { HazardOverlay } from '../components/HazardOverlay';
import { HazardIntro } from '../components/HazardIntro';
import { VoiceCueBar } from '../components/VoiceCueBar';
import { useSettings } from '../theme/SettingsContext';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';
import { HAZARD_CLASSES } from '../types/hazard';
import { useHazardDetections } from '../services/hazardDetector';
import { useSpokenHazardCues } from '../services/voiceCues';

// Standalone hazard scanning: the same detection treatment as AR Navigation,
// but with no route required - the third tab in the redesign.
export function HazardDetectionScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { F, hazardActive, hazardCues } = useSettings();

  const activeClasses = useMemo(
    () => HAZARD_CLASSES.filter((hazardClass) => hazardActive[hazardClass]),
    [hazardActive],
  );

  // Only run the camera and the detector while this tab is on screen, so
  // switching to Navigate or Settings releases the camera instead of holding
  // it open in the background.
  const { detections, error, onHazards } = useHazardDetections(isFocused, activeClasses);

  // Silenced when the tab is not on screen, as well as by the preference: this
  // screen stays mounted behind the others, and a backgrounded camera calling
  // out potholes would be baffling.
  useSpokenHazardCues(hazardCues && isFocused, detections);

  // The intro card, back on every visit to the tab.
  //
  // Keyed on focus rather than on mount for the same reason the detector is:
  // this screen is never unmounted, only navigated away from, so a mount-time
  // state would show the card once per launch and never again.
  const [introVisible, setIntroVisible] = useState(true);
  useEffect(() => {
    if (isFocused) setIntroVisible(true);
  }, [isFocused]);

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
        {/* Only the hazard half here: there is no route on this screen, so
            there are no turns to speak. Spoken turn cues stay whatever the
            user last set them to. */}
        <VoiceCueBar cues={['hazards']} />
      </View>

      {/* Kept after the intro is dismissed, and only on failure.

          A model that failed to load has to keep saying so: without it the
          screen looks identical to one pointed at a perfectly clear pavement,
          and the difference between "nothing here" and "nothing will ever be
          found" is the whole diagnosis. The intro card says it too, but the
          error can arrive after that has been dismissed - and a condition that
          persists cannot be reported only by something that does not.

          No bottom safe-area padding: this is a tab screen, and the tab bar
          below it already covers the home indicator. */}
      {error && (
        <View style={styles.sheet}>
          <Text style={[styles.sheetTitle, { fontSize: F.body }]}>Detection unavailable</Text>
          <Text style={[styles.sheetSubtitle, { fontSize: F.tinySm }]}>{error}</Text>
        </View>
      )}

      <HazardIntro
        visible={introVisible}
        error={error ?? null}
        onDismiss={() => setIntroVisible(false)}
      />
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
    // flex-end, not space-between. With the scanning pill gone this row has a
    // single child, and space-between packs a lone item against the *start* -
    // which would have quietly parked the sound bar on the left.
    justifyContent: 'flex-end',
    gap: 8,
  },
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
