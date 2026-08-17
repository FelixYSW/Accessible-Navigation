import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

// Short enough to feel like a response to the tap rather than a thing to wait
// for. Anything past about 200ms on a control this small starts to read as lag.
const TOGGLE_DURATION_MS = 160;

// A 0-to-1 value that follows a boolean, for animating a switch.
//
// Returned as an Animated.Value rather than as a number so every consumer can
// drive it natively. That matters more here than on most screens: these
// switches sit over AR Navigation, whose JS thread is already handling device
// motion at 20Hz and a fresh set of projected anchors every frame. A
// JS-driven animation would be competing with exactly that, and would stutter
// precisely when the screen is busiest.
//
// Native driving is why nothing here interpolates a colour: `backgroundColor`
// cannot be driven natively, so a switch that changes colour has to crossfade
// two layers on `opacity` instead. Callers do that; this only supplies the
// value.
export function useToggleProgress(on: boolean): Animated.Value {
  const progress = useRef(new Animated.Value(on ? 1 : 0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    Animated.timing(progress, {
      toValue: on ? 1 : 0,
      // Reduce Motion turns the slide into a cut rather than removing the
      // state change. Someone who has asked the system for less movement has
      // asked for less movement everywhere, and an app whose whole subject is
      // accessibility settings is the last place to make an exception.
      duration: reduceMotion ? 0 : TOGGLE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [on, progress, reduceMotion]);

  return progress;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
