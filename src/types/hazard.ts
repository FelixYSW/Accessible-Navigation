// The four hazard classes identified from the FYP environmental observation
// study (see Investigation Report, Chapter 3.4 - Final List of User Requirements).
export type HazardClass =
  | 'pothole'
  | 'slippery-surface'
  | 'broken-tactile-paving'
  | 'pathway-obstruction';

export const HAZARD_CLASSES: HazardClass[] = [
  'pothole',
  'slippery-surface',
  'broken-tactile-paving',
  'pathway-obstruction',
];

// Short labels, used where space is tight (detection chips, map legend).
export const HAZARD_LABELS: Record<HazardClass, string> = {
  pothole: 'Pothole',
  'slippery-surface': 'Slippery Surface',
  'broken-tactile-paving': 'Broken Tactile Paving',
  'pathway-obstruction': 'Pathway Obstruction',
};

// Full labels for the Settings rows. Broken tactile paving and a generally
// uneven surface are the same hazard class to the detector and call for the
// same avoidance behaviour, so they are presented as a single preference
// rather than two toggles the user would always set together.
export const HAZARD_SETTING_LABELS: Record<HazardClass, string> = {
  ...HAZARD_LABELS,
  'broken-tactile-paving': 'Broken Tactile Paving / Uneven Surface',
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
