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
// ARKit vends ARSCNView but the scene graph types it is filled with - SCNNode,
// SCNGeometry, the materials - are SceneKit's own module.
import SceneKit
import UIKit

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
  /// "route" for the points the ground ribbon is threaded through, "destination"
  /// for the journey's end. Only route points join the chain - a destination
  /// marker is a place, not a point the path passes through, and letting one in
  /// would drag the ribbon sideways to reach it.
  @Field var kind: String = "route"
  @Field var latitude: Double = 0
  @Field var longitude: Double = 0
}

/// The ribbon painted along the route on the ground, and the assumption about
/// how high the phone is held.
///
/// This replaced a run of separate chevrons, one per anchored route point, and
/// the reason is worth keeping. Each chevron was sized on its own, so anything
/// that varied with distance varied *per chevron* - and once distance-
/// compensated scaling was added to stop the far ones vanishing, the run
/// developed a visible pinch at whichever chevron happened to be nearest the
/// camera, with larger ones both ahead of it and behind. That is not a bug in
/// the scaling so much as a consequence of drawing a continuous thing as a row
/// of discrete ones: every rule applied to the parts has to be made to agree
/// across the joins, and eventually one of them will not.
///
/// A ribbon has no parts. It is a single polygon with one width in the world,
/// so there is nothing to disagree - it simply narrows towards the horizon the
/// way a painted line does, and the narrowing is the direction cue. It is also
/// cheaper: two projected points per route anchor instead of six.
///
/// It is built and projected here rather than drawn as a scaled sprite in JS
/// because a flat shape lying on the pavement is foreshortened, and projecting
/// its real edges through the ARKit camera gets that exactly right, including
/// as the phone is tilted - the difference between paint on the road and a
/// sticker on the lens.
enum GroundPath {
  /// Roughly how far below the phone the pavement is. Used as the altitude
  /// hint when the anchor is created, and as the fallback drop when ARKit has
  /// not yet found a floor to measure against.
  static let cameraHeightM: Double = 1.4

  /// The range of drops below the camera a floor reading may fall in *when
  /// there is no floor known yet*.
  ///
  /// Only a bootstrap. It used to gate every reading, which quietly broke the
  /// one thing anybody does to check the guidance closely: crouch down to it.
  /// Below half a metre of camera height every reading fails this band, so the
  /// probe stops accepting anything and the floor freezes at whatever it last
  /// believed - which is precisely the value being inspected, now unable to
  /// correct itself however long it is looked at.
  ///
  /// It is also the wrong quantity to test. How high the phone is says nothing
  /// about whether a surface is the ground; only its height compared with the
  /// ground does. So once a floor is known, `groundAgreementM` takes over and
  /// this is not consulted again.
  static let minGroundDropM: Float = 0.6
  static let maxGroundDropM: Float = 2.6

  /// How far a reading may sit from the floor already believed in and still be
  /// taken as the same floor.
  ///
  /// Wide enough to walk down a ramp or a kerb without the readings being
  /// rejected - the smoothing then carries the estimate down with the ground -
  /// and narrow enough to reject a bench, a bonnet or a step being climbed.
  static let groundAgreementM: Float = 0.5

  /// How long the floor may go without a reading it accepts before the estimate
  /// is thrown away and bootstrapped afresh.
  ///
  /// The escape hatch for `groundAgreementM`: a genuine change of level larger
  /// than that window - a flight of steps, a kerb dropped off in one stride -
  /// would otherwise be rejected forever, leaving the guidance pinned to a floor
  /// the walker has left. Long enough that a few seconds of the camera seeing no
  /// surface at all does not reset a good estimate.
  static let groundStaleAfter: TimeInterval = 2.0

  /// How far a point's own floor may sit from the floor under the walker.
  ///
  /// The band follows the ground rather than lying on one level, so each point
  /// on it is probed where it actually is and keeps its own height - which is
  /// what lets it run down a ramp or over a camber like a track instead of
  /// hovering off the high side of it.
  ///
  /// That needs a looser bound than `groundAgreementM`, because the far end of
  /// the band is ten metres away and ten metres of pavement can legitimately
  /// fall by a metre or more. Still bounded: past this the hit is a wall, a
  /// stairwell or a bad estimate rather than the same pavement continuing.
  static let slopeToleranceM: Float = 2.5

  /// How many of the band's points are probed per tick.
  ///
  /// The floor under a fixed patch of ground does not change, so each point
  /// only has to be found once and then kept. Spreading the work means the band
  /// takes a moment to settle onto a slope after it appears rather than costing
  /// a raycast per point per tick forever.
  /// How often every point on the band is re-measured.
  ///
  /// Every point, every tick - not a few of them in rotation, and never
  /// stopping. Both of those were tried and both were wrong.
  ///
  /// Measuring a few per tick let the band settle one point at a time, and a
  /// shape whose vertices arrive in sequence looks like it is being rebuilt,
  /// because it is. Measuring them together makes the same movement read as one
  /// surface easing into place.
  ///
  /// Stopping altogether was worse, and wrong rather than merely ugly. The
  /// reasoning was that the floor under a fixed patch of ground does not move,
  /// so a point that has been read a few times has nothing left to learn. The
  /// floor does not move - but the *estimate* of it does, and enormously. A
  /// point eight metres down a slope is first measured against a plane ARKit
  /// has extrapolated from the floor at the walker's feet, which puts it at
  /// roughly their own height; only walking closer produces a reading worth
  /// having. Freezing it at the first answer leaves the far end of the band
  /// hanging in the air over the downhill, and no amount of walking brings it
  /// back down.
  ///
  /// So it keeps measuring. The cost is bounded - a raycast per point at this
  /// rate - and a point whose estimate has genuinely converged simply reads the
  /// same number again and moves nowhere.
  static let anchorProbeInterval: TimeInterval = 0.2

  /// How long tracking has to stay lost before the walker is told to move the
  /// phone. Short dips recover on their own well inside this, and advice that
  /// arrives after the problem has fixed itself is worse than none.
  static let readinessGraceSeconds: TimeInterval = 1.5

  /// How much of each new floor reading to take. The estimate wanders by a few
  /// centimetres between probes; taken raw, the whole ribbon bobs.
  static let groundSmoothing: Float = 0.15

  /// How often to look for the floor. The floor does not move; the smoothing
  /// above already spreads each reading over several frames.
  static let groundProbeInterval: TimeInterval = 0.1

  /// The stretch of path planted by a tap in preview mode: how many points and
  /// how far apart. The spacing matches ANCHOR_SPACING_M on the navigation screen, so
  /// what is being previewed is the real thing at its real density.
  static let previewCount = 8
  static let previewSpacingM: Float = 1.2

  /// How wide the painted path is, in metres.
  ///
  /// A little under a pavement, so it reads as a lane to walk in rather than as
  /// a covering laid over the whole footway. Constant in the world, which is
  /// what makes it taper on screen: near the walker it is a broad band, and it
  /// narrows towards the horizon exactly as a real painted line would. That
  /// taper is doing the work the chevrons' spacing used to do - it says which
  /// way is "away" without anything having to be pointed.
  static let widthM: Float = 0.9

  /// The direction triangles lying in the band, in metres, and how often one
  /// appears.
  ///
  /// Narrower than the band so it reads as a marking *on* the path rather than
  /// as the path changing shape, and spaced by anchor rather than by distance
  /// along the visible stretch - a triangle every second anchor sits on a fixed
  /// patch of ground and stays there, where one placed every 2.4m along what is
  /// currently on screen would crawl forwards as the walker moved.
  static let markerLengthM: Float = 0.45
  static let markerWidthM: Float = 0.4
  static let markerEveryNthAnchor = 2

  /// How far the markers sit above the band in the 3D renderer. Two surfaces at
  /// exactly the same height flicker against each other as the camera moves.
  static let markerLiftM: Float = 0.01

  /// How far the dark edge stands out past the triangle it outlines. The
  /// overlay draws this as a 1pt stroke; in metres at the distance most of the
  /// band is read at, that is about a centimetre.
  static let markerEdgeM: Float = 0.01

  /// How far a mitred corner may reach past half the band's width before it
  /// is cut off square. 1/cos(half the turn), so this is passed at about 143
  /// degrees of turn - sharper than any corner a pavement takes, and short of
  /// the switchback where the factor would run away.
  static let mitreLimit: Float = 2.5

  /// The most any one vertex of a placed turn may bend by.
  ///
  /// Turning further than this at a single point stops looking like a corner
  /// and starts looking like a fold, so a sharper turn is spread over as many
  /// vertices as it needs. At 45 degrees the mitre reaches out by 1.08, which
  /// is nothing - the limit above exists for route data, not for these.
  static let maxTurnPerVertexDeg: Float = 45

  /// Where the room mesh sits in the draw order. Below everything, because
  /// what it contributes is the depth the band is then tested against.
  static let occluderOrder = -1000

  /// How far the band floats above the floor it was measured on.
  ///
  /// Purely to survive the depth test against the room mesh. The mesh includes
  /// the floor, and a band lying at exactly the measured floor height would be
  /// in a coin-toss with it for every pixel - occluded in patches, which looks
  /// far worse than not being occluded at all. Three centimetres is more than
  /// the two surfaces disagree by and less than the eye reads as hovering.
  static let bandLiftM: Float = 0.03

  /// The 3D renderer's stand-ins for the overlay's two strokes.
  ///
  /// The overlay draws an 8pt dark halo and a 2pt white rim around the band. A
  /// stroke is a screen-space width and there is no such thing in a 3D scene, so
  /// these are the same idea in metres: the centreline swept wider and drawn
  /// underneath. Chosen to match what those strokes subtend at about three
  /// metres, which is where most of the band a walker reads actually sits.
  static let haloWidthM: Float = 0.075
  static let rimWidthM: Float = 0.02

