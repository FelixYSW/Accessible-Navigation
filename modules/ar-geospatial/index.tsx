import { requireNativeView } from 'expo';
import * as React from 'react';
import { Platform, type ViewProps } from 'react-native';

/** Where the device is, as ARCore's Geospatial API sees it. */
export interface GeospatialUpdate {
  /** True once Earth is tracking and the pose below can be trusted. */
  tracking: boolean;
  trackingState: 'tracking' | 'paused' | 'stopped' | 'error' | 'unknown';
  /** Whether Google's Visual Positioning System covers this spot. "available"
   *  means roughly metre-level accuracy once localised; "unavailable" means it
   *  falls back to the phone's own GPS, which is what it has today. */
  vpsAvailability: 'available' | 'unavailable' | 'unknown';
  latitude: number;
  longitude: number;
  altitude: number;
  /** Compass bearing the camera is facing, in degrees. */
  heading: number;
  /** Radius of uncertainty in metres, and in degrees, respectively. Both are
   *  what to gate the guidance on: large values mean "keep scanning". */
  horizontalAccuracy: number;
  headingAccuracy: number;
  error?: string;
}

/** A route point to plant an anchor on. The id must stay the same for as long
 *  as the point is wanted: anchors are matched by it, so a point that keeps its
 *  id keeps the anchor it already has, and only genuinely new points cost a new
 *  one. Reusing ids for different coordinates, or renumbering as the walker
 *  advances, would move anchors that should have stayed put. */
export interface GeoAnchor {
  id: number;
  latitude: number;
  longitude: number;
}

/** One anchor, projected to where it appears on screen. */
export interface ProjectedAnchor {
  /** The `id` it was requested under, for route points. */
  index: number;
  /** `local` anchors are plain ARKit ones, planted ahead of wherever the phone
   *  was when tracking started. They need no VPS, GPS or coverage of any kind,
   *  so they work indoors - they are the control for judging whether the
   *  tracking itself holds still. `geospatial` anchors are pinned to real
   *  coordinates and only appear once Earth is localised. */
  kind: 'local' | 'geospatial';
  x: number;
  y: number;
  /** Metres from the camera. */
  distance: number;
  /** False when it is behind the camera. */
  visible: boolean;
  /** The six screen corners of the chevron lying on the ground at this point,
   *  flattened to `[x0, y0, x1, y1, ...]`, turned to face the next point along
   *  the route. Absent on control anchors, and on any chevron with a corner
   *  behind the lens - a half-projected polygon is a torn one, not a small
   *  one. */
  outline?: number[];
}

/** One detection, straight off the model. Deliberately not `HazardDetection`
 *  from the app's own types: `hazardClass` is whatever string the model was
 *  trained with, and it stays untrusted until the JS side has checked it
 *  against the classes the app knows about. */
export interface RawHazard {
  hazardClass: string;
  confidence: number;
  /** Normalised to the frame, origin top-left - already flipped from Vision's
   *  bottom-left origin on the native side. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HazardsEvent {
  hazards: RawHazard[];
  /** Set when the model could not be loaded at all, and then only once. An
   *  empty hazard list means "nothing in view"; this means "nothing will ever
   *  be in view", which the screens need to say out loud rather than look
   *  like a camera that never finds anything. */
  error?: string;
}

export interface ARGeospatialViewProps extends ViewProps {
  apiKey: string;
  anchors: GeoAnchor[];
  /** Plants three plain ARKit anchors ahead of the camera, to judge the
   *  tracking itself against. Only the Geospatial test screen wants them. */
  showControlAnchors?: boolean;
  onGeospatialUpdate?: (event: { nativeEvent: GeospatialUpdate }) => void;
  onAnchorsUpdate?: (event: { nativeEvent: { anchors: ProjectedAnchor[] } }) => void;
  onHazards?: (event: { nativeEvent: HazardsEvent }) => void;
}

export interface HazardCameraViewProps extends ViewProps {
  /** False releases the camera. Tab screens pass their focused state, so
   *  switching away stops the session rather than leaving it running behind
   *  another screen. */
  isActive?: boolean;
  onHazards?: (event: { nativeEvent: HazardsEvent }) => void;
}

/** Whether this platform has the native view at all. Callers check it to pick
 *  a camera surface, rather than rendering this one and getting nothing. */
export const isARGeospatialSupported = Platform.OS === 'ios';

// iOS only for now. ARKit runs the camera and the tracking; ARCore's Geospatial
// API rides along on the same frames to say where on Earth that tracking is.
//
// Resolved behind the platform check rather than at import: `requireNativeView`
// throws when the view is not registered, and that would take down any screen
// that so much as imports this file on Android.
// Both views are asked for by name. The module defines two, and an unnamed
// lookup resolves to whichever happens to be declared first - which would make
// reordering the Swift file change what this returns.
const NativeView: React.ComponentType<ARGeospatialViewProps> | null =
  isARGeospatialSupported ? requireNativeView('ARGeospatial', 'ARGeospatialView') : null;

const NativeHazardCamera: React.ComponentType<HazardCameraViewProps> | null =
  isARGeospatialSupported ? requireNativeView('ARGeospatial', 'HazardCameraView') : null;

export function ARGeospatialView(props: ARGeospatialViewProps) {
  if (!NativeView) return null;
  return <NativeView {...props} />;
}

/** The Hazard Detection screen's camera: the same model as the AR view runs,
 *  without the AR session. Returns null where the native module does not
 *  exist, so callers fall back to a plain preview rather than crashing. */
export function HazardCameraView(props: HazardCameraViewProps) {
  if (!NativeHazardCamera) return null;
  return <NativeHazardCamera {...props} />;
}
