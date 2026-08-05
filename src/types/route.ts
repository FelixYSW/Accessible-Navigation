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
}

// A row in the search bar's suggestion dropdown - either a nearby place
// (Places Nearby Search) or a text match (Places Autocomplete). Both are
// resolved to coordinates via Place Details once selected.
export interface PlaceSuggestion {
  placeId: string;
  name: string;
  secondaryText?: string;
}
