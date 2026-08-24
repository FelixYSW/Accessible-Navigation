# Accessible Navigation

A pedestrian navigation app for people who need to know what the pavement is
like, not just which way to turn. It plans walking routes around barriers
(steps, kerbs, steep gradients, narrow paths), flags hazards in the camera in
real time, and draws the route onto the ground through an AR overlay.

Built as a Final Year Project at Asia Pacific University of Technology &
Innovation, with Kuala Lumpur as the study area. iOS-first.

---

## Features

### Route planning

- **Distance-ranked search.** Suggestions come back nearest-first with an
  estimated walk to each — `~416 m · 11 min` — at the pace implied by the
  user's mobility aid.
- **Accessibility-aware routing.** Four mobility profiles (none, wheelchair,
  cane, walker). Each sends a different set of restrictions to the router:
  step avoidance, maximum incline, minimum path width, surface smoothness.
- **Barrier screening.** Every previewed route is checked against
  OpenStreetMap for steps, kerbs, rough surfaces and ways tagged
  `wheelchair=no`, with per-aid severity — steps with a handrail are passable
  with a cane and not in a wheelchair.
- **Road-versus-pavement breakdown.** Reports how much of a route shares the
  carriageway with traffic, because the shortest way is sometimes the shoulder
  of a main road.
- **Route alternatives** shown as tappable pills on the map, each labelled
  with its own duration and distance.

### AR navigation

- **Guidance is geometry, not an overlay.** The chevrons and the destination
  pin are SceneKit nodes inside the ARKit scene, rasterised in the same pass as
  the camera image they lie on. An overlay is computed from one frame and
  composited a frame or two later, so it is always drawn for a pose the phone
  has already left — it holds still when the phone does and slides when it
  moves. Geometry cannot be late, and a wall can hide it.
- **Geospatial anchors.** Route points are anchored to real-world coordinates
  through ARCore's Geospatial API, so a chevron stays on its bit of pavement as
  the walker moves rather than sliding with the phone.
- **Stuck to the ground, and to its slope.** Each point raycasts for the floor
  beneath *itself* rather than borrowing the one measured under the walker, so a
  run laid down a ramp follows the ramp.
- **Chevrons rather than a band.** A band wide enough to span a road is a sheet
  of paint over the road, hiding the kerb and the broken slab this app exists to
  warn about. A chevron spans the same width with two strokes a third of a metre
  thick and leaves everything between them clear.
- **Width is an admission, not a style.** It tracks how far apart the two
  answers to "where is the route" currently are — what the map says, and where
  the walker is standing — widening from 3 m to 14 m as that gap grows. Wide
  means "somewhere along here", which on a road whose pavements OSM has not
  mapped is the truth.
- **Grey behind, green ahead.** The run is cut where the walker stands. The
  covered half is invisible while walking forwards and is what makes turning
  round intelligible — otherwise a glance back at a junction shows a run leading
  away in the direction you came from, indistinguishable from an instruction to
  go that way.
- **Occlusion.** Someone stepping between the phone and the guidance hides it
  correctly; on LiDAR devices the room mesh does too.
- **3D destination pin** — an extruded teardrop with a chamfered edge, lit by
  the environment ARKit estimates from the camera feed, standing on its own
  painted contact shadow. Its size on screen is held beyond 14 m and below 6 m,
  so it is neither a speck across a junction nor a slab underfoot.
- **Compass fallback** when visual localisation is unavailable — the same
  chevron shape from a different source, so switching mid-walk reads as the
  guidance staying put rather than as the guidance changing. Only its steadiness
  differs, which is honest: that is the only thing that did change.
- **Scan prompt** while the AR session localises, with a live accuracy
  readout, and an honest "no visual coverage here" state where Street View
  imagery does not reach.
- **Preview screen** for placing each component indoors by tapping the floor,
  with no route and no Geospatial session — through the same code path a real
  route takes, so what is judged there is what ships.
- **Turn banner and arrival.** Manoeuvre glyph, distance, street name and
  progress, latching to "Arrived" on reaching the destination.

### Hazard detection

- **Four classes** — pothole, slippery surface, uneven/broken surface, pathway
  obstruction — detected on-device at 10 Hz.
- **Two screens, one detector.** Runs over ARKit frames during AR navigation
  and over a plain camera preview on the standalone Hazard Detection tab.
- **Per-type toggles** reachable without leaving the camera, as a dropdown
  pill that doubles as a master switch when collapsed.

### Accessibility

- **Voice guidance**, split into turn cues and hazard cues so either can be
  silenced independently. Routes through VoiceOver when it is running instead
  of talking over it.
- **Text size** (three steps) scaling every control, icon and touch target.
- **Dark mode**, applied to the Google basemap as well as the app chrome.
- **Reduce Motion** respected — toggle animations become cuts.
- **Screen reader labels** throughout, including spoken forms of things that
  are visual only, such as the AR progress bar's fill.
