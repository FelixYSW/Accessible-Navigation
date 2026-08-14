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
///
/// The id is what makes an anchor stable. Anchors are the one thing on this
/// screen that must not move once placed, so they are matched by id rather than
/// by list position: as the walker advances, points fall off the back of the
/// list and new ones appear at the front, and everything still in the middle
/// keeps its id and therefore keeps its anchor. Diffing by position instead
/// would destroy and recreate the lot on every location fix, and re-created
/// anchors jump.
struct GeoAnchorRecord: Record {
  @Field var id: Int = 0
  /// "route" for the points the chevrons are drawn on, "destination" for the
  /// journey's end. Only route points get a chevron and only route points take
  /// part in working out which way the run is facing - a destination marker
  /// sits where it sits and has no direction of travel through it.
  @Field var kind: String = "route"
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
}

/// The chevron painted on the ground at each anchored route point, and the
/// assumption about how high the phone is held.
///
/// The shape is built and projected here rather than drawn as a scaled sprite
/// in JS, because a flat marker lying on the pavement is foreshortened - it
/// gets shallower as well as smaller with distance, and its far edge shrinks
/// faster than its near one. Projecting the actual corners through the ARKit
/// camera gets that for free and gets it exactly right, including as the phone
/// is tilted, which is the difference between paint on the road and a sticker
/// on the lens.
enum GroundChevron {
  /// Roughly how far below the phone the pavement is, used to drop the anchors
  /// from the reported camera altitude onto the ground.
  static let cameraHeightM: Double = 1.4

  /// One chevron in its own frame, in metres: x across the path, y along it.
  ///
  /// 1.3m across and 1.1m deep - about the width of a pavement, and big enough
  /// that the nearest one fills a good part of the lower screen. Sized against
  /// the 1.5m anchor spacing rather than chosen in isolation: at this depth the
  /// run leaves only a 40cm gap between chevrons, so it reads as a continuous
  /// painted ribbon leading away rather than as separate marks that have to be
  /// picked out of the pavement one at a time.
  static let outline: [(across: Float, ahead: Float)] = [
    (0, 0.55), (0.65, -0.2), (0.65, -0.55), (0, 0.2), (-0.65, -0.55), (-0.65, -0.2),
  ]
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
  /// How far ahead the control anchors sit, in metres. Matches the distances
  /// the JS side labels them with.
  static let testDistancesM: [Double] = [3, 6, 10]

  let onGeospatialUpdate = EventDispatcher()
  let onAnchorsUpdate = EventDispatcher()
  let onHazards = EventDispatcher()

  /// The same detector the Hazard Detection screen runs, fed from ARKit's
  /// frames instead of an AVFoundation session. ARKit owns the camera on this
  /// screen, so there is no second stream to read - and no need for one, since
  /// its frames are the same frames.
  private let detector = HazardDetector()
  private var reportedDetectorFailure = false

  private let sceneView = ARSCNView()
  private var garSession: GARSession?
  private var apiKey: String?

  /// Route points waiting for Earth to start tracking, and the anchors made
  /// from them once it has, kept by id so the two can be reconciled without
  /// disturbing anchors that are already down.
  private var requestedAnchors: [(id: Int, kind: String, coordinate: CLLocationCoordinate2D)] = []
  private var placedAnchors: [Int: GARAnchor] = [:]
  private var anchorsAreStale = false

  /// Whether to plant the plain ARKit control anchors. Only the Geospatial test
  /// screen wants them; on a real route they would be three stray marks on the
  /// floor with no meaning.
  private var showControlAnchors = false

