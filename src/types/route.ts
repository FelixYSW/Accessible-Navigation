export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface WalkingRoute {
  origin: LatLng;
  destination: LatLng;
  destinationName: string;
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  // Short label for the streets the route mostly follows (e.g. "Jalan
  // Sultan Ismail"), from the Directions API - lets the route picker tell
  // otherwise-similar alternatives apart. Absent for very short routes.
  summary?: string;
  // Full formatted address of the destination (from Place Details / Text
  // Search), shown as the secondary line under the destination name.
  destinationAddress?: string;
  // Set when the route came from an accessibility-aware router (OpenRouteService
  // over OpenStreetMap) rather than from Google, and was planned around the
  // barriers that matter for this aid. Absent on ordinary Google routes.
  accessibleFor?: 'cane' | 'walker' | 'wheelchair';
}

// A row in the search bar's suggestion dropdown - either a nearby place
// (Places Nearby Search) or a text match (Places Autocomplete). Both are
// resolved to coordinates via Place Details once selected.
export interface PlaceSuggestion {
  placeId: string;
  name: string;
  secondaryText?: string;
}
