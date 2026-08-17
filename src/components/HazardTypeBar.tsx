import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react-native';
import { HAZARD_ICONS } from './hazardIcons';
import { useSettings } from '../theme/SettingsContext';
import { HAZARD_COLORS, OVERLAY_GREEN, OVERLAY_RED, RADIUS } from '../theme/tokens';
import { HAZARD_CLASSES, HAZARD_COMPACT_LABELS, HAZARD_SETTING_LABELS } from '../types/hazard';

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
// has learned that the yellow waves mean tactile paving should not have to
// learn a second vocabulary on the screen where it matters most.
//
// Both states write to the same persisted preferences the Settings rows do, so
// a type silenced here stays silenced when they come back, and the two screens
// can never disagree about what is being detected.
export function HazardTypeBar() {
  const { T, F, scaled, hazardActive, toggleHazard, setAllHazards } = useSettings();
  const [open, setOpen] = useState(false);

  // "On" when anything at all is being flagged, rather than only when all four
  // are. A master switch on a screen that is actively detecting should report
  // whether detection is happening, and with three of four types on the honest
  // answer is yes. Flipping it off silences everything; flipping it back on
  // restores all four rather than the previous selection, which is the one
  // thing this cannot do without remembering a set the user cannot see.
  const anyOn = HAZARD_CLASSES.some((hazardClass) => hazardActive[hazardClass]);

  const switchColors = {
    trackColor: { false: 'rgba(255,255,255,0.22)', true: T.green },
    ios_backgroundColor: 'rgba(255,255,255,0.22)',
  };

  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    // alignItems: stretch is what makes the panel and the header the same
    // width: the column takes the width of its widest child, and both then fill
    // it. The header therefore widens when opened rather than the panel hanging
    // off its edge.
    <View style={styles.column}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={[styles.header, open && styles.headerOpen]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide hazard types' : 'Show hazard types'}
      >
        <TriangleAlert
          size={scaled(15)}
          color={anyOn ? OVERLAY_GREEN : OVERLAY_RED}
          strokeWidth={2.4}
        />
        <Text style={[styles.headerLabel, { fontSize: F.micro }]} numberOfLines={1}>
          Hazard types
        </Text>
        <Switch
          value={anyOn}
          onValueChange={setAllHazards}
          accessibilityLabel="All hazard types"
          {...switchColors}
        />
        <Chevron size={scaled(14)} color="rgba(255,255,255,0.7)" strokeWidth={2.4} />
      </Pressable>

      {open && (
        <View style={styles.panel}>
          {HAZARD_CLASSES.map((hazardClass) => {
            const Icon = HAZARD_ICONS[hazardClass];
            return (
              <View key={hazardClass} style={styles.row}>
                <Icon
                  size={scaled(15)}
                  color={HAZARD_COLORS[hazardClass]}
                  strokeWidth={2.4}
                />
                <Text style={[styles.rowLabel, { fontSize: F.micro }]} numberOfLines={1}>
                  {HAZARD_COMPACT_LABELS[hazardClass]}
                </Text>
                <Switch
                  value={hazardActive[hazardClass]}
                  onValueChange={() => toggleHazard(hazardClass)}
                  // The full Settings label, not the compact one on screen -
                  // "Slippery" alone is not a hazard, and a screen reader has
                  // no width limit to work around.
                  accessibilityLabel={HAZARD_SETTING_LABELS[hazardClass]}
                  {...switchColors}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    alignItems: 'stretch',
    gap: 6,
    // Only as wide as it needs to be, so the sound bar keeps the other end of
    // the row.
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 19,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  // Squared off at the bottom when the panel is under it, so the two read as
  // one control rather than as a pill with a card beneath it.
  headerOpen: { borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  headerLabel: { color: '#fff', fontWeight: '600', flexShrink: 1 },
  panel: {
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderRadius: RADIUS.card,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  rowLabel: { color: '#fff', fontWeight: '600', flex: 1 },
});
