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
// Advance width per character, as a fraction of the font size, for the system
// font. A flat average across all characters is far too pessimistic on these
// labels - "Wheelchair" is mostly narrow lowercase - and pessimism here is not
// free: it shrinks the label, which is how the Text Size setting ended up
// having no visible effect on this control at all. So the estimate is made per
// character instead, from SF Pro Text's advance widths.
const GLYPH_WIDTHS: { pattern: RegExp; em: number }[] = [
  { pattern: /[ijltfrI.,:;'\s]/, em: 0.3 },
  { pattern: /[mwMW]/, em: 0.85 },
  { pattern: /[A-Z0-9]/, em: 0.62 },
];
const DEFAULT_GLYPH_EM = 0.52;

// Multiplied onto the estimate above. Covers the difference between the real
// font metrics and this approximation of them, and the extra width the
// selected segment picks up from being semibold - guessing a little high only
// costs a slightly smaller label, while guessing low brings back the
// truncation this exists to prevent.
const WIDTH_SAFETY_MARGIN = 1.1;

// Horizontal padding UIKit keeps inside each segment, plus the separator.
const SEGMENT_INNER_PADDING = 12;

// Never shrink past this, however long the labels get - a label small enough
// to be unreadable is no better than a truncated one.
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

// The largest size at or below `preferred` that still fits the widest label in
// one segment. Falls back to the floor until the control has been measured, so
// the first frame is undersized rather than truncated.
function fittedFontSize(values: string[], width: number, preferred: number): number {
  if (width === 0 || values.length === 0) return MIN_FONT_SIZE;

  // Widest by rendered width, not by character count: "Wheelchair" is longer
  // than "Extra Large" in characters and narrower on screen.
  const widest = values.reduce((a, b) => (labelWidthEm(b) > labelWidthEm(a) ? b : a));
  const usable = width / values.length - SEGMENT_INNER_PADDING;
  const fitted = usable / labelWidthEm(widest);

  return Math.max(MIN_FONT_SIZE, Math.min(preferred, Math.floor(fitted * 10) / 10));
}

// A label's width in em, so multiplying by a font size gives points.
function labelWidthEm(label: string): number {
  let em = 0;
  for (const character of label) {
    em += GLYPH_WIDTHS.find((entry) => entry.pattern.test(character))?.em ?? DEFAULT_GLYPH_EM;
  }
  return em * WIDTH_SAFETY_MARGIN;
}
