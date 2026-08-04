import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Canvas, Group, Line, Rect } from '@shopify/react-native-skia';
import { HAZARD_LABELS, type HazardDetection } from '../types/hazard';

const HAZARD_COLORS: Record<HazardDetection['hazardClass'], string> = {
  pothole: '#FF3B30',
  'slippery-surface': '#0A84FF',
  'broken-tactile-paving': '#FFD60A',
  'pathway-obstruction': '#FF9F0A',
};

interface HazardOverlayProps {
  detections: HazardDetection[];
  // Degrees to turn to face the next route waypoint, relative to the device's
  // current compass heading. 0 = straight ahead, +90 = turn right, -90 = left.
  arrowBearing?: number;
}

// Lightweight 2D overlay (bounding boxes + directional arrow) rendered with
// Skia instead of a full 3D AR engine, per the report's Universal Design /
// battery-efficiency rationale (Investigation Report, 2.2.2 Sub-Domain 3).
export function HazardOverlay({ detections, arrowBearing }: HazardOverlayProps) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        {detections.map((detection) => {
          const box = detection.boundingBox;
          const color = HAZARD_COLORS[detection.hazardClass];
          return (
            <Rect
              key={detection.id}
              x={box.x * width}
              y={box.y * height}
              width={box.width * width}
              height={box.height * height}
              color={color}
              style="stroke"
              strokeWidth={3}
            />
          );
        })}

        {arrowBearing !== undefined && (
          <DirectionalArrow centerX={width / 2} topY={80} bearing={arrowBearing} />
        )}
      </Canvas>

      {detections.map((detection) => (
        <Text
          key={detection.id}
          style={[
            styles.label,
            {
              left: detection.boundingBox.x * width,
              top: detection.boundingBox.y * height - 20,
              color: HAZARD_COLORS[detection.hazardClass],
            },
          ]}
        >
          {HAZARD_LABELS[detection.hazardClass]} {Math.round(detection.confidence * 100)}%
        </Text>
      ))}
    </View>
  );
}

function DirectionalArrow({
  centerX,
  topY,
  bearing,
}: {
  centerX: number;
  topY: number;
  bearing: number;
}) {
  const size = 36;
  const tip = { x: centerX, y: topY };
  const left = { x: centerX - size * 0.6, y: topY + size };
  const right = { x: centerX + size * 0.6, y: topY + size };

  return (
    <Group origin={{ x: centerX, y: topY + size / 2 }} transform={[{ rotate: (bearing * Math.PI) / 180 }]}>
      <Line p1={tip} p2={left} color="#30D158" strokeWidth={6} />
      <Line p1={tip} p2={right} color="#30D158" strokeWidth={6} />
    </Group>
  );
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
