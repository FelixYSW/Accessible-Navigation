import {
  Construction,
  Droplets,
  TriangleAlert,
  WavesHorizontal,
  type LucideIcon,
} from 'lucide-react-native';
import type { HazardClass } from '../types/hazard';

// One icon per hazard class, shared by the Settings rows, the camera
// detection chips and the Hazard Detection legend, so a colour/icon pairing
// the user learns in one place reads the same everywhere.
//
// `WavesHorizontal` is lucide v1's name for the icon previously published as
// `waves` (three horizontal wavy lines), which is what the design specifies.
export const HAZARD_ICONS: Record<HazardClass, LucideIcon> = {
  pothole: TriangleAlert,
  'slippery-surface': Droplets,
  'broken-tactile-paving': WavesHorizontal,
  'pathway-obstruction': Construction,
};
