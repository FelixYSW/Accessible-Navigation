import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { HAZARD_ICONS } from './hazardIcons';
import { useToggleProgress } from './useToggleProgress';
import { useSettings } from '../theme/SettingsContext';
import { HAZARD_COLORS, OVERLAY_PILL_HEIGHT } from '../theme/tokens';
import { HAZARD_CLASSES, HAZARD_COMPACT_LABELS, HAZARD_SETTING_LABELS } from '../types/hazard';

// The pill's own corner radius, and the one the panel picks up along its bottom
// edge when open, so the two ends of the expanded control match.
const PILL_RADIUS = 19;

// Which hazard types are being flagged, changeable without leaving the camera.
//
// Collapsed it is a master switch: one tap silences every hazard type, which is
// the thing a walker actually wants in the moment - crossing a building site
// where every second frame is an obstruction, or on a stretch of road where wet
// tarmac is being called slippery over and over. Expanded it becomes the four
// individual switches, for the slower decision of which types are worth seeing
// at all.
//
// The icons and colours are the ones from Settings, deliberately. A walker who
// has learned that the yellow waves mean an uneven surface should not have to
// learn a second vocabulary on the screen where it matters most.
//
// Both states write to the same persisted preferences the Settings rows do, so
// a type silenced here stays silenced when they come back, and the two screens
// can never disagree about what is being detected.
export function HazardTypeBar() {
  const { F, scaled, hazardActive, toggleHazard, setAllHazards } = useSettings();
  const [open, setOpen] = useState(false);

  // "On" when anything at all is being flagged, rather than only when all four
  // are. A master switch on a screen that is actively detecting should report
  // whether detection is happening, and with three of four types on the honest
  // answer is yes. Flipping it off silences everything; flipping it back on
  // restores all four rather than the previous selection, which is the one
  // thing this cannot do without remembering a set the user cannot see.
  const anyOn = HAZARD_CLASSES.some((hazardClass) => hazardActive[hazardClass]);

  // Up when closed, down when open: the chevron points the way the panel will
  // move, not the way it already sits.
  const chevron = open ? 'chevron-down' : 'chevron-up';

  return (
    // alignItems: stretch is what makes the panel and the header the same
    // width: the column takes the width of its widest child, and both then fill
    // it. No gap - open, the header and the panel are one shape.
    <View style={styles.column}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={[
          styles.header,
          { minHeight: scaled(OVERLAY_PILL_HEIGHT) },
          open && styles.headerOpen,
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide hazard types' : 'Show hazard types'}
      >
        <Text style={[styles.headerLabel, { fontSize: F.micro }]} numberOfLines={1}>
          Hazard types
        </Text>
        <MiniSwitch value={anyOn} onChange={setAllHazards} label="All hazard types" />
        <AppIcon name={chevron} size={scaled(14)} color="rgba(255,255,255,0.7)" />
      </Pressable>

      {open && (
        <View style={styles.panel}>
          {HAZARD_CLASSES.map((hazardClass) => {
            const icon = HAZARD_ICONS[hazardClass];
            return (
              <View key={hazardClass} style={styles.row}>
                <AppIcon name={icon} size={scaled(15)} color={HAZARD_COLORS[hazardClass]} />
                <Text style={[styles.rowLabel, { fontSize: F.micro }]} numberOfLines={1}>
                  {HAZARD_COMPACT_LABELS[hazardClass]}
                </Text>
                <MiniSwitch
                  value={hazardActive[hazardClass]}
                  onChange={() => toggleHazard(hazardClass)}
                  // The full Settings label, not the compact one on screen -
                  // "Slippery" alone is not a hazard, and a screen reader has
                  // no width limit to work around.
                  label={HAZARD_SETTING_LABELS[hazardClass]}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// A switch sized for a camera overlay.
//
// Not React Native's `Switch`, which is a fixed 51x31pt and cannot be made
// smaller - a transform would shrink how it looks without shrinking the space
// it takes, and the pill has to match the sound bar's height beside it. This is
// the same control at the size the row can hold.
//
// The touch target is grown back out with `hitSlop` rather than by drawing
// something bigger, so a small switch is still a comfortable thing to hit while
// walking.
//
// The thumb slides and the track crossfades, both driven natively - see
// `useToggleProgress` for why that is not optional on the AR screen. The
// crossfade is two stacked layers rather than an interpolated colour because
// `backgroundColor` cannot be driven off the JS thread.
function MiniSwitch({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  const { T, scaled } = useSettings();
  const progress = useToggleProgress(value);

  const height = scaled(20);
  const width = scaled(34);
  const thumb = scaled(14);
  const padding = 3;

  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      hitSlop={10}
      style={{
        height,
        width,
        borderRadius: height / 2,
        padding,
        justifyContent: 'center',
        // The off colour, sitting under the on colour below.
        backgroundColor: 'rgba(255,255,255,0.25)',
      }}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: height / 2, backgroundColor: T.green, opacity: progress },
        ]}
      />
      <Animated.View
        style={{
          height: thumb,
          width: thumb,
          borderRadius: thumb / 2,
          backgroundColor: '#fff',
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, width - padding * 2 - thumb],
              }),
            },
          ],
        }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'stretch',
    // Only as wide as it needs to be, so the sound bar keeps the other end of
    // the row.
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: PILL_RADIUS,
    paddingVertical: 4,
    paddingHorizontal: 14,
  },
  // Square along the bottom while the panel is under it, so the two are one
  // continuous shape rather than a pill with a card parked beneath it.
  headerOpen: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  panel: {
    // The same fill as the header, for the same reason.
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderBottomLeftRadius: PILL_RADIUS,
    borderBottomRightRadius: PILL_RADIUS,
    paddingBottom: 8,
    paddingHorizontal: 14,
    // The one seam left between them: a hairline, so the master switch reads as
    // governing the rows rather than as the first of them.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  rowLabel: { color: '#fff', fontWeight: '600', flex: 1 },
  headerLabel: { color: '#fff', fontWeight: '600', flexShrink: 1 },
});