- **Colour is never the only signal** — every state that uses colour also
  changes shape or glyph.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Expo SDK 57.0.9, React Native 0.86.2, React 19.2.3, New Architecture |
| Language | TypeScript 6.0.3 |
| Navigation | React Navigation 7 — native stack + bottom tabs |
| Maps | `react-native-maps` 1.29 with the Google provider |
| Place search | Google Places — Text Search, Autocomplete, Nearby, Details |
| Routing | OpenRouteService over OpenStreetMap; Google Directions as fallback |
| Barrier data | OpenStreetMap via Overpass (three mirrors, with failover) |
| AR session | ARKit + ARCore Geospatial, in a custom Swift native module |
| AR rendering | SceneKit geometry inside `ARSCNView` — chevrons, pin, occluders |
| Hazard model | YOLO26n fine-tuned, exported to Core ML, run through Vision |
| Camera | AVFoundation (hazard screen), ARKit (AR screen) |
| 2D overlays | `react-native-svg` — hazard boxes, destination label, compass fallback |
| Sensors | `expo-sensors` device motion, for camera pitch |
| Speech | `expo-speech` + `AccessibilityInfo`, audio session via `expo-audio` |
| Storage | AsyncStorage for persisted settings |
| Icons | `expo-symbols` (SF Symbols), with `lucide-react-native` as the fallback |
| CI | GitHub Actions on `macos-26`, producing an unsigned `.ipa` |

### Why OpenStreetMap for routing

Google's pedestrian network in the study area is sparse — asked for a 763 m
walk it has been observed returning alternatives of 8.0, 8.5 and 10.0 km,
detouring around a road it would not cross. OSM carries 14,601 footways in the
same area. A pedestrian router is only as good as its pedestrian network.

Google is kept as an automatic fallback rather than deleted: ORS is a free
service on a rate-limited key, and a walking app that cannot produce a route
is worse than one that produces a mediocre one.

Place search stayed with Google, which is far better at Malaysian POI names
than OSM's geocoder.

---

## Project structure

```
src/
  screens/          MapScreen, ARNavigationScreen, ARPreviewScreen,
                    HazardDetectionScreen, SettingsScreen
  components/       Presentational + camera overlays (labels, pills, toggles, prompts)
  services/         Routing, barrier screening, hazard filtering, speech, mobility model
  utils/            geo.ts (projection, distance, route maths), format.ts
  types/            Route and hazard domain types
  theme/            Design tokens, palettes, SettingsContext
  navigation/       Root stack + tab navigator

modules/ar-geospatial/          Custom Expo native module (Swift)
  ios/ARGeospatialView.swift    ARKit session + ARCore Geospatial anchors
  ios/HazardCameraView.swift    AVFoundation preview + detection
  ios/HazardDetector.swift      Core ML + Vision, shared by both views
  ios/HazardDetector.mlpackage  The trained model

training/hazard_detector.ipynb  Colab notebook: dataset build, training, Core ML export
plugins/withModularHeaders.js   Config plugin required by the ARCore pod
.github/workflows/ios-build.yml CI
```

### Key components

The anchored guidance has no entry here, and that is the point: the chevrons
and the pin are built in `ARGeospatialView.swift` and never cross the bridge.
What is left on the JS side is what deliberately must not obey perspective.

| Component | Does |
|---|---|
| `DestinationLabel` | The destination's name, hung above the pin the native side draws. Stays flat so it cannot shrink out of legibility at range |
| `GroundArrows` | Compass-drawn fallback run, matched in shape to the anchored one |
| `ScanPrompt` | Localisation progress, with a no-coverage branch |
| `ARScanOverlay` | Held over the preview screen until ARKit has found a surface |
| `HazardOverlay` | Bounding boxes and labels over the camera |
| `HazardTypeBar` | Collapsible per-type toggles, master switch when collapsed |
| `HazardIntro` | Opening card on the hazard screen, dismissed by the user |
| `VoiceCueBar` | Turn and hazard cue switches |
| `RoutePillOverlay` | Route labels projected over the map, with overlap avoidance |
| `CameraStage` | Shared camera surface and permission handling |
| `AppIcon` | Every icon as an SF Symbol, with the lucide equivalent as fallback |
| `SegmentedField` | Segmented control that sizes segments by content rather than truncating |

### Key services

| Service | Does |
|---|---|
| `routing.ts` | Picks ORS, falls back to Google |
| `accessibleRouting.ts` | ORS profiles, restrictions, alternatives, way-type breakdown |
| `directions.ts` | Google Places + Directions |
| `accessibility.ts` | Overpass queries and per-aid barrier verdicts |
| `mobility.ts` | Speed model, duration rescaling, walk estimates |
| `hazardDetector.ts` | Confidence and class filtering of native detections |
| `voiceCues.ts` / `speech.ts` | Cue timing, VoiceOver coexistence |

---

## Deploying to your iPhone

