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

export interface ARGeospatialViewProps extends ViewProps {
  apiKey: string;
  anchors: GeoAnchor[];
  /** Plants three plain ARKit anchors ahead of the camera, to judge the
   *  tracking itself against. Only the Geospatial test screen wants them. */
  showControlAnchors?: boolean;
  onGeospatialUpdate?: (event: { nativeEvent: GeospatialUpdate }) => void;
  onAnchorsUpdate?: (event: { nativeEvent: { anchors: ProjectedAnchor[] } }) => void;
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
const NativeView: React.ComponentType<ARGeospatialViewProps> | null =
  isARGeospatialSupported ? requireNativeView('ARGeospatial') : null;

export function ARGeospatialView(props: ARGeospatialViewProps) {
  if (!NativeView) return null;
  return <NativeView {...props} />;
}
