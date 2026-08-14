import { useCallback, useMemo, useState } from 'react';
import type { HazardsEvent, RawHazard } from '../../modules/ar-geospatial';
import { HAZARD_CLASSES, type HazardClass, type HazardDetection } from '../types/hazard';

// Below this the box is noise. The exported model already drops anything under
// its own export threshold, so this is a second, stricter floor applied where it
// can be tuned without retraining - and it is set deliberately high, because a
// hazard warning that cries wolf gets ignored, which is worse than one that
// occasionally stays quiet.
const MIN_CONFIDENCE = 0.35;

// Class names the model was trained with, as a set, so an unrecognised one is
// dropped rather than reaching the overlay. It should never happen - the
// training notebook takes its class list from HAZARD_CLASSES precisely so the
// two cannot drift - but "should never happen" is exactly what a retrain with a
// renamed class would quietly break.
const KNOWN_CLASSES = new Set<string>(HAZARD_CLASSES);

function isHazardClass(value: string): value is HazardClass {
  return KNOWN_CLASSES.has(value);
}

/// Detections from the native model, filtered to what the user still wants to
/// see and shaped the way the overlay expects.
///
/// `activeClasses` narrows the list to the hazard types left switched on in
/// Settings, so a type the user has turned off stops being flagged on camera as
/// well as avoided when routing. Filtering here rather than in the model means
/// one model serves every combination of settings.
export function useHazardDetections(active: boolean, activeClasses: HazardClass[] = HAZARD_CLASSES) {
  const [event, setEvent] = useState<HazardsEvent | null>(null);

  // Held steady: this goes to a native view that emits several times a second.
  const onHazards = useCallback(
    (nativeEvent: { nativeEvent: HazardsEvent }) => setEvent(nativeEvent.nativeEvent),
    [],
  );

  // Compared by contents rather than identity, so a caller that rebuilds the
  // array each render does not rebuild every detection with it.
  const classesKey = activeClasses.join(',');

  const detections = useMemo<HazardDetection[]>(() => {
    if (!active || !event?.hazards) return [];
    const enabled = new Set(classesKey ? classesKey.split(',') : []);

    return event.hazards
      .filter(
        (hazard: RawHazard) =>
          hazard.confidence >= MIN_CONFIDENCE &&
          isHazardClass(hazard.hazardClass) &&
          enabled.has(hazard.hazardClass),
      )
      .map((hazard: RawHazard, index: number) => ({
        // Positional. Detections are replaced wholesale several times a second
        // and nothing tracks an individual hazard between frames, so an id that
        // tried to be stable would be a fiction.
        id: `${hazard.hazardClass}-${index}`,
        hazardClass: hazard.hazardClass as HazardClass,
        confidence: hazard.confidence,
        boundingBox: {
          x: hazard.x,
          y: hazard.y,
          width: hazard.width,
          height: hazard.height,
        },
      }));
  }, [active, event, classesKey]);

  return {
    detections,
    /** Set only when the model itself could not be loaded - a missing or
     *  unreadable .mlpackage. Distinct from an empty detection list, which
     *  simply means nothing is in view. */
    error: event?.error,
    /** Hand straight to the native view's `onHazards`. */
    onHazards,
  };
}
