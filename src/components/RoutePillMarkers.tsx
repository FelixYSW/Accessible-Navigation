import React, { useEffect, useMemo, useState } from 'react';
import { Marker } from 'react-native-maps';
import type { LatLng } from '../types/route';
import { coordinateToScreenPoint, type MapRegion } from '../utils/geo';
import { RoutePill } from './RoutePill';

export interface RoutePillDescriptor {
  coordinate: LatLng;
  duration: string;
  distance: string;
}

interface RoutePillMarkersProps {
  pills: RoutePillDescriptor[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** The map's current region and pixel size, used only to work out which
   *  pills would overlap at this zoom - not to position them. */
  region: MapRegion | null;
  size: Size | null;
}

interface Size {
  width: number;
  height: number;
}

interface Rect extends Size {
  x: number;
  y: number;
}

// Clear space kept between two pills that would otherwise touch.
const PILL_GAP = 8;

// The route pills, as real map markers.
//
// They were previously absolutely-positioned views laid over the map and
// re-projected in JS on every frame of a pan, which meant they were always a
// frame or two behind the map and appeared to swim over it. As markers the
// native map moves them itself, so a pill stays exactly on its bit of road
// however the map is dragged or zoomed.
//
// The pills still have to be kept off each other, and that is a screen-space
// question - two routes 40m apart are a hair's width apart with a city in
// frame. So the overlap is worked out in pixels and then converted back into a
// small shift of the marker's own coordinate. The shift is recomputed only
// when the region settles, not per frame: it depends on the zoom, and the zoom
// doesn't change during a pan.
export function RoutePillMarkers({
  pills,
  selectedIndex,
  onSelect,
  region,
  size,
}: RoutePillMarkersProps) {
  // Each pill's rendered size, reported by the pill itself. Measured rather
  // than assumed because it changes with the duration text and with the Text
  // Size setting, and a wrong size means either a visible overlap or a gap
  // where none was needed.
  const [pillSizes, setPillSizes] = useState<Record<number, Size>>({});

  const placements = useMemo(
    () => placePills(pills, selectedIndex, region, size, pillSizes),
    [pills, selectedIndex, region, size, pillSizes],
  );

  const measurePill = (index: number, measured: Size) =>
    setPillSizes((current) => {
      const previous = current[index];
      if (
        previous &&
        Math.abs(previous.width - measured.width) < 1 &&
        Math.abs(previous.height - measured.height) < 1
      ) {
        return current;
      }
      return { ...current, [index]: measured };
    });

  return (
    <>
      {placements.map(({ index, coordinate }) => (
        <PillMarker
          key={`pill-${index}`}
          coordinate={coordinate}
          duration={pills[index].duration}
          distance={pills[index].distance}
          selected={index === selectedIndex}
          onPress={() => onSelect(index)}
          // Whether this pill has laid out yet. Feeds the marker's snapshot
          // window - see PillMarker for why that matters.
          measured={pillSizes[index] !== undefined}
          onMeasure={(measured) => measurePill(index, measured)}
          accessibilityLabel={`Route ${index + 1}: ${pills[index].duration}, ${
            pills[index].distance
          }`}
        />
      ))}
    </>
  );
}

interface PillMarkerProps {
  coordinate: LatLng;
  duration: string;
  distance: string;
  selected: boolean;
  measured: boolean;
  onPress: () => void;
  onMeasure: (size: Size) => void;
  accessibilityLabel: string;
}

// One marker. `tracksViewChanges` is the awkward part of putting a React view
// inside a native marker: left on, the marker is re-snapshotted every frame
// and the map stutters; turned off too early, the snapshot is taken before the
// view has drawn and the marker comes out blank. So it is held on for a moment
// after anything that changes how the pill looks, then switched off.
//
// `measured` is in the signature for a reason that is easy to miss and produces
// a completely invisible pill when missed. The window used to be timed from
// mount, which races the pill's own layout: if the contents draw after the
// window has closed, the map has already taken its snapshot of an empty view
// and never takes another. Including the flag re-arms the window at the moment
// the pill reports its size, which guarantees at least one snapshot of a pill
// that has actually drawn.
function PillMarker({
  coordinate,
  duration,
  distance,
  selected,
  measured,
  onPress,
  onMeasure,
  accessibilityLabel,
}: PillMarkerProps) {
  const tracking = useTrackingWindow(`${duration}|${distance}|${selected}|${measured}`);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracking}
      onPress={onPress}
      // The chosen route's pill wins any overlap with an alternative's.
      zIndex={selected ? 2 : 1}
      accessibilityLabel={accessibilityLabel}
    >
      <RoutePill
        duration={duration}
        distance={distance}
        selected={selected}
        onMeasure={onMeasure}
      />
    </Marker>
  );
}

