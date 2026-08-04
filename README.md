# Accessible Navigation

A mobile app that uses Computer Vision (a YOLO26-based hazard detector) and a
lightweight Augmented Reality overlay to help pedestrians — especially
wheelchair and walker users — spot sidewalk hazards (potholes, slippery
surfaces, broken tactile paving, pathway obstructions) and get safe walking
routes in urban Malaysia. Built for a Final Year Project at Asia Pacific
University of Technology & Innovation.

Stack: Expo (React Native, Custom Dev Client), `react-native-vision-camera`,
`@shopify/react-native-skia` for AR overlays, `react-native-maps` +
Google Directions/Places APIs for macro-routing.

## Current status

The camera preview, map/routing screen, and AR overlay pipeline are wired
up end-to-end. Hazard detection currently uses a synthetic stub
(`src/services/hazardDetector.ts`) so the app, build, and sideload pipeline
can be validated before the trained `.tflite` YOLO26 model is integrated.

## Building the iOS app

Because iOS builds require Xcode and this project targets hardware that
can't run a modern Xcode locally, the `.ipa` is built in CI instead:

1. Add a repository secret named `GOOGLE_MAPS_API_KEY`
   (Settings → Secrets and variables → Actions) with a key that has the
   **Places API** and **Directions API** enabled.
2. Push to `main`, or run the **Build iOS IPA** workflow manually from the
   Actions tab.
3. Once it finishes, download the `AccessibleNavigation-ipa` artifact from
   the workflow run — GitHub packages it as a `.zip` automatically.
4. Unzip it to get `AccessibleNavigation.ipa`.

The `.ipa` is intentionally **unsigned** — no Apple Developer Program
membership or Expo account is needed to produce it.

## Installing on your iPhone (Sideloadly)

1. Install [Sideloadly](https://sideloadly.io/) on your Mac.
2. Connect your iPhone via USB (or Wi-Fi with Sideloadly configured for it).
3. Drag `AccessibleNavigation.ipa` into Sideloadly, sign in with your Apple
   ID (a free account works), and click Start.
4. On the iPhone, go to **Settings → General → VPN & Device Management** and
   trust the developer certificate for your Apple ID.
5. A free Apple ID signature expires after 7 days — re-run Sideloadly with
   the same `.ipa` to reinstall when it does.

## Local development

```sh
cp .env.example .env   # fill in GOOGLE_MAPS_API_KEY
npm install
npx expo prebuild --platform ios   # generates ios/ (gitignored, regenerate anytime)
```

Native modules (`react-native-vision-camera`, maps) mean this app cannot run
in Expo Go — it needs a custom dev client / native build.
