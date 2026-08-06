import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HazardClass } from '../types/hazard';
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  fontSizesFor,
  type FontScaleKey,
  type FontSizes,
  type Palette,
} from './tokens';

export type MobilityAid = 'none' | 'cane' | 'walker' | 'wheelchair';

export interface Preferences {
  fontScale: FontScaleKey;
  darkMode: boolean;
  voiceGuidance: boolean;
  mobilityAid: MobilityAid;
  /** Which hazard classes the user wants routed around and flagged. */
  hazardActive: Record<HazardClass, boolean>;
}

const DEFAULT_PREFERENCES: Preferences = {
  fontScale: 'default',
  darkMode: false,
  voiceGuidance: true,
  mobilityAid: 'none',
  hazardActive: {
    pothole: true,
    'slippery-surface': true,
    'broken-tactile-paving': true,
    'pathway-obstruction': true,
  },
};

const STORAGE_KEY = 'accessible-navigation:preferences:v1';

interface SettingsValue extends Preferences {
  /** Resolved colors for the active mode. */
  T: Palette;
  /** Font sizes with the active Text Size multiplier already applied. */
  F: FontSizes;
  /** True once persisted preferences have been read, so the UI can avoid
   *  rendering a light-mode flash before a stored dark-mode preference loads. */
  ready: boolean;
  setFontScale: (value: FontScaleKey) => void;
  setDarkMode: (value: boolean) => void;
  setVoiceGuidance: (value: boolean) => void;
  setMobilityAid: (value: MobilityAid) => void;
  toggleHazard: (hazardClass: HazardClass) => void;
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
          const parsed = JSON.parse(stored) as Partial<Preferences>;
          setPreferences({
            ...DEFAULT_PREFERENCES,
            ...parsed,
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
      ready,
      setFontScale: (fontScale) => update({ fontScale }),
      setDarkMode: (darkMode) => update({ darkMode }),
      setVoiceGuidance: (voiceGuidance) => update({ voiceGuidance }),
      setMobilityAid: (mobilityAid) => update({ mobilityAid }),
      toggleHazard: (hazardClass) =>
        setPreferences((current) => ({
          ...current,
          hazardActive: {
            ...current.hazardActive,
            [hazardClass]: !current.hazardActive[hazardClass],
          },
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
export function useTheme(): { T: Palette; F: FontSizes; dark: boolean } {
  const { T, F, darkMode } = useSettings();
  return { T, F, dark: darkMode };
}