// True for a short window after `signature` changes, so the marker re-snapshots
// its contents and then stops.
//
// Generous rather than tight. The cost of being too long is a second of extra
// snapshotting on a map that is usually still at that moment; the cost of being
// too short is a marker that is permanently blank, because the map snapshots an
// undrawn view and never revisits it. Those are not comparable failures.
const TRACKING_WINDOW_MS = 1500;

function useTrackingWindow(signature: string): boolean {
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    setTracking(true);
    const timeout = setTimeout(() => setTracking(false), TRACKING_WINDOW_MS);
    return () => clearTimeout(timeout);
  }, [signature]);

  return tracking;
}

// Where each pill's marker actually goes: its route's anchor coordinate,
// shifted just enough that no two pills overlap on screen at this zoom.
//
// The selected route's pill is placed first and so never moves - it is the one
// being read, and having it shoved aside because an alternative runs nearby
// would be the wrong way round.
function placePills(
  pills: RoutePillDescriptor[],
  selectedIndex: number,
  region: MapRegion | null,
  size: Size | null,
  pillSizes: Record<number, Size>,
): { index: number; coordinate: LatLng }[] {
  // Before the map has reported a region there is nothing to project into, so
  // the pills sit on their own coordinates. The map still places them
  // correctly; they just aren't spread apart yet.
  if (!region || !size) {
    return pills.map((pill, index) => ({ index, coordinate: pill.coordinate }));
  }

  const order = pills
    .map((_, index) => index)
    .sort((a, b) => Number(b === selectedIndex) - Number(a === selectedIndex));

  const taken: Rect[] = [];
  const placed: { index: number; coordinate: LatLng }[] = [];

  for (const index of order) {
    const pillSize = pillSizes[index];
    const anchor = coordinateToScreenPoint(pills[index].coordinate, region, size);

    if (!pillSize) {
      placed.push({ index, coordinate: pills[index].coordinate });
      continue;
    }

    const point = freePosition(anchor, pillSize, taken);
    taken.push(rectAround(point, pillSize));
    placed.push({
      index,
      coordinate: shiftCoordinate(
        pills[index].coordinate,
        point.x - anchor.x,
        point.y - anchor.y,
        region,
        size,
      ),
    });
  }

  return placed;
}

// Turns a shift in pixels into a shift in degrees, so an overlap resolved on
// screen can be handed back to the map as a coordinate. Latitude is subtracted
// because screen y grows downwards while latitude grows up.
function shiftCoordinate(
  coordinate: LatLng,
  dx: number,
  dy: number,
  region: MapRegion,
  size: Size,
): LatLng {
  if (dx === 0 && dy === 0) return coordinate;
  return {
    latitude: coordinate.latitude - (dy / size.height) * region.latitudeDelta,
    longitude: coordinate.longitude + (dx / size.width) * region.longitudeDelta,
  };
}

// The anchor itself when it is clear, otherwise the nearest of a ring of
// candidates around it that is. Vertical offsets come first: a route pill
// belongs beside its own line, and moving it up or down a street keeps it
// closer to the route it labels than sliding it across one would.
function freePosition(
  anchor: { x: number; y: number },
  pillSize: Size,
  taken: Rect[],
): { x: number; y: number } {
  const stepY = pillSize.height + PILL_GAP;
  const stepX = pillSize.width + PILL_GAP;
  const candidates = [
    { x: 0, y: 0 },
    { x: 0, y: -stepY },
    { x: 0, y: stepY },
    { x: -stepX, y: 0 },
    { x: stepX, y: 0 },
    { x: 0, y: -stepY * 2 },
    { x: 0, y: stepY * 2 },
    { x: -stepX, y: -stepY },
    { x: stepX, y: -stepY },
    { x: -stepX, y: stepY },
    { x: stepX, y: stepY },
  ];

  for (const offset of candidates) {
    const point = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    if (!taken.some((rect) => overlaps(rect, rectAround(point, pillSize)))) return point;
  }

  return anchor;
}

function rectAround(center: { x: number; y: number }, size: Size): Rect {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + PILL_GAP &&
    a.x + a.width + PILL_GAP > b.x &&
    a.y < b.y + b.height + PILL_GAP &&
    a.y + a.height + PILL_GAP > b.y
  );
}
