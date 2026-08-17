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

// Labels for the hazard-type pill on the camera screens, which is a dropdown
// roughly a third of the screen wide with a switch on every row. Even the
// "short" labels above wrap to two lines in it at the larger Text Sizes, and a
// wrapped row makes the run of switches beside them stop lining up.
//
// Each of these is the distinguishing word of its full label rather than an
// abbreviation of it - the full name is a tap away in Settings, and on camera
// what the walker needs is to tell four rows apart at a glance.
export const HAZARD_COMPACT_LABELS: Record<HazardClass, string> = {
  pothole: 'Pothole',
  'slippery-surface': 'Slippery',
  'broken-tactile-paving': 'Tactile paving',
  'pathway-obstruction': 'Obstruction',
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
