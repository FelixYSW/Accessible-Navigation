import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  ARGeospatialView,
  isARGeospatialSupported,
  type PreviewComponent,
  type PreviewState,
  type ProjectedAnchor,
} from '../../modules/ar-geospatial';
import { AppIcon } from '../components/AppIcon';
import {
  MANEUVER_ICONS,
  MANEUVER_LABELS,
  type Maneuver,
} from '../components/maneuverIcons';
import { ARScanOverlay } from '../components/ARScanOverlay';
import { CameraStage } from '../components/CameraStage';
import { DestinationLabel } from '../components/DestinationLabel';
import { useSettings } from '../theme/SettingsContext';
import { OVERLAY_PILL_HEIGHT, OVERLAY_RED, RADIUS, SCREEN_MARGIN } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'ARPreview'>;

// Every component that can be placed by hand, and what each is for.
//
// Only two things in this app are drawn at a fixed point in the world - the
// guidance band and the destination pin. The compass band follows the camera
// and the hazard boxes follow the detector, so neither is a thing you can put
// somewhere.
//
// So everything but the pin is the same band, differing only in the shape of
// the run a tap lays down. They are named after the manoeuvres the navigation
// screen classifies real turns into, and bend by the middle angle of each of
// those bands - a route calling for a sharp left draws what 'Sharp L' places.
//
// Paired by severity rather than grouped by side, because the useful
// comparison is between a slight turn and a sharp one; left against right is
// a mirror image and the geometry behaves identically either way.
// Each placement also names the manoeuvre the navigation screen would call it,
// which is what puts that screen's own arrow on this one. Scrolling the picker
// therefore walks through every arrow the header card can show - the whole set
// bar `locating`, which is not a turn but the state before there is one.
const COMPONENTS: {
  key: PreviewComponent;
  label: string;
  place: string;
  hint: string;
  maneuver: Maneuver;
}[] = [
  { key: 'path', label: 'Path', place: 'a straight path', hint: 'A straight stretch of the guidance band', maneuver: 'straight' },
  { key: 'slight-left', label: 'Slight L', place: 'a slight left', hint: 'A gentle bend to the left, as a kink in a pavement', maneuver: 'slight-left' },
  { key: 'slight-right', label: 'Slight R', place: 'a slight right', hint: 'A gentle bend to the right, as a kink in a pavement', maneuver: 'slight-right' },
  { key: 'left', label: 'Left', place: 'a left turn', hint: 'A right-angle turn to the left, as at a junction', maneuver: 'left' },
  { key: 'right', label: 'Right', place: 'a right turn', hint: 'A right-angle turn to the right, as at a junction', maneuver: 'right' },
  { key: 'sharp-left', label: 'Sharp L', place: 'a sharp left', hint: 'A sharp turn back to the left', maneuver: 'sharp-left' },
  { key: 'sharp-right', label: 'Sharp R', place: 'a sharp right', hint: 'A sharp turn back to the right', maneuver: 'sharp-right' },
  { key: 'uturn-left', label: 'U-turn L', place: 'a u-turn to the left', hint: 'Doubling back to the left', maneuver: 'uturn-left' },
  { key: 'uturn-right', label: 'U-turn R', place: 'a u-turn to the right', hint: 'Doubling back to the right', maneuver: 'uturn-right' },
  { key: 'pin', label: 'Pin', place: 'a destination pin', hint: 'The destination marker', maneuver: 'arrive' },
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
  const { T, F, scaled } = useSettings();

  const [anchors, setAnchors] = useState<ProjectedAnchor[]>([]);
  const [component, setComponent] = useState<PreviewComponent>('path');
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
      // The narrowest the chevrons go, because in here the precision really is
      // perfect: the guidance is standing where it was tapped. Widening it on a
      // route is a statement about the route data, and there is no route data
      // in a preview to be unsure about.
      guidanceWidthM={3}
      previewComponent={component}
      previewClearToken={clearToken}
      onAnchorsUpdate={handleAnchorsUpdate}
      onPreviewState={handlePreviewState}
    />
  ) : undefined;

  return (
    <CameraStage isActive surface={surface}>
      <DestinationLabel anchors={anchors} label="Destination" />

      {/* Over the guidance and under the controls: it is telling the user the
          screen is not ready yet, so it must cover what is not ready without
          burying the way out. */}
      {/* `placed` as well as `ready`, because anything on the floor is proof the
          session found it - and if it is ever asked again after that, it must
          not be by covering up the thing the user is looking at. */}
      <ARScanOverlay
        ready={state.ready || state.placed > 0}
        supported={isARGeospatialSupported}
      />

      {/* The navigation screen's own header, over the band it belongs to.

          It is here so the arrow and the shape can be judged together. They
          are two halves of one instruction and they were only ever seen apart
          - the arrow while walking a route, the band while standing on a
          carpet - so nothing until now has shown whether the glyph for a sharp
          left agrees with what a sharp left actually looks like on the floor. */}
      <View style={[styles.banner, { top: insets.top + SCREEN_MARGIN }]}>
        {isARGeospatialSupported && chosen && (
          <AppIcon name={MANEUVER_ICONS[chosen.maneuver]} size={scaled(46)} color="#fff" />
        )}
        <View style={styles.bannerText}>
          <Text style={[styles.bannerLabel, { fontSize: F.h2 }]} numberOfLines={1}>
            {isARGeospatialSupported && chosen
              ? MANEUVER_LABELS[chosen.maneuver]
              : 'AR not available'}
          </Text>
          <Text style={[styles.bannerHint, { fontSize: F.sm }]} numberOfLines={2}>
            {!isARGeospatialSupported
              ? 'This device has no ARKit support, so the guidance cannot be previewed here.'
              : placed
                ? 'Walk around it to check that it stays put.'
                : `Tap the floor a couple of metres ahead to place ${chosen?.place}.`}
          </Text>
        </View>
      </View>

      <View style={[styles.controls, { bottom: insets.bottom > 0 ? insets.bottom : 32 }]}>
        {/* Picker and actions on one row, so the thing being chosen and the
            things done with it are not in two different corners. */}
        {/* Scrolls, because ten options will not fit across a phone and the
            alternatives are worse: a second row steals more of the camera than
            the controls already do, and a menu hides the choice behind a tap
            on a screen whose whole point is trying things quickly. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.picker}
          contentContainerStyle={styles.pickerRow}
        >
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
        </ScrollView>

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
  // Matching the navigation screen's banner, because it is the same banner.
  banner: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    backgroundColor: 'rgba(20,20,20,0.78)',
    borderRadius: RADIUS.section,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  bannerText: { flex: 1 },
  bannerLabel: { color: '#fff', fontWeight: '700' },
  bannerHint: { color: 'rgba(255,255,255,0.75)', marginTop: 2, lineHeight: 18 },

  controls: {
    position: 'absolute',
    left: SCREEN_MARGIN,
    right: SCREEN_MARGIN,
    alignItems: 'center',
    gap: 12,
  },
  picker: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: OVERLAY_PILL_HEIGHT / 2,
    overflow: 'hidden',
    // Stretched to the row it sits in, and this is the whole of why it scrolls.
    //
    // The parent centres its children, so without this the ScrollView is sized
    // by its own content - which makes its frame exactly as wide as all ten
    // segments laid end to end. A scroll view whose frame matches its content
    // has nothing to scroll: it takes the drag, finds no travel, and springs
    // back. Stretching pins the frame to the width actually available, and the
    // content is then genuinely wider than the window onto it.
    alignSelf: 'stretch',
  },
  // The row lives here rather than on the view above: a ScrollView lays out its
  // children through the content container, and a flexDirection on the view
  // itself is quietly ignored.
  pickerRow: { flexDirection: 'row', alignItems: 'stretch' },
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
