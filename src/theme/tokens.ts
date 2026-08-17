// Design tokens for the visual redesign.
//
// The design reference specifies its palette in CSS `oklch()`, which React
// Native's style engine cannot parse - every value below is the exact sRGB
// conversion of the corresponding oklch token, with the original written
// alongside it so the two stay traceable to the design file.
export type FontScaleKey = 'default' | 'large' | 'xl';

// Multipliers applied to every font-size token, so Text Size in Settings
// scales the whole app rather than a single preview swatch.
export const FONT_SCALES: Record<FontScaleKey, number> = {
  default: 1,
  large: 1.15,
  xl: 1.3,
};

const BASE_FONT_SIZES = {
  h1: 32,
  h2: 18,
  body: 16,
  label: 15,
  sm: 14,
  xs: 13,
  tinySm: 12.5,
  tiny: 12,
  micro: 11,
};

export type FontSizes = typeof BASE_FONT_SIZES;

export function fontSizesFor(scaleKey: FontScaleKey): FontSizes {
  const scale = FONT_SCALES[scaleKey];
  return Object.fromEntries(
    Object.entries(BASE_FONT_SIZES).map(([key, px]) => [key, Math.round(px * scale * 10) / 10]),
  ) as FontSizes;
}

// Hazard-type colors are identical in both themes - they encode severity /
// category, so they must not shift with the theme.
export const HAZARD_COLORS = {
  pothole: '#FF3B30',
  'slippery-surface': '#0A84FF',
  'broken-tactile-paving': '#FFD60A',
  'pathway-obstruction': '#FF9F0A',
} as const;

// On/off colours for the controls that sit over a camera preview.
//
// Fixed rather than themed, for the same reason the hazard colours above are:
// a camera preview has no theme. The palette's own green is tuned for legibility
// against a page background and comes out muddy over a dark overlay on a bright
// street, which is the one place these are ever used.
export const OVERLAY_GREEN = '#30D158';
export const OVERLAY_RED = '#FF453A';

// Shape of a resolved theme, shared by both modes so screens can be written
// against one set of semantic names.
export interface Palette {
  pageBg: string;
  /** Flat surface sitting on the page (settings cards, tab bar). */
  card: string;
  /** Floating surface (search bar, suggestions, bottom sheets). */
  cardRaised: string;
  text: string;
  text2: string;
  sep: string;
  sepStrong: string;
  accent: string;
  accentDeep: string;
  green: string;
  clearBtn: string;
  trackOff: string;
  segmentIdle: string;
  tabIdle: string;
  /** Fill of the currently-selected on-map route pill. */
  pillSelected: string;
  routeMainOutline: string;
  routeMainFill: string;
  routeAltOutline: string;
  routeAltFill: string;
  /** Elevation for floating surfaces. Dark mode communicates elevation with
   *  the lighter surface color alone, so shadows are switched off there. */
  shadow: Shadow;
  panelShadow: Shadow;
}

// React Native takes shadows as discrete style props rather than a single
// CSS-style string, so each elevation is stored pre-split.
export interface Shadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

const NO_SHADOW: Shadow = {
  shadowColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
};

export const LIGHT_PALETTE: Palette = {
  pageBg: '#f9f8f5', // oklch(98% 0.004 90)
  card: '#ffffff',
  cardRaised: '#ffffff',
  text: '#181611', // oklch(20% 0.01 90)
  text2: '#65635d', // oklch(50% 0.01 90)
  sep: '#ecebe7', // oklch(94% 0.005 90)
  sepStrong: '#e9e8e4', // oklch(93% 0.005 90)
  accent: '#1f6dd8', // oklch(55% 0.18 258)
  accentDeep: '#004296', // oklch(40% 0.15 258)
  green: '#1b9247', // oklch(58% 0.15 150)
  clearBtn: '#a19e98', // oklch(70% 0.01 90)
  trackOff: '#dfdeda', // oklch(90% 0.005 90)
  segmentIdle: '#f0eeeb', // oklch(95% 0.005 90)
  tabIdle: '#a19e98', // oklch(70% 0.01 90)
  pillSelected: '#013e8b', // oklch(38% 0.14 258)
  routeMainOutline: '#003386', // oklch(35% 0.15 258)
  routeMainFill: '#1f6dd8',
  routeAltOutline: '#8ba0be', // oklch(70% 0.05 258)
  routeAltFill: '#c2cfe2', // oklch(85% 0.03 258)
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  panelShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
};

export const DARK_PALETTE: Palette = {
  pageBg: '#121212',
  card: '#242424',
  cardRaised: '#2D2D2D',
  text: '#E0E0E0',
  text2: '#A0A0A0',
  sep: '#383838',
  sepStrong: '#444444',
  accent: '#1857ae', // oklch(47% 0.153 258)
  accentDeep: '#5b90dd', // oklch(65% 0.13 258)
  green: '#117436', // oklch(49% 0.128 150)
  clearBtn: '#5A5A5C',
  trackOff: '#3A3A3C',
  segmentIdle: '#2D2D2D',
  tabIdle: '#8E8E93',
  pillSelected: '#013e8b',
  routeMainOutline: '#1351a6', // oklch(45% 0.15 258)
  routeMainFill: '#1857ae',
  routeAltOutline: '#445671', // oklch(45% 0.05 258)
  routeAltFill: '#313b4a', // oklch(35% 0.03 258)
  shadow: NO_SHADOW,
  panelShadow: NO_SHADOW,
};

// Layout constants shared across screens.
export const SCREEN_MARGIN = 16;
export const RADIUS = { section: 18, card: 16, control: 14, button: 12, small: 10 };
