import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

// The design's `pulseDot` keyframe: opacity 1 -> 0.5 and scale 1 -> 0.85 at
// the midpoint of a 1.1s cycle, then back. A single driver value runs both
// properties so they stay in phase.
const CYCLE_MS = 1100;

export function PulsingDot({ color, size = 8 }: { color: string; size?: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: CYCLE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: CYCLE_MS / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }),
        transform: [
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }) },
        ],
      }}
    />
  );
}