  /// Plain ARKit anchors, planted straight ahead on the floor as soon as the
  /// camera is tracking and independent of anything geospatial.
  ///
  /// They are the control in the experiment. ARKit's tracking needs no VPS, no
  /// GPS and no coverage, so these can be checked anywhere - indoors, in a
  /// stairwell, in an alley. If they stay stuck to the floor while the phone is
  /// walked around, the tracking is sound and the drift problem is solved
  /// whatever Geospatial turns out to offer. If they crawl, nothing built on
  /// top of this will hold still either.
  private var localAnchors: [ARAnchor] = []

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
      (
        id: $0.id,
        kind: $0.kind,
        coordinate: CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
      )
    }
    anchorsAreStale = true
  }

  func setShowControlAnchors(_ show: Bool) {
    showControlAnchors = show
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
    placeLocalAnchorsIfNeeded(frame: frame)
    detectHazards(in: frame)

    guard let garSession else {
      // No ARCore session yet - the local anchors are still worth drawing, so
      // the tracking can be judged on its own.
      emitAnchors(arFrame: frame)
      return
    }

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

  /// The detector throttles itself, so this can be called on every frame - it
  /// returns immediately on the ones it decides to skip.
  private func detectHazards(in frame: ARFrame) {
    if let failure = detector.loadFailure {
      guard !reportedDetectorFailure else { return }
      reportedDetectorFailure = true
      onHazards(["hazards": [] as [[String: Any]], "error": failure])
      return
    }

    // ARKit hands over its capture buffer in the camera's native landscape
    // orientation, a quarter turn from the portrait frame it is displayed in.
    detector.detect(pixelBuffer: frame.capturedImage, orientation: .right) { [weak self] hazards in
      self?.onHazards(["hazards": hazards])
    }
  }

  // MARK: - Geospatial

  private func handle(garFrame: GARFrame, arFrame: ARFrame) {
    guard let earth = garFrame.earth else { return }

    let localised = earth.earthState == .enabled && earth.trackingState == .tracking
    let transform = localised ? earth.cameraGeospatialTransform : nil

    if let transform {
      requestVpsAvailabilityOnce(at: transform.coordinate)
      syncAnchorsIfNeeded(cameraAltitude: transform.altitude)
    }
    emitAnchors(arFrame: arFrame)

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
  /// only works where that data exists. Roughly a phone's carrying height under
  /// the camera is the pavement, near enough, and it needs no coverage at all.
  private func syncAnchorsIfNeeded(cameraAltitude: CLLocationDistance) {
    guard anchorsAreStale, let garSession else { return }
    anchorsAreStale = false

    // Only the difference is applied. An anchor that is still wanted is left
    // exactly as it is - not removed and re-made at the same coordinate, which
    // would look identical in the code and visibly twitch on screen, since a
    // fresh anchor is re-resolved against the current pose.
    let wanted = Set(requestedAnchors.map(\.id))
    for id in placedAnchors.keys.filter({ !wanted.contains($0) }) {
      if let anchor = placedAnchors.removeValue(forKey: id) {
        garSession.remove(anchor)
      }
    }

    // Identity: the anchor is a point on the route, so which way it "faces"
    // carries no meaning - the direction is drawn from the run of them.
    let orientation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)

    for request in requestedAnchors where placedAnchors[request.id] == nil {
      do {
        placedAnchors[request.id] = try garSession.createAnchor(
          coordinate: request.coordinate,
          altitude: cameraAltitude - GroundChevron.cameraHeightM,
          eastUpSouthQAnchor: orientation
        )
      } catch {
        report(failure: "Could not anchor a route point: \(error.localizedDescription)")
      }
    }
  }

  /// Plants the control anchors once, the moment tracking is good enough to
  /// trust a position. They go on the floor - a fixed drop below the camera -
  /// straight ahead of wherever the phone is pointing.
  private func placeLocalAnchorsIfNeeded(frame: ARFrame) {
    guard showControlAnchors, localAnchors.isEmpty else { return }
    guard case .normal = frame.camera.trackingState else { return }

    let camera = frame.camera.transform
    let eye = simd_float3(camera.columns.3.x, camera.columns.3.y, camera.columns.3.z)

    // The camera looks down its own -Z. Flattened onto the horizontal plane,
    // so that pointing the phone slightly up or down doesn't send the row of
    // anchors into the sky or through the floor.
    let ahead = simd_float3(-camera.columns.2.x, 0, -camera.columns.2.z)
    guard simd_length(ahead) > 0.001 else { return }
    let direction = simd_normalize(ahead)

    for distance in Self.testDistancesM {
      var transform = matrix_identity_float4x4
      transform.columns.3 = simd_float4(
        eye + direction * Float(distance) - simd_float3(0, Float(GroundChevron.cameraHeightM), 0),
        1
      )
      let anchor = ARAnchor(name: "control-\(distance)", transform: transform)
      sceneView.session.add(anchor: anchor)
      localAnchors.append(anchor)
    }
  }

  /// Where every anchor lands on screen, in points, for the JS layer to draw
  /// on. Both kinds go in the same event so the two can be compared directly:
  /// if the control anchors hold and the geospatial ones wander, the problem is
  /// the localisation rather than the tracking.
  private func emitAnchors(arFrame: ARFrame) {
    let viewport = bounds.size
    guard viewport.width > 0, viewport.height > 0 else { return }

    var projected: [[String: Any]] = []

    for (index, anchor) in localAnchors.enumerated() {
      projected.append(
        project(
          position: origin(of: anchor.transform),
          index: index,
          kind: "local",
          forward: nil,
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    // Route order matters here in a way it did not for the control anchors:
    // each chevron is turned to face the next point along, so the run of them
    // follows the pavement round a corner. Markers are held out of this - a
    // destination pin has no direction through it, and letting one join the
    // chain would swing the last chevron towards it.
    let route = requestedAnchors.compactMap { request -> (id: Int, position: simd_float3)? in
      guard request.kind == "route" else { return nil }
      guard let anchor = placedAnchors[request.id], anchor.hasValidTransform else { return nil }
      return (id: request.id, position: origin(of: anchor.transform))
    }

    // Everything that is a point rather than a path: the destination pin. Sent
    // with its own kind and no outline, since the JS side draws it as a sprite
    // standing at the projected point rather than as a shape on the ground.
    for request in requestedAnchors where request.kind != "route" {
      guard let anchor = placedAnchors[request.id], anchor.hasValidTransform else { continue }
      projected.append(
        project(
          position: origin(of: anchor.transform),
          index: request.id,
          kind: request.kind,
          forward: nil,
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    var forwards: [simd_float3] = []
    for index in route.indices {
      let toNext = index + 1 < route.count
        ? flattened(route[index + 1].position - route[index].position)
        : nil
      // The last point has nothing to aim at, so it keeps the direction of the
      // leg that reached it; a repeated coordinate does the same rather than
      // collapsing to a zero-length arrow.
      forwards.append(toNext ?? forwards.last ?? cameraForward(arFrame))
    }

    for (index, point) in route.enumerated() {
      projected.append(
        project(
          position: point.position,
          index: point.id,
          kind: "geospatial",
          forward: forwards[index],
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    onAnchorsUpdate(["anchors": projected])
  }

  /// One anchor, as the JS layer needs it: where its centre lands on screen,
  /// and - when it is a route point - the six screen corners of the chevron
  /// lying flat on the ground there.
  private func project(
    position: simd_float3,
    index: Int,
    kind: String,
    forward: simd_float3?,
    arFrame: ARFrame,
    viewport: CGSize
  ) -> [String: Any] {
    let centre = screenPoint(of: position, arFrame: arFrame, viewport: viewport)

    var payload: [String: Any] = [
      "index": index,
      "kind": kind,
      "x": centre.point.x,
      "y": centre.point.y,
      "distance": Double(centre.distance),
      "visible": centre.inFront,
    ]

    if let forward, centre.inFront {
      // Right-handed world with +Y up, so forward x up points to the walker's
      // right - the axis the chevron's width runs along.
      let right = simd_cross(forward, simd_float3(0, 1, 0))
      var outline: [Double] = []
      var wholeShapeInFront = true

      for corner in GroundChevron.outline {
        let world = position + right * corner.across + forward * corner.ahead
        let projectedCorner = screenPoint(of: world, arFrame: arFrame, viewport: viewport)
        // One corner behind the lens takes the whole chevron with it: a partly
        // projected polygon is not a smaller chevron, it is a torn one.
        if !projectedCorner.inFront {
          wholeShapeInFront = false
          break
        }
        outline.append(Double(projectedCorner.point.x))
        outline.append(Double(projectedCorner.point.y))
      }

      if wholeShapeInFront {
        payload["outline"] = outline
      }
    }

    return payload
  }

  private func screenPoint(
    of position: simd_float3,
    arFrame: ARFrame,
    viewport: CGSize
  ) -> (point: CGPoint, distance: Float, inFront: Bool) {
    // Anything behind the lens projects onto the screen as readily as anything
    // in front of it, so being in front has to be checked separately: in
    // camera space the view looks down -Z.
    let inCameraSpace = simd_mul(arFrame.camera.transform.inverse, simd_float4(position, 1))
    let point = arFrame.camera.projectPoint(
      position,
      orientation: .portrait,
      viewportSize: viewport
    )

    return (
      point: point,
      distance: simd_length(simd_float3(inCameraSpace.x, inCameraSpace.y, inCameraSpace.z)),
      inFront: inCameraSpace.z < 0
    )
  }

  private func origin(of transform: simd_float4x4) -> simd_float3 {
    simd_float3(transform.columns.3.x, transform.columns.3.y, transform.columns.3.z)
  }

  /// A direction flattened onto the horizontal plane and normalised, or nil if
  /// there is nothing left of it once the vertical part is dropped.
  private func flattened(_ vector: simd_float3) -> simd_float3? {
    let level = simd_float3(vector.x, 0, vector.z)
    guard simd_length(level) > 0.001 else { return nil }
    return simd_normalize(level)
  }

  private func cameraForward(_ arFrame: ARFrame) -> simd_float3 {
    let transform = arFrame.camera.transform
    let lookingAt = simd_float3(-transform.columns.2.x, 0, -transform.columns.2.z)
    return flattened(lookingAt) ?? simd_float3(0, 0, -1)
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
