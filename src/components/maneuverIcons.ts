import type { AppIconName } from './AppIcon';

// The manoeuvres the navigation banner can show, and one fixed glyph for each.
//
// A fixed set rather than one arrow rotated to the measured angle: a rotated
// chevron drifts with every compass twitch, and at a glance "45 degrees" and
// "60 degrees" look the same anyway. What a walker reads off the banner is
// which of a handful of things to do - go straight, turn left, double back -
// so the banner shows exactly that, and the continuously-accurate version of
// the same information stays on the ground arrows where it belongs.
export type Maneuver =
  | 'straight'
  | 'slight-left'
  | 'slight-right'
  | 'left'
  | 'right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn-left'
  | 'uturn-right'
  | 'arrive'
  | 'locating';

// Names rather than components, resolved by `AppIcon` into an SF Symbol on iOS
// and the lucide icon it replaced elsewhere. The glyph choices are unchanged.
export const MANEUVER_ICONS: Record<Maneuver, AppIconName> = {
  straight: 'arrow-up',
  'slight-left': 'arrow-up-left',
  'slight-right': 'arrow-up-right',
  left: 'corner-up-left',
  right: 'corner-up-right',
  // A corner turning downwards reads as swinging back past square, which is
  // what a sharp turn is.
  'sharp-left': 'corner-left-down',
  'sharp-right': 'corner-right-down',
  // Both sides share a glyph, as they already share a label - see the note in
  // AppIcon. The arrow comes back down towards the walker, which is what a
  // turn-around actually asks for.
  'uturn-left': 'uturn',
  'uturn-right': 'uturn',
  arrive: 'map-pin',
  locating: 'compass',
};

export const MANEUVER_LABELS: Record<Maneuver, string> = {
  straight: 'Continue straight',
  'slight-left': 'Slight left',
  'slight-right': 'Slight right',
  left: 'Turn left',
  right: 'Turn right',
  'sharp-left': 'Sharp left',
  'sharp-right': 'Sharp right',
  'uturn-left': 'Turn around',
  'uturn-right': 'Turn around',
  arrive: 'Arrive at destination',
  locating: 'Getting your position',
};

// Where the boundaries between those manoeuvres sit, in degrees off straight
// ahead. Anything under `straight` is a bend in the pavement rather than a
// turn, and calling it one on every kink would make the banner cry wolf.
const STRAIGHT_MAX = 20;
const SLIGHT_MAX = 45;
const TURN_MAX = 120;
const SHARP_MAX = 160;

// Classifies a measured change of direction, for routes whose steps carry no
// manoeuvre of their own - OpenRouteService reports one, but in a different
// vocabulary to Google's, and guessing at the mapping would risk drawing a
// left arrow on a right turn.
export function maneuverFromAngle(angle: number | undefined): Maneuver {
  if (angle === undefined) return 'locating';

  const magnitude = Math.abs(angle);
  const left = angle < 0;

  if (magnitude <= STRAIGHT_MAX) return 'straight';
  if (magnitude <= SLIGHT_MAX) return left ? 'slight-left' : 'slight-right';
  if (magnitude <= TURN_MAX) return left ? 'left' : 'right';
  if (magnitude <= SHARP_MAX) return left ? 'sharp-left' : 'sharp-right';
  return left ? 'uturn-left' : 'uturn-right';
}

// The Directions API's own manoeuvre code, which is better evidence than the
// geometry: it knows a fork from a turn, and it isn't affected by how noisy
// the walker's heading is. Undefined for codes with no walking equivalent, and
// for steps that carry no code at all - both fall back to the angle.
export function maneuverFromApi(code: string | undefined): Maneuver | undefined {
  switch (code) {
    case 'straight':
    case 'merge':
      return 'straight';
    case 'turn-slight-left':
    case 'ramp-left':
    case 'fork-left':
      return 'slight-left';
    case 'turn-slight-right':
    case 'ramp-right':
    case 'fork-right':
      return 'slight-right';
    // A roundabout on foot is walked round as an ordinary turn - there is no
    // lane to hold or exit to count.
    case 'turn-left':
    case 'roundabout-left':
      return 'left';
    case 'turn-right':
    case 'roundabout-right':
      return 'right';
    case 'turn-sharp-left':
      return 'sharp-left';
    case 'turn-sharp-right':
      return 'sharp-right';
    case 'uturn-left':
      return 'uturn-left';
    case 'uturn-right':
      return 'uturn-right';
    default:
      return undefined;
  }
}
