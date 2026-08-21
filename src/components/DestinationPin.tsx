import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
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

// The classic map-pin red, and the hole punched through the bulb.
//
// Fixed rather than themed, and not the app's green. This is the one marker on
// screen that means "the thing you are walking to", and it is the only place
// the walker sees this shape - a red pin is what everyone already reads as a
// destination, and matching the guidance colour would make it one more green
// thing among the chevrons.
const PIN_RED = '#E5202E';
const HOLE_RADIUS = 6;

// How tall the pin stands in the world, in metres.
//
// About waist height on an adult. Big enough to be unmissable from across a
// junction and to read as an object standing on the pavement rather than a
// sticker on the lens, without becoming a wall that hides the doorway it is
// pointing at.
const PIN_HEIGHT_M = 1.0;

// The camera's horizontal field of view, matching the assumption in
// GroundArrows. The projected x/y come from ARKit's real intrinsics, but the
// size is worked out here, so this is the one part of the pin that is assumed
// rather than measured.
const CAMERA_FOV_DEG = 62;

// Floor and ceiling on the drawn height, in pixels. The floor keeps it findable
// at the far end of its range; the ceiling stops it filling the screen when the
// walker is standing on top of it.
const MIN_PIN_PX = 26;
const MAX_PIN_FRACTION = 0.6;

// Past this the pin is not drawn at all. Not a rendering limit - an honesty
// one. Geospatial anchors are placed against a pose whose error grows with
// range, and a pin planted 200m off would be confidently pointing through three
// buildings at a spot it has no business being sure about.
const MAX_VISIBLE_DISTANCE_M = 60;

const LABEL_SIZE = 15;

interface DestinationPinProps {
  anchors: ProjectedAnchor[];
  label: string;
}

export function DestinationPin({ anchors, label }: DestinationPinProps) {
  const { width, height: screenHeight } = useWindowDimensions();
  const pin = anchors.find((anchor) => anchor.kind === 'destination' && anchor.visible);
  if (!pin || pin.distance > MAX_VISIBLE_DISTANCE_M) return null;

  // Sized the way anything of a known height is: an object PIN_HEIGHT_M tall at
  // this distance subtends `PIN_HEIGHT_M * focal / distance` pixels.
  //
  // Replaces a single tuned constant that had the right idea and the wrong
  // ceiling - it capped the scale at a value that rendered the pin about
  // three-quarters of a metre tall from two metres away, so it shrank exactly
  // as the walker arrived. Deriving the focal length from the real viewport
  // also makes this correct on screens the constant was never fitted to.
  const focal = width / 2 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const pixels = Math.min(
    screenHeight * MAX_PIN_FRACTION,
    Math.max(MIN_PIN_PX, (PIN_HEIGHT_M * focal) / pin.distance),
  );
  const scale = pixels / PIN_HEIGHT_UNITS;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <G transform={`translate(${pin.x.toFixed(1)}, ${pin.y.toFixed(1)}) scale(${scale.toFixed(3)})`}>
        {/* Dark edge for the same reason the chevrons have one: this has to
            read against a bright pavement and a dark doorway alike. */}
        <Path d={PIN_PATH} fill={PIN_RED} stroke="rgba(0,0,0,0.55)" strokeWidth={2.5} />
        <Circle cx={0} cy={-24} r={HOLE_RADIUS} fill="#ffffff" />
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
        y={pin.y - pixels - 10}
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
        y={pin.y - pixels - 10}
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
