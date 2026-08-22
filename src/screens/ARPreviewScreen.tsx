import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  ARGeospatialView,
  isARGeospatialSupported,
  type PreviewComponent,
  type PreviewRenderer,
  type PreviewState,
  type ProjectedAnchor,
} from '../../modules/ar-geospatial';
import { ARScanOverlay } from '../components/ARScanOverlay';
import { CameraStage } from '../components/CameraStage';
import { GroundPath } from '../components/GroundPath';
import { DestinationPin } from '../components/DestinationPin';
import { useSettings } from '../theme/SettingsContext';
import { OVERLAY_PILL_HEIGHT, OVERLAY_RED, RADIUS, SCREEN_MARGIN } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'ARPreview'>;

// Every component that can be placed by hand, and what each is for.
//
// The list is short because only two things in this app are drawn at a fixed
// point in the world - the guidance band and the destination pin. The compass
// band follows the camera and the hazard boxes follow the detector, so neither
// is a thing you can put somewhere. Path and Turn are the same component; they
// differ only in the shape of the run a tap lays down.
const COMPONENTS: { key: PreviewComponent; label: string; hint: string }[] = [
  { key: 'path', label: 'Path', hint: 'A stretch of the guidance band, leading away from you' },
  { key: 'turn', label: 'Turn', hint: 'The same band with a right-angle corner halfway along' },
  { key: 'pin', label: 'Pin', hint: 'The destination marker' },
];

// The two ways of drawing it, so they can be compared on a real floor.
//
// "Scene" is 3D geometry inside the AR session, drawn by SceneKit in the same
// pass as the camera image. "Overlay" is what the navigation screen ships: the
// shape is projected to screen coordinates natively, sent to JS, and drawn in
// SVG on top of the camera preview - which costs a bridge hop and a React render
// before any of it appears, so it is always a frame or two behind the picture it
// is lying on. That lag is what makes an overlay slide when the phone moves, and
// it is the thing this comparison exists to show.
const RENDERERS: { key: PreviewRenderer; label: string; hint: string }[] = [
  { key: 'scene', label: 'Scene', hint: '3D geometry inside the AR session' },
  { key: 'overlay', label: 'Overlay', hint: 'Drawn on top of the camera, as the route screen does' },
];