  /// The gap between the stacked strips. Millimetres - far below anything here
  /// is accurate to - and present only so coplanar surfaces cannot flicker.
  static let layerLiftM: Float = 0.002

  /// The distance fade and the travelling highlight, matching GroundPath.tsx so
  /// that switching renderer changes only *when* the band is drawn.
  ///
  /// Deliberately well short of opaque, and that is a safety decision rather
  /// than a stylistic one. At 0.95 the band was a solid sheet of colour laid
  /// over the pavement, which hid exactly what a walker most needs to see -
  /// the kerb, the puddle, the broken slab, the thing this app exists to warn
  /// them about. Guidance that obscures the ground it is guiding you across is
  /// worse than no guidance. The rim and halo are what keep it legible now,
  /// and they outline rather than cover.
  static let nearOpacity: CGFloat = 0.32
  static let farOpacity: CGFloat = 0.22
  /// How wide the travelling highlight is, as a fraction of the run. Matches
  /// WAVE_WIDTH in GroundPath.tsx, and doubles as where the pulse sits inside
  /// its own texture - the two have to agree for advanceWave to place it.
  static let wavePulseHalfWidth: Float = 0.22
  static let waveCycleSeconds: CFTimeInterval = 1.9
  static let waveStrength: CGFloat = 0.35

  /// Ground already covered, matching GroundPath.tsx.
  static let walkedNearOpacity: CGFloat = 0.5
  static let walkedFarOpacity: CGFloat = 0.32

  /// How far the floor estimate has to move before the 3D band is rebuilt on
  /// it. A centimetre is below what any of this resolves and well below what a
  /// rebuild costs in a restarted highlight animation.
  static let rebuildFloorDeltaM: Float = 0.01

  /// How far along a run the walked/ahead split has to move before the band is
  /// rebuilt on it, as a fraction of the run.
  ///
  /// The split follows the walker continuously, so left unquantised it would
  /// rebuild the geometry on every frame. A fortieth of a run is a few
  /// centimetres on the eight-point stretch a tap places - well under what the
  /// eye picks out as a step in the grey boundary.
  static let rebuildSplitStep: Float = 0.025

  /// How far in front of the lens the ribbon is cut off.
  ///
  /// Nothing may be projected from at or behind the camera plane: the division
  /// by depth blows up, and a point just behind the lens lands on screen as
  /// confidently as one just in front. The chevrons dealt with this by dropping
  /// any shape with a corner behind - a torn polygon being worse than a missing
  /// one - but a ribbon cannot be dropped that way. It is one shape, it starts
  /// under the walker's feet, and the part of it that is behind them is exactly
  /// the part they are standing on. So it is *clipped* instead: the polyline is
  /// cut at this depth and the ribbon is built from what survives, which is what
  /// makes it run off the bottom of the frame rather than blink out.
  static let nearClipM: Float = 0.25
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
final class ARGeospatialView: ExpoView, ARSessionDelegate, ARSCNViewDelegate {
  /// How far ahead the control anchors sit, in metres. Matches the distances
  /// the JS side labels them with.
  static let testDistancesM: [Double] = [3, 6, 10]

  /// The index the route's ribbon is sent under. There is exactly one of it per
  /// frame, so the value only has to be stable and not collide with an anchor
  /// id - and anchor ids are lattice indices, which are never negative.
  static let pathIndex = -100
  static let walkedPathIndex = -101

  let onGeospatialUpdate = EventDispatcher()
  let onAnchorsUpdate = EventDispatcher()
  let onHazards = EventDispatcher()
  let onPreviewState = EventDispatcher()

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

  /// The smoothed height of the floor under the phone, and when it was last
  /// probed for.
  ///
  /// This is what the ribbon is actually laid on, and it is measured
  /// rather than taken from the anchor's own altitude - see `onGround`.
  private var groundY: Float?
  private var lastGroundProbe: TimeInterval = 0
  /// When a probe last returned something that looked like the floor, as
  /// against when one last ran. The gap between the two is what says the walker
  /// has changed level - see `groundStaleAfter`.
  private var lastGroundReading: TimeInterval?

  /// The floor height found under each anchor, by anchor id, and where the
  /// round-robin of probing them has got to.
  ///
  /// This is what lets the band follow a slope. `groundY` alone is one number
  /// for the whole scene, so it can only lay the band flat at the height of the
  /// ground under the walker - correct at their feet and increasingly wrong up
  /// a hill, where the band floats off the high side or sinks into the low one.
  /// Probing each point where it actually is and keeping its own answer is what
  /// turns a flat plane into a track that follows the ground.
  ///
  /// Kept by id rather than by position in the list, for the same reason the
  /// anchors themselves are: the list shifts by one every time the walker
  /// advances past a point, and a cache keyed on position would then hand every
  /// remaining point its neighbour's height.
  private var anchorGroundY: [Int: Float] = [:]
  private var nextPreviewId = 0
  private var lastAnchorProbe: TimeInterval = 0

  /// One point on the band, and whether a direction triangle sits on it.
  private struct PathPoint {
    let position: simd_float3
    let marker: Bool
  }

  /// Whether to plant the plain ARKit control anchors. Only the Geospatial test
  /// screen wants them; on a real route they would be three stray marks on the
  /// floor with no meaning.
  private var showControlAnchors = false

  /// Preview mode: tap the floor and a stretch of path is laid there.
  ///
  /// Deliberately built on plain ARKit anchors and a raycast, with no
  /// Geospatial session involved at all. That is what makes it work indoors,
  /// which is the whole point of it - the navigation screen needs to know where
  /// on Earth it is, and this needs only to know where the floor is. Somewhere
  /// with no Street View coverage, no GPS fix and no sky is a perfectly good
  /// place to check whether the path looks right.
  private var previewMode = false
  private var previewComponent = "path"
  private var previewClearToken = 0
  private var previewRuns: [PreviewRun] = []
  private var previewTap: UITapGestureRecognizer?


  /// The nodes currently in the scene, one per preview run, and whether the
  /// last frame could have placed something.
  ///
  /// Rebuilt rather than transformed, because a run's shape depends on the
  /// ground under it as well as on its anchors, and both move as ARKit refines
  /// them. Rebuilding a dozen vertices is far cheaper than the bookkeeping to
  /// work out whether it was necessary.
  private var previewNodes: [SCNNode] = []
  private var lastPreviewGeometry: TimeInterval = 0

  /// What the nodes currently in the scene were built from.
  ///
  /// The geometry is rebuilt only when one of these has actually moved, which
  /// matters for more than cost: the travelling highlight is a `CABasicAnimation`
  /// living on the fill material, and tearing the node down to rebuild it would
  /// restart that animation from the beginning. Rebuilding on a timer made the
  /// sweep stutter ten times a second.
  private var builtRunCount = -1
  private var builtHeights: [Float] = []
  private var builtSplits: [Int] = []

  /// Built once and kept. Neither ramp ever changes, and both allocate a bitmap.
  /// The wave materials currently in the scene, so their phase can be advanced
  /// each frame. Emptied whenever the nodes are.
  private var previewWaveMaterials: [SCNMaterial] = []

  private var cachedFade: UIImage?
  private var cachedWalked: UIImage?
  private var cachedWave: UIImage?
  private var previewReady = false
  private var previewStateSent = false
  private var lastReadinessProbe: TimeInterval = 0
  /// The last value handed to JS, so the event fires on change rather than on
  /// every probe.
  private var previewReadySent = false
  /// When tracking was first seen to be gone, or nil while it is fine.
  private var trackingLostSince: TimeInterval?
  private var previewPlacedCount = 0

  /// One thing put down by a tap: a stretch of path, or a pin.
  ///
  /// Grouped per tap rather than kept as one flat list of anchors, which is the
  /// difference between a preview and a route. A route is a single chain from
  /// where the walker stands to where they are going, so every point on it
  /// belongs to the same ribbon. A preview is a scatter of separate things, and
  /// two stretches dropped in different corners of a room are two paths - one
  /// flat list would stitch them together and draw a ribbon across the gap.
  private struct PreviewRun {
    /// In order along the run. A pin has exactly one.
    let anchors: [ARAnchor]
    /// One per anchor, in the same order. They exist so a placement can have
    /// its own floor found under each point the way a route does - the ground
    /// cache is keyed by id, and without one every point had to share the
    /// single level measured under the phone.
    let ids: [Int]
    /// The *projected* kind, the vocabulary the JS overlays filter on: "path"
    /// for the ground ribbon, "destination" for the pin. Not the
    /// "route"/"destination" vocabulary a GeoAnchorRecord arrives with - the
    /// two lists differ, and using the input names here draws nothing at all.
    let kind: String
  }

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
    // Separate from the session delegate above and doing a different job:
    // this one is told about the nodes SceneKit makes for anchors, which is
    // where the room mesh is turned into an occluder.
    sceneView.delegate = self
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

