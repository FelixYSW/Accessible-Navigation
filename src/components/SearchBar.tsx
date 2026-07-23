/**
 * SearchBar.tsx
 *
 * Debounced Google Places API (New) autocomplete search field.
 *
 * Features:
 *  - 350 ms debounce on text input (via useRef timer, not a third-party lib).
 *  - Calls the Places API (New) Autocomplete endpoint with field masks.
 *  - Displays last 5 selected places from MMKV when input is focused and empty.
 *  - Saves each selected place to MMKV history (max 5 entries, FIFO eviction).
 *  - Reads API key exclusively from process.env.EXPO_PUBLIC_GOOGLE_API_KEY.
 *  - Zero external dependencies beyond react-native-mmkv.
 *
 * No navigation logic — purely a controlled input with a callback.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MMKV } from 'react-native-mmkv';
import type { SelectedPlace } from '../hooks/useAppStateMachine';

// ─── MMKV Storage Instance ────────────────────────────────────────────────────

/**
 * Scoped MMKV instance for search history.
 * Using a dedicated ID prevents key collisions with other stores.
 */
const storage = new MMKV({ id: 'accessible-nav-search-history' });
const HISTORY_KEY = 'search_history_v1';
const MAX_HISTORY = 5;

// ─── Places API Types (minimal, for autocomplete response) ───────────────────

interface PlacesSuggestion {
  placePrediction: {
    placeId: string;
    structuredFormat: {
      mainText: { text: string };
      secondaryText?: { text: string };
    };
  };
}

interface PlacesAutocompleteResponse {
  suggestions?: PlacesSuggestion[];
  error?: { message: string };
}

// ─── History helpers ──────────────────────────────────────────────────────────

function readHistory(): SelectedPlace[] {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SelectedPlace[];
  } catch {
    return [];
  }
}

function saveToHistory(place: SelectedPlace): void {
  const current = readHistory();
  // Remove duplicate if already in history
  const deduped = current.filter((p) => p.placeId !== place.placeId);
  // Prepend and cap at MAX_HISTORY
  const updated = [place, ...deduped].slice(0, MAX_HISTORY);
  storage.set(HISTORY_KEY, JSON.stringify(updated));
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchBarProps {
  /** Called when the user selects an autocomplete suggestion or history item. */
  onPlaceSelected: (place: SelectedPlace) => void;
  /** Forwarded from the appState so we can clear the input when navigating. */
  isNavigating?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SearchBar({
  onPlaceSelected,
  isNavigating = false,
}: SearchBarProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SelectedPlace[]>([]);
  const [history, setHistory] = useState<SelectedPlace[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Clear input when navigation starts
  useEffect(() => {
    if (isNavigating) {
      setQuery('');
      setSuggestions([]);
      inputRef.current?.blur();
    }
  }, [isNavigating]);

  // Load history on focus with empty query
  const loadHistory = useCallback(() => {
    setHistory(readHistory());
  }, []);

  // ── Autocomplete fetch ───────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (text: string) => {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;
    if (!apiKey) {
      setError('Google API key is not configured.');
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        'https://places.googleapis.com/v1/places:autocomplete',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            // Field mask — only request what we need (cost optimisation)
            'X-Goog-FieldMask':
              'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
          },
          body: JSON.stringify({
            input: text,
            // Bias results to walking-relevant place types
            includedPrimaryTypes: [
              'establishment',
              'geocode',
              'street_address',
            ],
            // Language for result text
            languageCode: 'en-GB',
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Places API HTTP error: ${response.status}`);
      }

      const data: PlacesAutocompleteResponse = await response.json();

      if (data.error) {
        throw new Error(data.error.message);
      }

      const mapped: SelectedPlace[] = (data.suggestions ?? []).map(
        (s: PlacesSuggestion) => ({
          placeId: s.placePrediction.placeId,
          displayName: s.placePrediction.structuredFormat.mainText.text,
          formattedAddress:
            s.placePrediction.structuredFormat.secondaryText?.text ?? '',
        }),
      );

      setSuggestions(mapped);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError('Could not load suggestions. Check your connection.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Debounced input handler ──────────────────────────────────────────────
  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      setSuggestions([]);
      setError(null);

      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      if (text.trim().length < 2) {
        setLoading(false);
        return;
      }

      debounceTimer.current = setTimeout(() => {
        void fetchSuggestions(text.trim());
      }, 350);
    },
    [fetchSuggestions],
  );

  // ── Place selection ──────────────────────────────────────────────────────
  const handleSelect = useCallback(
    (place: SelectedPlace) => {
      saveToHistory(place);
      setQuery(place.displayName);
      setSuggestions([]);
      inputRef.current?.blur();
      onPlaceSelected(place);
    },
    [onPlaceSelected],
  );

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── What list to show ────────────────────────────────────────────────────
  const showHistory = isFocused && query.length === 0 && history.length > 0;
  const showSuggestions = suggestions.length > 0;
  const listData: SelectedPlace[] = showHistory ? history : suggestions;
  const listLabel = showHistory ? 'Recent destinations' : 'Suggestions';

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.wrapper}>
      {/* ── Search Input ──────────────────────────────────────────────── */}
      <View style={styles.inputRow}>
        <Text style={styles.inputIcon} accessibilityElementsHidden>
          🔍
        </Text>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={handleChangeText}
          placeholder="Where to?"
          placeholderTextColor="#64748b"
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="words"
          onFocus={() => {
            setIsFocused(true);
            loadHistory();
          }}
          onBlur={() => {
            // Short delay so taps on list items register before blur dismissal.
            setTimeout(() => setIsFocused(false), 150);
          }}
          accessibilityLabel="Destination search"
          accessibilityHint="Type your destination to get walking directions"
        />
        {loading && (
          <ActivityIndicator
            size="small"
            color="#3b82f6"
            accessibilityLabel="Loading suggestions"
          />
        )}
      </View>

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
        </View>
      )}

      {/* ── Results list ──────────────────────────────────────────────── */}
      {(showHistory || showSuggestions) && (
        <View style={styles.listContainer}>
          {showHistory && (
            <Text style={styles.listSectionLabel}>{listLabel}</Text>
          )}
          <FlatList
            data={listData}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={false}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                style={[
                  styles.listItem,
                  index < listData.length - 1 && styles.listItemBorder,
                ]}
                onPress={() => handleSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.displayName}, ${item.formattedAddress}`}
              >
                <Text style={styles.listItemIcon} accessibilityElementsHidden>
                  {showHistory ? '🕐' : '📍'}
                </Text>
                <View style={styles.listItemText}>
                  <Text style={styles.listItemName} numberOfLines={1}>
                    {item.displayName}
                  </Text>
                  {item.formattedAddress ? (
                    <Text style={styles.listItemAddress} numberOfLines={1}>
                      {item.formattedAddress}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    paddingTop: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    gap: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputIcon: {
    fontSize: 16,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#f1f5f9',
    fontWeight: '500',
  },
  errorContainer: {
    marginTop: 8,
    backgroundColor: '#450a0a',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  listContainer: {
    marginTop: 8,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
  },
  listSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  listItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  listItemIcon: {
    fontSize: 16,
    width: 22,
    textAlign: 'center',
  },
  listItemText: {
    flex: 1,
    gap: 2,
  },
  listItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  listItemAddress: {
    fontSize: 13,
    color: '#64748b',
  },
});
