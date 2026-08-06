import React from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme/SettingsContext';

// Track/knob geometry for the two toggle sizes in the design: 50x30 with a
// 24px knob for section-level switches (Dark Mode, Voice Guidance) and 44x26
// with a 22px knob for the denser hazard-type rows.
const SIZES = {
  large: { width: 50, height: 30, knob: 24, inset: 3 },
  small: { width: 44, height: 26, knob: 22, inset: 2 },
} as const;

interface ToggleProps {
  value: boolean;
  /** Not needed (and never called) when `disablePress` is set - the
   *  surrounding row owns the interaction in that case. */
  onValueChange?: (value: boolean) => void;
  size?: keyof typeof SIZES;
  /** Spoken/announced name for the control, since the switch itself is unlabelled. */
  accessibilityLabel: string;
  /** Set when the row around the toggle is the pressable. The toggle then
   *  renders as pure decoration - it must neither capture the touch nor be
   *  announced, or the row would be read out twice as two switches. */
  disablePress?: boolean;
}

export function Toggle({
  value,
  onValueChange,
  size = 'large',
  accessibilityLabel,
  disablePress,
}: ToggleProps) {
  const { T } = useTheme();
  const { width, height, knob, inset } = SIZES[size];

  const track = (
    <View
      style={{
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: value ? T.green : T.trackOff,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: value ? width - knob - inset : inset,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: '#fff',
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          elevation: 2,
        }}
      />
    </View>
  );

  if (disablePress) {
    return (
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {track}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onValueChange?.(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      {track}
    </Pressable>
  );
}
