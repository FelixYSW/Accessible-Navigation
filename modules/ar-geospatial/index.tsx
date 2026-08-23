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
  /** `route` points are threaded together into the ground band and chained to work
   *  out which way the run faces. `destination` is a single marker at the end
   *  of the journey, drawn as an upright pin in the scene and deliberately kept
   *  out of that
   *  chain. Defaults to `route`. */
  kind?: 'route' | 'destination';
  latitude: number;
  longitude: number;
}

/** One anchor the AR session drew this frame, projected to where it appears on
 *  screen.
 *
 *  Points only, and deliberately. Nothing that is drawn *as* something comes
 *  across this bridge any more - the band and the destination pin are both
 *  geometry inside the AR scene, rasterised in the same pass as the camera
 *  image, which is what lets them hold still and lets a wall hide them.
 *
 *  What is sent here is where to hang the things that must not obey
 *  perspective: the destination's name, which has to stay readable at sixty
 *  metres, and the control anchors on the test screen, whose whole job is to
 *  be a dot at a known place. */
export interface ProjectedAnchor {
  /** The `id` it was requested under. */
  index: number;
  /** `local` anchors are plain ARKit ones, planted ahead of wherever the phone
   *  was when tracking started. They need no VPS, GPS or coverage of any kind,
   *  so they work indoors - they are the control for judging whether the
   *  tracking itself holds still. `destination` is pinned to a real coordinate
   *  and only appears once Earth is localised. */
  kind: 'local' | 'destination';
  x: number;
  y: number;
  /** Metres from the camera. */
  distance: number;
  /** False when it is behind the camera. */
  visible: boolean;
  /** Where the top of the thing standing at this anchor lands on screen.
   *
   *  Sent for the destination, so its name can be hung above the pin without
   *  the JS side having to guess the camera's field of view - which it did, and
   *  got wrong by about a factor of two, because the preview is cropped to fill
   *  the view and the visible field is narrower than the sensor's.
   *
   *  Absent when the top is behind the lens. */
  headY?: number;
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

/** The components that can be placed by hand in preview mode.
 *
 *  Only two things in this app are drawn at a fixed point in the world: the
 *  ground band and the destination pin. The compass band is relative to the
 *  camera and the hazard boxes come from the detector, so neither can be put
 *  anywhere.
 *
 *  Everything but `pin` is the same band; they differ only in the shape of the
 *  run a tap lays down. `path` is straight, and the rest bend halfway along by
 *  the angle the navigation screen would classify as that manoeuvre - the same
 *  names it uses in `Maneuver`, so what is placed is what a route calling for
 *  that turn would actually draw.
 *
 *  There is no single-element option: the band has no elements to place one
 *  of. */
export type PreviewComponent =
  | 'path'
  | 'slight-left'
  | 'slight-right'
  | 'left'
  | 'right'
  | 'sharp-left'
  | 'sharp-right'
  | 'uturn-left'
  | 'uturn-right'
  | 'pin';

/** What preview mode can currently do, and what is currently down. */
export interface PreviewState {
  /** True once the camera is tracking normally *and* a raycast into the middle
   *  of the frame finds a surface - which is the same test a tap runs, so what
   *  the screen promises and what a tap can do cannot come apart. */
  ready: boolean;
  /** How many things have been placed. Reported from the native side because
   *  the `scene` renderer sends no anchors over at all - it draws them itself -
   *  so counting the anchor list would report nothing however many taps had
   *  landed. */
  placed: number;
}

export interface ARGeospatialViewProps extends ViewProps {
  /** Both optional because `previewMode` needs neither: it plants its run on
   *  ARKit anchors from a tap, so there is no route to anchor and no Geospatial
   *  session to authorise. Omitting the key is what keeps that session from
   *  starting at all, which is what lets the preview work indoors. */
  apiKey?: string;
  anchors?: GeoAnchor[];
  /** Plants three plain ARKit anchors ahead of the camera, to judge the
   *  tracking itself against. Only the Geospatial test screen wants them. */
  showControlAnchors?: boolean;

  /** How wide to draw the chevrons, in metres. Clamped to 3-14 natively.
   *
   *  Not a style setting. It is how far apart the two answers to "where is the
   *  route" currently are - what the map says, and where the walker is standing
   *  - so a chevron narrower than that gap would be claiming a precision
   *  nothing supports. Wide means "somewhere along here", which on a road whose
   *  pavements OSM has not mapped is the truth. */
  guidanceWidthM?: number;

  /** Tap the floor to place components, with no route and no Geospatial
   *  session. Works indoors, which is what it is for. */
  previewMode?: boolean;
  /** What the next tap puts down. */
  previewComponent?: PreviewComponent;
  /** Any change removes everything placed so far. The value means nothing. */
  previewClearToken?: number;
  onGeospatialUpdate?: (event: { nativeEvent: GeospatialUpdate }) => void;
  onAnchorsUpdate?: (event: { nativeEvent: { anchors: ProjectedAnchor[] } }) => void;
  onHazards?: (event: { nativeEvent: HazardsEvent }) => void;
  /** Preview mode only. Fires when the answer changes, not per frame. */
  onPreviewState?: (event: { nativeEvent: PreviewState }) => void;
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
