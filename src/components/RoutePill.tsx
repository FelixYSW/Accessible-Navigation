import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Leaf } from 'lucide-react-native';
import Svg, { Polygon } from 'react-native-svg';
import { useTheme } from '../theme/SettingsContext';

// Distance from the pill's centre to the centre of its tail triangle, and the
// triangle's own footprint. Matches the design's 34px wrapper offset plus half
// the 8px triangle.
const TAIL_DISTANCE = 38;
const TAIL_WIDTH = 8;
const TAIL_HEIGHT = 14;

// The pill and its tail are laid out inside a fixed-size transparent box
// centred on the anchor point, rather than letting the tail overflow the
// pill's own bounds - Android clips views that spill outside their parent,
// which would drop the tail entirely. Sized to still fit the widest pill the
// Extra Large text setting can produce ("1 hr 25 min"); the box is
// `box-none`, so the empty space around the pill stays transparent to touch
// and the map underneath still pans normally.
const FRAME = 170;

interface RoutePillProps {
  duration: string;
  distance: string;
  selected: boolean;
  /** Screen position the pill is centred on. */
  center: { x: number; y: number };
  /** Direction, in degrees, from the pill toward the point on its own route
   *  curve that the tail should point at. 0 = right, 90 = down. */
  tailAngle: number;
  onPress: () => void;
  accessibilityLabel: string;
}

export function RoutePill({
  duration,
  distance,
  selected,
  center,
  tailAngle,
  onPress,
  accessibilityLabel,
}: RoutePillProps) {
  const { T, F } = useTheme();

  const background = selected ? T.pillSelected : T.card;
  const foreground = selected ? '#fff' : T.text;

  const radians = (tailAngle * Math.PI) / 180;
  const tailLeft = FRAME / 2 + TAIL_DISTANCE * Math.cos(radians) - TAIL_WIDTH / 2;
  const tailTop = FRAME / 2 + TAIL_DISTANCE * Math.sin(radians) - TAIL_HEIGHT / 2;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.frame, { left: center.x - FRAME / 2, top: center.y - FRAME / 2 }]}
    >
      {/* Drawn before the pill so the pill's shadow layers over the seam
          between the two, hiding the triangle's flat base. */}
      <View
        pointerEvents="none"
        style={[
          styles.tail,
          { left: tailLeft, top: tailTop, transform: [{ rotate: `${tailAngle}deg` }] },
        ]}
      >
        <Svg width={TAIL_WIDTH} height={TAIL_HEIGHT}>
          <Polygon
            points={`0,0 ${TAIL_WIDTH},${TAIL_HEIGHT / 2} 0,${TAIL_HEIGHT}`}
            fill={background}
          />
        </Svg>
      </View>

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel}
        style={[styles.pill, { backgroundColor: background }]}
      >
        <View style={styles.durationRow}>
          {selected && <Leaf size={Math.round(F.sm)} color={foreground} strokeWidth={2.4} />}
          <Text style={[styles.duration, { color: foreground, fontSize: F.sm }]}>{duration}</Text>
        </View>
        <Text style={[styles.distance, { color: foreground, fontSize: F.micro }]}>{distance}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    width: FRAME,
    height: FRAME,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tail: { position: 'absolute' },
  pill: {
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 74,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  duration: { fontWeight: '700' },
  distance: { fontWeight: '600', opacity: 0.85 },
});
