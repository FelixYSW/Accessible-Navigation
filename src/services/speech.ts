import { AccessibilityInfo } from 'react-native';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';

// Spoken output for the two camera screens.
//
// Two things are deliberately kept apart here. VoiceOver is a screen reader: it
// narrates the interface as its user moves through it, and an app does not hand
// it sentences to say. AVSpeechSynthesizer - which is what expo-speech drives -
// is a speech engine that will say anything, to anyone, whether or not a screen
// reader is running. Turn-by-turn guidance is the second kind: a sighted walker
// with the phone at their side needs to hear the turn just as much as a
// VoiceOver user does.
//
// But when VoiceOver *is* running, talking over it is the worst of both. So a
// cue is routed into its announcement queue instead, and it arrives politely
// after whatever the screen reader is currently saying rather than on top of it.

/** Turn cues wait their turn; hazard cues do not. */
export type CuePriority = 'turn' | 'hazard';

// British English, to match the wording the rest of the app uses - "metres"
// read out by an American voice is a small but constant wrongness. iOS falls
// back to an installed voice if this exact one is missing.
const SPEECH_LANGUAGE = 'en-GB';

let prepared = false;
let screenReaderEnabled = false;

/// Sets up the audio session and starts watching for VoiceOver. Safe to call
/// from more than one screen; only the first call does anything.
export async function prepareSpeech(): Promise<void> {
  if (prepared) return;
  prepared = true;

  try {
    await setAudioModeAsync({
      // Guidance is heard even with the ringer switched to silent. This is a
      // deliberate departure from the usual rule that silent means silent:
      // someone following spoken directions through traffic has asked for this
      // audio, and every navigation app treats it the same way.
      playsInSilentMode: true,
      // Ducks a podcast or music rather than stopping it. Walking directions
      // are short interjections, and killing someone's audio for four seconds
      // of speech would be worse than the speech is worth.
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
    });
  } catch {
    // A session that could not be configured still speaks - it just may not be
    // heard on silent, or may stop the user's music instead of ducking it.
    // Losing that refinement is not worth losing the guidance over.
  }

  try {
    screenReaderEnabled = await AccessibilityInfo.isScreenReaderEnabled();
  } catch {
    screenReaderEnabled = false;
  }

  AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
    screenReaderEnabled = enabled;
  });
}

/// Says something, once.
export function speakCue(text: string, priority: CuePriority = 'turn'): void {
  if (!text) return;

  if (screenReaderEnabled) {
    // VoiceOver's own queue. Nothing is interrupted, including by a hazard:
    // cutting off a screen reader mid-sentence disorients the person relying
    // on it far more than a second's delay does.
    AccessibilityInfo.announceForAccessibility(text);
    return;
  }

  // expo-speak queues by default, which is what turn cues want. A hazard is
  // the exception - it is about something directly ahead, and a warning that
  // waits for a sentence about a turn fifty metres away has arrived too late.
  if (priority === 'hazard') {
    Speech.stop();
  }

  Speech.speak(text, { language: SPEECH_LANGUAGE });
}

/// Silences anything queued or in progress. Called when a screen goes away, so
/// guidance does not carry on after the user has left the route.
export function stopSpeaking(): void {
  Speech.stop();
}

/// A distance as it should be heard rather than read. The banner can show
/// "250 m" because an eye takes that in at once; an ear needs the word, and
/// needs it rounded to something a person would actually say.
export function spokenDistance(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} kilometres`;
  }
  if (meters >= 100) return `${Math.round(meters / 50) * 50} metres`;
  if (meters >= 20) return `${Math.round(meters / 10) * 10} metres`;
  return `${Math.max(5, Math.round(meters / 5) * 5)} metres`;
}
