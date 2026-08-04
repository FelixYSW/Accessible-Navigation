// The four hazard classes identified from the FYP environmental observation
// study (see Investigation Report, Chapter 3.4 - Final List of User Requirements).
export type HazardClass =
  | 'pothole'
  | 'slippery-surface'
  | 'broken-tactile-paving'
  | 'pathway-obstruction';

export const HAZARD_LABELS: Record<HazardClass, string> = {
  pothole: 'Pothole',
  'slippery-surface': 'Slippery Surface',
  'broken-tactile-paving': 'Broken Tactile Paving',
  'pathway-obstruction': 'Pathway Obstruction',
};

// Bounding box in normalized [0, 1] coordinates relative to the camera frame,
// origin at top-left, so it can be mapped onto any overlay canvas size.
export interface NormalizedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HazardDetection {
  id: string;
  hazardClass: HazardClass;
  confidence: number;
  boundingBox: NormalizedBoundingBox;
}
