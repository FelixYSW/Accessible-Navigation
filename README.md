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

- **Geospatial anchors.** Chevrons are anchored to real-world coordinates via
  ARCore's Geospatial API, so they stay on their bit of pavement as the walker
  moves rather than sliding with the phone.
- **Ground-projected chevrons** drawn through a pinhole camera model with
  measured device pitch, so they foreshorten like paint on the road instead of
  scaling like a sticker on the lens.
- **Compass fallback** when visual localisation is unavailable — the guidance
  degrades rather than disappearing.
- **Scan prompt** while the AR session localises, with a live accuracy
  readout, and an honest "no visual coverage here" state where Street View
  imagery does not reach.
- **Destination pin** in AR as the walker arrives.
- **Turn banner** with manoeuvre glyph, distance, street name and progress.

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
| Hazard model | YOLO26n fine-tuned, exported to Core ML, run through Vision |
| Camera | AVFoundation (hazard screen), ARKit (AR screen) |
| 2D overlays | `react-native-svg` |
| Sensors | `expo-sensors` device motion, for camera pitch |
| Speech | `expo-speech` + `AccessibilityInfo`, audio session via `expo-audio` |
| Storage | AsyncStorage for persisted settings |
| Icons | `lucide-react-native` |
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
  screens/          MapScreen, ARNavigationScreen, HazardDetectionScreen, SettingsScreen
  components/       Presentational + camera overlays (chevrons, pills, toggles, prompts)
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

| Component | Does |
|---|---|
| `GroundChevrons` | Draws geospatially-anchored chevrons projected by the native session |
| `GroundArrows` | Compass-drawn fallback run, matched in size and style |
| `DestinationPin` | Billboard pin in AR, scaled by distance |
| `ScanPrompt` | Localisation progress, with a no-coverage branch |
| `HazardOverlay` | Bounding boxes and labels over the camera |
| `HazardTypeBar` | Collapsible per-type toggles, master switch when collapsed |
| `VoiceCueBar` | Turn and hazard cue switches |
| `RoutePillOverlay` | Route labels projected over the map, with overlap avoidance |
| `CameraStage` | Shared camera surface and permission handling |

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

- **Arrival detection and off-route rerouting are not implemented.** The route
  does not currently re-plan if the walker leaves it.
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
