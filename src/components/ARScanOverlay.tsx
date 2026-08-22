import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useSettings } from '../theme/SettingsContext';
import { RADIUS, SCREEN_MARGIN } from '../theme/tokens';

interface ARScanOverlayProps {
  /** False while the session is still looking for a surface. The overlay is
   *  shown for exactly as long as this is false. */
  ready: boolean;
  supported: boolean;
}

// Shown over the preview until ARKit has actually found a surface to put things
// on.
//
// It exists because the screen was lying by omission. It opened saying "tap the
// floor to place a path", and tapping did nothing for the first several seconds
// - not because the tap was missed but because there was no surface yet to
// raycast against. With no way to tell those apart, a dead tap reads as a broken
// feature rather than as a session that is not ready, and the natural response
// is to tap again rather than to do the one thing that actually helps, which is
// to move the phone.
//
// So it asks for that movement directly, and it goes away on the same test a tap
// runs - a raycast into the middle of the frame - rather than on a timer. A
// timer would be the same lie with an extra step: it would clear while the floor
// was still unfound on a blank wall or a dark room, and hang about pointlessly
// on a textured carpet that was ready immediately.
//
// Deliberately not blocking. Touches pass through, so a tap that arrives just as
// the surface is found still lands rather than being eaten by a panel that has
// not finished animating away.
export function ARScanOverlay({ ready, supported }: ARScanOverlayProps) {
  const { T, F, scaled } = useSettings();

  if (ready || !supported) return null;

  return (
    <View style={styles.scrim} pointerEvents="none">
      <View style={styles.card}>
        <View style={styles.icon}>
          <AppIcon name="scan-buildings" size={scaled(56)} color={T.green} />
        </View>

        <Text style={[styles.title, { fontSize: F.h2 }]}>Move your phone slowly</Text>

        <Text style={[styles.body, { fontSize: F.sm }]}>
          Point the camera at the floor a couple of metres ahead and move it from side to side.
          The guidance can be placed as soon as a surface is found.
        </Text>

        <ActivityIndicator color="#fff" style={styles.spinner} />
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
  spinner: { marginTop: 18 },
});