Builds happen in CI because iOS builds need Xcode, and local development here
is on hardware that cannot run a current version of it. The `.ipa` is
**unsigned** — no Apple Developer Program membership and no Expo account are
needed.

### 1. Add the API keys as repository secrets

**Settings → Secrets and variables → Actions**

| Secret | Required | Notes |
|---|---|---|
| `GOOGLE_MAPS_API_KEY` | yes | Needs **Places API**, **Directions API**, **Maps SDK for iOS** and **Maps SDK for Android** enabled. The SDKs are what render the tiles — without them the map is blank even with a valid key. Also used for ARCore Geospatial. |
| `ORS_API_KEY` | strongly recommended | Free from [openrouteservice.org](https://openrouteservice.org/dev/#/signup), 2,000 requests/day. Without it every route falls back to Google, which routes badly for pedestrians here. |

### 2. Build

Push to `main`, or run **Build iOS IPA** manually from the Actions tab.

### 3. Download

Open the finished run and download the `AccessibleNavigation-ipa` artifact.
GitHub wraps artifacts in a `.zip` — unzip it to get
`AccessibleNavigation.ipa`.

### 4. Sideload

1. Install [Sideloadly](https://sideloadly.io/).
2. Connect the iPhone by USB.
3. Drag the `.ipa` into Sideloadly, sign in with your Apple ID (a free account
   works), and press Start.
4. On the phone: **Settings → General → VPN & Device Management**, and trust
   the certificate for your Apple ID.
5. Launch, and grant camera, location and motion permissions.

> A free Apple ID signature expires after **7 days**. Re-run Sideloadly with
> the same `.ipa` to reinstall.

**Requires iOS 15.1 or later**, and a device with ARKit support for the AR
navigation screen. The hazard detection screen works without ARKit.

---

## Local development

```sh
cp .env.example .env        # fill in GOOGLE_MAPS_API_KEY and ORS_API_KEY
npm install
npx expo prebuild --platform ios --no-install
npx tsc --noEmit            # type check
```

`ios/` and `android/` are generated by `expo prebuild` and are not committed —
regenerate them any time. Note that `modules/ar-geospatial/ios/` **is**
tracked; the `/ios` entry in `.gitignore` is root-anchored and does not match
it.

The app uses custom native modules and cannot run in Expo Go. It needs a
development build or the CI `.ipa`.

---

## The hazard model

`training/hazard_detector.ipynb` runs end to end on a free Colab T4: it builds
the dataset, fine-tunes YOLO26n, validates per class, and exports Core ML.

| Class | Source | Coverage |
|---|---|---|
| `pothole` | RDD2022 (damage type D40) | good |
| `slippery-surface` | Roboflow puddle / wet-surface sets | weak — see below |
| `broken-tactile-paving` | RDD2022 cracking (D00/D10/D20) | good, but see below |
| `pathway-obstruction` | COCO subset, collapsed to one class | strong |

To install a newly trained model, drop `HazardDetector.mlpackage` into
`modules/ar-geospatial/ios/`, commit, and push. The podspec ships it as a pod
resource, so it survives `expo prebuild` regenerating `ios/`. The app compiles
it to `.mlmodelc` on first launch and caches that.

Class names are the contract: Vision returns the label the model was trained
with, and the app checks it against `HAZARD_CLASSES`. A mismatch does not
crash — it silently drops every detection.

**Two honest caveats.** Class 2 is trained on road cracking rather than on
tactile paving specifically, so it detects broken and uneven surface and will
not reliably recognise *intact* tactile paving; it is labelled "uneven
surface" in the UI for that reason. Class 1 is the weak one — there is no
substantial public dataset of slippery surfaces with bounding boxes, because
"slippery" is not visible; standing water is, and that is what these datasets
actually label.

---

## Known limitations

- **Off-route rerouting is not implemented.** The route does not re-plan if the
  walker leaves it. The drawn run is shifted sideways to meet them and widened
  to admit the uncertainty, but it is still the original route.
- **The anchored path needs a good pose to engage.** Chevrons are only trusted
  at a horizontal accuracy of 3 m or better *and* a heading accuracy of 15° or
  better. Built-up streets often fail the heading test, and the walk then falls
  back to compass guidance, which is aimed by a magnetometer and assumes the
  camera height. It shows which way to go; it is not a survey mark.
- **Accessibility restrictions are thinly supported by the data.** The KL
  study area has 296 tagged kerbs and 228 tagged inclines against 14,601
  footways, so incline and kerb limits rarely bind in practice. Step avoidance
  does the real work, against 2,415 mapped stairways.
- **Suggestion distances are straight-line**, corrected by a pedestrian
  circuity factor. The real figure appears once a route is planned, and the
  two can differ substantially.
- **The `wheelchair` ORS profile is used for all three aids**, since ORS has
  no cane or walker profile. They differ by restriction set, not by profile.
- **Android is unbuilt.** The native module is iOS-only, and the Android icon
  assets have not been updated.
