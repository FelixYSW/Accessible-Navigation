import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Rabbit, Turtle } from 'lucide-react-native';
import { SegmentedField } from '../components/SegmentedField';
import { HAZARD_ICONS } from '../components/hazardIcons';
import { useSettings } from '../theme/SettingsContext';
import {
  MOBILITY_AIDS,
  MOBILITY_AID_DESCRIPTIONS,
  MOBILITY_AID_LABELS,
} from '../services/mobility';
import { HAZARD_COLORS, RADIUS, SCREEN_MARGIN, type FontScaleKey } from '../theme/tokens';
import { HAZARD_CLASSES, HAZARD_SETTING_LABELS } from '../types/hazard';

// The dotted run between the hare and the tortoise. Spread across whatever
// width is left between them, so it stretches with the card rather than
// needing a count per screen size.
const PACE_DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const TEXT_SIZES: { key: FontScaleKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'large', label: 'Large' },
  { key: 'xl', label: 'Extra Large' },
];

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const {
    T,
    F,
    scaled,
    fontScale,
    darkMode,
    spokenTurns,
    hazardCues,
    mobilityAid,
    hazardActive,
    setFontScale,
    setDarkMode,
    setSpokenTurns,
    setHazardCues,
    setMobilityAid,
    toggleHazard,
  } = useSettings();

  // Shared across every switch on the screen, so the app's green reads the
  // same on all of them rather than each row picking its own.
  const switchColors = {
    trackColor: { false: T.trackOff, true: T.green },
    ios_backgroundColor: T.trackOff,
  };

  return (
    <ScrollView
      style={{ backgroundColor: T.pageBg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 20 }}
    >
      <Text style={[styles.title, { color: T.text, fontSize: F.h1 }]}>Settings</Text>

      <SectionLabel>Display</SectionLabel>
      <View style={[styles.sectionCard, { backgroundColor: T.card }]}>
        <View style={[styles.row, styles.rowDivided, { borderBottomColor: T.sep }]}>
          <Text style={[styles.rowTitle, { color: T.text, fontSize: F.body, marginBottom: 10 }]}>
            Text Size
          </Text>
          <SegmentedField
            values={TEXT_SIZES.map((option) => option.label)}
            selectedIndex={TEXT_SIZES.findIndex((option) => option.key === fontScale)}
            onChange={(index) => setFontScale(TEXT_SIZES[index].key)}
            accessibilityLabel="Text Size"
          />
        </View>

        <View style={[styles.row, styles.rowInline]}>
          <Text style={[styles.rowTitle, { color: T.text, fontSize: F.body }]}>Dark Mode</Text>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            accessibilityLabel="Dark Mode"
            {...switchColors}
          />
        </View>
      </View>

      {/* Two switches rather than one: a user who knows the way but not the
          pavement wants hazard warnings without turn-by-turn chatter, and a
          user on an unfamiliar route in a quiet place wants the reverse. */}
      <SectionLabel>Voice guidance</SectionLabel>
      <View style={[styles.sectionCard, { backgroundColor: T.card }]}>
        <View style={[styles.row, styles.rowInline, styles.rowDivided, { borderBottomColor: T.sep }]}>
          <View style={styles.rowTextBlock}>
            <Text style={[styles.rowTitle, { color: T.text, fontSize: F.body }]}>
              Spoken Turns
            </Text>
            <Text style={[styles.rowSubtitle, { color: T.text2, fontSize: F.tinySm }]}>
              Turn-by-turn directions read aloud
            </Text>
          </View>
          <Switch
            value={spokenTurns}
            onValueChange={setSpokenTurns}
            accessibilityLabel="Spoken Turns"
            {...switchColors}
          />
        </View>

        <View style={[styles.row, styles.rowInline]}>
          <View style={styles.rowTextBlock}>
            <Text style={[styles.rowTitle, { color: T.text, fontSize: F.body }]}>
              Hazard Cues
            </Text>
            <Text style={[styles.rowSubtitle, { color: T.text2, fontSize: F.tinySm }]}>
              Spoken warning when a hazard is detected
            </Text>
          </View>
          <Switch
            value={hazardCues}
            onValueChange={setHazardCues}
            accessibilityLabel="Hazard Cues"
            {...switchColors}
          />
        </View>
      </View>

      <SectionLabel>Mobility aid</SectionLabel>
      <View style={[styles.sectionCard, { backgroundColor: T.card }]}>
        <View style={styles.row}>
          {/* The segments run fastest to slowest, so the two ends are marked
              with a hare and a tortoise, joined by a dotted run so the two read
              as the ends of one scale rather than as two unrelated icons.
              Announced as one label rather than three loose pieces, since a
              screen reader reading "rabbit, turtle" on its own says nothing
              about what the control does. */}
          <View
            style={styles.paceScale}
            accessible
            accessibilityLabel="Ordered from fastest to slowest"
          >
            <Rabbit size={scaled(18)} color={T.text2} strokeWidth={2} />
            <View style={styles.paceDots}>
              {PACE_DOTS.map((dot) => (
                <View
                  key={dot}
                  style={[
                    styles.paceDot,
                    {
                      backgroundColor: T.text2,
                      height: scaled(3),
                      width: scaled(3),
                      borderRadius: scaled(3) / 2,
                    },
                  ]}
                />
              ))}
            </View>
            <Turtle size={scaled(18)} color={T.text2} strokeWidth={2} />
          </View>
          <SegmentedField
            values={MOBILITY_AIDS.map((aid) => MOBILITY_AID_LABELS[aid])}
            selectedIndex={MOBILITY_AIDS.indexOf(mobilityAid)}
            onChange={(index) => setMobilityAid(MOBILITY_AIDS[index])}
            accessibilityLabel="Mobility aid"
          />
          {/* Spelled out because the setting is otherwise invisible: it only
              shows up as different numbers on the route panel. */}
          <Text style={[styles.rowSubtitle, { color: T.text2, fontSize: F.tinySm, marginTop: 10 }]}>
            {MOBILITY_AID_DESCRIPTIONS[mobilityAid]}
          </Text>
        </View>
      </View>

      <SectionLabel>Hazard types</SectionLabel>
      <View style={styles.hazardList}>
        {HAZARD_CLASSES.map((hazardClass) => {
          const active = hazardActive[hazardClass];
          const color = HAZARD_COLORS[hazardClass];
          const Icon = HAZARD_ICONS[hazardClass];
          const label = HAZARD_SETTING_LABELS[hazardClass];

          return (
            <View key={hazardClass} style={[styles.hazardRow, { backgroundColor: T.card }]}>
              <View style={styles.hazardRowLeft}>
                <View
                  style={[
                    styles.swatch,
                    { height: scaled(32), width: scaled(32), borderRadius: scaled(9) },
                  ]}
                >
                  {/* A separate tinted layer rather than an alpha colour, so
                      the icon on top stays fully opaque. */}
                  <View
                    style={[
                      styles.swatchTint,
                      { backgroundColor: color, borderRadius: scaled(9) },
                    ]}
                  />
                  <Icon size={scaled(18)} color={color} strokeWidth={2} />
                </View>
                <Text style={[styles.hazardLabel, { color: T.text, fontSize: F.label }]}>
                  {label}
                </Text>
              </View>
              <Switch
                value={active}
                onValueChange={() => toggleHazard(hazardClass)}
                accessibilityLabel={label}
                {...switchColors}
              />
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { T, F } = useSettings();
  return (
    <Text style={[styles.sectionLabel, { color: T.text2, fontSize: F.xs }]}>{children}</Text>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '700', paddingHorizontal: 20, paddingBottom: 18 },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    paddingHorizontal: 30,
    paddingBottom: 6,
  },
  sectionCard: {
    borderRadius: RADIUS.section,
    marginHorizontal: SCREEN_MARGIN,
    marginBottom: 20,
    overflow: 'hidden',
  },
  row: { paddingVertical: 14, paddingHorizontal: 16 },
  rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowTextBlock: { flex: 1 },
  rowTitle: { fontWeight: '600' },
  rowSubtitle: { marginTop: 2 },
  paceScale: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Inset so each icon sits over the middle of its end segment rather than
    // hard against the control's rounded corner.
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  paceDots: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Keeps the run clear of both icons instead of running into them.
    paddingHorizontal: 10,
  },
  // Size and radius are set inline, from the Text Size multiplier.
  paceDot: { opacity: 0.45 },
  hazardList: { gap: 8, paddingHorizontal: SCREEN_MARGIN, paddingBottom: 20 },
  hazardRow: {
    borderRadius: RADIUS.control,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  hazardRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  // Size and radius are set inline, from the Text Size multiplier.
  swatch: { alignItems: 'center', justifyContent: 'center' },
  swatchTint: { ...StyleSheet.absoluteFill, opacity: 0.16 },
  hazardLabel: { fontWeight: '600', flex: 1 },
});
