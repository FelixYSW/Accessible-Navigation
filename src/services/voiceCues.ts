import { useEffect, useRef } from 'react';
import { MANEUVER_LABELS, type Maneuver } from '../components/maneuverIcons';
import { HAZARD_LABELS, type HazardDetection } from '../types/hazard';
import { prepareSpeech, speakCue, spokenDistance, stopSpeaking } from './speech';

// When a turn is announced, in metres remaining. Three warnings rather than a
// continuous countdown: a walker needs time to change lanes on a pavement, a
// confirmation as the corner arrives, and nothing in between. Announcing every
// few metres is how a navigation app becomes something people mute.
const TURN_BANDS = [50, 20, 8];

// The band at which the instruction switches from "in fifty metres, turn left"
// to "turn left now".
const IMMINENT_BAND = 8;

// How much of the frame a hazard must fill before it is worth interrupting for.
//
// Box area stands in for distance, since a detector reports neither. A pothole
// twenty metres off is a handful of pixels and not yet anyone's problem; the
// same pothole two paces away fills a good part of the frame. This threshold is
// what stops the app narrating every crack on the horizon.
const MIN_SPOKEN_HAZARD_AREA = 0.04;

// A given kind of hazard is not announced again for this long. Detection runs
// ten times a second and a pothole stays in frame for several seconds, so
// without this one pothole would be announced thirty times.
const HAZARD_COOLDOWN_MS = 8000;

interface TurnCueOptions {
  enabled: boolean;
  maneuver: Maneuver;
  road: string | undefined;
  metersToManeuver: number | undefined;
  stepIndex: number | undefined;
}

/// Speaks the upcoming turn as it approaches, once per distance band.
export function useSpokenTurnCues({
  enabled,
  maneuver,
  road,
  metersToManeuver,
  stepIndex,
}: TurnCueOptions): void {
  // Which announcements have already been made, keyed by step and band, so
  // each is spoken exactly once - a walker pausing at a kerb should not hear
  // the same instruction again for as long as they stand there.
  const announced = useRef(new Set<string>());

  useEffect(() => {
    prepareSpeech();
    return stopSpeaking;
  }, []);

  useEffect(() => {
    if (!enabled || stepIndex === undefined || metersToManeuver === undefined) return;
    if (maneuver === 'locating') return;

    const band = TURN_BANDS.find((limit) => metersToManeuver <= limit);
    if (band === undefined) return;

    const key = `${stepIndex}:${band}`;
    if (announced.current.has(key)) return;
    announced.current.add(key);

    speakCue(turnPhrase(maneuver, road, metersToManeuver, band), 'turn');
  }, [enabled, maneuver, road, metersToManeuver, stepIndex]);
}

function turnPhrase(
  maneuver: Maneuver,
  road: string | undefined,
  metersToManeuver: number,
  band: number,
): string {
  // Arrival is not an instruction to carry out, so it does not take the "in X
  // metres, do Y" shape the others do.
  if (maneuver === 'arrive') {
    return band === IMMINENT_BAND
      ? 'You have arrived at your destination'
      : `Your destination is ${spokenDistance(metersToManeuver)} ahead`;
  }

  const action = MANEUVER_LABELS[maneuver];
  const onto = road ? ` onto ${road}` : '';

  if (band === IMMINENT_BAND) return `${action}${onto} now`;
  // Lower-cased because it lands mid-sentence here, where the banner shows it
  // standing alone.
  return `In ${spokenDistance(metersToManeuver)}, ${lowerFirst(action)}${onto}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/// Announces hazards as they come close, at most one kind at a time.
export function useSpokenHazardCues(enabled: boolean, detections: HazardDetection[]): void {
  const lastSpokenAt = useRef<Partial<Record<string, number>>>({});

  useEffect(() => {
    prepareSpeech();
  }, []);

  useEffect(() => {
    if (!enabled || detections.length === 0) return;

    // The largest qualifying box, which is the nearest thing the detector can
    // tell us about. Only one is spoken: two warnings at once is a sentence
    // nobody parses in time to step around anything.
    const nearest = detections
      .filter((d) => areaOf(d) >= MIN_SPOKEN_HAZARD_AREA)
      .sort((a, b) => areaOf(b) - areaOf(a))[0];
    if (!nearest) return;

    const now = Date.now();
    if (now - (lastSpokenAt.current[nearest.hazardClass] ?? 0) < HAZARD_COOLDOWN_MS) return;
    lastSpokenAt.current[nearest.hazardClass] = now;

    speakCue(`${HAZARD_LABELS[nearest.hazardClass]} ahead`, 'hazard');
  }, [enabled, detections]);
}

function areaOf(detection: HazardDetection): number {
  return detection.boundingBox.width * detection.boundingBox.height;
}