  func setPreviewMode(_ on: Bool) {
    guard on != previewMode else { return }
    previewMode = on

    if on, previewTap == nil {
      let tap = UITapGestureRecognizer(target: self, action: #selector(handlePreviewTap(_:)))
      addGestureRecognizer(tap)
      previewTap = tap
    }
    previewTap?.isEnabled = on

    // The readiness answer is about this session on this screen, so leaving the
    // preview retires it: coming back has to say "scanning" again rather than
    // inheriting a "ready" from the last visit and inviting a tap the tracking
    // cannot yet honour.
    previewStateSent = false
    previewReady = false
    previewReadySent = false
    previewPlacedCount = 0
    trackingLostSince = nil

    if !on {
      clearPreview()
      clearPreviewNodes()
    }
  }

  func setPreviewComponent(_ component: String) {
    previewComponent = component
  }


  private func clearPreviewNodes() {
    for node in previewNodes { node.removeFromParentNode() }
    previewNodes.removeAll()
    previewWaveMaterials.removeAll()
    // The signature has to go with them. Left set, the next tick would compare
    // an unchanged run count against nodes that are no longer in the scene and
    // decline to rebuild the very thing it just removed.
    builtRunCount = -1
    builtSplits = []
    builtHeights = []
  }

  /// Cleared by a token rather than by a method call, because a view in this
  /// module is reached through props and not through a ref. Any change to the
  /// number means "clear now"; its value carries nothing.
  func setPreviewClearToken(_ token: Int) {
    guard token != previewClearToken else { return }
    previewClearToken = token
    clearPreview()
  }

  private func clearPreview() {
    for run in previewRuns {
      for anchor in run.anchors { sceneView.session.remove(anchor: anchor) }
    }
    previewRuns.removeAll()
  }

  /// Puts the chosen component down exactly where the floor was tapped.
  ///
  /// Placements accumulate, so a path and a pin can be put down together and
  /// looked at as a pair. `previewClearToken` takes them all away again.
  ///
  /// Everything faces away from the phone rather than along the camera's
  /// forward axis, so tapping off to one side aims it towards that spot rather
  /// than parallel to wherever the lens happens to point.
  @objc private func handlePreviewTap(_ gesture: UITapGestureRecognizer) {
    guard previewMode, let frame = sceneView.session.currentFrame else { return }

    let point = gesture.location(in: sceneView)
    guard
      let query = sceneView.raycastQuery(
        from: point,
        allowing: .estimatedPlane,
        alignment: .horizontal
      ),
      let hit = sceneView.session.raycast(query).first
    else { return }

    let start = origin(of: hit.worldTransform)
    let camera = origin(of: frame.camera.transform)
    let forward = flattened(start - camera) ?? cameraForward(frame)

    if previewComponent == "pin" {
      place(at: [start], kind: "destination")
      return
    }

    // A stretch of path as the navigation screen lays one out: the same anchor
    // spacing over the same number of points, starting at the tap and leading
    // away from the phone, with whatever turn was asked for halfway along.
    //
    // The turns exist because a straight stretch never exercises the part of the
    // band most likely to be wrong. Every point is swept along the bisector of
    // the headings meeting at it, pushed out by 1/cos(half the turn) - so how
    // that corner behaves depends entirely on the angle, and the only honest way
    // to see it is to put each angle on a floor and look at it.
    //
    // The angles are the middle of each band the navigation screen sorts real
    // manoeuvres into, so what is placed here is what a route classified as that
    // manoeuvre would actually draw.
    let (bend, vertices) = turnShape(for: previewComponent)
    let perVertex = vertices > 0 ? bend / Float(vertices) : 0
    // Far enough in that there is a straight approach to judge the corner
    // against, and early enough to leave a leg on the other side of it.
    let bendAt = 2

    var position = start
    var heading = forward
    var along: [simd_float3] = []

    for step in 0..<GroundPath.previewCount {
      along.append(position)
      if step >= bendAt, step < bendAt + vertices {
        heading = turned(heading, by: perVertex)
      }
      position += heading * GroundPath.previewSpacingM
    }

    place(at: along, kind: "path")
  }

  /// How far the run turns, and over how many vertices it does the turning.
  ///
  /// The angles are the middle of each band `maneuverFromAngle` sorts real
  /// manoeuvres into on the navigation screen - 20/45/120/160 degrees - so each
  /// one places the shape a route classified as that manoeuvre would draw,
  /// rather than a round number that happens to look like it.
  ///
  /// The spread is the part that took a device to work out. Turning the whole
  /// angle at a single vertex is right for a street corner and nonsense for a
  /// u-turn: at 175 degrees the run leaves and returns along very nearly the
  /// same line, so the band folds onto itself, doubles its own opacity, and
  /// hands the mitre a bisector that has all but collapsed. What came out was a
  /// stack of overlapping wedges rather than a path.
  ///
  /// No real route does that either. A walker turning round walks an arc, and a
  /// pavement that doubles back - a switchback ramp, the end of a barrier -
  /// carries them round with metres between the two legs. So the turn is spread
  /// over as many vertices as it takes to keep any one of them under
  /// `maxTurnPerVertexDeg`, which gives the corner a radius, keeps the legs
  /// apart, and incidentally keeps every mitre well inside its limit.
  private func turnShape(for component: String) -> (radians: Float, vertices: Int) {
    let degrees: Float
    switch component {
    case "slight-left", "slight-right": degrees = 32
    case "left", "right": degrees = 90
    case "sharp-left", "sharp-right": degrees = 140
    case "uturn-left", "uturn-right": degrees = 175
    default: return (0, 0)
    }

    let toTheLeft = component.hasSuffix("left")
    let vertices = max(1, Int((degrees / GroundPath.maxTurnPerVertexDeg).rounded(.up)))
    return ((toTheLeft ? -degrees : degrees) * .pi / 180, vertices)
  }

  /// A horizontal unit vector turned about the vertical, positive to the
  /// walker's right.
  private func turned(_ heading: simd_float3, by radians: Float) -> simd_float3 {
    let right = simd_cross(heading, simd_float3(0, 1, 0))
    return heading * cos(radians) + right * sin(radians)
  }

  private func place(at positions: [simd_float3], kind: String) {
    let anchors = positions.map { position -> ARAnchor in
      var transform = matrix_identity_float4x4
      transform.columns.3 = simd_float4(position, 1)

      // Handed to ARKit rather than kept as bare positions, so placements are
      // corrected along with everything else when tracking relocalises.
      let anchor = ARAnchor(transform: transform)
      sceneView.session.add(anchor: anchor)
      return anchor
    }

    // Ids from a counter that never rewinds, so clearing and placing again
    // cannot hand a fresh point the floor height cached for a retired one.
    let ids = positions.indices.map { _ -> Int in
      nextPreviewId += 1
      return nextPreviewId
    }

    previewRuns.append(PreviewRun(anchors: anchors, ids: ids, kind: kind))
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

    // A mesh of the room, on the devices that can build one, so the guidance
    // can be hidden by the things that are actually in front of it.
    //
    // This is the difference between a marking on the ground and a sticker on
    // the lens. Without it a path that runs on behind a wall is still drawn
    // across the wall, which says the walkway is there when it is not - and on
    // a street that is not a cosmetic problem, because the same drawing that
    // paints through a wall paints over a bollard, a step, or a person.
    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      configuration.sceneReconstruction = .mesh
    }

    // People are the case the mesh is worst at - they move, and the mesh is
    // built for a static room. ARKit segments them out of the frame directly,
    // and ARSCNView applies that itself once the semantic is on, so a walker
    // stepping between the phone and the band occludes it correctly.
    if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
      configuration.frameSemantics.insert(.personSegmentationWithDepth)
    }

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

  // MARK: - Occlusion

  func renderer(_ renderer: SCNSceneRenderer, didAdd node: SCNNode, for anchor: ARAnchor) {
    applyOccluder(to: node, for: anchor)
  }

  func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
    applyOccluder(to: node, for: anchor)
  }

  /// Turns a piece of the reconstructed room into something that blocks the
  /// guidance without being drawn itself.
  ///
  /// The trick is a material that writes depth and no colour. The mesh is
  /// rendered first, filling the depth buffer with how far away the real
  /// world is; the band is rendered after and depth-tested against it, so any
  /// part of the band further away than a wall simply fails the test. Nothing
  /// of the mesh itself ever appears - what the camera shows through it is the
  /// wall, which is the correct picture.
  private func applyOccluder(to node: SCNNode, for anchor: ARAnchor) {
    guard #available(iOS 13.4, *), let mesh = anchor as? ARMeshAnchor else { return }

    let geometry = occluderGeometry(from: mesh.geometry)
    let material = SCNMaterial()
    material.colorBufferWriteMask = []
    material.writesToDepthBuffer = true
    material.readsFromDepthBuffer = true
    geometry.materials = [material]

    node.geometry = geometry
    // Before everything: the depth it lays down is what the band is tested
    // against, so it has to be there before the band is drawn.
    node.renderingOrder = GroundPath.occluderOrder
  }

  /// ARKit's mesh, wrapped as SceneKit geometry.
  ///
  /// The buffers are handed over as they are rather than copied out and
  /// rebuilt: the mesh is thousands of triangles and is revised continuously,
  /// so unpacking it every update would cost far more than the occlusion is
  /// worth.
  @available(iOS 13.4, *)
  private func occluderGeometry(from mesh: ARMeshGeometry) -> SCNGeometry {
    let vertices = SCNGeometrySource(
      buffer: mesh.vertices.buffer,
      vertexFormat: mesh.vertices.format,
      semantic: .vertex,
      vertexCount: mesh.vertices.count,
      dataOffset: mesh.vertices.offset,
      dataStride: mesh.vertices.stride
    )

    let faces = mesh.faces
    let element = SCNGeometryElement(
      data: Data(bytes: faces.buffer.contents(), count: faces.buffer.length),
      primitiveType: .triangles,
      primitiveCount: faces.count,
      bytesPerIndex: faces.bytesPerIndex
    )

    return SCNGeometry(sources: [vertices], elements: [element])
  }

