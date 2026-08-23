import type { AppIconName } from './AppIcon';
import type { HazardClass } from '../types/hazard';

// One icon per hazard class, shared by the Settings rows, the camera
// detection chips and the Hazard Detection legend, so a colour/icon pairing
// the user learns in one place reads the same everywhere.
//
// Names rather than components now that icons resolve through `AppIcon`, which
// draws an SF Symbol on iOS and the lucide icon it replaced everywhere else -
// except where the platform has nothing worth using, which is why `blocked` is
// a lucide wall on both.
//
// `waves` is still the three wavy lines the design specifies for a broken
// surface. `blocked` is not the traffic cone the design started from: the cone
// implied roadworks for a class that is mostly parked cars and bins.
export const HAZARD_ICONS: Record<HazardClass, AppIconName> = {
  pothole: 'triangle-alert',
  'slippery-surface': 'droplets',
  'broken-tactile-paving': 'waves',
  'pathway-obstruction': 'blocked',
};
