export interface LatLng {
  latitude: number;
  longitude: number;
}

// One leg of the turn-by-turn directions: walk along this, then make the
// manoeuvre named at the *start* of the next step. That is how the Directions
// API models it - `maneuver` describes how you get onto the step it sits on,
// not how you leave it.
export interface RouteStep {
  /** Plain-text form of the API's `html_instructions`, e.g. "Turn left onto
   *  Jalan Tun Razak". */
  instruction: string;
  /** The road this step runs along, pulled out of the instruction. Absent when
   *  the instruction names no road ("Head north"). */
  road?: string;
  /** The API's manoeuvre code ("turn-left", "roundabout-right", ...). Absent
   *  on the first step and on straight continuations. */
  maneuver?: string;
  distanceMeters: number;
  start: LatLng;
  end: LatLng;
}

// How much of a route runs on pedestrian infrastructure and how much shares
// the carriageway with traffic, in metres.
//
// This exists because a pedestrian router will happily route along any way
// OpenStreetMap does not explicitly forbid pedestrians on - including a trunk
// road with no pavement at all. That is the right default for a router (a road
// with no alternative still has to be usable) and the wrong thing to leave
// unsaid to a walker, who is entitled to know before they set off that the
// shortest way is short because it goes down the side of a main road.
export interface RouteSurface {
  /** Footway, path, cycleway and steps - ways built for people on foot. */
  footwayMeters: number;
  /** Street, road and state road - shared with traffic. */
  roadMeters: number;
  /** Tracks, ferries and anything OSM left uncategorised. Counted separately
   *  rather than folded into either, because guessing which would misreport
   *  exactly the stretches nobody has surveyed. */
  otherMeters: number;
}

export interface WalkingRoute {
  origin: LatLng;
  destination: LatLng;
  destinationName: string;
  coordinates: LatLng[];
  /** Turn-by-turn steps, in order, for the navigation banner. */
  steps: RouteStep[];
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
  // What the route is made of, from OpenRouteService's `waytype` breakdown.
  // Absent on Google's routes, which report nothing of the kind.
  surface?: RouteSurface;
}

// A row in the search bar's suggestion dropdown - either a nearby place
// (Places Nearby Search) or a text match (Places Autocomplete). Both are
// resolved to coordinates via Place Details once selected.
export interface PlaceSuggestion {
  placeId: string;
  name: string;
  secondaryText?: string;
}
