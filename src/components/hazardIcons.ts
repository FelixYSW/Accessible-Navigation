import type { AppIconName } from './AppIcon';
import type { HazardClass } from '../types/hazard';

// One icon per hazard class, shared by the Settings rows, the camera
// detection chips and the Hazard Detection legend, so a colour/icon pairing
// the user learns in one place reads the same everywhere.
//
// Names rather than components now that icons resolve through `AppIcon`, which
// draws an SF Symbol on iOS and the lucide icon it replaced everywhere else.
// The pairings are unchanged: `waves` is still the three wavy lines the design
// specifies for a broken surface, and `construction` is still the traffic cone.
export const HAZARD_ICONS: Record<HazardClass, AppIconName> = {
  pothole: 'triangle-alert',
  'slippery-surface': 'droplets',
  'broken-tactile-paving': 'waves',
  'pathway-obstruction': 'construction',
};
