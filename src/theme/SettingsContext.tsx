import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HAZARD_CLASSES, type HazardClass } from '../types/hazard';
import type { MobilityAid } from '../services/mobility';
import {
  DARK_PALETTE,
  FONT_SCALES,
  LIGHT_PALETTE,
  fontSizesFor,
  type FontScaleKey,
  type FontSizes,
  type Palette,
} from './tokens';

// Re-exported so screens can keep importing the preference's type from the
// context that owns it, while the pace model that gives it meaning lives with
// the rest of the routing logic.
export type { MobilityAid };

export interface Preferences {
  fontScale: FontScaleKey;
  darkMode: boolean;
  /** Spoken turn-by-turn instructions while following a route. */
  spokenTurns: boolean;
  /** Spoken warnings when a hazard is detected ahead. */
  hazardCues: boolean;
  mobilityAid: MobilityAid;
  /** Which hazard classes the user wants routed around and flagged. */
  hazardActive: Record<HazardClass, boolean>;
}

const DEFAULT_PREFERENCES: Preferences = {
  fontScale: 'default',
  darkMode: false,
  spokenTurns: true,
  hazardCues: true,
  mobilityAid: 'none',
  hazardActive: {
    pothole: true,
    'slippery-surface': true,
    'broken-tactile-paving': true,
    'pathway-obstruction': true,
  },
};

const STORAGE_KEY = 'accessible-navigation:preferences:v1';

/** What may come back off disk: current fields, plus the single `voiceGuidance`
 *  switch that `spokenTurns` and `hazardCues` replaced. */
type StoredPreferences = Partial<Preferences> & { voiceGuidance?: boolean };

interface SettingsValue extends Preferences {
  /** Resolved colors for the active mode. */
  T: Palette;
  /** Font sizes with the active Text Size multiplier already applied. */
  F: FontSizes;
  /** Puts any fixed pixel size through that same multiplier. Text Size is the
   *  app's one legibility control, so it has to reach everything that carries
   *  meaning - icons, the swatches behind them, the marks on a scale - not
   *  just the text, or an icon shrinks relative to its own label. */
  scaled: (base: number) => number;
  /** True once persisted preferences have been read, so the UI can avoid
   *  rendering a light-mode flash before a stored dark-mode preference loads. */
  ready: boolean;
  setFontScale: (value: FontScaleKey) => void;
  setDarkMode: (value: boolean) => void;
  setSpokenTurns: (value: boolean) => void;
  setHazardCues: (value: boolean) => void;
  setMobilityAid: (value: MobilityAid) => void;
  toggleHazard: (hazardClass: HazardClass) => void;
  /** Sets every hazard type at once - the master switch behind the Settings
   *  section header and the collapsed hazard pill on the camera screens. */
  setAllHazards: (active: boolean) => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  // Load once on mount. Everything in `Preferences` is a user preference the
  // design brief calls out as persistent, so the whole object round-trips as
  // a single JSON blob rather than one AsyncStorage key per field.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored && !cancelled) {
          const parsed = JSON.parse(stored) as StoredPreferences;
          const { voiceGuidance, ...rest } = parsed;
          setPreferences({
            ...DEFAULT_PREFERENCES,
            // Before the two cue types split, one switch covered both. Anyone
            // who had turned it off gets that carried over to both halves
            // rather than having spoken cues come back on under a new name;
            // the key itself is dropped on the next write.
            ...(voiceGuidance !== undefined
              ? { spokenTurns: voiceGuidance, hazardCues: voiceGuidance }
              : null),
            ...rest,
            // Merged separately so a hazard class added in a later version
            // still defaults to on instead of coming back undefined.
            hazardActive: { ...DEFAULT_PREFERENCES.hazardActive, ...parsed.hazardActive },
          });
        }
      } catch {
        // A corrupt or unreadable store is not worth interrupting launch for -
        // fall back to defaults and let the next write repair it.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change, but only after the initial load has completed -
  // otherwise the defaults-shaped first render would overwrite the stored
  // preferences before they have been read back.
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)).catch(() => {
      // Best-effort: a failed write only costs the user their preference on
      // the next launch, so it should not surface as an error.
    });
  }, [preferences, ready]);

  const value = useMemo<SettingsValue>(() => {
    const update = (patch: Partial<Preferences>) =>
      setPreferences((current) => ({ ...current, ...patch }));

    return {
      ...preferences,
      T: preferences.darkMode ? DARK_PALETTE : LIGHT_PALETTE,
      F: fontSizesFor(preferences.fontScale),
      // Rounded to whole pixels: icon libraries and native views take these as
      // dimensions, and a fractional one lands on a half-pixel border.
      scaled: (base) => Math.round(base * FONT_SCALES[preferences.fontScale]),
      ready,
      setFontScale: (fontScale) => update({ fontScale }),
      setDarkMode: (darkMode) => update({ darkMode }),
      setSpokenTurns: (spokenTurns) => update({ spokenTurns }),
      setHazardCues: (hazardCues) => update({ hazardCues }),
      setMobilityAid: (mobilityAid) => update({ mobilityAid }),
      toggleHazard: (hazardClass) =>
        setPreferences((current) => ({
          ...current,
          hazardActive: {
            ...current.hazardActive,
            [hazardClass]: !current.hazardActive[hazardClass],
          },
        })),
      setAllHazards: (active) =>
        setPreferences((current) => ({
          ...current,
          // Rebuilt from HAZARD_CLASSES rather than by mapping the existing
          // record, so a class added to the list later cannot be left out of
          // "all" simply because a stored preference predates it.
          hazardActive: HAZARD_CLASSES.reduce(
            (all, hazardClass) => ({ ...all, [hazardClass]: active }),
            {} as Record<HazardClass, boolean>,
          ),
        })),
    };
  }, [preferences, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside a SettingsProvider');
  return value;
}

// Convenience for the common case of a component that only needs to style
// itself: `const { T, F } = useTheme()`.
export function useTheme(): {
  T: Palette;
  F: FontSizes;
  scaled: (base: number) => number;
  dark: boolean;
} {
  const { T, F, scaled, darkMode } = useSettings();
  return { T, F, scaled, dark: darkMode };
}