  /// The height of the floor in ARKit's world, found by looking straight down
  /// from the phone.
  ///
  /// This replaces picking the highest horizontal plane within a plausible drop
  /// of the camera, which was wrong outdoors in a way that is obvious in
  /// hindsight: a car bonnet, a bench, a bin lid and the top of a low wall are
  /// all horizontal planes sitting between half a metre and two metres under a
  /// held phone, and every one of them is *above* the pavement. Choosing the
  /// highest chose those, and the ribbon floated at the height of whatever
  /// furniture happened to be nearby.
  ///
  /// A downward raycast asks the question that was actually meant - what is the
  /// ground *beneath me* - and cannot be answered by a bench three metres to
  /// the side.
  ///
  /// What that first attempt still got wrong was which of the answers to take.
  /// `raycast` returns its hits ordered by distance from the ray's origin, and
  /// the ray starts at the camera pointing down - so the first hit is the
  /// *nearest*, which for a downward ray is the *highest* surface under the
  /// phone. That is the old highest-plane bias again, narrowed from the whole
  /// scene to the column directly beneath the walker but not removed: a kerb
  /// being stepped off, the lip of a drain, a bag by the foot, the raised edge
  /// of a paving slab all sit in that column and all sit above the pavement.
  /// Every one of them lifts the estimate, the smoothing holds it up between
  /// probes, and the guidance hovers.
  ///
  /// Taking the lowest plausible hit instead asks for the ground rather than
  /// for whatever is on top of it. The plausibility bounds are what stop that
  /// becoming its own version of the same mistake in the other direction.
  private func updateGroundLevel(arFrame: ARFrame) {
    // Raycasting on every frame is wasted work: the floor does not move, and
    // the smoothing below already spreads each reading over several frames.
    let now = arFrame.timestamp
    guard now - lastGroundProbe > GroundPath.groundProbeInterval else { return }
    lastGroundProbe = now

    let cameraY = arFrame.camera.transform.columns.3.y
    let cameraPosition = origin(of: arFrame.camera.transform)

    guard
      let measured = floorHeight(below: cameraPosition, cameraY: cameraY, tolerance: .underfoot)
    else {
      // Nothing acceptable for long enough means the walker has changed level
      // by more than the agreement window allows - down a flight of steps, off
      // a high kerb. Start again rather than stay pinned to a floor they left.
      if let last = lastGroundReading, now - last > GroundPath.groundStaleAfter {
        groundY = nil
        lastGroundReading = nil
      }
      return
    }

    lastGroundReading = now

    if let current = groundY {
      groundY = current + (measured - current) * GroundPath.groundSmoothing
    } else {
      groundY = measured
    }
  }

  /// The height of the floor directly below a point, or nil if nothing under it
  /// looks like a floor.
  ///
  /// Tracked plane geometry is asked for first and the feature-point estimate
  /// only if that finds nothing. The estimate is what makes this work at all on
  /// tarmac and smooth pavement - exactly the low-texture surfaces ARKit is
  /// slowest to promote into a full plane, and it is available long before the
  /// plane anchor is - but where ARKit has committed to a plane, that plane is
  /// the better answer, and preferring it costs one extra raycast at 10Hz.
  private func floorHeight(
    below position: simd_float3,
    cameraY: Float,
    tolerance: FloorTolerance
  ) -> Float? {
    for target in [ARRaycastQuery.Target.existingPlaneGeometry, .estimatedPlane] {
      let query = ARRaycastQuery(
        origin: position,
        direction: simd_float3(0, -1, 0),
        allowing: target,
        alignment: .horizontal
      )

      // The lowest acceptable hit, not the nearest one - see above.
      let lowest = sceneView.session.raycast(query)
        .map { $0.worldTransform.columns.3.y }
        .filter { isFloor($0, cameraY: cameraY, tolerance: tolerance) }
        .min()

      if let lowest { return lowest }
    }

    return nil
  }

  /// How far from the known floor a reading may sit and still be believed.
  ///
  /// `underfoot` is for the floor beneath the walker, where anything much off
  /// the level they are standing on is something else. `slope` is for a point
  /// out along the band, which may genuinely be well below or above them and
  /// still be the same pavement.
  private enum FloorTolerance {
    case underfoot
    case slope

    var metres: Float {
      switch self {
      case .underfoot: return GroundPath.groundAgreementM
      case .slope: return GroundPath.slopeToleranceM
      }
    }
  }

  /// Whether a surface at this height is the ground.
  ///
  /// Two different questions depending on what is already known. With a floor in
  /// hand the only thing that matters is whether this agrees with it, and the
  /// camera's height is irrelevant - which is what lets the walker crouch down
  /// to the guidance and have it keep correcting itself while they look. With no
  /// floor yet there is nothing to compare against, so the camera is all there
  /// is, and a plausible carrying height stands in for one.
  private func isFloor(_ height: Float, cameraY: Float, tolerance: FloorTolerance) -> Bool {
    if let current = groundY {
      return abs(height - current) <= tolerance.metres
    }

    let drop = cameraY - height
    return drop >= GroundPath.minGroundDropM && drop <= GroundPath.maxGroundDropM
  }

