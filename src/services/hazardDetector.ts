import { useEffect, useState } from 'react';
import { HAZARD_CLASSES, type HazardClass, type HazardDetection } from '../types/hazard';

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateStubDetections(classes: HazardClass[]): HazardDetection[] {
  if (classes.length === 0) return [];
  const count = Math.random() < 0.6 ? 1 : Math.random() < 0.9 ? 2 : 0;

  return Array.from({ length: count }, (_, i) => {
    const width = randomBetween(0.15, 0.3);
    const height = randomBetween(0.12, 0.22);
    return {
      id: `stub-${Date.now()}-${i}`,
      hazardClass: classes[Math.floor(Math.random() * classes.length)],
      confidence: randomBetween(0.6, 0.97),
      boundingBox: {
        x: randomBetween(0.05, 0.95 - width),
        y: randomBetween(0.45, 0.85 - height),
        width,
        height,
      },
    };
  });
}

// Placeholder for the on-device YOLO26 TensorFlow Lite hazard detector
// described in the FYP investigation report (Chapter 2.4.3). Emits synthetic
// bounding boxes on an interval so the camera + AR overlay pipeline can be
// built, sideloaded, and demoed before the trained .tflite model is ready.
//
// To wire up real inference later: replace the interval below with a
// `useFrameOutput` callback (react-native-vision-camera-worklets) that runs
// the model via an `AsyncRunner` on each camera frame and calls
// `scheduleOnRN` (react-native-worklets) to push detections into state here.
//
// `classes` narrows what may be emitted to the hazard types the user still
// has switched on in Settings ("Avoid hazard types"), so a type they have
// turned off stops being flagged on camera as well as avoided when routing.
export function useStubHazardDetector(
  active: boolean,
  classes: HazardClass[] = HAZARD_CLASSES,
  intervalMs = 800,
): HazardDetection[] {
  const [detections, setDetections] = useState<HazardDetection[]>([]);
  // Depend on the contents rather than the array identity, so a caller that
  // rebuilds the list on every render doesn't restart the interval each time.
  const classesKey = classes.join(',');

  useEffect(() => {
    if (!active) {
      setDetections([]);
      return;
    }

    const enabled = classesKey ? (classesKey.split(',') as HazardClass[]) : [];
    const id = setInterval(() => setDetections(generateStubDetections(enabled)), intervalMs);
    return () => clearInterval(id);
  }, [active, classesKey, intervalMs]);

  return detections;
}
