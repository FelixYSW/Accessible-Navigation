import React from 'react';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useSettings } from '../theme/SettingsContext';

interface SegmentedFieldProps {
  values: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  accessibilityLabel: string;
}

// The app's multiple-choice settings (Text Size, Mobility aid) rendered as a
// real UIKit `UISegmentedControl` rather than a row of custom Pressables.
//
// That is what gets the platform behaviour the design asks for on iOS 26: the
// Liquid Glass selection capsule, the press-and-hold lift, and dragging the
// selection continuously across segments instead of having to lift and tap.
// None of that is reimplementable in JS, so the control is used bare -
// deliberately no `tintColor` or `backgroundColor`, because setting either
// replaces the system's glass material with a flat fill.
export function SegmentedField({
  values,
  selectedIndex,
  onChange,
  accessibilityLabel,
}: SegmentedFieldProps) {
  const { F, darkMode } = useSettings();

  return (
    <SegmentedControl
      values={values}
      selectedIndex={selectedIndex}
      onChange={(event) => onChange(event.nativeEvent.selectedSegmentIndex)}
      // Dark Mode is an in-app preference that can disagree with the OS
      // theme, so the native control is told which appearance to use instead
      // of being left to follow the system.
      appearance={darkMode ? 'dark' : 'light'}
      // Only the size is overridden; leaving the colours to the system is
      // what keeps the selected segment's material intact.
      fontStyle={{ fontSize: F.sm }}
      activeFontStyle={{ fontSize: F.sm, fontWeight: '600' }}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
