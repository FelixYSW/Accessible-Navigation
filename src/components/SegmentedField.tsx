import React, { useState } from 'react';
import { View } from 'react-native';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import { useSettings } from '../theme/SettingsContext';

// UISegmentedControl gives every segment an equal share of the width and
// truncates any label that doesn't fit ("Wheelchair" becomes "Wheelc..."),
// with no wrapping and no way to ask it to size segments by content - the
// underlying `apportionsSegmentWidthsByContent` isn't exposed by the JS
// bridge. So the label size is fitted to the space instead.
//
// Width per glyph as a fraction of the font size. Mixed-case SF Pro averages
// nearer 0.48em per character across these labels; the headroom is deliberate,
// since guessing high only costs a slightly smaller label while guessing low
// brings back the truncation this exists to prevent.
const GLYPH_WIDTH_RATIO = 0.58;

// Horizontal padding UIKit keeps inside each segment, plus the separator.
const SEGMENT_INNER_PADDING = 12;

// Never shrink past this, however long the labels get - a label small enough
// to be unreadable is no better than a truncated one. Reached only at the
// Extra Large text size on the four-segment control.
const MIN_FONT_SIZE = 11;

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
  const [width, setWidth] = useState(0);

  const fontSize = fittedFontSize(values, width, F.sm);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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
        fontStyle={{ fontSize }}
        activeFontStyle={{ fontSize, fontWeight: '600' }}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

// The largest size at or below `preferred` that still fits the longest label
// in one segment. Falls back to the floor until the control has been measured,
// so the first frame is undersized rather than truncated.
function fittedFontSize(values: string[], width: number, preferred: number): number {
  if (width === 0 || values.length === 0) return MIN_FONT_SIZE;

  const longest = values.reduce((a, b) => (b.length > a.length ? b : a));
  const usable = width / values.length - SEGMENT_INNER_PADDING;
  const fitted = usable / (longest.length * GLYPH_WIDTH_RATIO);

  return Math.max(MIN_FONT_SIZE, Math.min(preferred, Math.floor(fitted * 10) / 10));
}
