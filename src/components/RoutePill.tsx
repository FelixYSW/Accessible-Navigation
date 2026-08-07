import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import type { LatLng } from '../types/route';
import { useSettings } from '../theme/SettingsContext';
import { FONT_SCALES } from '../theme/tokens';

// react-native-maps draws a custom marker child by snapshotting the React
// Native view into a native marker image. It has to be told to keep
// re-snapshotting while the view is still settling, or it captures an empty
// frame and the marker shows up blank - but leaving it on permanently
// re-snapshots continuously, which is exactly the cost the native marker is
// here to avoid. So it snapshots for a moment after anything visible changes,
// then stops.
const SNAPSHOT_WINDOW_MS = 600;

// The pill is given explicit dimensions rather than being sized by its text:
// a view sized purely by intrinsic content can measure 0x0 at snapshot time
// on iOS, which is the other way this renders blank. Scaled by the Text Size
// setting so the label doesn't outgrow its box at Extra Large.
const BASE_PILL_SIZE = { width: 96, height: 46 };

interface RoutePillProps {
  /** The point on the route the pill is centred on. */
  coordinate: LatLng;
  duration: string;
  distance: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

// A route's time/distance badge, rendered as a real map marker so the map
// itself keeps it glued to its coordinate. The previous version was a plain
// view layered over the map and positioned in JS from `onRegionChange`, which
// meant it always trailed the map by a frame or two while panning and drifted
// off its line entirely once the camera was rotated or tilted - the
// projection had no way to know about either.
export function RoutePill({
  coordinate,
  duration,
  distance,
  selected,
  onPress,
  accessibilityLabel,
}: RoutePillProps) {
  const { T, F, fontScale, darkMode } = useSettings();

  const scale = FONT_SCALES[fontScale];
  const size = {
    width: Math.round(BASE_PILL_SIZE.width * scale),
    height: Math.round(BASE_PILL_SIZE.height * scale),
  };

  const background = selected ? T.pillSelected : T.card;
  const foreground = selected ? '#fff' : T.text;

  const tracksViewChanges = useSnapshotWindow(
    `${duration}|${distance}|${selected}|${darkMode}|${fontScale}`,
  );

  return (
    <Marker
      coordinate={coordinate}
      // Centre the pill on the point, matching how it was positioned before.
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
      // The chosen route's pill wins any overlap with an alternative's.
      zIndex={selected ? 2 : 1}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[styles.pill, size, { backgroundColor: background }]}>
        <Text
          style={[styles.duration, { color: foreground, fontSize: F.xs }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {duration}
        </Text>
        <Text
          style={[styles.distance, { color: foreground, fontSize: F.micro }]}
          numberOfLines={1}
        >
          {distance}
        </Text>
      </View>
    </Marker>
  );
}

// True for a short window after `signature` changes, so the marker re-snapshots
// while the new content lays out and then settles into a static image.
function useSnapshotWindow(signature: string): boolean {
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    setTracking(true);
    const timeout = setTimeout(() => setTracking(false), SNAPSHOT_WINDOW_MS);
    return () => clearTimeout(timeout);
  }, [signature]);

  return tracking;
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  duration: { fontWeight: '700' },
  distance: { fontWeight: '600', marginTop: 1, opacity: 0.85 },
});
