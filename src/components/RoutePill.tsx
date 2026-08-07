import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/SettingsContext';

// The pill sits inside a fixed-size transparent box centred on its anchor
// point, so it can be centred without first measuring it - the text inside
// changes width with the duration and with the Text Size setting. The box is
// `box-none`, so the empty space around the pill stays transparent to touch
// and the map underneath still pans normally.
//
// Sized to fit the widest pill the Extra Large text setting can produce
// ("1 hr 25 min"), and also used as the off-screen culling margin in
// RoutePillLayer.
export const PILL_FRAME = 130;

interface RoutePillProps {
  duration: string;
  distance: string;
  selected: boolean;
  /** Screen position the pill is centred on. */
  center: { x: number; y: number };
  onPress: () => void;
  accessibilityLabel: string;
}

export function RoutePill({
  duration,
  distance,
  selected,
  center,
  onPress,
  accessibilityLabel,
}: RoutePillProps) {
  const { T, F } = useTheme();

  const background = selected ? T.pillSelected : T.card;
  const foreground = selected ? '#fff' : T.text;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.frame,
        {
          left: center.x - PILL_FRAME / 2,
          top: center.y - PILL_FRAME / 2,
          // The chosen route's pill wins any overlap with an alternative's.
          zIndex: selected ? 2 : 1,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel}
        style={[styles.pill, { backgroundColor: background }]}
      >
        <Text style={[styles.duration, { color: foreground, fontSize: F.xs }]}>{duration}</Text>
        <Text style={[styles.distance, { color: foreground, fontSize: F.micro }]}>{distance}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    width: PILL_FRAME,
    height: PILL_FRAME,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
