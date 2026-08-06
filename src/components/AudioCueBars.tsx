import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// The design's `waveBar` keyframe: each bar scales between 0.4x and full
// height over 0.9s, the three offset by 0.2s so they read as a waveform
// rather than a single blinking block.
const BAR_HEIGHT = 14;
const BAR_WIDTH = 3;
const CYCLE_MS = 900;
const STAGGER_MS = 200;
const MIN_SCALE = 0.4;

export function AudioCueBars({ color }: { color: string }) {
  return (
    <View style={styles.row}>
      {[0, 1, 2].map((index) => (
        <WaveBar key={index} color={color} delay={index * STAGGER_MS} />
      ))}
    </View>
  );
}

function WaveBar({ color, delay }: { color: string; delay: number }) {
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
    const timeout = setTimeout(() => animation.start(), delay);
    return () => {
      clearTimeout(timeout);
      animation.stop();
    };
  }, [progress, delay]);

  const scaleY = progress.interpolate({ inputRange: [0, 1], outputRange: [MIN_SCALE, 1] });

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          backgroundColor: color,
          transform: [
            // scaleY pivots on the bar's centre, so the bar is pushed back
            // down by half the height it lost - anchoring it to the baseline
            // the way CSS `align-items: end` does in the design.
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [(BAR_HEIGHT * (1 - MIN_SCALE)) / 2, 0],
              }),
            },
            { scaleY },
          ],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: BAR_HEIGHT },
  bar: { width: BAR_WIDTH, height: BAR_HEIGHT, borderRadius: 2 },
});
