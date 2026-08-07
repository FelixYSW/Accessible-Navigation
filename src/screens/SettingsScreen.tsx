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
    fontScale,
    darkMode,
    voiceGuidance,
    mobilityAid,
    hazardActive,
    setFontScale,
    setDarkMode,
    setVoiceGuidance,
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

      <SectionLabel>Navigation</SectionLabel>
      <View style={[styles.sectionCard, { backgroundColor: T.card }]}>
        <View style={[styles.row, styles.rowInline]}>
          <View style={styles.rowTextBlock}>
            <Text style={[styles.rowTitle, { color: T.text, fontSize: F.body }]}>
              Voice Guidance
            </Text>
            <Text style={[styles.rowSubtitle, { color: T.text2, fontSize: F.tinySm }]}>
              Spoken turn and hazard cues
            </Text>
          </View>
          <Switch
            value={voiceGuidance}
            onValueChange={setVoiceGuidance}
            accessibilityLabel="Voice Guidance"
            {...switchColors}
          />
        </View>
      </View>

      <SectionLabel>Mobility aid</SectionLabel>
      <View style={[styles.sectionCard, { backgroundColor: T.card }]}>
        <View style={styles.row}>
          {/* The segments run fastest to slowest, so the two ends are marked
              with a hare and a tortoise. Announced as one label rather than
              two loose icons, since a screen reader reading "rabbit, turtle"
              on its own says nothing about what the control does. */}
          <View
            style={styles.paceScale}
            accessible
            accessibilityLabel="Ordered from fastest to slowest"
          >
            <Rabbit size={18} color={T.text2} strokeWidth={2} />
            <Turtle size={18} color={T.text2} strokeWidth={2} />
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
                <View style={styles.swatch}>
                  {/* A separate tinted layer rather than an alpha colour, so
                      the icon on top stays fully opaque. */}
                  <View style={[styles.swatchTint, { backgroundColor: color }]} />
                  <Icon size={18} color={color} strokeWidth={2} />
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
    justifyContent: 'space-between',
    // Inset so each icon sits over the middle of its end segment rather than
    // hard against the control's rounded corner.
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
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
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchTint: { ...StyleSheet.absoluteFill, borderRadius: 9, opacity: 0.16 },
  hazardLabel: { fontWeight: '600', flex: 1 },
});
