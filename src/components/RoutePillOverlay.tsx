import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LatLng } from '../types/route';
import { coordinateToScreenPoint, type MapRegion } from '../utils/geo';
import { RoutePill } from './RoutePill';

export interface RoutePillDescriptor {
  coordinate: LatLng;
  duration: string;
  distance: string;
}

export interface RoutePillOverlayHandle {
  /** Feed the map's region as it moves. Called from `onRegionChange`, which
   *  fires every frame of a pan, so the pills track the map instead of
   *  jumping to their new positions once the gesture ends. */
  setRegion: (region: MapRegion) => void;
}

interface RoutePillOverlayProps {
  pills: RoutePillDescriptor[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** The region as of the last settled gesture. Used until the imperative
   *  handle above has been called - which is what puts a pill on screen at
   *  all before the map has moved even once. */
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

// How far outside the map a pill may project before it stops being rendered.
// A route can run well off screen, and its anchor with it.
const CULL_MARGIN_PX = 120;

// The route pills, projected onto the map as ordinary React Native views.
//
// These were briefly implemented as `<Marker>` children instead, which is the
// tidier idea - the native map moves its own markers, so nothing can lag - and
// it did not work. This app runs the New Architecture, react-native-maps 1.x
// does not, and a marker's React children go through the Fabric interop layer
// on their way to being snapshotted into the marker's icon. The snapshot is
// taken before that interop-hosted view has drawn anything, so the marker
// comes out empty and never redraws. `tracksViewChanges` cannot help: the
// problem is not when the snapshot is taken but what the marker can see when
// it takes it. Plain markers with no children - the destination pin - are
// unaffected, which is what makes this look so much like a styling bug.
//
// So the pills are drawn above the map and positioned in JS. The cost is that
// they are a frame behind the basemap during a pan. That is mitigated by
// updating from `onRegionChange` rather than `onRegionChangeComplete`: the
// original version of this overlay only updated when a gesture *ended*, which
// is what made the pills appear to swim across the map and led to the marker
// attempt in the first place.
export const RoutePillOverlay = forwardRef<RoutePillOverlayHandle, RoutePillOverlayProps>(
  function RoutePillOverlay({ pills, selectedIndex, onSelect, region, size }, ref) {
    // Driven imperatively so that a pan re-renders these few pills and nothing
    // else. Routed through MapScreen's own state instead, every frame of every
    // gesture would re-render the map, its polylines and the route panel.
    const [liveRegion, setLiveRegion] = useState<MapRegion | null>(null);

    useImperativeHandle(ref, () => ({ setRegion: setLiveRegion }), []);

    // Each pill's rendered size, reported by the pill itself. Measured rather
    // than assumed because it changes with the duration text and with the Text
    // Size setting, and a wrong size means either a visible overlap or a gap
    // where none was needed.
    const [pillSizes, setPillSizes] = useState<Record<number, Size>>({});

    const active = liveRegion ?? region;

    const placements = useMemo(
      () => placePills(pills, selectedIndex, active, size, pillSizes),
      [pills, selectedIndex, active, size, pillSizes],
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

    if (!active || !size || placements.length === 0) return null;

    return (
      // box-none, so the layer itself is transparent to touches and only the
      // pills inside it take any - the map still pans normally underneath.
      <View style={styles.layer} pointerEvents="box-none">
        {placements.map(({ index, x, y, size: pillSize }) => (
          <Pressable
            key={`pill-${index}`}
            style={[
              styles.pill,
              {
                left: x,
                top: y,
                // Centres the pill on its anchor. Done as a transform rather
                // than by subtracting from left/top, because the size is not
                // known until the pill has laid out once and a transform of
                // zero leaves it merely off-centre rather than mispositioned.
                transform: [
                  { translateX: -(pillSize?.width ?? 0) / 2 },
                  { translateY: -(pillSize?.height ?? 0) / 2 },
                ],
                // The chosen route's pill wins any overlap with an
                // alternative's.
                zIndex: index === selectedIndex ? 2 : 1,
              },
            ]}
            onPress={() => onSelect(index)}
            accessibilityRole="button"
            accessibilityLabel={`Route ${index + 1}: ${pills[index].duration}, ${
              pills[index].distance
            }`}
            // A pill is small and is tapped while walking, so the touch target
            // is grown past what is drawn rather than the pill being drawn
            // bigger than it needs to be.
            hitSlop={8}
          >
            <RoutePill
              duration={pills[index].duration}
              distance={pills[index].distance}
              selected={index === selectedIndex}
              onMeasure={(measured) => measurePill(index, measured)}
            />
          </Pressable>
        ))}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pill: {
    position: 'absolute',
  },
});

interface Placement {
  index: number;
  x: number;
  y: number;
  size: Size | undefined;
}

// Where each pill is drawn: its route's anchor point, nudged just enough that
// no two pills overlap.
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
): Placement[] {
  if (!region || !size) return [];

  const order = pills
    .map((_, index) => index)
    .sort((a, b) => Number(b === selectedIndex) - Number(a === selectedIndex));

  const taken: Rect[] = [];
  const placed: Placement[] = [];

  for (const index of order) {
    const pillSize = pillSizes[index];
    const anchor = coordinateToScreenPoint(pills[index].coordinate, region, size);

    if (
      anchor.x < -CULL_MARGIN_PX ||
      anchor.y < -CULL_MARGIN_PX ||
      anchor.x > size.width + CULL_MARGIN_PX ||
      anchor.y > size.height + CULL_MARGIN_PX
    ) {
      continue;
    }

    // First render, before this pill has reported its size: drawn on its
    // anchor without overlap avoidance. It measures on that same frame, so
    // this only ever describes the very first one.
    if (!pillSize) {
      placed.push({ index, x: anchor.x, y: anchor.y, size: undefined });
      continue;
    }

    const point = freePosition(anchor, pillSize, taken);
    taken.push(rectAround(point, pillSize));
    placed.push({ index, x: point.x, y: point.y, size: pillSize });
  }

  return placed;
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
