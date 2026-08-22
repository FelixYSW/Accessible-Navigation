import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useSettings } from '../theme/SettingsContext';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';

// Shown while the AR session works out where on Earth it is, and taken away the
// moment it knows.
//
// It exists because the one thing that speeds localisation up is something only
// the user can do - point the camera at buildings - and nothing about a camera
// preview suggests that. Live View asks the same thing for the same reason.
//
// Deliberately not a blocking modal. The user has to see through it to aim the
// phone, so it dims rather than covers, and it never takes touches: the route
// controls underneath stay live throughout.
//
// Static, with no animation on the icon. A pulsing ring reads as the app doing
// something, when in fact the app is waiting on the user to do something - and
// the progress bar below already reports the only thing that is actually
// changing.

// The accuracy readout is drawn as a bar between these. 30m is roughly a raw
// GPS fix with no visual localisation at all; 5m is close enough that the
// anchors are about to be trusted, so the bar fills as scanning works.
const SCANNING_ACCURACY_M = 30;
const LOCALISED_ACCURACY_M = 5;

interface ScanPromptProps {
  visible: boolean;
  /** Whether Google has Street View coverage here. When it does not, scanning
   *  cannot help, and saying so is more useful than asking the user to keep
   *  waving their phone at a hedge. */
  vpsAvailability: 'available' | 'unavailable' | 'unknown' | undefined;
  horizontalAccuracy: number | undefined;
  tracking: boolean | undefined;
}

export function ScanPrompt({
  visible,
  vpsAvailability,
  horizontalAccuracy,
  tracking,
}: ScanPromptProps) {
  const { T, F, scaled } = useSettings();

  if (!visible) return null;

  const hopeless = vpsAvailability === 'unavailable';
  const measured = tracking === true && (horizontalAccuracy ?? 0) > 0;
  const progress = measured
    ? Math.min(
        1,
        Math.max(
          0,
          (SCANNING_ACCURACY_M - horizontalAccuracy!) /
            (SCANNING_ACCURACY_M - LOCALISED_ACCURACY_M),
        ),
      )
    : 0;

  return (
    <View style={styles.scrim} pointerEvents="none">
      <View style={styles.card}>
        <View style={styles.icon}>
          <AppIcon
            name="scan-buildings"
            size={scaled(40)}
            color={hopeless ? 'rgba(255,255,255,0.7)' : T.green}
          />
        </View>

        <Text style={[styles.title, { fontSize: F.h2 }]}>
          {hopeless ? 'No visual coverage here' : 'Scan your surroundings'}
        </Text>

        <Text style={[styles.body, { fontSize: F.sm }]}>
          {hopeless
            ? 'Street imagery does not reach this spot, so the arrows are following your compass instead. They will still guide you, but may sit a little off the path.'
            : 'Point your phone at the buildings around you. The arrows appear once it recognises where you are.'}
        </Text>

        {!hopeless && (
          <>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { backgroundColor: T.green, width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
            <Text style={[styles.readout, { fontSize: F.tinySm }]}>
              {measured
                ? `Accuracy ±${horizontalAccuracy!.toFixed(0)} m — keep scanning`
                : 'Locating…'}
            </Text>
          </>
        )}
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
    // Light enough to aim the camera through. The user cannot follow the
    // instruction if the instruction hides what they are meant to point at.
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SCREEN_MARGIN,
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,20,0.92)',
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
  track: {
    alignSelf: 'stretch',
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
    marginTop: 18,
  },
  fill: { height: '100%', borderRadius: 3 },
  readout: { color: 'rgba(255,255,255,0.6)', marginTop: 8 },
});
