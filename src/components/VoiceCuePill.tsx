import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { VolumeX } from 'lucide-react-native';
import { AudioCueBars } from './AudioCueBars';
import { useSettings } from '../theme/SettingsContext';

// Voice Guidance, reachable from the two camera screens without leaving them
// for Settings - turning spoken cues off is the kind of thing a user needs to
// do *while* navigating (walking into a quiet place, or into a phone call),
// and a round trip through the Settings tab tears down the camera and the
// route to do it.
//
// It writes to the same persisted preference the Settings switch does, so the
// two always agree and the choice survives a relaunch.
export function VoiceGuidancePill() {
  const { T, F, voiceGuidance, setVoiceGuidance } = useSettings();

  return (
    <Pressable
      onPress={() => setVoiceGuidance(!voiceGuidance)}
      style={styles.pill}
      accessibilityRole="switch"
      accessibilityState={{ checked: voiceGuidance }}
      accessibilityLabel="Voice guidance"
      hitSlop={6}
    >
      {voiceGuidance ? (
        <AudioCueBars color={T.green} />
      ) : (
        <VolumeX size={15} color="rgba(255,255,255,0.75)" strokeWidth={2.2} />
      )}
      <Text style={[styles.label, { fontSize: F.micro }]}>
        {voiceGuidance ? 'Voice on' : 'Voice off'}
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
  },
  label: { color: '#fff', fontWeight: '600' },
});
