import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import type { ProjectedAnchor } from '../../modules/ar-geospatial';

// The destination, standing on the spot in the camera view.
//
// Drawn as a billboard rather than as a modelled 3D pin, which is not a
// shortcut but the correct treatment: a marker that always faces the viewer is
// by definition a flat sprite at a projected point, scaled by how far away it
// is. Building it in 3D would produce something that turns edge-on and
// disappears as the walker approaches from the side - the one thing a
// destination marker must never do.
//
// The anchor sits on the ground at the destination, so the pin is drawn with
// its tip exactly on the projected point and its body rising above it, the way
// a real sign stands out of the pavement.

// The pin shape, tip at the origin, drawn upwards. Bulb of radius 12 centred
// 24 above the tip, so the whole thing is 36 tall in its own units.
const PIN_PATH =
  'M 0 0 C -6 -10, -12 -16, -12 -24 A 12 12 0 1 1 12 -24 C 12 -16, 6 -10, 0 0 Z';
const PIN_HEIGHT_UNITS = 36;

// How big the pin is drawn, as (apparent size) = SCALE_CONSTANT / distance.
//
// Derived rather than guessed: a marker about 1.6m tall seen through a lens of
// roughly 335px focal length subtends 1.6 x 335 / distance pixels, and the path
// above is 36 units tall, giving 15 / distance. The clamps stop it swallowing
// the screen underfoot or vanishing at the far end.
const SCALE_CONSTANT = 15;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3.5;

// Past this the pin is not drawn at all. Not a rendering limit - an honesty
// one. Geospatial anchors are placed against a pose whose error grows with
// range, and a pin planted 200m off would be confidently pointing through three
// buildings at a spot it has no business being sure about.
const MAX_VISIBLE_DISTANCE_M = 60;

const LABEL_SIZE = 15;

interface DestinationPinProps {
  anchors: ProjectedAnchor[];
  label: string;
  color: string;
}

export function DestinationPin({ anchors, label, color }: DestinationPinProps) {
  const pin = anchors.find((anchor) => anchor.kind === 'destination' && anchor.visible);
  if (!pin || pin.distance > MAX_VISIBLE_DISTANCE_M) return null;

  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, SCALE_CONSTANT / pin.distance));
  const height = PIN_HEIGHT_UNITS * scale;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <G transform={`translate(${pin.x.toFixed(1)}, ${pin.y.toFixed(1)}) scale(${scale.toFixed(3)})`}>
        {/* Dark edge for the same reason the chevrons have one: this has to
            read against a bright pavement and a dark doorway alike. */}
        <Path d={PIN_PATH} fill={color} stroke="rgba(0,0,0,0.55)" strokeWidth={2.5} />
        <Circle cx={0} cy={-24} r={5} fill="#ffffff" />
      </G>

      {/* Above the pin, and in screen units rather than scaled with it - a
          label that shrank with distance would be unreadable exactly when the
          walker most wants to know which doorway it is.

          Drawn twice: an outline pass, then the fill on top. SVG strokes paint
          over their own fill, so a single stroked text would have the outline
          eating into every letter - `paint-order` fixes that in the spec but is
          not in react-native-svg's typings. */}
      <SvgText
        x={pin.x}
        y={pin.y - height - 10}
        stroke="rgba(0,0,0,0.65)"
        strokeWidth={4}
        fontSize={LABEL_SIZE}
        fontWeight="700"
        textAnchor="middle"
      >
        {label}
      </SvgText>
      <SvgText
        x={pin.x}
        y={pin.y - height - 10}
        fill="#ffffff"
        fontSize={LABEL_SIZE}
        fontWeight="700"
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </Svg>
  );
}
