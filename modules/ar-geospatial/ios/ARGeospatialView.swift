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
// CACurrentMediaTime, for the measurement. SceneKit pulls QuartzCore in, but the
// same argument applies as in HazardDetector: a transitive import is someone
// else's decision to change.
import QuartzCore
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
  /// how far apart.
  ///
  /// The spacing matches ANCHOR_SPACING_M on the navigation screen, so what is
  /// previewed is the real thing at its real density - which is the whole claim
  /// this screen makes, and it has to be kept true by hand whenever that figure
  /// moves.
  ///
  /// Twelve points is twenty-two metres, which is long for a room and is the
  /// point. A chevron every eight metres needs a run long enough to hold three of
  /// them, and a turn cannot be told apart from a sharper one until enough of
  /// what comes *after* the bend is on the ground to see. Eight points at the old
  /// spacing was eight metres, so the whole difference between a left, a sharp
  /// left and a u-turn lay past the end of the run.
  static let previewCount = 12
  static let previewSpacingM: Float = 2

  /// How wide the painted path is, in metres.
  ///
  /// A little under a pavement, so it reads as a lane to walk in rather than as
  /// a covering laid over the whole footway. Constant in the world, which is
  /// what makes it taper on screen: near the walker it is a broad band, and it
  /// narrows towards the horizon exactly as a real painted line would. That
  /// taper is doing the work the chevrons' spacing used to do - it says which
  /// way is "away" without anything having to be pointed.
  /// The bounds the chevron's width moves between.
  ///
  /// The width itself is a prop - see `guidanceWidth` - because it is the one
  /// measurement here that is not a design choice. It is a statement about how
  /// much the app actually knows, and it has to be allowed to say "not much".
  ///
  /// Three metres is a footpath. Fourteen is a two-lane road with a pavement
  /// and a row of parked cars on each side, which is what a chevron has to span
  /// when the route line is on one pavement and the walker is on the other.
  static let minGuidanceWidthM: Float = 3
  static let maxGuidanceWidthM: Float = 14
  static let defaultGuidanceWidthM: Float = 5

  /// How thick the chevron's arms are drawn, and how far its point reaches
  /// forward, as a fraction of its width.
  ///
  /// The arms stay a third of a metre whatever the span, which is the whole
  /// reason this shape was worth changing to. A band twelve metres wide would be
  /// twelve metres of paint over the pavement; twelve metres of chevron is two
  /// strokes a third of a metre thick with everything between them left clear.
  /// Wide and sparse are not two wishes, they are the same one.
  static let chevronArmM: Float = 0.34
  static let chevronSweepFraction: Float = 0.35

  /// How often a chevron appears, counted in anchors rather than in metres.
  ///
  /// By anchor and not by distance along the visible stretch, because anchor ids
  /// are lattice indices measured from the start of the route. A chevron on every
  /// fifth of them lands on a fixed patch of ground and stays there; one placed
  /// every six metres along whatever is currently on screen would crawl forwards
  /// as the walker moved, which is the one thing a marker on the ground must
  /// never do.
  ///
  /// Four anchors at the route's 2m spacing is a chevron every eight metres.
  ///
  /// It has to divide a million exactly. The sideways shift is folded into the
  /// anchor ids as a whole multiple of a million - see OFFSET_ID_STRIDE - so a
  /// value that did not divide it would change *which* anchors are marked every
  /// time the run moved sideways, and the chevrons would jump to new ground for
  /// no reason the walker could see. Four divides it; three would not.
  static let markerEveryNthAnchor = 4

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
  /// these are the same idea in metres, measured outwards from the edge of the
  /// mark: the rim takes the first 45mm and the halo the 55mm beyond it. Chosen
  /// to match what those strokes subtend at about three metres, which is where
  /// most of the guidance a walker reads actually sits.
  static let haloWidthM: Float = 0.1
  static let rimWidthM: Float = 0.045

  /// How solid the two outline layers are, live and for ground already walked.
  ///
  /// The outline carries the mark and the fill only tints it, which is the
  /// opposite of how this started and is the right way round for guidance drawn
  /// over a pavement someone is about to walk on. A filled shape competes with
  /// the ground for the same pixels; an outlined one draws the eye to an edge
  /// and leaves the middle to the pavement. So these are near solid while the
  /// fill below is barely there.
  ///
  /// The walked pair are dimmer rather than a different colour. With the fill
  /// this faint, grey against green is no longer enough on its own to say which
  /// half of the route a chevron belongs to - brightness has to carry it.
  static let haloOpacity: CGFloat = 0.8
  static let rimOpacity: CGFloat = 1.0
  static let walkedHaloOpacity: CGFloat = 0.45
  static let walkedRimOpacity: CGFloat = 0.5

  /// The gap between the stacked strips. Millimetres - far below anything here
  /// is accurate to - and present only so coplanar surfaces cannot flicker.
  static let layerLiftM: Float = 0.002

  /// The distance fade and the travelling highlight.
  ///
  /// Barely there, and that is a safety decision rather than a stylistic one.
  ///
  /// At 0.95 the band was a solid sheet of colour laid over the pavement, which
  /// hid exactly what a walker most needs to see - the kerb, the puddle, the
  /// broken slab, the thing this app exists to warn them about. Guidance that
  /// obscures the ground it is guiding you across is worse than no guidance.
  ///
  /// It went 0.95, then 0.5, then 0.32, then 0.16 - and 0.16 was chasing the
  /// wrong thing. The fill looked washed out not because it was too strong but
  /// because it was being composited over the white rim underneath it rather
  /// than over the pavement; see the note in `chevronNode`. Lowering it made it
  /// whiter, which is the opposite of what was wanted and should have been the
  /// clue.
  ///
  /// With the rim drawn as a ring, the green now lands on the ground and reads as
  /// green, so it can afford to be seen. Still a tint - you can read the paving
  /// through it - and the outline still carries the shape.
  ///
  /// The last nudge up came with the fill turning a purer green. Alpha and
  /// saturation both make a tint look stronger and are not interchangeable: alpha
  /// decides how much pavement survives, saturation only decides what colour the
  /// part that does not survive is. So the chroma did most of that work and this
  /// moved by a little, which is what keeps the ground readable.
  static let nearOpacity: CGFloat = 0.4
  static let farOpacity: CGFloat = 0.28

  /// Ground already covered.
  static let walkedNearOpacity: CGFloat = 0.3
  static let walkedFarOpacity: CGFloat = 0.2

  /// How far the floor estimate has to move before the 3D band is rebuilt on
  /// it. A centimetre is below what any of this resolves and well below what a
  /// rebuild costs in a restarted highlight animation.
  static let rebuildFloorDeltaM: Float = 0.01

  /// How far along a run the walked/ahead split has to move before the band is
  /// rebuilt on it.
  ///
  /// The split follows the walker continuously, so left unquantised it would
  /// rebuild the geometry on every frame.
  ///
  /// In metres rather than as a fraction of the run, which is what it used to
  /// be. A fraction meant the same setting behaved differently on the two
  /// screens: a fortieth of the eight metres a tap places is twenty centimetres,
  /// a fortieth of the sixteen metres of route the navigation screen carries is
  /// twice that - so the boundary would have stepped most coarsely on the screen
  /// where it matters, and the preview would have been quietly flattering.
  ///
  /// Twenty centimetres is well under a stride, and the boundary it moves lies
  /// at the walker's own feet, where the ground is most foreshortened.
  static let rebuildSplitM: Float = 0.2

  /// How far a point has to move across the ground before the band is rebuilt
  /// on it.
  ///
  /// This is the test the navigation screen needs and the preview never did. A
  /// placement sits on plain ARKit anchors, which barely move once they are
  /// down; a route sits on Geospatial anchors, which are corrected continuously
  /// as the localisation improves. Without this the band would keep the shape it
  /// was first built with while the anchors underneath it slid sideways. Five
  /// centimetres is well under the width of the band, so a correction large
  /// enough to see is a correction large enough to rebuild for.
  static let rebuildMoveM: Float = 0.05

  /// The smallest the pin is ever built: a person at eye level.
  ///
  /// The floor under the rule in `pinHeight`, and the size the marker settles to
  /// once the walker is standing on top of it. Something at the height of your
  /// own eyes is the most readable thing a marker can be at close range - it is
  /// the size the street is already full of.
  static let pinLifeSizeM: Float = 1.7

  /// How big the pin looks while it is far enough away to need the help: its
  /// height divided by its distance.
  ///
  /// A ratio rather than a height, because what matters at range is the angle the
  /// marker subtends, not how many metres of it there are. Held constant, the pin
  /// is the same size to look at from sixty metres as from six - which is the
  /// whole job of a destination marker, and the opposite of what an honestly
  /// scaled object does.
  ///
  /// At 0.6 it stands a little under half the height of the screen, at any range
  /// where the rule is in force. This is the one number to change if it should be
  /// bigger or smaller: the pin's height on screen is very nearly this times the
  /// screen's height, and nothing else about the pin needs touching.
  static let pinApparentSize: Float = 0.6

  /// The pin's outline, in the 24-by-36 unit space it is drawn in: the tip at
  /// the origin, a bulb of radius 12 centred 24 above it, and a hole of radius
  /// 5 punched through that bulb.
  ///
  /// The hole is the whole reason this is an extruded outline rather than the
  /// ball on a spike it started as. A ball is a solid of revolution and needs no
  /// billboard, which was elegant - but it is not the shape anyone recognises,
  /// and a marker that has to be understood at a glance should look like the
  /// thing it is imitating rather than like the cleanest way to build it.
  static let pinUnitHeight: CGFloat = 36
  static let pinBulbRadius: CGFloat = 12
  static let pinBulbCentre: CGFloat = 24
  static let pinHoleRadius: CGFloat = 5

  /// How thick the pin is and how rounded its edges are, in the same units.
  ///
  /// Thickness is what stops an extruded outline reading as a cut-out. The
  /// chamfer is what stops it reading as a slab: a hard 90-degree edge takes no
  /// highlight, and the bright line running down a rounded edge is most of what
  /// the eye uses to decide something is solid.
  static let pinThicknessUnits: CGFloat = 5
  static let pinChamferUnits: CGFloat = 1.2

  /// How glossy the pin is: plastic, not metal and not chalk.
  ///
  /// This is the number that decides whether it looks like a rendering or like
  /// an object someone left on the pavement. A surface with no gloss at all takes
  /// no highlight and shows nothing of the room it is standing in, and nothing in
  /// a camera frame behaves that way.
  ///
  /// Lowered for the extruded shape, which wants to look like moulded plastic
  /// with a sheen on it rather than like matte paint.
  static let pinRoughness: CGFloat = 0.22

  /// A little light of its own, so a marker in deep shade is still findable.
  /// Realism is the goal right up to the point where it hides the destination.
  static let pinGlow: CGFloat = 0.16

  /// Past this the pin is not drawn. Not a rendering limit - an honesty one.
  /// Geospatial anchors are placed against a pose whose error grows with range,
  /// and a pin planted two hundred metres off would be confidently pointing
  /// through three buildings at a spot it has no business being sure about.
  static let pinFarCutM: Float = 60

  /// And inside this it is not drawn either.
  ///
  /// True perspective on a waist-high object at arm's length is a red slab
  /// across the whole frame. Correct, and the worst possible thing to put there:
  /// it hides the pavement at the exact moment the walker is stepping onto it,
  /// which is the same argument that took the band down to a third opacity.
  ///
  /// The overlay version handled this by capping the drawn size, which is a lie
  /// told gently - the pin stopped growing while everything around it kept
  /// going, so it read as shrinking on approach. Cutting it is honest, and it
  /// costs nothing: the label is drawn by the JS layer at a fixed size and stays,
  /// so the destination is still named at the moment the pin gives way to it.
  ///
  /// Sixty centimetres, down from a metre and a half, because the first figure
  /// was guessed and the arithmetic says it was far too cautious. A one-metre
  /// pin covers about a quarter of the screen's height at a metre and a half -
  /// nowhere near the slab this is guarding against, and well inside the radius
  /// at which the route is declared arrived. It was cutting the marker away at
  /// exactly the moment it is meant to say "this one".
  static let pinNearCutM: Float = 0.6

  /// The contact shadow under the pin, as a fraction of its height, and how
  /// dark its centre is.
  ///
  /// Not decoration. A marker with nothing beneath it reads as hovering, and
  /// hovering is the single loudest tell that a thing has been pasted onto the
  /// picture rather than placed in it.
  static let pinShadowRadiusFraction: Float = 0.35
  static let pinShadowOpacity: CGFloat = 0.38

  /// And how wide it is allowed to get, whatever the pin is doing.
  ///
  /// The one place the shadow is deliberately not in proportion. A pin held at a
  /// constant apparent size is thirty-six metres tall by the time it is sixty
  /// metres away, and a shadow in proportion to that is a twenty-five metre pool
  /// of black laid across the road - over the chevrons the walker is meant to be
  /// following.
  ///
  /// The inconsistency costs nothing because of where a contact shadow is read.
  /// It says "this is standing here rather than floating", and that is a claim
  /// about the tip, settled in the last few metres. At sixty metres the shadow is
  /// a handful of points across either way.
  static let pinShadowMaxRadiusM: Float = 1.0
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

  let onGeospatialUpdate = EventDispatcher()
  let onAnchorsUpdate = EventDispatcher()
  let onHazards = EventDispatcher()
  let onPreviewState = EventDispatcher()
  let onPerformance = EventDispatcher()

  /// What the screen is costing, measured rather than argued.
  ///
  /// Three separate numbers, and they are not interchangeable. `renderRate` is
  /// what the walker sees - SceneKit presenting a frame. `frameRate` is ARKit
  /// offering one. `frameWork` is how long this class then spends on the main
  /// thread before giving it back, which is the quantity that turns the second
  /// number into the first.
  ///
  /// They are read from two threads: SceneKit renders on its own, and the
  /// session delegate is called on the main one, because no `delegateQueue` was
  /// set on it. Hence the lock.
  private var renderRate = RateCounter()
  private var frameRate = RateCounter()
  private var frameWork = DurationSampler()
  private let perfLock = NSLock()
  private var lastPerformanceSent: CFTimeInterval = 0

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
  /// How wide the chevrons are drawn, in metres, as the JS side works it out.
  ///
  /// A prop and not a constant because it is not a matter of taste. It is how
  /// far apart the two answers to "where is the route" currently are - what the
  /// map says, and where the walker is standing - and a marker narrower than
  /// that gap is claiming a precision nobody has. See the note in
  /// ARNavigationScreen where it is measured.
  private var guidanceWidth = GroundPath.defaultGuidanceWidthM

  private var previewMode = false
  private var previewComponent = "path"
  private var previewClearToken = 0
  private var previewRuns: [PreviewRun] = []
  private var previewTap: UITapGestureRecognizer?


  /// The band nodes currently in the scene - the route's on the navigation
  /// screen, the placements' in the preview.
  ///
  /// Rebuilt rather than transformed, because a band's shape depends on the
  /// ground under it as well as on its anchors, and both move as ARKit and the
  /// Geospatial API refine them. Rebuilding a dozen vertices is far cheaper than
  /// the bookkeeping to work out whether it was necessary.
  private var pathNodes: [SCNNode] = []
  private var lastGeometryBuild: TimeInterval = 0

  /// What the nodes currently in the scene were built from: the floor height
  /// under each point, where each point stands on the ground plan, and where the
  /// walked/ahead split falls on each run.
  ///
  /// The geometry is rebuilt only when one of these has actually moved, which
  /// matters for more than cost: a rebuild tears the nodes down, and anything
  /// living on their materials goes with them.
  ///
  /// Each is compared against what was *built*, not against the last thing
  /// measured. That is what stops a figure hovering on a threshold from
  /// rebuilding every tick: once rebuilt, the stored figure is the current one,
  /// so it takes a fresh move of the full amount to trigger again.
  private var needsRebuild = true
  private var builtHeights: [Float] = []
  private var builtPlan: [simd_float2] = []
  private var builtSplits: [Int] = []


  private var cachedShadow: UIImage?
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

    // Lets ARKit drive the scene's lighting from what it can see: the ambient
    // intensity and colour temperature it estimates each frame, and the
    // environment probe the configuration asks for. Without this the probe is
    // built and never used.
    sceneView.automaticallyUpdatesLighting = true
    // A curved silhouette against a photograph is where aliasing shows worst,
    // and the pin is nothing but curved silhouette.
    sceneView.antialiasingMode = .multisampling4X

    // A neutral environment to start from, so the pin is lit on the very first
    // frame. ARKit replaces this the moment its own probe is ready; without it
    // a physically based surface with nothing to reflect renders as what it
    // physically is under no light at all, which is black.
    sceneView.scene.lightingEnvironment.contents = UIColor(white: 0.65, alpha: 1)
    sceneView.scene.lightingEnvironment.intensity = 1

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
      clearPathNodes()
    }
  }

  func setPreviewComponent(_ component: String) {
    previewComponent = component
  }

  func setGuidanceWidth(_ width: Float) {
    guard abs(width - guidanceWidth) > 0.01 else { return }
    guidanceWidth = width
    // The chevrons carry this in their geometry, so a change to it is a change
    // of shape and has to be built. Nothing else in the rebuild test would
    // notice - not a point has moved.
    needsRebuild = true
  }


  private func clearPathNodes() {
    for node in pathNodes { node.removeFromParentNode() }
    pathNodes.removeAll()
    // The signature has to go with them. Left set, the next tick would compare
    // an unchanged shape against nodes that are no longer in the scene and
    // decline to rebuild the very thing it just removed.
    needsRebuild = true
    builtSplits = []
    builtHeights = []
    builtPlan = []
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

    // A cube map of the surroundings, assembled from the camera feed as the
    // walker moves and filled in by ARKit where they have not looked.
    //
    // This is the setting behind why an object in AR Quick Look sits in the room
    // and a hand-built one usually does not. Without it a rendered surface can
    // only reflect whatever the app decided to imagine; with it, it reflects the
    // actual pavement, the actual sky, the actual wall to its left - and the
    // reflection changes as the walker moves around it, which is a cue the eye
    // reads immediately and cannot be faked by choosing a nicer colour.
    //
    // It costs nothing here beyond the probe itself: the band is constant-shaded
    // and ignores lighting entirely, so this is doing work for the pin alone.
    configuration.environmentTexturing = .automatic

    sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    // Timed as a whole, because the whole of it is main-thread time.
    //
    // ARKit calls this on the main thread - no `delegateQueue` is set on the
    // session - and everything below runs to completion before the run loop is
    // given back. Hazard inference is inside it and is synchronous, so on this
    // screen the model's cost is subtracted directly from the renderer's budget.
    // At sixty frames a second there are sixteen milliseconds to spend.
    //
    // The hazard screen does not work this way: it hands frames to its own
    // capture queue. Measuring both is what makes the comparison mean anything.
    var elapsed: Double = 0
    measuring({ elapsed = $0 }) { handleFrame(frame) }

    perfLock.lock()
    frameRate.tick()
    frameWork.record(elapsed)
    perfLock.unlock()

    emitPerformanceIfDue()
  }

  private func handleFrame(_ frame: ARFrame) {
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

  /// Called once per presented frame, on SceneKit's own render thread.
  ///
  /// This is the frame rate the requirement is about. Counting ARKit's delivery
  /// instead would measure the camera, which keeps its cadence whatever the app
  /// does with it - a screen frozen behind a blocked main thread still receives
  /// sixty frames a second and shows none of them.
  func renderer(_ renderer: SCNSceneRenderer, updateAtTime time: TimeInterval) {
    perfLock.lock()
    renderRate.tick(at: time)
    perfLock.unlock()
  }

  /// A snapshot a second, which is as often as a number on screen can be read.
  private func emitPerformanceIfDue() {
    let now = CACurrentMediaTime()
    guard now - lastPerformanceSent >= 1 else { return }
    lastPerformanceSent = now

    perfLock.lock()
    var payload: [String: Any] = [
      "render": renderRate.dictionary,
      "frames": frameRate.dictionary,
    ]
    if let work = frameWork.summary { payload["frameWork"] = work.dictionary }
    perfLock.unlock()

    payload["screen"] = "ar"
    if let detector = detector.performance() { payload["detector"] = detector }
    onPerformance(payload)
  }

  /// Runs the model flat out instead of at its throttled rate, so the ceiling
  /// can be measured rather than assumed. See `HazardDetector.setUnthrottled`.
  func setBenchmarking(_ on: Bool) {
    detector.setUnthrottled(on)
  }

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
      let ground = previewGroundPoints()
      probeAnchorGround(ground, arFrame: arFrame)
      updatePathGeometry(
        points: ground,
        splits: previewRuns.map { run in
          walkerDistance(along: run.anchors.map { origin(of: $0.transform) }, arFrame: arFrame)
        },
        arFrame: arFrame
      ) {
        previewBuild(arFrame: arFrame)
      }

      // Only the pin goes over to the JS layer. The band is geometry in the
      // scene, so there is nothing of it left to draw over the top.
      //
      // The pin stays where it is, and that is not the same thing as being
      // left behind. A destination marker has to face the walker from every
      // approach, which is what a flat sprite at a projected point is; the
      // band lies on the ground and belongs in the geometry. Each is drawn
      // where its own shape wants to be.
      emitPreviewAnchors(arFrame: arFrame, viewport: viewport)
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

    // Found once and used twice: the ground probe measures the floor under
    // these points, and the rebuild test asks whether they have moved.
    let ground = routeGroundPoints()
    probeAnchorGround(ground, arFrame: arFrame)

    // Everything that is a point rather than a path: the destination pin. Sent
    // with its own kind, since the JS side draws it as a sprite standing at the
    // projected point rather than as a shape on the ground.
    var pins: [simd_float3] = []
    for request in requestedAnchors where request.kind != "route" {
      guard let anchor = placedAnchors[request.id], anchor.hasValidTransform else { continue }
      // Stands on the floor for the same reason the band lies on it - a pin
      // whose base is at eye level reads as floating in the air.
      let standing = onGround(origin(of: anchor.transform), id: request.id, arFrame: arFrame)
      pins.append(standing)
      projected.append(
        project(
          position: standing,
          index: request.id,
          kind: request.kind,
          // The same height the pin is actually built at, not the constant. These
          // two disagreeing is what would put the name through the middle of the
          // marker instead of above it.
          headM: pinHeight(at: flatDistance(to: standing, arFrame: arFrame)),
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    // The band itself is geometry inside the AR scene rather than a polygon
    // drawn over the top of it, which is the whole of what the preview screen
    // was built to settle. An overlay is computed from one camera frame and
    // composited a frame or two later, over a camera image that has moved on, so
    // it is always drawn for a pose the phone has already left - it holds still
    // when the phone does and slides when it moves. Geometry is rasterised in
    // the same pass as the image it lies on, from the same pose, so it cannot be
    // late. It is also what lets the room mesh hide it.
    updatePathGeometry(
      points: ground,
      splits: [walkerDistance(along: route.map { $0.position }, arFrame: arFrame)],
      arFrame: arFrame
    ) {
      // Two bands rather than one, cut where the walker is standing: what is
      // behind them is drawn as covered ground and what is ahead as the route.
      //
      // The covered half is mostly invisible while walking forwards, which is
      // not a reason to leave it out - it is what makes turning round
      // intelligible. Glancing back at a junction otherwise shows a band running
      // away in the direction you came from, indistinguishable from one telling
      // you to go that way.
      let (walked, ahead) = splitAtWalker(route, arFrame: arFrame)
      return PathBuild(
        stretches: [
          BandStretch(points: walked, walked: true),
          BandStretch(points: ahead, walked: false),
        ],
        pins: pins
      )
    }

    // What is left for the JS layer: the destination's *label*, and the control
    // anchors on the test screen. The pin itself is in the scene now; what goes
    // over the bridge is the point to hang its name above, at a size that does
    // not shrink with distance.
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

  /// Every anchored point on the route, as the ground probe wants them.
  ///
  /// The destination is in here as well as the band's own points, which it was
  /// not before. A pin standing on a slope wants the floor found under itself
  /// just as much as the band does, and without a reading of its own it fell
  /// back to the level measured under the walker - which is the wrong level by
  /// however much the ground rises between here and there.
  private func routeGroundPoints() -> [(id: Int, position: simd_float3)] {
    requestedAnchors.compactMap { request in
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


  /// One stretch of band: the points it runs through, and whether it is ground
  /// the walker has already covered.
  private struct BandStretch {
    let points: [PathPoint]
    let walked: Bool
  }

  /// Everything to be laid down this rebuild: the stretches of band, and the
  /// ground points any destination pins stand on.
  private struct PathBuild {
    let stretches: [BandStretch]
    let pins: [simd_float3]
  }

  /// The guidance, built as geometry inside the AR scene.
  ///
  /// This is the answer to why the overlay never felt stuck to the ground. It
  /// computed screen positions from camera frame N, handed them across the
  /// bridge, waited for React to re-render and for the SVG views to update - and
  /// by then the camera image underneath was showing frame N+2 or later. The
  /// band was therefore always drawn for a pose the phone had already left,
  /// which is why it held still when the phone did and slid when it moved.
  ///
  /// Geometry in the scene has no such gap. SceneKit rasterises it in the same
  /// pass as the camera image it sits on, from the same pose, so it is late by
  /// definition never. It is also real 3D, which is what makes depth occlusion
  /// possible at all - a polygon painted over the top of everything cannot be
  /// hidden by a wall, because it was never behind one.
  ///
  /// The route and the placements share this, and share it whole. What differs
  /// between the two screens is only where the points come from: a route threads
  /// one chain of Geospatial anchors from the walker to their destination, a
  /// preview holds a handful of separate runs on plain ARKit ones. Everything
  /// from there down - the floor found under each point, the cut at the walker,
  /// the three strips, the triangles, the sweep - is this code. That is what
  /// makes the preview worth testing on: it is not a mock-up of the navigation
  /// screen's band, it is that band, on a carpet.
  ///
  /// - Parameters:
  ///   - points: every anchored point the shape is derived from, used to decide
  ///     whether anything has actually moved.
  ///   - splits: how far along each run the walker stands, for the same test.
  ///   - build: what to lay down. Called only when a rebuild is due, so
  ///     the work of cutting and threading them is not done to be thrown away on
  ///     the ticks where nothing has changed.
  private func updatePathGeometry(
    points: [(id: Int, position: simd_float3)],
    splits: [Float],
    arFrame: ARFrame,
    build: () -> PathBuild
  ) {
    // Rebuilt only when something about it has moved - not on a clock. The
    // *rendering* stays frame-locked regardless, which is the entire point of
    // drawing it this way; what a rebuild changes is the shape.
    let now = arFrame.timestamp
    guard now - lastGeometryBuild > GroundPath.groundProbeInterval else { return }
    lastGeometryBuild = now

    // Quantised before it is compared: taken raw the split moves with every step
    // the walker takes, and every move would be a rebuild.
    let quantisedSplits = splits.map {
      Int(($0 / GroundPath.rebuildSplitM).rounded())
    }

    // Compared against the heights the band is actually built from, not against
    // the floor under the walker.
    //
    // Those are different numbers on a slope, which is the whole point: the
    // walker's floor changes with every step downhill, so keying the rebuild to
    // it meant rebuilding constantly while descending even though the band ahead
    // had not moved at all.
    let heights = points.map { anchorGroundY[$0.id] ?? groundY ?? 0 }
    let plan = points.map { simd_float2($0.position.x, $0.position.z) }

    let moved = needsRebuild
      || quantisedSplits != builtSplits
      || heights.count != builtHeights.count
      || zip(heights, builtHeights).contains { abs($0 - $1) > GroundPath.rebuildFloorDeltaM }
      || plan.count != builtPlan.count
      || zip(plan, builtPlan).contains { simd_distance($0, $1) > GroundPath.rebuildMoveM }

    guard moved else { return }

    let laid = build()

    // In this order. Clearing resets the signature, so recording what has just
    // been built has to come after it or it would be wiped by its own bookkeeping
    // and rebuilt again on the next tick, forever.
    clearPathNodes()
    builtSplits = quantisedSplits
    builtHeights = heights
    builtPlan = plan
    needsRebuild = false

    for stretch in laid.stretches {
      for node in chevronNodes(along: stretch.points, walked: stretch.walked) {
        sceneView.scene.rootNode.addChildNode(node)
        pathNodes.append(node)
      }
    }

    // Measured flat. The pin is on the ground and the camera is at head height,
    // so counting the vertical drop would report a metre and a half of distance
    // to something the walker is standing on top of.
    let camera = origin(of: arFrame.camera.transform)
    for pin in laid.pins {
      let away = simd_length(simd_float3(pin.x - camera.x, 0, pin.z - camera.z))
      guard away > GroundPath.pinNearCutM, away < GroundPath.pinFarCutM else { continue }
      let node = pinNode(at: pin, distance: away)
      sceneView.scene.rootNode.addChildNode(node)
      pathNodes.append(node)
    }
  }

  /// How tall to build the pin for something this far away.
  ///
  /// Enormous at range and life-size underfoot, with one line doing both.
  ///
  /// Far off, height is a fixed fraction of distance, which is the same as saying
  /// the pin holds its apparent size - eighteen metres tall at thirty, six at ten,
  /// three at five, all of them the same mark on the screen. That is not what an
  /// object does and it is exactly what a marker should: the thing being pointed
  /// at does not get less important for being further away.
  ///
  /// The floor is what stops it there. Once the rule would build something shorter
  /// than a person - inside about three metres - the pin stops shrinking and
  /// becomes an object again, standing at eye level on the pavement. From then on
  /// it behaves honestly, growing as it is approached, because at that range there
  /// is nothing left to help with: the walker is on top of it.
  ///
  /// The previous rule held the *screen* size at close range instead, by shrinking
  /// the pin below life-size as the walker closed in. It kept the marker a
  /// convenient size and made it a doll's-house prop at the moment of arrival,
  /// which is the moment it most needs to read as a real thing standing in a real
  /// place.
  private func pinHeight(at distance: Float) -> Float {
    max(GroundPath.pinLifeSizeM, distance * GroundPath.pinApparentSize)
  }

  /// How far a point is from the camera across the ground.
  ///
  /// Flat, for the same reason the pin's own range test is: the camera is at head
  /// height and the pin is on the floor, so counting the vertical drop would
  /// report a metre and a half of distance to something underfoot.
  private func flatDistance(to position: simd_float3, arFrame: ARFrame) -> Float {
    let camera = origin(of: arFrame.camera.transform)
    return simd_length(simd_float3(position.x - camera.x, 0, position.z - camera.z))
  }

  /// The destination, standing on the spot.
  ///
  /// A billboard, and that is the correct treatment rather than a shortcut: a
  /// marker that must be readable from every approach has to face the viewer,
  /// and something that always faces the viewer is a flat thing turned towards
  /// them. What was wrong before was not the flatness - it was that the flat
  /// thing lived on the JS overlay, painted over the whole picture, so a wall
  /// could not hide it, nothing could pass in front of it, and it had no depth
  /// relationship to the ground it claimed to be standing on. That is what read
  /// as fake. Here it is a plane in the scene: same shape, real depth.
  ///
  /// The label is not here. It stays on the JS layer, drawn at a fixed size,
  /// because a label that shrank with distance would be unreadable exactly when
  /// the walker most wants to know which doorway is meant. The pin is an object
  /// and belongs in the world; its name is interface and belongs on the glass.
  private func pinNode(at position: simd_float3, distance: Float) -> SCNNode {
    let node = SCNNode()
    node.simdPosition = position

    // Everything below is built from this rather than from the constant, so the
    // shadow grows with the pin it belongs to. A marker that outgrew its own
    // shadow would be back to hovering, which is the thing the shadow is there to
    // prevent.
    let height = pinHeight(at: distance)

    if let shadow = shadowImage() {
      let radius = CGFloat(
        min(GroundPath.pinShadowMaxRadiusM, height * GroundPath.pinShadowRadiusFraction)
      )
      let disc = SCNPlane(width: radius * 2, height: radius * 2)
      let material = SCNMaterial()
      material.lightingModel = .constant
      material.diffuse.contents = shadow
      material.isDoubleSided = true
      material.writesToDepthBuffer = false
      disc.materials = [material]

      let discNode = SCNNode(geometry: disc)
      // Laid flat. A plane stands upright by default, which would put the
      // shadow on its edge and show as a dark line rather than a pool.
      discNode.eulerAngles.x = -.pi / 2
      discNode.position = SCNVector3(0, GroundPath.bandLiftM, 0)
      node.addChildNode(discNode)
    }

    // The outline, extruded and given a rounded edge, so it is the map pin
    // everyone already knows how to read - hole and all - rather than the
    // cleanest shape to build.
    //
    // Extruding brings the billboard back, and that is the trade being made
    // knowingly. A ball on a spike needed no billboard because it looks the same
    // from everywhere; this has a face and has to be turned to show it. What
    // makes that acceptable now is that it is no longer flat: it has five units
    // of thickness and a chamfered edge catching the room's own light, so
    // walking round it shows a solid object turning rather than a picture
    // swivelling to follow you.
    let shape = SCNShape(path: pinPath(), extrusionDepth: GroundPath.pinThicknessUnits)
    shape.chamferRadius = GroundPath.pinChamferUnits
    // One material across every element the shape generates - front, back, the
    // extruded sides and both chamfers. SceneKit repeats the list when there are
    // fewer materials than elements, which is what makes a single entry cover
    // all of them and the highlight run unbroken round the edge.
    shape.materials = [pinMaterial()]

    let body = SCNNode(geometry: shape)
    // The path is drawn in units and the pin is wanted in metres. The tip sits
    // at the path's origin, so scaling about that origin leaves it exactly on
    // the ground - no offset to get wrong, unlike the textured plane this
    // replaced, where three units of margin below the tip put the whole pin
    // seven centimetres into the air.
    let unit = Float(CGFloat(height) / GroundPath.pinUnitHeight)
    body.scale = SCNVector3(unit, unit, unit)

    // Turns about the vertical only. Free on every axis it would tip back to
    // face a walker looking down at it, and a marker that lies over towards you
    // is a sticker. Rotating about the node's origin, which is the tip, is what
    // keeps the point planted while the pin turns.
    let billboard = SCNBillboardConstraint()
    billboard.freeAxes = .Y
    body.constraints = [billboard]
    node.addChildNode(body)

    return node
  }

  /// The pin's outline: a teardrop with a hole through its bulb.
  ///
  /// Drawn in the 24-by-36 unit space described on `pinUnitHeight`, tip at the
  /// origin and bulb above it, which is the same outline the flat version used -
  /// so this is the marker that was there before, given thickness and a hole,
  /// rather than a different marker.
  private func pinPath() -> UIBezierPath {
    let radius = GroundPath.pinBulbRadius
    let centre = GroundPath.pinBulbCentre
    let steps = 48

    let path = UIBezierPath()
    path.move(to: CGPoint(x: 0, y: 0))
    path.addCurve(
      to: CGPoint(x: -radius, y: centre),
      controlPoint1: CGPoint(x: -radius / 2, y: 10),
      controlPoint2: CGPoint(x: -radius, y: 16)
    )

    // The bulb, written out as segments from the left of the circle over its top
    // to the right.
    //
    // Written out rather than left to `addArc`, whose `clockwise` flag is defined
    // in UIKit's y-down space while SCNShape reads the path y-up. The two
    // conventions disagree, and taking the wrong half of the circle produces a
    // bulb tucked inside the pin's own body - a mistake that shows up only on a
    // device. Computing the points settles it here instead. Forty-eight segments
    // on a twelve-unit radius is finer than the chamfer that rounds it.
    for step in 1...steps {
      let angle = CGFloat.pi * (1 - CGFloat(step) / CGFloat(steps))
      path.addLine(to: CGPoint(x: cos(angle) * radius, y: centre + sin(angle) * radius))
    }

    path.addCurve(
      to: CGPoint(x: 0, y: 0),
      controlPoint1: CGPoint(x: radius, y: 16),
      controlPoint2: CGPoint(x: radius / 2, y: 10)
    )
    path.close()

    // The hole, as its own closed subpath under the even-odd rule - which makes
    // it a hole whichever way round it is wound. The alternative is to wind it
    // against the outline and hope, and there is no way to check that here.
    let hole = UIBezierPath()
    for step in 0...steps {
      let angle = CGFloat.pi * 2 * CGFloat(step) / CGFloat(steps)
      let point = CGPoint(
        x: cos(angle) * GroundPath.pinHoleRadius,
        y: centre + sin(angle) * GroundPath.pinHoleRadius
      )
      if step == 0 { hole.move(to: point) } else { hole.addLine(to: point) }
    }
    hole.close()

    path.append(hole)
    path.usesEvenOddFillRule = true
    return path
  }

  /// The pin's surface.
  ///
  /// Physically based, which is the whole of the difference. A constant-shaded
  /// material is drawn at exactly the colour it was given, whatever is happening
  /// around it - correct for the band, which is a marking rather than an object,
  /// and wrong for something claiming to be standing on the pavement. This one is
  /// lit by ARKit's estimate of the real light and reflects the environment probe
  /// built from the camera feed, so it dims under a tree, warms under a sodium
  /// lamp, and carries a highlight that moves as the walker moves.
  ///
  /// One material shared by both pieces, so the highlight runs across the join
  /// rather than stopping at it.
  private func pinMaterial() -> SCNMaterial {
    // The classic map-pin red, and deliberately not the app's green. This is the
    // one marker that means "the thing you are walking to", and matching the
    // guidance colour would make it one more green thing among the guidance.
    let red = UIColor(red: 0.898, green: 0.125, blue: 0.180, alpha: 1)

    let material = SCNMaterial()
    material.lightingModel = .physicallyBased
    material.diffuse.contents = red
    material.roughness.contents = NSNumber(value: Double(GroundPath.pinRoughness))
    material.metalness.contents = NSNumber(value: 0.0)
    // Its own faint glow, in its own colour so it reads as the pin being bright
    // rather than as a grey wash over it.
    material.emission.contents = UIColor(
      red: 0.898 * GroundPath.pinGlow,
      green: 0.125 * GroundPath.pinGlow,
      blue: 0.180 * GroundPath.pinGlow,
      alpha: 1
    )
    return material
  }


  /// The soft pool under the pin: dark at the centre, nothing at the rim.
  private func shadowImage() -> UIImage? {
    if let cachedShadow { return cachedShadow }

    let size = CGSize(width: 128, height: 128)
    let format = UIGraphicsImageRendererFormat.default()
    format.opaque = false

    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      guard
        let gradient = CGGradient(
          colorsSpace: CGColorSpaceCreateDeviceRGB(),
          colors: [
            UIColor(white: 0, alpha: GroundPath.pinShadowOpacity).cgColor,
            UIColor(white: 0, alpha: 0).cgColor,
          ] as CFArray,
          locations: [0, 1]
        )
      else { return }

      let centre = CGPoint(x: size.width / 2, y: size.height / 2)
      context.cgContext.drawRadialGradient(
        gradient,
        startCenter: centre,
        startRadius: 0,
        endCenter: centre,
        endRadius: size.width / 2,
        options: []
      )
    }

    cachedShadow = image
    return image
  }

  /// The placements as stretches of band.
  ///
  /// One run is one band and never two runs joined. A route is a single chain
  /// from where the walker stands to where they are going, so every point on it
  /// belongs to the same band; a preview is a scatter of separate things, and two
  /// stretches dropped in different corners of a room are two paths. Flattening
  /// them into one list would draw a band across the gap between them.
  ///
  /// Each is cut at the walker exactly as a real route is. A placement has no
  /// direction of travel of its own, but walking along one is the nearest thing
  /// to walking a route that can be done indoors - and it is the only way to see
  /// the covered half behave without going outside and planning a journey.
  private func previewBuild(arFrame: ARFrame) -> PathBuild {
    var stretches: [BandStretch] = []
    var pins: [simd_float3] = []

    for run in previewRuns {
      let points = previewPoints(of: run, arFrame: arFrame)

      if run.kind == "destination" {
        if let first = points.first { pins.append(first.position) }
        continue
      }

      let (walked, ahead) = splitAtWalker(points, arFrame: arFrame)
      stretches.append(BandStretch(points: walked, walked: true))
      stretches.append(BandStretch(points: ahead, walked: false))
    }

    return PathBuild(stretches: stretches, pins: pins)
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

  /// How far along a run the walker stands, in metres from its near end. Only
  /// used to decide whether the split has moved enough to be worth a rebuild.
  ///
  /// Measured along the straight line between the run's ends rather than around
  /// its corners, which is an approximation and a safe one: it is not answering
  /// where to cut the band - `splitAtWalker` does that, properly - only whether
  /// the answer has changed since last time.
  private func walkerDistance(along positions: [simd_float3], arFrame: ARFrame) -> Float {
    guard positions.count >= 2 else { return 0 }
    let camera = origin(of: arFrame.camera.transform)
    let first = positions[0]
    let last = positions[positions.count - 1]

    let axis = simd_float3(last.x - first.x, 0, last.z - first.z)
    let length = simd_length(axis)
    guard length > 1e-3 else { return 0 }

    let toCamera = simd_float3(camera.x - first.x, 0, camera.z - first.z)
    return min(length, max(0, simd_dot(toCamera, axis) / length))
  }

  /// The guidance as a run of chevrons lying on the ground.
  ///
  /// This replaced a continuous band, and the reason was not that the band was
  /// drawn badly. It was that the band was drawn *precisely*, and the data
  /// underneath it is not precise.
  ///
  /// A walking route from OpenRouteService is a single line, usually the road's
  /// centreline, because OSM in the study area has a few thousand mapped footways
  /// against its whole street network. Where a pavement is mapped it may be the
  /// one on the far side. So the route's sideways accuracy is about half a road
  /// width - and a band ninety centimetres across says "walk exactly here", which
  /// is a claim nothing supports. The same six-metre error looks like a broken
  /// app inside a ninety-centimetre band and like a rough guide inside a
  /// six-metre chevron. It is a rough guide. It should look like one.
  ///
  /// Chevrons rather than a wider band because width and coverage come apart
  /// here. A band wide enough to span a road would be a sheet of paint over the
  /// whole road, which is exactly what was taken away for being unsafe. A chevron
  /// spans the same width with two strokes a third of a metre thick and leaves
  /// everything between them clear.
  ///
  /// Everything else is unchanged and deliberately so: the floor found under each
  /// point, the slope followed along the run, the grey for ground already walked,
  /// the room mesh hiding what is behind a wall, the dark halo and bright rim that
  /// keep it legible on both pale concrete and wet asphalt.
  private func chevronNodes(along points: [PathPoint], walked: Bool) -> [SCNNode] {
    guard points.count >= 2 else { return [] }

    let width = min(
      GroundPath.maxGuidanceWidthM,
      max(GroundPath.minGuidanceWidthM, guidanceWidth)
    )
    let halfWidth = width / 2
    let reach = width * GroundPath.chevronSweepFraction / 2
    let up = simd_float3(0, 1, 0)

    // Which points carry a chevron was decided when the anchors were made, from
    // the anchor's own id - see `markerEveryNthAnchor`. Ids are lattice indices
    // measured from the start of the route, so a chevron lands on the same patch
    // of ground for the whole walk instead of sliding along as points come and go
    // at the ends of the drawn stretch.
    let marked = points.indices.filter { points[$0].marker }
    guard !marked.isEmpty else { return [] }

    var nodes: [SCNNode] = []

    for (ordinal, i) in marked.enumerated() {
      let centre = points[i].position

      // Taken across the point rather than from the leg leaving it. A single leg
      // is a stride long and carries the anchor noise of both its ends; the span
      // across the point averages that out, and a chevron is a direction
      // indicator, so its aim is the whole of what it says.
      let before = points[max(i - 1, 0)].position
      let after = points[min(i + 1, points.count - 1)].position
      guard
        let direction = flattened(after - before)
          ?? flattened(centre - before)
          ?? flattened(after - centre)
      else { continue }

      let side = simd_cross(direction, up)

      // A V, built as a three-point centreline, so the same sweep, the same mitre
      // and the same three strips that drew the band draw this. The point of the
      // V is a corner like any other and the mitre machinery already knows what
      // to do with a corner - at these proportions it turns about seventy degrees
      // and reaches out by 1.2, nowhere near the limit.
      //
      // All three points share the chevron's own floor height. Across four metres
      // of road camber that is a few centimetres out at the arm tips, which is
      // below what any of this resolves - and the slope that matters, the one
      // along the route, is still followed because each chevron finds its own.
      let arms = [
        PathPoint(position: centre - direction * reach - side * halfWidth, marker: false),
        PathPoint(position: centre + direction * reach, marker: false),
        PathPoint(position: centre - direction * reach + side * halfWidth, marker: false),
      ]

      let fade = marked.count > 1 ? Float(ordinal) / Float(marked.count - 1) : 0
      guard let node = chevronNode(arms: arms, walked: walked, fade: fade) else { continue }
      nodes.append(node)
    }

    return nodes
  }

  /// One chevron: a tinted fill inside two rings, laid on the ground.
  ///
  /// Rings because a 3D renderer has no equivalent of a stroke. The dark halo and
  /// the bright rim are not decoration - they are what keeps the shape legible
  /// against pale concrete and dark wet asphalt alike, since any single outline
  /// colour disappears against one of them.
  ///
  /// The lifts between the layers are millimetres, far below anything here is
  /// accurate to, and exist only to stop coplanar surfaces flickering against
  /// each other as the camera moves.
  private func chevronNode(arms: [PathPoint], walked: Bool, fade: Float) -> SCNNode? {
    let half = GroundPath.chevronArmM / 2

    guard
      let fill = strip(
        along: arms,
        halfWidth: half,
        lift: GroundPath.bandLiftM + GroundPath.layerLiftM * 2
      )
    else { return nil }

    let node = SCNNode()

    // The outline goes all the way round the mark: both long edges *and* the two
    // blunt ends where the arms of the V stop.
    //
    // It used to be a strip down each side and nothing across the ends, which was
    // the natural thing to build - a sweep has two edges, and they are the two
    // sides - and it left every chevron open at both tips. Seen from behind, which
    // is the only way a walker ever sees one, the arms read as bars that had been
    // sliced off rather than as a shape that finishes.
    //
    // So the outline is built from the fill's *perimeter* instead of from its
    // sweep. The perimeter is a closed loop - down the left edge, across the end,
    // back along the right, across the start - and pushing that loop outwards
    // gives a ring that closes. The ends come out square, which is right: a mitre
    // would put a point on an arm that is not going anywhere.
    //
    // Each ring is offset from the one inside it rather than from the fill, so the
    // halo starts exactly where the rim stops. Offsetting preserves angles, so all
    // three boundaries mitre identically and stay parallel round the point of the
    // V.
    //
    // Rings, not stacked strips, and that part is load-bearing: it is why the fill
    // is green at all. Stacked, the rim was a solid white strip running the full
    // width of the mark, and the green was composited over *that* instead of over
    // the pavement. A tint over opaque white is a pale tint of white, so the more
    // transparent the green was made the whiter it went - the opposite of what
    // lowering an alpha is supposed to do, and the clue that the fill was never
    // the problem.
    let fillEdge = outlineLoop(along: arms, halfWidth: half)
    let rimEdge = expand(fillEdge, by: GroundPath.rimWidthM)
    let haloEdge = expand(rimEdge, by: GroundPath.haloWidthM - GroundPath.rimWidthM)

    if let halo = ringNode(between: rimEdge, and: haloEdge, lift: GroundPath.bandLiftM) {
      halo.geometry?.materials = [
        flatMaterial(
          UIColor(
            white: 0,
            alpha: walked ? GroundPath.walkedHaloOpacity : GroundPath.haloOpacity
          )
        )
      ]
      halo.renderingOrder = -14
      node.addChildNode(halo)
    }

    if let rim = ringNode(
      between: fillEdge,
      and: rimEdge,
      lift: GroundPath.bandLiftM + GroundPath.layerLiftM
    ) {
      rim.geometry?.materials = [
        flatMaterial(
          UIColor(
            white: 1,
            alpha: walked ? GroundPath.walkedRimOpacity : GroundPath.rimOpacity
          )
        )
      ]
      rim.renderingOrder = -13
      node.addChildNode(rim)
    }

    // The distance fade is now a flat colour per chevron rather than a gradient
    // painted along the run, which is both simpler and more correct. A chevron is
    // a single mark at a single distance; fading *within* one would say its near
    // arm is closer than its far arm, and its arms are side by side.
    //
    // Only the fill fades. The outline holds its strength all the way out, which
    // is what keeps a distant chevron findable at all - it is already down to a
    // few pixels of screen by then, and fading the one part still carrying the
    // shape would be fading it away exactly where the walker is looking ahead.
    let near = walked ? GroundPath.walkedNearOpacity : GroundPath.nearOpacity
    let far = walked ? GroundPath.walkedFarOpacity : GroundPath.farOpacity
    let alpha = near + (far - near) * CGFloat(fade)

    // Grey rather than a dimmed green for ground already covered, because dimming
    // is already what distance does to the far end of the run - two meanings on
    // one channel would make a long way ahead read as a way behind.
    // A purer green than the app's own, which is where this started. The brand
    // green carries enough blue to sit near mint, and mint laid this thinly over
    // grey concrete is barely a colour at all - it reads as the pavement being
    // lightened rather than as green paint on it. Draining the blue and most of
    // the red leaves a hue that survives being transparent, which is the only way
    // to look greener without covering more ground.
    let colour = walked
      ? UIColor(red: 0.604, green: 0.627, blue: 0.651, alpha: alpha)
      : UIColor(red: 0.05, green: 0.85, blue: 0.30, alpha: alpha)

    fill.geometry?.materials = [flatMaterial(colour)]
    fill.renderingOrder = -12
    node.addChildNode(fill)

    return node
  }

  /// One sweep of a centreline at a given half-width, filled edge to edge.
  private func strip(along points: [PathPoint], halfWidth: Float, lift: Float) -> SCNNode? {
    var vertices: [SCNVector3] = []
    let frames = bandFrames(points, halfWidth: halfWidth)

    for (i, point) in points.enumerated() {
      guard let frame = frames[i] else { continue }

      let raised = point.position + simd_float3(0, lift, 0)
      let left = raised - frame.offset
      let right = raised + frame.offset
      vertices.append(SCNVector3(left.x, left.y, left.z))
      vertices.append(SCNVector3(right.x, right.y, right.z))
    }

    return stripNode(from: vertices)
  }

  /// The closed boundary of a sweep: down the left edge, across the end, back
  /// along the right edge, and across the start to meet itself.
  ///
  /// The outline of a shape, as against the two edges of the stroke that drew it.
  /// The difference is the two ends, and the ends are what a walker looking down
  /// the length of a chevron actually sees.
  private func outlineLoop(along points: [PathPoint], halfWidth: Float) -> [simd_float3] {
    let frames = bandFrames(points, halfWidth: halfWidth)

    var left: [simd_float3] = []
    var right: [simd_float3] = []

    for (i, point) in points.enumerated() {
      guard let frame = frames[i] else { continue }
      left.append(point.position - frame.offset)
      right.append(point.position + frame.offset)
    }

    guard left.count >= 2 else { return [] }

    // Nothing is inserted where the two edges meet: an end is a straight hop
    // across the width of the mark, which is the square cap.
    return left + right.reversed()
  }

  /// The same loop pushed outwards by a fixed distance, corners mitred.
  private func expand(_ loop: [simd_float3], by distance: Float) -> [simd_float3] {
    zip(loop, outwardNormals(of: loop)).map { $0 + $1 * distance }
  }

  /// Which way is out at every vertex of a closed loop, and how far that corner
  /// has to reach to keep both its edges parallel to where they started.
  ///
  /// The same mitre as `bandFrames` and for the same reason, differing only in
  /// that a loop has no ends: every vertex has a neighbour on both sides, so the
  /// two that close the loop wrap around instead of inheriting a single heading.
  private func outwardNormals(of loop: [simd_float3]) -> [simd_float3] {
    let up = simd_float3(0, 1, 0)
    var normals: [simd_float3] = []

    for i in loop.indices {
      let previous = loop[(i + loop.count - 1) % loop.count]
      let next = loop[(i + 1) % loop.count]
      let incoming = flattened(loop[i] - previous)
      let outgoing = flattened(next - loop[i])

      // A repeated vertex has no heading of its own. It stays where it is rather
      // than being dropped, so a loop and its expansion keep matching lengths.
      guard let into = incoming ?? outgoing, let outOf = outgoing ?? incoming else {
        normals.append(simd_float3(repeating: 0))
        continue
      }

      // Out is to the left of travel. `outlineLoop` runs forward down the left
      // edge and back along the right, so the mark it encloses is on the right the
      // whole way round - including across both ends, which is the case that had
      // to be got right rather than assumed.
      let fromIn = -simd_cross(into, up)
      let fromOut = -simd_cross(outOf, up)
      let sum = fromIn + fromOut
      let length = simd_length(sum)

      guard length > 1e-3 else {
        normals.append(fromOut)
        continue
      }

      let bisector = sum / length
      let cosHalf = max(simd_dot(bisector, fromOut), 1e-3)
      normals.append(bisector * min(GroundPath.mitreLimit, 1 / cosHalf))
    }

    return normals
  }

  /// The band between two loops of the same length, as one closed triangle strip.
  private func ringNode(
    between inner: [simd_float3],
    and outer: [simd_float3],
    lift: Float
  ) -> SCNNode? {
    guard inner.count >= 3, inner.count == outer.count else { return nil }

    var vertices: [SCNVector3] = []
    for (near, far) in zip(inner, outer) {
      let a = near + simd_float3(0, lift, 0)
      let b = far + simd_float3(0, lift, 0)
      vertices.append(SCNVector3(a.x, a.y, a.z))
      vertices.append(SCNVector3(b.x, b.y, b.z))
    }

    // A triangle strip is open by nature, so the loop is closed by hand:
    // repeating the first pair at the end is what turns the last vertices into a
    // segment back to the beginning rather than a free end.
    vertices.append(vertices[0])
    vertices.append(vertices[1])

    return stripNode(from: vertices)
  }

  /// A run of paired vertices as one triangle strip, which is what a swept line
  /// is: every new pair closes two more triangles against the pair before it.
  private func stripNode(from vertices: [SCNVector3]) -> SCNNode? {
    guard vertices.count >= 4 else { return nil }

    let element = SCNGeometryElement(
      indices: (0..<vertices.count).map { Int32($0) },
      primitiveType: .triangleStrip
    )

    return SCNNode(
      geometry: SCNGeometry(sources: [SCNGeometrySource(vertices: vertices)], elements: [element])
    )
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

  /// The pins among the placements, projected exactly the way a real route's
  /// destination is - same kind, same projection, so the JS side needs no idea
  /// which screen it is drawing for.
  ///
  /// Only the pins. The bands are geometry in the scene; see
  /// `updatePathGeometry`.
  private func emitPreviewAnchors(arFrame: ARFrame, viewport: CGSize) {
    var projected: [[String: Any]] = []

    for (index, run) in previewRuns.enumerated() where run.kind == "destination" {
      guard let first = previewPoints(of: run, arFrame: arFrame).first else { continue }
      projected.append(
        project(
          position: first.position,
          // The pin's index is negative, matching the destination id the
          // navigation screen uses, so the JS side treats it the same way.
          index: -1 - index,
          kind: run.kind,
          headM: pinHeight(at: flatDistance(to: first.position, arFrame: arFrame)),
          arFrame: arFrame,
          viewport: viewport
        )
      )
    }

    onAnchorsUpdate(["anchors": projected])
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
    let cut = a + (b - a) * bestT

    // Whether the cut lands exactly on one of the run's own points rather than
    // between two of them, which is the common case and not the rare one: the
    // walker starts every route standing at its first point, and every preview
    // placement starts under the spot that was tapped.
    let landsOn: Int?
    if bestT <= 1e-3 {
      landsOn = bestIndex
    } else if bestT >= 1 - 1e-3 {
      landsOn = bestIndex + 1
    } else {
      landsOn = nil
    }

    // A chevron sitting exactly on the cut belongs to the stretch ahead, and to
    // that stretch only.
    //
    // This is the whole of the bug it fixes. The cut used to replace whatever
    // point it landed on with a marker-less one, so a walker standing on a
    // lattice point silently destroyed its chevron - and since they stand on the
    // *first* point of a fresh preview placement, the first chevron was the one
    // destroyed every time. What showed up instead was the second, a full spacing
    // further on, which reads as the guidance being placed several metres away
    // from where it was asked for.
    //
    // Handing it to one side rather than both matters too. A chevron drawn on the
    // walked stretch and again on the stretch ahead would sit in the same place
    // twice, once grey and once live, at double the opacity of either.
    let carries = landsOn.map { points[$0].marker } ?? false

    var walked = Array(points[0...bestIndex])
    if landsOn == bestIndex {
      // The cut is on the last walked point: it stays, but hands its chevron on.
      walked[walked.count - 1] = PathPoint(position: cut, marker: false)
    } else {
      walked.append(PathPoint(position: cut, marker: false))
    }

    var ahead = Array(points[(bestIndex + 1)...])
    // Landing on the far end of the segment would otherwise leave that point in
    // twice - once as itself and once as the cut.
    if landsOn == bestIndex + 1, !ahead.isEmpty { ahead.removeFirst() }
    ahead.insert(PathPoint(position: cut, marker: carries), at: 0)

    return (walked, ahead)
  }


  /// One anchor as a bare projected point: the destination pin, and the control
  /// anchors on the test screen. Anything that lies on the ground rather than
  /// facing the walker is geometry in the scene instead.
  private func project(
    position: simd_float3,
    index: Int,
    kind: String,
    headM: Float = 0,
    arFrame: ARFrame,
    viewport: CGSize
  ) -> [String: Any] {
    let centre = screenPoint(of: position, arFrame: arFrame, viewport: viewport)

    var projected: [String: Any] = [
      "index": index,
      "kind": kind,
      "x": centre.point.x,
      "y": centre.point.y,
      "distance": Double(centre.distance),
      "visible": centre.inFront,
    ]

    // Where the top of the thing standing here lands on screen - measured,
    // rather than worked out a second time on the JS side.
    //
    // The label used to derive this from an assumed 62-degree field of view,
    // and it was wrong by about a factor of two: the name came out halfway down
    // the pin instead of above it. ARSCNView fills its view with the camera
    // feed, which crops it, so the field of view actually on screen is much
    // narrower than the sensor's - and no fixed constant describes it, because
    // it depends on the view's own aspect ratio against the camera's.
    //
    // ARKit's projection already knows the real intrinsics and the real
    // viewport. Asking it for a second point is two lines and cannot drift out
    // of step with the renderer the way a duplicated guess did.
    if headM > 0 {
      let head = screenPoint(
        of: position + simd_float3(0, headM, 0),
        arFrame: arFrame,
        viewport: viewport
      )
      if head.inFront { projected["headY"] = head.point.y }
    }

    return projected
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
