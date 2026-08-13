// ARCore's iOS SDK has no umbrella Swift module: it ships one XCFramework per
// subspec (ARCoreBase, ARCoreGARSession, ARCoreGeospatial), and each is its
// own module. `import ARCore` matches the pod name, not a module, and does not
// resolve - the session types live in ARCoreGARSession and everything
// geospatial, including the pose and the VPS check, in ARCoreGeospatial.
import ARCoreBase
import ARCoreGARSession
import ARCoreGeospatial
import ARKit
import ExpoModulesCore

/// A route point to plant an anchor on.
struct GeoAnchorRecord: Record {
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
}

/// An ARKit camera preview whose frames are also fed to ARCore's Geospatial
/// API, reporting back where the device is in the world and where each anchored
/// route point lands on screen.
///
/// The split of work is deliberate. ARKit does the tracking: it is the platform's
/// own visual-inertial odometry, it needs no coverage of any kind, and it is
/// what stops the arrows drifting - a point fixed in ARKit's world stays put
/// whether or not anything else is available. ARCore's Geospatial API sits on
/// top and answers a different question: where that world actually is on Earth.
/// Where Street View has been, its VPS localisation gets that to about a metre;
/// where it hasn't, it falls back to GPS and is no better than the phone's own
/// fix - but the tracking underneath is unaffected either way.
final class ARGeospatialView: ExpoView, ARSessionDelegate {
  let onGeospatialUpdate = EventDispatcher()
  let onAnchorsUpdate = EventDispatcher()

  private let sceneView = ARSCNView()
  private var garSession: GARSession?
  private var apiKey: String?

  /// Route points waiting for Earth to start tracking, and the anchors made
  /// from them once it has.
  private var requestedAnchors: [CLLocationCoordinate2D] = []
  private var placedAnchors: [GARAnchor] = []
  private var anchorsAreStale = false

  private var vpsAvailability = "unknown"
  private var vpsRequested = false
  private var lastUpdateSent = Date.distantPast

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    clipsToBounds = true
    sceneView.frame = bounds
    sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    sceneView.session.delegate = self
    addSubview(sceneView)

