import React, { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LatLng } from '../types/route';
import { coordinateToScreenPoint, type MapRegion } from '../utils/geo';
import { PILL_FRAME, RoutePill } from './RoutePill';

export interface RoutePillDescriptor {
  coordinate: LatLng;
  duration: string;
  distance: string;
}

export interface RoutePillLayerHandle {
  /** Called straight from MapView's region events, once per frame of a pan. */
  setRegion: (region: MapRegion) => void;
}

interface RoutePillLayerProps {
  pills: RoutePillDescriptor[];
  selectedIndex: number;
  onSelect: (index: number) => void;
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

// The route pills, layered over the map and positioned by projecting each
// route's anchor coordinate into screen space. They can't be <Marker>
// children: react-native-maps renders those by snapshotting the child view
// into a native image, which comes out blank on this stack (New Architecture
// + Google provider on iOS), with or without an explicit size and a
// `tracksViewChanges` window.
//
// Positioning in JS means a pill can only move once React has re-rendered it,
// so the region is fed in through an imperative handle rather than being held
// as state on MapScreen. That confines each frame of a pan to re-rendering
// this layer and its two or three pills, instead of the entire screen - the
// map, both sets of polylines, the search bar and the route panel included.
//
// Positioning here also owns keeping the pills off each other. The anchor
// search in `labelAnchorIndexForRoute` spreads them apart on the ground, but
// ground distance is not screen distance: two routes that diverge by 40m are
// 40m apart at every zoom, and that is a hair's width with a whole city in
// frame. So a second, screen-space pass nudges any pill that would land on one
// already placed.
export const RoutePillLayer = forwardRef<RoutePillLayerHandle, RoutePillLayerProps>(
  function RoutePillLayer({ pills, selectedIndex, onSelect }, ref) {
    const [region, setRegion] = useState<MapRegion | null>(null);
    // The layer covers exactly the map, so its own layout is the map's size.
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    // Each pill's rendered size, reported by the pill itself. Measured rather
    // than assumed because it changes with the duration text and with the Text
    // Size setting, and a wrong size here means either a visible overlap or a
    // gap where none was needed.
    const [pillSizes, setPillSizes] = useState<Record<number, Size>>({});

    useImperativeHandle(ref, () => ({ setRegion }), []);

    const placements = useMemo(
      () => (region && size ? placePills(pills, selectedIndex, region, size, pillSizes) : []),
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
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        {placements.map(({ index, center, visible }) =>
          visible ? (
            <RoutePill
              key={`pill-${index}`}
              duration={pills[index].duration}
              distance={pills[index].distance}
              selected={index === selectedIndex}
              center={center}
              onPress={() => onSelect(index)}
              onMeasure={(measured) => measurePill(index, measured)}
              accessibilityLabel={`Route ${index + 1}: ${pills[index].duration}, ${
                pills[index].distance
              }`}
            />
          ) : null,
        )}
      </View>
    );
  },
);

// Where each pill actually goes. Pills are placed one at a time onto a list of
// rectangles already taken; a pill that would overlap one of them is offered a
// ring of nearby positions and takes the first that is clear.
//
// The selected route's pill is placed first and so never moves: it is the one
// the user is reading, and having it jump aside because an alternative happens
// to run nearby would be the wrong way round.
function placePills(
  pills: RoutePillDescriptor[],
  selectedIndex: number,
  region: MapRegion,
  size: Size,
  pillSizes: Record<number, Size>,
): { index: number; center: { x: number; y: number }; visible: boolean }[] {
  const order = pills
    .map((_, index) => index)
    .sort((a, b) => Number(b === selectedIndex) - Number(a === selectedIndex));

  const taken: Rect[] = [];
  const placed: { index: number; center: { x: number; y: number }; visible: boolean }[] = [];

  for (const index of order) {
    const anchor = coordinateToScreenPoint(pills[index].coordinate, region, size);
    // Off-screen pills are culled rather than placed - they are not visible,
    // so they cannot overlap anything, and reserving space for them would push
    // the pills that are visible around for no reason.
    if (
      anchor.x < -PILL_FRAME ||
      anchor.y < -PILL_FRAME ||
      anchor.x > size.width + PILL_FRAME ||
      anchor.y > size.height + PILL_FRAME
    ) {
      placed.push({ index, center: anchor, visible: false });
      continue;
    }

    // Until a pill has been measured it is placed on its anchor and reserves
    // nothing, so the first frame is unresolved rather than resolved wrongly.
    const pillSize = pillSizes[index];
    if (!pillSize) {
      placed.push({ index, center: anchor, visible: true });
      continue;
    }

    const center = freePosition(anchor, pillSize, taken, size);
    taken.push(rectAround(center, pillSize));
    placed.push({ index, center, visible: true });
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
  bounds: Size,
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

  let fallback: { x: number; y: number } | null = null;

  for (const offset of candidates) {
    const center = { x: anchor.x + offset.x, y: anchor.y + offset.y };
    if (taken.some((rect) => overlaps(rect, rectAround(center, pillSize)))) continue;
    // A clear position that runs off the screen edge is worse than a clear one
    // that doesn't, but still better than an overlap - so it is remembered and
    // used only if nothing fully on screen works out.
    if (onScreen(rectAround(center, pillSize), bounds)) return center;
    fallback = fallback ?? center;
  }

  return fallback ?? anchor;
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

function onScreen(rect: Rect, bounds: Size): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= bounds.width &&
    rect.y + rect.height <= bounds.height
  );
}
