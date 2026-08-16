import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/SettingsContext';

interface RoutePillProps {
  duration: string;
  distance: string;
  selected: boolean;
  /** Reports the pill's rendered size, which the marker layer needs to keep
   *  pills from overlapping each other. */
  onMeasure: (size: { width: number; height: number }) => void;
}

// The contents of a route's pill: its travel time over its distance.
//
// Just the pill, with no positioning and no press handling of its own. Both
// belong to RoutePillOverlay, which projects it onto the map and wraps it in
// the `Pressable` that selects the route - keeping this component to the one
// job of looking right at whatever text size the user has chosen.
export function RoutePill({ duration, distance, selected, onMeasure }: RoutePillProps) {
  const { T, F } = useTheme();

  const background = selected ? T.pillSelected : T.card;
  const foreground = selected ? '#fff' : T.text;

  return (
    <View
      style={[styles.pill, { backgroundColor: background }]}
      onLayout={(e) => onMeasure(e.nativeEvent.layout)}
    >
      <Text style={[styles.duration, { color: foreground, fontSize: F.xs }]}>{duration}</Text>
      <Text style={[styles.distance, { color: foreground, fontSize: F.micro }]}>{distance}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 11,
    minWidth: 74,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  duration: { fontWeight: '700' },
  distance: { fontWeight: '600', marginTop: 1, opacity: 0.85 },
});
