import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Accessibility,
  CandyCane,
  Footprints,
  Frame,
  type LucideIcon,
} from 'lucide-react-native';
import { Toggle } from '../components/Toggle';
import { HAZARD_ICONS } from '../components/hazardIcons';
import { useSettings } from '../theme/SettingsContext';
import type { MobilityAid } from '../theme/SettingsContext';
import { HAZARD_COLORS, RADIUS, SCREEN_MARGIN, type FontScaleKey } from '../theme/tokens';
import { HAZARD_CLASSES, HAZARD_SETTING_LABELS } from '../types/hazard';

const TEXT_SIZES: { key: FontScaleKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'large', label: 'Large' },
  { key: 'xl', label: 'Extra Large' },
];

// lucide has no dedicated walking-cane or walker icon; `candy-cane` and
// `frame` (a 4-line grid that reads as a walker frame) are the closest
// available stand-ins, per the design handoff.
const MOBILITY_AIDS: { id: MobilityAid; label: string; Icon: LucideIcon }[] = [
  { id: 'none', label: 'None', Icon: Footprints },
  { id: 'cane', label: 'Cane', Icon: CandyCane },
  { id: 'walker', label: 'Walker', Icon: Frame },
  { id: 'wheelchair', label: 'Wheelchair', Icon: Accessibility },
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
          <View style={styles.segments}>
            {TEXT_SIZES.map((option) => {
              const selected = fontScale === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setFontScale(option.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.segment,
                    { backgroundColor: selected ? T.accent : T.segmentIdle },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      { color: selected ? '#fff' : T.text, fontSize: F.sm },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.row, styles.rowInline]}>
          <Text style={[styles.rowTitle, { color: T.text, fontSize: F.body }]}>Dark Mode</Text>
          <Toggle value={darkMode} onValueChange={setDarkMode} accessibilityLabel="Dark Mode" />
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
          <Toggle
            value={voiceGuidance}
            onValueChange={setVoiceGuidance}
            accessibilityLabel="Voice Guidance"
          />
        </View>
      </View>

      <SectionLabel>Mobility aid</SectionLabel>
      <View style={styles.grid}>
        {MOBILITY_AIDS.map(({ id, label, Icon }) => {
          const selected = mobilityAid === id;
          const color = selected ? T.accent : T.text;
          return (
            <Pressable
              key={id}
              onPress={() => setMobilityAid(id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.gridCard,
                { backgroundColor: T.card, borderColor: selected ? T.accent : T.sep },
              ]}
            >
              <Icon size={26} color={color} strokeWidth={2} />
              <Text style={[styles.gridLabel, { color, fontSize: F.sm }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SectionLabel>Avoid hazard types</SectionLabel>
      <View style={styles.hazardList}>
        {HAZARD_CLASSES.map((hazardClass) => {
          const active = hazardActive[hazardClass];
          const color = HAZARD_COLORS[hazardClass];
          const Icon = HAZARD_ICONS[hazardClass];
          const label = HAZARD_SETTING_LABELS[hazardClass];

          return (
            <Pressable
              key={hazardClass}
              onPress={() => toggleHazard(hazardClass)}
              accessibilityRole="switch"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`Avoid ${label}`}
              style={[styles.hazardRow, { backgroundColor: T.card }]}
            >
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
              {/* The whole row is the pressable, so the switch here is purely
                  the visual state - it must not intercept the touch and
                  toggle a second time. */}
              <Toggle value={active} size="small" accessibilityLabel={`Avoid ${label}`} disablePress />
            </Pressable>
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
  segments: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: RADIUS.small,
  },
  segmentLabel: { fontWeight: '700' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: SCREEN_MARGIN,
    paddingBottom: 20,
  },
  gridCard: {
    width: '48%',
    borderRadius: RADIUS.card,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
  },
  gridLabel: { fontWeight: '600' },
  hazardList: { gap: 8, paddingHorizontal: SCREEN_MARGIN, paddingBottom: 20 },
  hazardRow: {
    borderRadius: RADIUS.control,
    paddingVertical: 13,
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
