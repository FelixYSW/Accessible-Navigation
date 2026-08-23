import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import type { ProjectedAnchor } from '../../modules/ar-geospatial';

// The destination's name, floating above the pin that names it.
//
// The pin itself is not here. It is geometry in the AR scene, built in
// ARGeospatialView, which is what lets a wall hide it and lets it stand on the
// ground at a believable depth. Drawing it on this layer was what made it look
// pasted on: painted over the whole picture, nothing could ever pass in front
// of it, and it had no depth relationship to the pavement it claimed to be
// standing on.
//
// The label stays here, and that split is the point rather than a leftover. A
// name drawn in the scene would shrink with distance and be unreadable exactly
// when the walker most wants to know which doorway is meant. The pin is an
// object and belongs in the world; its name is interface and belongs on the
// glass, at a size that does not change.

// How tall the pin stands in the world, in metres. Must match
// GroundPath.pinHeightM on the native side - this is only used to work out how
// far above the ground point the label has to sit to clear it.
const PIN_HEIGHT_M = 1.0;

// The camera's horizontal field of view, matching the assumption in
// GroundArrows. The projected x/y come from ARKit's real intrinsics, but this
// height is worked out here, so it is the one assumed part.
const CAMERA_FOV_DEG = 62;

// The range the native pin is drawn over, matching GroundPath.pinFarCutM and
// GroundPath.pinNearCutM. Outside it there is no pin to label.
//
// The far end is an honesty limit rather than a rendering one: a pin placed
// 200m off is confidently pointing through three buildings. The near end is a
// safety one: real perspective on a waist-high object at arm's length is a slab
// across the frame, hiding the pavement at the moment the walker steps onto it.
const MAX_VISIBLE_DISTANCE_M = 60;
const PIN_NEAR_CUT_M = 1.5;

// How far above the pin's head the label sits, and how far above the ground
// point it sits once the pin has been cut and there is no head to clear.
const LABEL_GAP_PX = 10;
const LABEL_GAP_NO_PIN_PX = 40;

const LABEL_SIZE = 15;

interface DestinationLabelProps {
  anchors: ProjectedAnchor[];
  label: string;
}

export function DestinationLabel({ anchors, label }: DestinationLabelProps) {
  const { width } = useWindowDimensions();
  const pin = anchors.find((anchor) => anchor.kind === 'destination' && anchor.visible);
  if (!pin || pin.distance > MAX_VISIBLE_DISTANCE_M) return null;

  // How tall the pin appears from here, which is the same sum the renderer is
  // doing in 3D: an object PIN_HEIGHT_M tall at this distance covers
  // `PIN_HEIGHT_M * focal / distance` pixels. Deriving the focal length from
  // the real viewport keeps it right on screens no constant was fitted to.
  //
  // No floor and no ceiling on it any more. The overlay needed both because it
  // was drawing the pin itself and true perspective across its whole range is a
  // nineteen-fold change in size; here the pin is drawn by the renderer at
  // whatever size perspective says, and this only has to agree with it.
  const focal = width / 2 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const pinPixels = (PIN_HEIGHT_M * focal) / pin.distance;

  const y =
    pin.distance <= PIN_NEAR_CUT_M
      ? pin.y - LABEL_GAP_NO_PIN_PX
      : pin.y - pinPixels - LABEL_GAP_PX;

  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Drawn twice: an outline pass, then the fill on top. SVG strokes paint
          over their own fill, so a single stroked text would have the outline
          eating into every letter - `paint-order` fixes that in the spec but is
          not in react-native-svg's typings. */}
      <SvgText
        x={pin.x}
        y={y}
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
        y={y}
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
