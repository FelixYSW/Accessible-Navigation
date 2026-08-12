import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme/SettingsContext';
import { HAZARD_COLORS } from '../theme/tokens';
import { HAZARD_LABELS, type HazardDetection } from '../types/hazard';
import { HAZARD_ICONS } from './hazardIcons';

// Height reserved above each box for its label chip, so the chip clears the
// box border instead of overlapping the detection it describes. Scaled with
// Text Size, since the chip it has to clear grows with its own label.
const CHIP_OFFSET = 27;

interface HazardOverlayProps {
  detections: HazardDetection[];
}

// Lightweight 2D overlay (bounding boxes + labelled chips) rather than a full
// 3D AR engine, per the report's Universal Design / battery-efficiency
// rationale (Investigation Report, 2.2.2 Sub-Domain 3). Shared by the AR
// Navigation and Hazard Detection screens so a hazard looks identical in both.
export function HazardOverlay({ detections }: HazardOverlayProps) {
  const { width, height } = useWindowDimensions();
  const { F, scaled } = useTheme();
  const chipOffset = scaled(CHIP_OFFSET);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {detections.map((detection) => {
        const box = detection.boundingBox;
        const color = HAZARD_COLORS[detection.hazardClass];
        const Icon = HAZARD_ICONS[detection.hazardClass];
        const left = box.x * width;
        const top = box.y * height;

        return (
          <React.Fragment key={detection.id}>
            <View
              style={[
                styles.box,
                {
                  left,
                  top,
                  width: box.width * width,
                  height: box.height * height,
                  borderColor: color,
                },
              ]}
            />
            {/* The chip is a sibling of the box rather than a child: it sits
                above the box's top edge, and Android clips children that
                overflow a parent's bounds. For a detection near the top of
                the frame there is no room above it, so the chip tucks just
                inside the box instead of running off-screen. */}
            <View
              style={[
                styles.chip,
                { left, top: top >= chipOffset ? top - chipOffset : top + 4 },
              ]}
            >
              <Icon size={scaled(13)} color={color} strokeWidth={2.2} />
              <Text style={[styles.chipText, { fontSize: F.tiny }]} numberOfLines={1}>
                {HAZARD_LABELS[detection.hazardClass]} {Math.round(detection.confidence * 100)}%
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderWidth: 3,
    borderRadius: 6,
  },
  chip: {
    position: 'absolute',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 3,
  },
  chipText: { color: '#fff', fontWeight: '700' },
});
