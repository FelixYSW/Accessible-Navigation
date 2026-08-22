import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useSettings } from '../theme/SettingsContext';
import { OVERLAY_RED, RADIUS, SCREEN_MARGIN } from '../theme/tokens';

interface HazardIntroProps {
  visible: boolean;
  /** Set when the detector could not be loaded. The overlay says so instead of
   *  asking the user to point a camera at a model that will never answer. */
  error: string | null;
  onDismiss: () => void;
}

// The opening card on Hazard Detection: what the screen is for, dismissed by
// the user rather than by a timer.
//
// It replaces a permanent caption along the bottom of the screen. That caption
// had the problem every permanent instruction has - it is read once and then
// occupies the frame forever, on a screen whose entire purpose is showing the
// pavement. As an overlay it says the same thing more clearly, once, and then
// gets out of the way completely.
//
// Unlike the scan prompt on AR Navigation, this one waits to be closed. That
// prompt is reporting on something the app is doing and can therefore say when
// it is finished; this one is telling the user something, and only the reader
// knows when they have read it. There is nothing to auto-dismiss on.
//
// It returns on every visit to the tab rather than being dismissed for good.
// The screen stays mounted behind the others, so without that it would appear
// exactly once per launch - and the walker most likely to need the reminder is
// the one coming back to the tab after a while away.
export function HazardIntro({ visible, error, onDismiss }: HazardIntroProps) {
  const { T, F, scaled } = useSettings();

  if (!visible) return null;

  return (
    // Takes touches, unlike the scan prompt - it has a button in it, and the
    // button is the only way out.
    <View style={styles.scrim}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <AppIcon
            name="scan-eye"
            size={scaled(40)}
            color={error ? OVERLAY_RED : T.green}
          />
        </View>

        <Text style={[styles.title, { fontSize: F.h2 }]}>
          {error ? 'Detection unavailable' : 'Point your camera at the path ahead'}
        </Text>

        <Text style={[styles.body, { fontSize: F.sm }]}>
          {error ??
            'Hazards are flagged in real time as you walk — no route needed. Hold the phone so the pavement a few steps ahead fills the frame.'}
        </Text>

        <Pressable
          onPress={onDismiss}
          style={[styles.button, { backgroundColor: error ? 'rgba(255,255,255,0.14)' : T.green }]}
          accessibilityRole="button"
          accessibilityLabel={error ? 'Close' : 'Start scanning'}
        >
          <Text style={[styles.buttonText, { fontSize: F.sm }]}>
            {error ? 'Close' : 'Start scanning'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SCREEN_MARGIN,
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,20,0.94)',
    borderRadius: RADIUS.section,
    paddingVertical: 24,
    paddingHorizontal: 22,
  },
  icon: { alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  body: {
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  button: {
    marginTop: 20,
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: RADIUS.button,
    paddingVertical: 13,
    paddingHorizontal: 20,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