    startTracking()
  }

  deinit {
    sceneView.session.pause()
  }

  // MARK: - Props

  func setApiKey(_ key: String) {
    guard key != apiKey, !key.isEmpty else { return }
    apiKey = key

    do {
      let session = try GARSession(apiKey: key, bundleIdentifier: nil)
      let configuration = GARSessionConfiguration()
      configuration.geospatialMode = .enabled
      var configurationError: NSError?
      session.setConfiguration(configuration, error: &configurationError)

      if let configurationError {
        report(failure: "Geospatial mode unavailable: \(configurationError.localizedDescription)")
        return
      }
      garSession = session
    } catch {
      report(failure: "Could not start ARCore: \(error.localizedDescription)")
    }
  }

  func setAnchors(_ anchors: [GeoAnchorRecord]) {
    requestedAnchors = anchors.map {
      CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
    }
    anchorsAreStale = true
  }

  // MARK: - ARKit

  private func startTracking() {
    let configuration = ARWorldTrackingConfiguration()
    // Gravity alone, not gravityAndHeading: the Geospatial API establishes the
    // world's heading itself, and letting ARKit align to the magnetometer as
    // well puts two sources of north in the same session.
    configuration.worldAlignment = .gravity
    // The ground the arrows are drawn on, found rather than assumed.
    configuration.planeDetection = [.horizontal]
    sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard let garSession else { return }

    do {
      let garFrame = try garSession.update(frame)
      handle(garFrame: garFrame, arFrame: frame)
    } catch {
      // A single dropped frame is not worth reporting - the next one is
      // milliseconds away, and an error banner that flickers on and off is
      // worse than none.
    }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    report(failure: "Camera tracking failed: \(error.localizedDescription)")
  }

  // MARK: - Geospatial

  private func handle(garFrame: GARFrame, arFrame: ARFrame) {
    guard let earth = garFrame.earth else { return }

    let localised = earth.earthState == .enabled && earth.trackingState == .tracking
    let transform = localised ? earth.cameraGeospatialTransform : nil

    if let transform {
      requestVpsAvailabilityOnce(at: transform.coordinate)
      rebuildAnchorsIfNeeded(cameraAltitude: transform.altitude)
      projectAnchors(in: garFrame, arFrame: arFrame)
    }

    // Throttled: ARKit runs at 60Hz, and the numbers on screen are read by a
    // human standing still. Anchor positions are sent every frame; only this
    // summary is rate-limited.
    guard Date().timeIntervalSince(lastUpdateSent) > 0.1 else { return }
    lastUpdateSent = Date()

    onGeospatialUpdate([
      "tracking": localised,
      "trackingState": describe(state: earth.trackingState),
      "vpsAvailability": vpsAvailability,
      "latitude": transform?.coordinate.latitude ?? 0,
      "longitude": transform?.coordinate.longitude ?? 0,
      "altitude": transform?.altitude ?? 0,
      // Deprecated in favour of the eastUpSouthQTarget quaternion, but still
      // the one reading that is already a compass bearing - which is what the
      // route maths on the JS side works in.
      "heading": transform?.heading ?? 0,
      "horizontalAccuracy": transform?.horizontalAccuracy ?? 0,
      "headingAccuracy": transform?.orientationYawAccuracy ?? 0,
    ])
  }

  /// Anchors are planted a fixed drop below the camera rather than on a terrain
  /// anchor, which would need its own round trip to Google's elevation data and
  /// only works where that data exists. A metre and a half under the phone is
  /// the pavement, near enough, and it works with no coverage at all.
  private func rebuildAnchorsIfNeeded(cameraAltitude: CLLocationDistance) {
    guard anchorsAreStale, let garSession else { return }
    anchorsAreStale = false

    for anchor in placedAnchors {
      garSession.remove(anchor)
    }
    placedAnchors = []

    // Identity: the anchor is a point on the route, so which way it "faces"
    // carries no meaning - the direction is drawn from the run of them.
    let orientation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)

    for coordinate in requestedAnchors {
      do {
        let anchor = try garSession.createAnchor(
          coordinate: coordinate,
          altitude: cameraAltitude - 1.5,
          eastUpSouthQAnchor: orientation
        )
        placedAnchors.append(anchor)
      } catch {
        report(failure: "Could not anchor a route point: \(error.localizedDescription)")
      }
    }
  }

  /// Where each anchor lands on screen, in points, for the JS layer to draw on.
  private func projectAnchors(in garFrame: GARFrame, arFrame: ARFrame) {
    guard !placedAnchors.isEmpty else { return }

    let viewport = bounds.size
    guard viewport.width > 0, viewport.height > 0 else { return }

    let cameraTransform = arFrame.camera.transform
    let projected: [[String: Any]] = garFrame.anchors.enumerated().map { index, anchor in
      let world = anchor.transform.columns.3
      let position = simd_float3(world.x, world.y, world.z)

      // Anything behind the lens projects to a point on screen as readily as
      // anything in front of it, so being in front has to be checked
      // separately: in camera space the view looks down -Z.
      let inCameraSpace = simd_mul(cameraTransform.inverse, simd_float4(position, 1))
      let isAhead = inCameraSpace.z < 0

      let point = arFrame.camera.projectPoint(
        position,
        orientation: .portrait,
        viewportSize: viewport
      )

      return [
        "index": index,
        "x": point.x,
        "y": point.y,
        "distance": Double(simd_length(simd_float3(inCameraSpace.x, inCameraSpace.y, inCameraSpace.z))),
        "visible": isAhead && anchor.hasValidTransform,
      ]
    }

    onAnchorsUpdate(["anchors": projected])
  }

  /// Asked once, as soon as there is a location to ask about. The answer is
  /// what tells the user whether to expect metre accuracy here or the phone's
  /// own GPS - and it is a property of the place, so it does not change while
  /// they stand in it.
  private func requestVpsAvailabilityOnce(at coordinate: CLLocationCoordinate2D) {
    guard !vpsRequested, let garSession else { return }
    vpsRequested = true

    garSession.checkVPSAvailability(coordinate: coordinate) { [weak self] availability in
      guard let self else { return }
      switch availability {
      case .available:
        self.vpsAvailability = "available"
      case .unavailable:
        self.vpsAvailability = "unavailable"
      default:
        self.vpsAvailability = "unknown"
      }
    }
  }

  private func describe(state: GARTrackingState) -> String {
    switch state {
    case .tracking: return "tracking"
    case .paused: return "paused"
    case .stopped: return "stopped"
    @unknown default: return "unknown"
    }
  }

  private func report(failure: String) {
    onGeospatialUpdate([
      "tracking": false,
      "trackingState": "error",
      "error": failure,
      "vpsAvailability": vpsAvailability,
    ])
  }
}
