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

// The contents of a route's map marker: its travel time over its distance.
//
// Just the pill, with no positioning of its own - it is rendered inside a
// `<Marker>`, so the map places it and the map handles the tap. It carries no
// `Pressable` for that reason: touches on a marker are dispatched natively and
// would not reach a JS-side press target inside it.
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
