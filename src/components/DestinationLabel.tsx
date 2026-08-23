import React from 'react';
import { StyleSheet } from 'react-native';
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

// Past this the pin is not drawn, matching GroundPath.pinFarCutM. An honesty
// limit rather than a rendering one: a pin placed 200m off is confidently
// pointing through three buildings.
const MAX_VISIBLE_DISTANCE_M = 60;

// How far above the pin's head the name sits.
const LABEL_GAP_PX = 14;

// How far above the ground point it sits when the renderer could not tell us
// where the head is, which happens only when the head is behind the lens.
const LABEL_GAP_NO_HEAD_PX = 40;

// The highest the label is allowed to go.
//
// Walk close enough and the pin's head leaves the top of the frame, taking the
// label with it - so the name disappears at exactly the distance where the
// walker is deciding which door is theirs. Held here instead, which is roughly
// clear of the instruction banner. A rough figure is defensible because this
// only binds in the last stride or two, and the alternative to a slightly
// misplaced label is no label.
const MIN_LABEL_Y = 180;

const LABEL_SIZE = 15;

interface DestinationLabelProps {
  anchors: ProjectedAnchor[];
  label: string;
}

export function DestinationLabel({ anchors, label }: DestinationLabelProps) {
  const pin = anchors.find((anchor) => anchor.kind === 'destination' && anchor.visible);
  if (!pin || pin.distance > MAX_VISIBLE_DISTANCE_M) return null;

  // Where the top of the pin actually lands, projected by the renderer through
  // the camera's real intrinsics.
  //
  // This used to be worked out here, from the pin's known height and an assumed
  // 62-degree field of view - and it was wrong by roughly a factor of two, which
  // put the name across the middle of the pin rather than above it. The preview
  // is cropped to fill the view, so the field actually on screen is narrower
  // than the sensor's and no constant describes it. Asking the thing that did
  // the projection is both correct and impossible to get out of step with.
  const y =
    pin.headY !== undefined
      ? Math.max(MIN_LABEL_Y, pin.headY - LABEL_GAP_PX)
      : Math.max(MIN_LABEL_Y, pin.y - LABEL_GAP_NO_HEAD_PX);

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