  /// Puts a point on the floor, keeping only its horizontal position.
  ///
  /// This is the one line that decides whether the ribbon is visible at all,
  /// and it exists because the two halves of an anchor's position are not
  /// equally trustworthy. ARCore's Geospatial API is good horizontally - about
  /// a metre where VPS has coverage - and much weaker vertically, because it
  /// reports a WGS84 ellipsoid altitude that has to be round-tripped back into
  /// ARKit's world. An error of a metre and a half in that round trip puts a
  /// flat ribbon at eye level, where a horizontal polygon is seen edge-on and
  /// collapses to a line: not a wrong-looking path, an invisible one.
  ///
  /// So the horizontal position is taken from the anchor and the height is
  /// thrown away, replaced by a floor ARKit has actually seen. Failing that,
  /// the camera's own height in ARKit's world less a carrying height - still
  /// better than the anchor's altitude, because ARKit's vertical is gravity
  /// aligned and exact, and only the 1.4m assumption is approximate.
  /// Three answers in order of how much they are worth. The floor found under
  /// this very point is the best - it is what makes the band follow a slope
  /// rather than lie flat across it. Failing that, the floor under the walker,
  /// which is right at their feet and drifts with the gradient. Failing that,
  /// the camera's own height less a carrying height - still better than the
  /// anchor's altitude, because ARKit's vertical is gravity aligned and exact
  /// and only the 1.4m assumption is approximate.
  private func onGround(_ position: simd_float3, id: Int?, arFrame: ARFrame) -> simd_float3 {
    let fallback = arFrame.camera.transform.columns.3.y - Float(GroundPath.cameraHeightM)
    let floor = id.flatMap { anchorGroundY[$0] } ?? groundY ?? fallback
    return simd_float3(position.x, floor, position.z)
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
          altitude: cameraAltitude - GroundPath.cameraHeightM,
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
        eye + direction * Float(distance) - simd_float3(0, Float(GroundPath.cameraHeightM), 0),
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

    updateGroundLevel(arFrame: arFrame)

    if previewMode {
      updatePreviewReadiness(arFrame: arFrame)
      // Placements get their floor found under each point, the same as route
      // anchors do, which is what lets a band laid down a ramp follow it.
      probeAnchorGround(previewGroundPoints(), arFrame: arFrame)
      updatePreviewGeometry(arFrame: arFrame)

      // Only the pin goes over to the JS layer. The band is drawn in the
      // scene now, and there is no longer a second version of it to compare
      // against - the comparison is settled.
      //
      // The pin stays where it is, and that is not the same thing as being
      // left behind. A destination marker has to face the walker from every
      // approach, which is what a flat sprite at a projected point is; the
      // band lies on the ground and belongs in the geometry. Each is drawn
      // where its own shape wants to be.
      emitPreviewAnchors(arFrame: arFrame, viewport: viewport, pinsOnly: true)
      return
    }

    var projected: [[String: Any]] = []

    for (index, anchor) in localAnchors.enumerated() {
      projected.append(
        project(
          position: origin(of: anchor.transform),
          index: index,
          kind: "local",
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    // Route order matters here in a way it did not for the control anchors:
    // the ribbon is stitched from one anchor to the next, so out-of-order points
    // would fold it back on itself. `requestedAnchors` preserves the order the
    // JS side sent, which is the order along the route. Markers are held out of
    // this - a destination pin is not a point the path passes through, and
    // letting one join the chain would drag the ribbon sideways to reach it.
    let route = requestedAnchors.compactMap { request -> PathPoint? in
      guard request.kind == "route" else { return nil }
      guard let anchor = placedAnchors[request.id], anchor.hasValidTransform else { return nil }
      return PathPoint(
        // Each point gets the floor found beneath it, not the one under the
        // walker - see `anchorGroundY`.
        position: onGround(origin(of: anchor.transform), id: request.id, arFrame: arFrame),
        // Anchor ids are lattice indices plus a whole multiple of a million, so
        // their parity is the lattice index's parity and a triangle lands on
        // the same patch of ground for the whole walk.
        marker: request.id % GroundPath.markerEveryNthAnchor == 0
      )
    }

    // A few of the band's points are re-probed each tick rather than all of
    // them, which is what keeps following the ground affordable.
    probeAnchorGround(routeGroundPoints(), arFrame: arFrame)

    // Everything that is a point rather than a path: the destination pin. Sent
    // with its own kind and no outline, since the JS side draws it as a sprite
    // standing at the projected point rather than as a shape on the ground.
    for request in requestedAnchors where request.kind != "route" {
      guard let anchor = placedAnchors[request.id], anchor.hasValidTransform else { continue }
      projected.append(
        project(
          // Stands on the floor for the same reason the ribbon lies on it -
          // a pin whose base is at eye level reads as floating in the air.
          position: onGround(origin(of: anchor.transform), id: request.id, arFrame: arFrame),
          index: request.id,
          kind: request.kind,
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    // Two bands rather than one, cut where the walker is standing: what is
    // behind them is drawn as covered ground and what is ahead as the route.
    //
    // The covered half is mostly invisible while walking forwards, which is not
    // a reason to leave it out - it is what makes turning round intelligible.
    // Glancing back at a junction otherwise shows a band running away in the
    // direction you came from, indistinguishable from one telling you to go
    // that way.
    let (walked, ahead) = splitAtWalker(route, arFrame: arFrame)

    if let covered = ribbon(
      along: walked,
      index: Self.walkedPathIndex,
      kind: "path-walked",
      arFrame: arFrame,
      viewport: viewport
    ) {
      projected.append(covered)
    }

    if let path = ribbon(
      along: ahead,
      index: Self.pathIndex,
      kind: "path",
      arFrame: arFrame,
      viewport: viewport
    ) {
      projected.append(path)
    }

    onAnchorsUpdate(["anchors": projected])
  }

  /// Finds the floor under a few of the band's points, moving through them a
  /// handful at a time.
  ///
  /// The raycast starts above the point rather than at it, because the point's
  /// own height is the thing being corrected - starting at it would mean a
  /// point that has floated up cannot see the ground it floated away from.
  private func probeAnchorGround(_ points: [(id: Int, position: simd_float3)], arFrame: ARFrame) {
    // Throttled on its own clock, and slower than the walker's own floor probe.
    // `emitAnchors` runs on every ARKit frame, and this measures every point on
    // the band, so at 60Hz it would be well over a thousand raycasts a second.
    // Five times a second is quicker than the ground estimate improves.
    let now = arFrame.timestamp
    guard now - lastAnchorProbe > GroundPath.anchorProbeInterval else { return }
    lastAnchorProbe = now

    guard !points.isEmpty else {
      anchorGroundY.removeAll()
      return
    }

    // Points the walker has gone past are dropped from the list, and their
    // cached heights would otherwise accumulate for the whole journey.
    let wanted = Set(points.map { $0.id })
    anchorGroundY = anchorGroundY.filter { wanted.contains($0.key) }

    let cameraY = arFrame.camera.transform.columns.3.y

    // Every point, together, so the band eases as one surface rather than
    // settling a vertex at a time - see anchorProbeInterval.
    for point in points {
      let from = simd_float3(point.position.x, cameraY, point.position.z)
      guard let measured = floorHeight(below: from, cameraY: cameraY, tolerance: .slope) else {
        continue
      }

      if let current = anchorGroundY[point.id] {
        anchorGroundY[point.id] = current + (measured - current) * GroundPath.groundSmoothing
      } else {
        // The first reading is taken whole. There is nothing to ease from, and
        // easing up from the walker's own floor would make every new point
        // visibly slide into place from the wrong height.
        anchorGroundY[point.id] = measured
      }
    }
  }

  /// The route's anchored points, as the ground probe wants them.
  private func routeGroundPoints() -> [(id: Int, position: simd_float3)] {
    requestedAnchors.compactMap { request in
      guard request.kind == "route" else { return nil }
      guard let anchor = placedAnchors[request.id], anchor.hasValidTransform else { return nil }
      return (id: request.id, position: origin(of: anchor.transform))
    }
  }

  /// Every placed point in preview mode, likewise. Pins are included: a marker
  /// standing on a slope wants the floor under itself just as much as the band
  /// does.
  private func previewGroundPoints() -> [(id: Int, position: simd_float3)] {
    previewRuns.flatMap { run in
      zip(run.ids, run.anchors).map { (id: $0, position: origin(of: $1.transform)) }
    }
  }

  /// The preview runs, built as geometry inside the AR scene.
  ///
  /// This is the answer to why the overlay never feels stuck to the ground. The
  /// overlay computes screen positions from camera frame N, hands them across
  /// the bridge, waits for React to re-render and for the SVG views to update -
  /// and by then the preview underneath is showing frame N+2 or later. The band
  /// is therefore always drawn for a pose the camera has already left, which is
  /// why it holds still when the phone does and slides when it moves.
  ///
  /// Geometry in the scene has no such gap. SceneKit rasterises it in the same
  /// pass as the camera image it lies on, from the same pose, so it is late by
  /// definition never. It is also real 3D, which is what makes depth occlusion
  /// and a contact shadow possible at all - neither is available to a polygon
  /// painted over the top of everything.
  private func updatePreviewGeometry(arFrame: ARFrame) {
    // The sweep advances every frame, regardless of whether the geometry is
    // rebuilt. It is a phase off the clock rather than an animation attached to
    // a material, so it survives the rebuilds below - see the note where the
    // wave material is made.
    advanceWave(arFrame: arFrame)

    // Rebuilt only when something about it has moved - not on a clock. The
    // *rendering* stays frame-locked regardless, which is the entire point of
    // this renderer; what a rebuild changes is the shape.
    let now = arFrame.timestamp
    guard now - lastPreviewGeometry > GroundPath.groundProbeInterval else { return }
    lastPreviewGeometry = now

    // Where the walker stands on each run, which is where its band is cut into
    // covered ground and ground ahead. Quantised before it is compared: taken
    // raw it changes on every fix, and every change is a rebuild.
    let splits = previewRuns.map { run -> Int in
      Int((walkerFraction(along: run, arFrame: arFrame) / GroundPath.rebuildSplitStep).rounded())
    }

    // Compared against the heights the band is actually built from, not
    // against the floor under the walker.
    //
    // Those are different numbers on a slope, which is the whole point: the
    // walker's floor changes with every step downhill, so keying the rebuild
    // to it meant rebuilding constantly while descending even though the band
    // ahead had not moved at all.
    let heights = previewGroundPoints().map { anchorGroundY[$0.id] ?? groundY ?? 0 }
    let shapeMoved = heights.count != builtHeights.count
      || zip(heights, builtHeights).contains {
        abs($0 - $1) > GroundPath.rebuildFloorDeltaM
      }

    guard previewRuns.count != builtRunCount || splits != builtSplits || shapeMoved else {
      return
    }

    builtRunCount = previewRuns.count
    builtSplits = splits
    builtHeights = heights

    clearPreviewNodes()

    for run in previewRuns {
      // The pin stays on the overlay under both renderers, and that is not an
      // omission. A destination marker is a billboard by design - it has to
      // face the viewer from every approach, which is what a flat sprite at a
      // projected point *is* - so modelling it in 3D would buy nothing and cost
      // it the one property it must have. What is being compared here is the
      // band, which is the thing that genuinely lies on the ground.
      guard run.kind != "destination" else { continue }

      let points = previewPoints(of: run, arFrame: arFrame)
      // Cut where the walker is standing, exactly as a real route is. A
      // placement has no direction of travel of its own, but walking along one
      // is the nearest thing to walking a route that can be done indoors - and
      // it is the only way to see the covered half behave without going outside
      // and planning a journey.
      let (walked, ahead) = splitAtWalker(points, arFrame: arFrame)

      for (stretch, isWalked) in [(walked, true), (ahead, false)] {
        guard let node = bandNode(along: stretch, walked: isWalked) else { continue }
        sceneView.scene.rootNode.addChildNode(node)
        previewNodes.append(node)
      }
    }
  }

  /// One placed run as points on the ground, each at the floor found under it.
  ///
  /// Passing the ids is what gives a placement the same slope following a route
  /// gets. Before, every point shared the one level measured under the phone, so
  /// a band laid down a ramp stayed flat and lifted off it.
  private func previewPoints(of run: PreviewRun, arFrame: ARFrame) -> [PathPoint] {
    zip(run.ids, run.anchors).enumerated().map { step, pair in
      PathPoint(
        position: onGround(origin(of: pair.1.transform), id: pair.0, arFrame: arFrame),
        marker: step % GroundPath.markerEveryNthAnchor == 0
      )
    }
  }

  /// How far along a run the walker stands, as a 0-1 fraction. Only used to
  /// decide whether the split has moved enough to be worth a rebuild.
  private func walkerFraction(along run: PreviewRun, arFrame: ARFrame) -> Float {
    guard run.anchors.count >= 2 else { return 0 }
    let camera = origin(of: arFrame.camera.transform)
    let first = origin(of: run.anchors[0].transform)
    let last = origin(of: run.anchors[run.anchors.count - 1].transform)

    let axis = simd_float3(last.x - first.x, 0, last.z - first.z)
    let lengthSquared = simd_length_squared(axis)
    guard lengthSquared > 1e-6 else { return 0 }

    let toCamera = simd_float3(camera.x - first.x, 0, camera.z - first.z)
    return min(1, max(0, simd_dot(toCamera, axis) / lengthSquared))
  }

  /// Slides the highlight texture along the band, one pass per cycle.
  ///
  /// Sampling at v + t shows the feature that lives at v + t where v is, so a
  /// decreasing t walks the bright band towards larger v - which is away from
  /// the walker.
  private func advanceWave(arFrame: ARFrame) {
    guard !previewWaveMaterials.isEmpty else { return }

    let phase = Float(
      arFrame.timestamp.truncatingRemainder(dividingBy: GroundPath.waveCycleSeconds)
        / GroundPath.waveCycleSeconds
    )

    // Where the bright band sits along the run, in the same terms the overlay
    // uses: it starts one half-width before the near end and finishes one past
    // the far end, so the highlight enters and leaves rather than appearing
    // and vanishing mid-band.
    let half = GroundPath.wavePulseHalfWidth
    let centre = phase * (1 + half * 2) - half

    // The texture keeps its peak a fixed distance in, so the translation is
    // whatever puts that peak at `centre`: sampling at v + t shows the peak
    // where v = peak - t.
    let transform = SCNMatrix4MakeTranslation(0, half - centre, 0)
    for material in previewWaveMaterials {
      material.diffuse.contentsTransform = transform
    }
  }

  /// The band as three concentric strips of triangles laid on the ground, with
  /// the direction markers and the travelling highlight above them.
  ///
  /// Three strips, because a 3D renderer has no equivalent of a stroke. The
  /// overlay gets its dark halo and bright rim by stroking one polygon at two
  /// widths, and those are not decoration - they are what keeps the band legible
  /// against pale concrete and dark wet asphalt alike, since any single outline
  /// colour disappears against one of them. Here the same effect is built from
  /// geometry: the same centreline swept at three half-widths, drawn widest
  /// first.
  ///
  /// Built in world coordinates on a node with an identity transform, rather
  /// than as a child of one anchor. A band spans many anchors and belongs to no
  /// single one of them, so parenting it to the first would make the whole strip
  /// swing whenever ARKit corrected that anchor alone.
  private func bandNode(along points: [PathPoint], walked: Bool) -> SCNNode? {
    guard points.count >= 2 else { return nil }

    let half = GroundPath.widthM / 2

    // Widest first and lifted least, so each strip lies over the one under it.
    // The lifts are millimetres - far below anything here is accurate to - and
    // exist only to stop coplanar surfaces flickering against each other as the
    // camera moves.
    guard
      let halo = strip(
        along: points,
        halfWidth: half + GroundPath.haloWidthM,
        lift: GroundPath.bandLiftM,
        vScale: nil
      ),
      let rim = strip(
        along: points,
        halfWidth: half + GroundPath.rimWidthM,
        lift: GroundPath.bandLiftM + GroundPath.layerLiftM,
        vScale: nil
      ),
      let fill = strip(
        along: points,
        halfWidth: half,
        lift: GroundPath.bandLiftM + GroundPath.layerLiftM * 2,
        // The fill is the one strip that is textured, so it is the one that
        // needs the distance running along it. Normalised over the band's whole
        // length, so the fade spans exactly what is drawn.
        vScale: .wholeLength
      )
    else { return nil }

    halo.geometry?.materials = [flatMaterial(UIColor(white: 0, alpha: walked ? 0.35 : 0.55))]
    halo.renderingOrder = -14

    rim.geometry?.materials = [flatMaterial(UIColor(white: 1, alpha: walked ? 0.4 : 0.85))]
    rim.renderingOrder = -13

    let fillMaterial = flatMaterial(.white)
    // The colour and the fade arrive together, as a one-pixel-wide ramp sampled
    // along the band. A texture rather than a per-vertex colour because the
    // fade has to be smooth between anchors that are more than a metre apart,
    // and interpolating two vertex colours across that distance banded visibly.
    fillMaterial.diffuse.contents = walked ? walkedRamp() : fadeRamp()
    fillMaterial.diffuse.wrapT = .clamp
    fillMaterial.diffuse.wrapS = .clamp
    fill.geometry?.materials = [fillMaterial]
    fill.renderingOrder = -12

    let node = SCNNode()
    node.addChildNode(halo)
    node.addChildNode(rim)
    node.addChildNode(fill)

    // The travelling highlight rides on its own copy of the fill, additively
    // blended. It has to be separate because the two textures want opposite
    // wrapping: the fade is clamped and spans the band once, while the highlight
    // repeats every few metres so that its speed is a speed over the ground
    // rather than a fraction of however much band happens to be drawn.
    if !walked, let wave = strip(
      along: points,
      halfWidth: half,
      lift: GroundPath.bandLiftM + GroundPath.layerLiftM * 3,
      // Normalised over the band, not repeating every few metres. Repeating
      // was the obvious choice - it makes the sweep a speed over the ground -
      // but it is not what the overlay does, and on a band longer than the
      // wavelength it puts two highlights on screen at once where the overlay
      // has one. This renderer is meant to differ from the overlay in exactly
      // one respect, so everywhere else it follows it.
      vScale: .wholeLength
    ) {
      let waveMaterial = flatMaterial(.white)
      waveMaterial.diffuse.contents = waveRamp()
      waveMaterial.diffuse.wrapT = .clamp
      waveMaterial.diffuse.wrapS = .clamp
      waveMaterial.blendMode = .add
      // Driven from the clock each frame rather than by a repeating
      // `CABasicAnimation`, and that is worth explaining because the animation
      // was the obvious choice and was wrong.
      //
      // An animation belongs to the material, so tearing the node down to
      // rebuild the geometry restarts it from the beginning. That was tolerable
      // while the band only changed when a run was added - but it has to be
      // rebuilt whenever the walked/ahead split moves too, which is every stride.
      // The sweep would have restarted at walking pace.
      //
      // A phase computed from absolute time has no such memory. It picks up
      // exactly where it left off however often the geometry underneath it is
      // replaced, which is what lets the split move freely.
      previewWaveMaterials.append(waveMaterial)

      wave.geometry?.materials = [waveMaterial]
      wave.renderingOrder = -11
      node.addChildNode(wave)
    }

    // Two passes, matching the overlay: a slightly larger dark triangle first,
    // then the white one over it. The overlay gets this from a 1pt stroke, and a
    // stroke paints over its own fill - so drawing the edge as a separate shape
    // underneath is not just the 3D equivalent, it is the shape the stroke was
    // approximating.
    if !walked {
      if let edge = markerNode(
        along: points,
        grow: GroundPath.markerEdgeM,
        color: UIColor(white: 0, alpha: 0.35),
        lift: GroundPath.bandLiftM + GroundPath.markerLiftM,
        order: -11
      ) {
        node.addChildNode(edge)
      }
      if let markers = markerNode(
        along: points,
        grow: 0,
        color: UIColor(white: 1, alpha: 0.92),
        lift: GroundPath.bandLiftM + GroundPath.markerLiftM + GroundPath.layerLiftM,
        order: -10
      ) {
        node.addChildNode(markers)
      }
    }

    return node
  }

  /// How the band sits at one point on its centreline: which way it runs
  /// through that point, and how far to step sideways to reach its edge.
  private struct BandFrame {
    /// Unit vector along the direction of travel.
    let along: simd_float3
    /// Unit vector to the walker's right, square to `along`. What the
    /// direction markers are built on, since a marker is not mitred.
    let side: simd_float3
    /// Centre to edge, already mitred - so at a corner it leans into the
    /// bend and reaches further than half the width.
    let offset: simd_float3
  }

  /// The band's frame at every point on a centreline, with the corners
  /// mitred.
  ///
  /// This is what makes a turn look like a turn. Sweeping each point square
  /// to the direction *leaving* it - which is what this did at first - means
  /// the point before a corner is swept along the old heading and the corner
  /// itself along the new one, so the quad between them is not a rectangle but
  /// a sheared trapezoid. On a right angle that shows as a notch bitten out of
  /// the inside of the bend and a flap hanging off the outside.
  ///
  /// A mitre fixes it the way it is fixed in every line renderer: the corner
  /// point is swept along the bisector of the two headings instead, and pushed
  /// out by 1/cos(half the turn) so that both arms still finish at the full
  /// half-width. At ninety degrees that is about 1.41 - unremarkable. It only
  /// misbehaves as the turn approaches a full reversal, where the bisector
  /// collapses and the factor runs away, which is what the limit is for: past
  /// it the corner is cut off square rather than allowed to shoot off to
  /// infinity. Walking routes do double back on themselves at switchbacks, so
  /// that case is real rather than theoretical.
  private func bandFrames(_ points: [PathPoint], halfWidth: Float) -> [BandFrame?] {
    let up = simd_float3(0, 1, 0)
    var frames: [BandFrame?] = []
    var previous: simd_float3?

    for i in points.indices {
      let incoming = i > 0
        ? flattened(points[i].position - points[i - 1].position)
        : nil
      let outgoing = i + 1 < points.count
        ? flattened(points[i + 1].position - points[i].position)
        : nil

      // The ends have only one heading, and a repeated coordinate has none of
      // its own - it inherits, rather than collapsing the band to a line.
      guard
        let into = incoming ?? outgoing ?? previous,
        let outOf = outgoing ?? incoming ?? previous
      else {
        frames.append(nil)
        continue
      }
      previous = outOf

      let sideIn = simd_cross(into, up)
      let sideOut = simd_cross(outOf, up)
      let sum = sideIn + sideOut
      let length = simd_length(sum)

      // A near reversal: the two normals cancel and there is no bisector to
      // speak of. Square to the outgoing leg is the only sane answer.
      guard length > 1e-3 else {
        frames.append(BandFrame(along: outOf, side: sideOut, offset: sideOut * halfWidth))
        continue
      }

      let bisector = sum / length
      // The bisector is a unit vector, so its dot with either normal is the
      // cosine of half the turn - and the reach needed is its reciprocal.
      let cosHalf = max(simd_dot(bisector, sideOut), 1e-3)
      let reach = min(GroundPath.mitreLimit, 1 / cosHalf)

      frames.append(
        BandFrame(along: outOf, side: sideOut, offset: bisector * (halfWidth * reach))
      )
    }

    return frames
  }

  /// How the texture coordinate running along a strip is scaled.
  private enum StripMapping {
    /// 0 at the near end, 1 at the far end, whatever the band's length. What a
    /// fade that spans the whole band needs.
    case wholeLength
    /// One unit per this many metres of ground. What a repeating pattern needs
    /// if it is to move at a fixed speed rather than at a fixed fraction.
    case metres(Float)
  }

  /// One sweep of the centreline at a given half-width, as a triangle strip.
  ///
  /// `vScale` of nil skips the texture coordinates entirely - the halo and rim
  /// are flat colours and have nothing to sample.
  private func strip(
    along points: [PathPoint],
    halfWidth: Float,
    lift: Float,
    vScale: StripMapping?
  ) -> SCNNode? {
    var vertices: [SCNVector3] = []
    var centres: [simd_float3] = []
    let frames = bandFrames(points, halfWidth: halfWidth)

    for (i, point) in points.enumerated() {
      guard let frame = frames[i] else { continue }

      let raised = point.position + simd_float3(0, lift, 0)
      let left = raised - frame.offset
      let right = raised + frame.offset
      vertices.append(SCNVector3(left.x, left.y, left.z))
      vertices.append(SCNVector3(right.x, right.y, right.z))
      centres.append(point.position)
    }

    guard vertices.count >= 4 else { return nil }

    let source = SCNGeometrySource(vertices: vertices)
    // A triangle strip, which is what a ribbon is: every new pair of vertices
    // closes two more triangles against the pair before it.
    let element = SCNGeometryElement(
      indices: (0..<vertices.count).map { Int32($0) },
      primitiveType: .triangleStrip
    )

    var sources = [source]
    if let vScale {
      sources.append(SCNGeometrySource(textureCoordinates: coordinates(along: centres, vScale)))
    }

    return SCNNode(geometry: SCNGeometry(sources: sources, elements: [element]))
  }

  /// Texture coordinates for a strip: u across it, v along it.
  private func coordinates(along centres: [simd_float3], _ vScale: StripMapping) -> [CGPoint] {
    var travelled: [Float] = [0]
    for i in 1..<centres.count {
      travelled.append(travelled[i - 1] + simd_length(centres[i] - centres[i - 1]))
    }

    let divisor: Float
    switch vScale {
    case .wholeLength: divisor = max(travelled.last ?? 1, 0.01)
    case .metres(let metres): divisor = metres
    }

    var uv: [CGPoint] = []
    for distance in travelled {
      let v = CGFloat(distance / divisor)
      uv.append(CGPoint(x: 0, y: v))
      uv.append(CGPoint(x: 1, y: v))
    }
    return uv
  }

  /// The direction triangles, as one geometry rather than one node each.
  private func markerNode(
    along points: [PathPoint],
    grow: Float,
    color: UIColor,
    lift: Float,
    order: Int
  ) -> SCNNode? {
    let halfLength = GroundPath.markerLengthM / 2 + grow
    let halfWidth = GroundPath.markerWidthM / 2 + grow

    var vertices: [SCNVector3] = []
    // Square to the direction of travel, not mitred. A marker is a shape
    // lying in the band rather than part of its edge, so leaning it into a
    // corner would skew the triangle instead of closing a join.
    let frames = bandFrames(points, halfWidth: halfWidth)

    for (i, point) in points.enumerated() {
      guard point.marker, let frame = frames[i] else { continue }
      let centre = point.position
      let along = frame.along
      let side = frame.side
      let raise = simd_float3(0, lift, 0)

      for corner in [
        centre + along * halfLength + raise,
        centre - along * halfLength + side * halfWidth + raise,
        centre - along * halfLength - side * halfWidth + raise,
      ] {
        vertices.append(SCNVector3(corner.x, corner.y, corner.z))
      }
    }

    guard vertices.count >= 3 else { return nil }

    let geometry = SCNGeometry(
      sources: [SCNGeometrySource(vertices: vertices)],
      elements: [
        SCNGeometryElement(
          indices: (0..<vertices.count).map { Int32($0) },
          primitiveType: .triangles
        )
      ]
    )
    geometry.materials = [flatMaterial(color)]

    let node = SCNNode(geometry: geometry)
    node.renderingOrder = order
    return node
  }

  /// A material for a marking on the ground.
  ///
  /// Constant rather than lit, because a marking has no surface normal anyone
  /// believes in - shading it would make the far end darken for reasons that
  /// have nothing to do with distance, which is the one thing the fade is
  /// supposed to be saying.
  ///
  /// Double sided so that a strip turned by a slope cannot present a back face
  /// and punch a hole in itself, and writing no depth so the layers of the band
  /// never fight each other for the same pixels.
  private func flatMaterial(_ color: UIColor) -> SCNMaterial {
    let material = SCNMaterial()
    material.lightingModel = .constant
    material.diffuse.contents = color
    material.isDoubleSided = true
    material.writesToDepthBuffer = false
    return material
  }

  /// The band's colour and its distance fade, as a one-pixel-wide ramp.
  ///
  /// Cached because it never changes and building it allocates a bitmap.
  ///
  /// Drawn top to bottom, and the geometry's v runs 0 at the near end - so the
  /// *first* stop is the near end. Worth checking on a device before trusting:
  /// if the band comes out faint at your feet and solid in the distance, these
  /// two stops are the wrong way round and swapping them is the whole fix.
  /// The same ramp for ground already covered: grey, and fainter at both ends.
  /// Grey rather than a dimmed green, because dimming is already what distance
  /// does to the far end of the live band - two meanings on one channel would
  /// make a long route ahead read as a route behind.
  private func walkedRamp() -> UIImage? {
    if let cachedWalked { return cachedWalked }
    let grey = UIColor(red: 0.604, green: 0.627, blue: 0.651, alpha: 1)
    cachedWalked = ramp(stops: [
      grey.withAlphaComponent(GroundPath.walkedNearOpacity),
      grey.withAlphaComponent(GroundPath.walkedFarOpacity),
    ])
    return cachedWalked
  }

  private func fadeRamp() -> UIImage? {
    if let cachedFade { return cachedFade }
    let green = UIColor(red: 0.16, green: 0.79, blue: 0.42, alpha: 1)
    cachedFade = ramp(stops: [
      green.withAlphaComponent(GroundPath.nearOpacity),
      green.withAlphaComponent(GroundPath.farOpacity),
    ])
    return cachedFade
  }

  /// One pass of the travelling highlight: a soft bright band over transparent
  /// black, repeating along the strip.
  ///
  /// Black rather than clear at the ends because this is added, not blended -
  /// and adding black is what "leave this pixel alone" means.
  private func waveRamp() -> UIImage? {
    if let cachedWave { return cachedWave }
    let lift = GroundPath.waveStrength
    let half = CGFloat(GroundPath.wavePulseHalfWidth)
    cachedWave = ramp(stops: [
      UIColor(white: 0, alpha: 1),
      UIColor(white: lift, alpha: 1),
      UIColor(white: 0, alpha: 1),
      UIColor(white: 0, alpha: 1),
    ], locations: [0, half, half * 2, 1])
    return cachedWave
  }

  private func ramp(stops: [UIColor], locations: [CGFloat]? = nil) -> UIImage? {
    let size = CGSize(width: 1, height: 256)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false

    return UIGraphicsImageRenderer(size: size, format: format).image { context in
      guard
        let gradient = CGGradient(
          colorsSpace: CGColorSpaceCreateDeviceRGB(),
          colors: stops.map { $0.cgColor } as CFArray,
          locations: locations
        )
      else { return }

      context.cgContext.drawLinearGradient(
        gradient,
        start: CGPoint(x: 0, y: 0),
        end: CGPoint(x: 0, y: size.height),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
      )
    }
  }

  /// Whether the floor has been found well enough to put something on it, and
  /// telling JS when that answer changes.
  ///
  /// The test is the same raycast a tap would run, from the middle of the
  /// screen, so what the overlay promises and what a tap can actually do cannot
  /// come apart.
  ///
  /// But it *latches*, and that is the important part. Asked fresh each time,
  /// this is a question about where the phone happens to be pointing right now,
  /// and the honest answer flickers: look up at a wall, step in close over the
  /// band, tilt to read something, and the middle of the frame leaves the floor
  /// for a moment. Reported straight through, that put the scanning overlay back
  /// over the screen every few seconds during ordinary use - which is both
  /// wrong and maddening, because the session had not lost anything.
  ///
  /// Finding the floor is not a state the session drops in and out of. Once it
  /// has one, it keeps it, and a raycast that misses means the camera is aimed
  /// somewhere else. So only a genuine loss of tracking takes it back - and even
  /// then not instantly, because tracking dips briefly for all sorts of reasons
  /// that resolve themselves before anyone could act on the advice.
  private func updatePreviewReadiness(arFrame: ARFrame) {
    // Throttled: this raycasts, and at 60Hz it would be a raycast a frame to
    // re-answer a question whose answer holds for seconds.
    let now = arFrame.timestamp
    guard now - lastReadinessProbe > GroundPath.groundProbeInterval else { return }
    lastReadinessProbe = now

    let tracking: Bool
    switch arFrame.camera.trackingState {
    case .normal: tracking = true
    default: tracking = false
    }

    let centre = CGPoint(x: bounds.midX, y: bounds.midY)
    let onSurface = bounds.width > 0
      && sceneView.raycastQuery(from: centre, allowing: .estimatedPlane, alignment: .horizontal)
        .map { !sceneView.session.raycast($0).isEmpty } ?? false

    if tracking && onSurface {
      trackingLostSince = nil
      previewReady = true
    } else if tracking {
      // Pointing away from the floor. Nothing has gone wrong and there is
      // nothing to tell the user, so this says nothing at all.
      trackingLostSince = nil
    } else {
      // Tracking itself is gone, which is the one case where asking the user to
      // move the phone is real advice rather than noise.
      let since = trackingLostSince ?? now
      trackingLostSince = since
      if now - since > GroundPath.readinessGraceSeconds { previewReady = false }
    }

    // How many things are down travels on the same event rather than being
    // counted in JS from the anchor list. Under the scene renderer that list is
    // empty by design - the scene is drawing the band, so nothing is sent over
    // to draw - and a JS count would then report nothing placed however many
    // taps had landed.
    let placed = previewRuns.count

    guard
      previewReady != previewReadySent || placed != previewPlacedCount || !previewStateSent
    else { return }

    previewReadySent = previewReady
    previewPlacedCount = placed
    previewStateSent = true
    onPreviewState(["ready": previewReady, "placed": placed])
  }

  /// The tapped placements, projected exactly the way a real route is.
  ///
  /// Same `kind` values, same ribbon builder, same projection - so what the
  /// preview shows is the navigation screen's own drawing rather than a mock-up
  /// of it, and the JS side needs no idea which one it is looking at.
  ///
  /// Each tap is its own run and therefore its own ribbon, which is why the
  /// placements are grouped rather than being one flat list. Two paths dropped
  /// in different corners of a room are two paths; stitching them into one
  /// would draw a ribbon across the gap between them.
  private func emitPreviewAnchors(arFrame: ARFrame, viewport: CGSize, pinsOnly: Bool) {
    var projected: [[String: Any]] = []

    for (index, run) in previewRuns.enumerated() {
      let points = previewPoints(of: run, arFrame: arFrame)

      if run.kind == "destination" {
        guard let first = points.first else { continue }
        projected.append(
          project(
            position: first.position,
            // The pin's index is negative, matching the destination id the
            // navigation screen uses, so the JS side treats it the same way.
            index: -1 - index,
            kind: run.kind,
            arFrame: arFrame,
            viewport: viewport
          )
        )
        continue
      }

      if pinsOnly { continue }

      // Cut at the walker exactly as a real route is, so the covered half can be
      // seen indoors by walking along a placement. Two ribbons need two indices
      // that cannot collide with each other or with another run: doubling the
      // run index gives each run a pair of its own.
      let (walked, ahead) = splitAtWalker(points, arFrame: arFrame)

      if let covered = ribbon(
        along: walked,
        index: index * 2 + 1,
        kind: "path-walked",
        arFrame: arFrame,
        viewport: viewport
      ) {
        projected.append(covered)
      }

      if let path = ribbon(
        along: ahead,
        index: index * 2,
        kind: "path",
        arFrame: arFrame,
        viewport: viewport
      ) {
        projected.append(path)
      }
    }

    onAnchorsUpdate(["anchors": projected])
  }

  /// The route as one closed polygon on screen: a band of constant width in the
  /// world, laid along the centreline and cut off at the near plane.
  ///
  /// Nil when there is nothing left to draw - fewer than two points to begin
  /// with, or the whole path behind the walker.
  private func ribbon(
    along centres: [PathPoint],
    index: Int,
    kind: String,
    arFrame: ARFrame,
    viewport: CGSize
  ) -> [String: Any]? {
    let visible = clipToNearPlane(centres, arFrame: arFrame)
    guard visible.count >= 2 else { return nil }

    let half = GroundPath.widthM / 2
    var leftEdge: [CGPoint] = []
    var rightEdge: [CGPoint] = []
    var markers: [Double] = []
    var nearest = Float.greatestFiniteMagnitude
    var nearestPoint = CGPoint.zero
    // Mitred at the corners, the same as the scene renderer - see bandFrames.
    let frames = bandFrames(visible, halfWidth: half)

    for (i, point) in visible.enumerated() {
      let centre = point.position
      guard let frame = frames[i] else { continue }
      let along = frame.along
      let side = frame.side

      let left = screenPoint(
        of: centre - frame.offset, arFrame: arFrame, viewport: viewport
      )
      let right = screenPoint(
        of: centre + frame.offset, arFrame: arFrame, viewport: viewport
      )
      guard left.inFront, right.inFront else { continue }

      leftEdge.append(left.point)
      rightEdge.append(right.point)

      if point.marker,
         let triangle = marker(at: centre, along: along, side: side, arFrame: arFrame, viewport: viewport) {
        markers.append(contentsOf: triangle)
      }

      if left.distance < nearest {
        nearest = left.distance
        nearestPoint = left.point
      }
    }

    guard leftEdge.count >= 2 else { return nil }

    // Down one edge and back up the other, which closes the band into a single
    // polygon rather than two lines that happen to be near each other.
    var outline: [Double] = []
    for point in leftEdge + rightEdge.reversed() {
      outline.append(Double(point.x))
      outline.append(Double(point.y))
    }

    var payload: [String: Any] = [
      "index": index,
      "kind": kind,
      "x": nearestPoint.x,
      "y": nearestPoint.y,
      "distance": Double(nearest),
      "visible": true,
      "outline": outline,
    ]
    if !markers.isEmpty { payload["markers"] = markers }
    return payload
  }

  /// One direction triangle lying in the band, as three screen corners.
  ///
  /// Deliberately *not* distance-compensated, unlike the chevrons these grew
  /// out of. That compensation is what put a pinch in the old run, and it is
  /// not needed here because these are no longer carrying the guidance on their
  /// own - the band does that, continuously, and these only say which way along
  /// it to go. A far one shrinking to almost nothing costs nothing, because the
  /// band it sits on is still there.
  ///
  /// Nil when any corner is behind the lens. A partly projected triangle is not
  /// a smaller triangle, it is a torn one - and there is no clipping to do here
  /// the way there is for the band, because a missing marker leaves the band
  /// intact and a missing stretch of band would leave a hole.
  private func marker(
    at centre: simd_float3,
    along: simd_float3,
    side: simd_float3,
    arFrame: ARFrame,
    viewport: CGSize
  ) -> [Double]? {
    let halfLength = GroundPath.markerLengthM / 2
    let halfWidth = GroundPath.markerWidthM / 2

    let corners = [
      centre + along * halfLength,
      centre - along * halfLength + side * halfWidth,
      centre - along * halfLength - side * halfWidth,
    ]

    var flat: [Double] = []
    for corner in corners {
      let projected = screenPoint(of: corner, arFrame: arFrame, viewport: viewport)
      guard projected.inFront else { return nil }
      flat.append(Double(projected.point.x))
      flat.append(Double(projected.point.y))
    }

    return flat
  }

  /// The centreline cut in two where the walker is standing: what they have
  /// already covered, and what is still ahead.
  ///
  /// The split point belongs to both halves, so the two bands meet exactly
  /// rather than leaving a seam or overlapping by a step.
  ///
  /// Measured horizontally. The walker's height above the path is not evidence
  /// of anything about their progress along it, and including it would push the
  /// split backwards on a slope by roughly their own height.
  private func splitAtWalker(
    _ points: [PathPoint],
    arFrame: ARFrame
  ) -> (walked: [PathPoint], ahead: [PathPoint]) {
    guard points.count >= 2 else { return ([], points) }

    let camera = origin(of: arFrame.camera.transform)
    var bestIndex = 0
    var bestT: Float = 0
    var bestDistance = Float.greatestFiniteMagnitude

    for i in 0..<(points.count - 1) {
      let a = points[i].position
      let b = points[i + 1].position
      let segment = simd_float3(b.x - a.x, 0, b.z - a.z)
      let lengthSquared = simd_length_squared(segment)
      let toCamera = simd_float3(camera.x - a.x, 0, camera.z - a.z)

      let t = lengthSquared > 1e-6
        ? min(1, max(0, simd_dot(toCamera, segment) / lengthSquared))
        : 0
      let foot = a + (b - a) * t
      let distance = simd_length(simd_float3(camera.x - foot.x, 0, camera.z - foot.z))

      if distance < bestDistance {
        bestDistance = distance
        bestIndex = i
        bestT = t
      }
    }

    let a = points[bestIndex].position
    let b = points[bestIndex + 1].position
    // The join carries no marker: it lands wherever the walker happens to be
    // rather than on the lattice, so a triangle there would slide along the
    // band as they walked instead of staying on its patch of ground.
    let join = PathPoint(position: a + (b - a) * bestT, marker: false)

    let walked = Array(points[0...bestIndex]) + [join]
    let ahead = [join] + Array(points[(bestIndex + 1)...])

    return (walked, ahead)
  }

  /// The centreline with everything at or behind the lens removed, and the
  /// segment that straddles the near plane cut at it.
  ///
  /// Cutting rather than dropping is the whole point - see GroundPath.nearClipM.
  /// The walker is standing on the near end of this path, so on any route being
  /// actively walked the first point or two are behind the camera, and dropping
  /// whole segments would make the ribbon start a stride and a half up the
  /// street instead of at their feet.
  private func clipToNearPlane(_ centres: [PathPoint], arFrame: ARFrame) -> [PathPoint] {
    guard centres.count >= 2 else { return [] }

    let toCamera = arFrame.camera.transform.inverse
    // Depth in front of the lens, positive ahead: camera space looks down -Z.
    func depth(_ position: simd_float3) -> Float {
      -simd_mul(toCamera, simd_float4(position, 1)).z
    }

    let near = GroundPath.nearClipM
    var kept: [PathPoint] = []

    for i in 0..<(centres.count - 1) {
      let a = centres[i]
      let b = centres[i + 1]
      let da = depth(a.position)
      let db = depth(b.position)

      if da >= near { kept.append(a) }

      // Exactly one end in front: the crossing point is where the depth
      // reaches the near plane, which on a straight segment is a plain linear
      // interpolation of the two depths. The cut point carries no marker - it
      // is an artefact of where the phone is pointed, not a place on the route.
      if (da >= near) != (db >= near), abs(db - da) > 1e-6 {
        let t = (near - da) / (db - da)
        kept.append(PathPoint(position: a.position + (b.position - a.position) * t, marker: false))
      }
    }

    if depth(centres[centres.count - 1].position) >= near { kept.append(centres[centres.count - 1]) }

    return kept
  }

  /// One anchor as a bare projected point: the destination pin, and the control
  /// anchors on the test screen. Anything drawn as a shape on the ground goes
  /// through `ribbon` instead.
  private func project(
    position: simd_float3,
    index: Int,
    kind: String,
    arFrame: ARFrame,
    viewport: CGSize
  ) -> [String: Any] {
    let centre = screenPoint(of: position, arFrame: arFrame, viewport: viewport)

    return [
      "index": index,
      "kind": kind,
      "x": centre.point.x,
      "y": centre.point.y,
      "distance": Double(centre.distance),
      "visible": centre.inFront,
    ]
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
