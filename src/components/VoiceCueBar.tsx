import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from './AppIcon';
import { useToggleProgress } from './useToggleProgress';
import { useSettings } from '../theme/SettingsContext';
import { OVERLAY_GREEN, OVERLAY_PILL_HEIGHT, OVERLAY_RED } from '../theme/tokens';

/** Which half of voice guidance a segment switches: the spoken turn-by-turn
 *  directions, or the spoken hazard warnings. */
export type VoiceCue = 'turns' | 'hazards';

const CUE_LABELS: Record<VoiceCue, { short: string; accessibility: string }> = {
  turns: { short: 'Turns', accessibility: 'Spoken turn cues' },
  hazards: { short: 'Hazards', accessibility: 'Spoken hazard cues' },
};

// Voice guidance, reachable from the two camera screens without leaving them
// for Settings - silencing spoken cues is the kind of thing a user needs to do
// *while* navigating (walking into a quiet place, or into a phone call), and a
// round trip through the Settings tab tears down the camera and the route to
// do it.
//
// The cues stay independent - a walker can keep hazard warnings while silencing
// turn-by-turn chatter on a route they already know - but they are drawn as one
// bar rather than as separate floating pills. Two pills read as two unrelated
// controls that happen to be adjacent; one bar with a divider reads as what it
// is, which is a pair of switches over the same thing.
//
// Each segment writes to the same persisted preference its Settings switch
// does, so the two always agree and the choice survives a relaunch.
export function VoiceCueBar({ cues }: { cues: VoiceCue[] }) {
  return (
    <View style={styles.bar}>
      {cues.map((cue, index) => (
        <React.Fragment key={cue}>
          {index > 0 && <View style={styles.divider} />}
          <CueSegment cue={cue} />
        </React.Fragment>
      ))}
    </View>
  );
}

function CueSegment({ cue }: { cue: VoiceCue }) {
  const { F, scaled, spokenTurns, hazardCues, setSpokenTurns, setHazardCues } = useSettings();

  const on = cue === 'turns' ? spokenTurns : hazardCues;
  const set = cue === 'turns' ? setSpokenTurns : setHazardCues;
  const { short, accessibility } = CUE_LABELS[cue];

  // The glyph changes as well as the colour - a crossed-out speaker when off, a
  // sounding one when on. Green-versus-red carries the state at a glance, but
  // it cannot be the only thing that carries it: red/green is the commonest
  // colour vision deficiency there is, and an app about accessibility is a poor
  // place to encode a control's state in exactly that pair.
  //
  // The two are crossfaded rather than swapped. A hard swap of both glyph and
  // colour in one frame is easy to miss on a screen you are glancing at while
  // walking, and the fade is what makes it read as this control changing rather
  // than as the screen having redrawn.
  const progress = useToggleProgress(on);
  const size = scaled(15);

  return (
    <Pressable
      onPress={() => set(!on)}
      // Shares its height with the hazard bar beside it, rather than taking one
      // from its own padding - see OVERLAY_PILL_HEIGHT.
      style={[styles.segment, { minHeight: scaled(OVERLAY_PILL_HEIGHT) }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      // Spells the state out, because the label beside the icon does not: it
      // names which cue this is, not whether it is on.
      accessibilityLabel={`${accessibility}, ${on ? 'on' : 'off'}`}
      hitSlop={6}
    >
      {/* Fixed box, so the two stacked glyphs cannot shift the label between
          them as they fade. */}
      <View style={{ height: size, width: size }}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]}>
          <AppIcon name="volume-on" size={size} color={OVERLAY_GREEN} />
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
          ]}
        >
          <AppIcon name="volume-off" size={size} color={OVERLAY_RED} />
        </Animated.View>
      </View>
      <Text style={[styles.label, { fontSize: F.micro }]} numberOfLines={1}>
        {short}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    // Stretch, so the divider takes its height from the segments beside it
    // rather than needing one of its own.
    alignItems: 'stretch',
    // Deliberately no `alignSelf` here. Both screens place this in a row, where
    // `alignSelf` would set its *vertical* position and quietly drop it to the
    // bottom of whatever sits beside it - the horizontal placement it looks
    // like it is asking for belongs to the parent's `justifyContent`, and both
    // parents already set it.
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 19,
    overflow: 'hidden',
    // The two-segment version can reach the screen margins at the largest Text
    // Size setting.
    flexShrink: 1,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    // Vertical space comes from the shared minimum height, not from padding -
    // padding here would stack on top of it and make this bar the taller of the
    // two again.
    paddingVertical: 4,
    paddingHorizontal: 14,
    flexShrink: 1,
  },
  divider: {
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginVertical: 8,
  },
  label: { color: '#fff', fontWeight: '600', flexShrink: 1 },
});
