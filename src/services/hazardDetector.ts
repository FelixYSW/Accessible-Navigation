import { useEffect, useState } from 'react';
import type { HazardClass, HazardDetection } from '../types/hazard';

const HAZARD_CLASSES: HazardClass[] = [
  'pothole',
  'slippery-surface',
  'broken-tactile-paving',
  'pathway-obstruction',
];

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateStubDetections(): HazardDetection[] {
  const count = Math.random() < 0.6 ? 1 : Math.random() < 0.9 ? 2 : 0;

  return Array.from({ length: count }, (_, i) => {
    const width = randomBetween(0.15, 0.3);
    const height = randomBetween(0.12, 0.22);
    return {
      id: `stub-${Date.now()}-${i}`,
      hazardClass: HAZARD_CLASSES[Math.floor(Math.random() * HAZARD_CLASSES.length)],
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
export function useStubHazardDetector(active: boolean, intervalMs = 800): HazardDetection[] {
  const [detections, setDetections] = useState<HazardDetection[]>([]);

  useEffect(() => {
    if (!active) {
      setDetections([]);
      return;
    }

    const id = setInterval(() => setDetections(generateStubDetections()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return detections;
}
