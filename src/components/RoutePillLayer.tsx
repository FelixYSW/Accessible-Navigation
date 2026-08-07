import React, { forwardRef, useImperativeHandle, useState } from 'react';
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
export const RoutePillLayer = forwardRef<RoutePillLayerHandle, RoutePillLayerProps>(
  function RoutePillLayer({ pills, selectedIndex, onSelect }, ref) {
    const [region, setRegion] = useState<MapRegion | null>(null);
    // The layer covers exactly the map, so its own layout is the map's size.
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);

    useImperativeHandle(ref, () => ({ setRegion }), []);

    return (
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        {region &&
          size &&
          pills.map((pill, index) => {
            const center = coordinateToScreenPoint(pill.coordinate, region, size);
            // Skip pills the map has scrolled out of view.
            if (
              center.x < -PILL_FRAME ||
              center.y < -PILL_FRAME ||
              center.x > size.width + PILL_FRAME ||
              center.y > size.height + PILL_FRAME
            ) {
              return null;
            }

            return (
              <RoutePill
                key={`pill-${index}`}
                duration={pill.duration}
                distance={pill.distance}
                selected={index === selectedIndex}
                center={center}
                onPress={() => onSelect(index)}
                accessibilityLabel={`Route ${index + 1}: ${pill.duration}, ${pill.distance}`}
              />
            );
          })}
      </View>
    );
  },
);
