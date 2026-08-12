import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Volume2, VolumeX } from 'lucide-react-native';
import { useSettings } from '../theme/SettingsContext';

/** Which half of voice guidance a pill switches: the spoken turn-by-turn
 *  directions, or the spoken hazard warnings. */
export type VoiceCue = 'turns' | 'hazards';

const CUE_LABELS: Record<VoiceCue, { short: string; accessibility: string }> = {
  turns: { short: 'Turns', accessibility: 'Spoken turn cues' },
  hazards: { short: 'Hazards', accessibility: 'Spoken hazard cues' },
};

// One half of Voice Guidance, reachable from the two camera screens without
// leaving them for Settings - silencing spoken cues is the kind of thing a
// user needs to do *while* navigating (walking into a quiet place, or into a
// phone call), and a round trip through the Settings tab tears down the camera
// and the route to do it.
//
// The two cues are independent: a user can keep hazard warnings while
// silencing the turn-by-turn chatter on a route they already know, or the
// reverse. Each pill writes to the same persisted preference its Settings
// switch does, so the two always agree and the choice survives a relaunch.
export function VoiceCuePill({ cue }: { cue: VoiceCue }) {
  const { T, F, scaled, spokenTurns, hazardCues, setSpokenTurns, setHazardCues } = useSettings();

  const on = cue === 'turns' ? spokenTurns : hazardCues;
  const set = cue === 'turns' ? setSpokenTurns : setHazardCues;
  const { short, accessibility } = CUE_LABELS[cue];

  return (
    <Pressable
      onPress={() => set(!on)}
      style={styles.pill}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={accessibility}
      hitSlop={6}
    >
      {on ? (
        <Volume2 size={scaled(15)} color={T.green} strokeWidth={2.2} />
      ) : (
        <VolumeX size={scaled(15)} color="rgba(255,255,255,0.75)" strokeWidth={2.2} />
      )}
      <Text style={[styles.label, { fontSize: F.micro }]} numberOfLines={1}>
        {short} {on ? 'on' : 'off'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 19,
    paddingVertical: 9,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    // Two of these sit side by side on AR Navigation, where the largest Text
    // Size can push them past the width between the screen margins.
    flexShrink: 1,
  },
  label: { color: '#fff', fontWeight: '600', flexShrink: 1 },
});
