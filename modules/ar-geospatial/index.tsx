import { requireNativeView } from 'expo';
import * as React from 'react';
import type { ViewProps } from 'react-native';

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

/** One anchor, projected to where it appears on screen. */
export interface ProjectedAnchor {
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
}

export interface ARGeospatialViewProps extends ViewProps {
  apiKey: string;
  anchors: { latitude: number; longitude: number }[];
  onGeospatialUpdate?: (event: { nativeEvent: GeospatialUpdate }) => void;
  onAnchorsUpdate?: (event: { nativeEvent: { anchors: ProjectedAnchor[] } }) => void;
}

// iOS only for now. ARKit runs the camera and the tracking; ARCore's Geospatial
// API rides along on the same frames to say where on Earth that tracking is.
const NativeView: React.ComponentType<ARGeospatialViewProps> =
  requireNativeView('ARGeospatial');

export function ARGeospatialView(props: ARGeospatialViewProps) {
  return <NativeView {...props} />;
}