// A sandbox for the AR guidance: choose a component, tap the floor, and it
// appears exactly where you tapped.
//
// It exists because the guidance is otherwise only reachable by planning a real
// route and walking it, which is a slow way to answer "does this path look
// right" - and impossible at a desk. Everything here runs on ARKit alone, with
// no API key passed and therefore no Geospatial session, so it works indoors,
// underground, and anywhere Street View has never been.
//
// What it draws is not a mock-up. The native side projects each placement
// through exactly the same code path as a real route, with the same `kind`
// values, so this screen and AR Navigation are looking at the same drawing.
export function ARPreviewScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { T, F } = useSettings();

  const [anchors, setAnchors] = useState<ProjectedAnchor[]>([]);
  const [component, setComponent] = useState<PreviewComponent>('path');
  const [renderer, setRenderer] = useState<PreviewRenderer>('scene');
  const [clearToken, setClearToken] = useState(0);
  // How many things are down comes from the native side rather than from the
  // length of `anchors`, because under the scene renderer that list is empty by
  // design - the scene is drawing the band, so nothing is sent over to draw.
  const [state, setState] = useState<PreviewState>({ ready: false, placed: 0 });

  const handleAnchorsUpdate = useCallback(
    (event: { nativeEvent: { anchors: ProjectedAnchor[] } }) =>
      setAnchors(event.nativeEvent.anchors),
    [],
  );

  const handlePreviewState = useCallback(
    (event: { nativeEvent: PreviewState }) => setState(event.nativeEvent),
    [],
  );

  const placed = state.placed > 0;
  const chosen = COMPONENTS.find((entry) => entry.key === component);

  // No `apiKey` prop, deliberately. Passing one would start a Geospatial
  // session that has nothing to localise against indoors and would report
  // failures this screen has no use for.
  const surface = isARGeospatialSupported ? (
    <ARGeospatialView
      style={StyleSheet.absoluteFill}
      previewMode
      previewComponent={component}
      previewRenderer={renderer}
      previewClearToken={clearToken}
      onAnchorsUpdate={handleAnchorsUpdate}
      onPreviewState={handlePreviewState}
    />
  ) : undefined;

  return (
    <CameraStage isActive surface={surface}>
      <GroundPath anchors={anchors} color={T.green} />
      <DestinationPin anchors={anchors} label="Destination" />

      {/* Over the guidance and under the controls: it is telling the user the
          screen is not ready yet, so it must cover what is not ready without
          burying the way out. */}
      <ARScanOverlay ready={state.ready} supported={isARGeospatialSupported} />

      <View style={[styles.card, { top: insets.top + SCREEN_MARGIN }]}>
        <Text style={[styles.title, { fontSize: F.body }]}>
          {isARGeospatialSupported ? `Tap the floor to place a ${chosen?.label.toLowerCase()}` : 'AR not available'}
        </Text>
        <Text style={[styles.body, { fontSize: F.tinySm }]}>
          {!isARGeospatialSupported
            ? 'This device has no ARKit support, so the guidance cannot be previewed here.'
            : placed
              ? `${chosen?.hint}. Walk around what you have placed to check that it stays put.`
              : 'Tap the floor a couple of metres ahead of you.'}
        </Text>
      </View>

      <View style={[styles.controls, { bottom: insets.bottom > 0 ? insets.bottom : 32 }]}>
        {/* Picker and actions on one row, so the thing being chosen and the
            things done with it are not in two different corners. */}
        <View style={styles.picker}>
          {COMPONENTS.map((entry, index) => (
            <React.Fragment key={entry.key}>
              {index > 0 && <View style={styles.divider} />}
              <Pressable
                onPress={() => setComponent(entry.key)}
                style={[styles.segment, { minHeight: F.micro * 3 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: entry.key === component }}
                accessibilityLabel={`${entry.label}. ${entry.hint}`}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { fontSize: F.micro },
                    entry.key === component && { color: T.green },
                  ]}
                >
                  {entry.label}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>

        {/* The two renderers, side by side on the same floor.
            Which one is better is not really arguable in the abstract - it is a
            question about how a moving phone feels, and the only honest way to
            answer it is to put both on the same pavement and switch. */}
        <View style={styles.picker}>
          {RENDERERS.map((entry, index) => (
            <React.Fragment key={entry.key}>
              {index > 0 && <View style={styles.divider} />}
              <Pressable
                onPress={() => setRenderer(entry.key)}
                style={[styles.segment, { minHeight: F.micro * 3 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: entry.key === renderer }}
                accessibilityLabel={`${entry.label}. ${entry.hint}`}
              >
                <Text
                  style={[
                    styles.segmentLabel,
                    { fontSize: F.micro },
                    entry.key === renderer && { color: T.green },
                  ]}
                >
                  {entry.label}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => setClearToken((token) => token + 1)}
            disabled={!placed}
            style={[styles.action, styles.clear, !placed && styles.actionDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Clear everything placed"
          >
            <Text style={[styles.actionText, { fontSize: F.sm }]}>Clear</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            style={[styles.action, { backgroundColor: OVERLAY_RED }]}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
          >
            <Text style={[styles.actionText, { fontSize: F.sm }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </CameraStage>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    backgroundColor: 'rgba(20,20,20,0.78)',
    borderRadius: RADIUS.section,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  title: { color: '#fff', fontWeight: '700' },
  body: { color: 'rgba(255,255,255,0.75)', marginTop: 4, lineHeight: 18 },
  controls: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    alignItems: 'center',
    gap: 12,
  },
  picker: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: OVERLAY_PILL_HEIGHT / 2,
    overflow: 'hidden',
  },
  segment: {
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  segmentLabel: { color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  divider: {
    width: StyleSheet.hairlineWidth * 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginVertical: 8,
  },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    borderRadius: RADIUS.small,
    paddingVertical: 11,
    paddingHorizontal: 26,
  },
  clear: { backgroundColor: 'rgba(255,255,255,0.16)' },
  // Dimmed rather than hidden, so the row does not reflow the moment the first
  // thing is placed.
  actionDisabled: { opacity: 0.4 },
  actionText: { color: '#fff', fontWeight: '700' },
});
