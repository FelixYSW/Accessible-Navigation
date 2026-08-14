import CoreML
// CGImagePropertyOrientation, which appears in this file's own signatures.
// Vision happens to pull it in transitively, but relying on that would make the
// build depend on someone else's import list.
import ImageIO
import Vision

/// Runs the trained YOLO26 hazard model over camera frames.
///
/// One class, two hosts. The AR Navigation screen feeds it ARKit frames and the
/// Hazard Detection screen feeds it AVFoundation frames, and neither knows
/// anything about the model - which is the point, because a hazard has to be
/// flagged identically on both screens or the same pothole would be described
/// two different ways depending on which tab the user happened to be on.
///
/// The model is a Vision-native detector: NMS is built into the Core ML graph
/// at export, so Vision hands back decoded observations with labels and boxes
/// and there is no YOLO output tensor to unpack here.
final class HazardDetector {
  /// Frames are dropped to this rate rather than run at the camera's.
  ///
  /// Hazards do not move - the walker does - so there is nothing to gain from
  /// inferring sixty times a second, and a great deal to lose: on the AR screen
  /// this competes for the same cores as ARKit's tracking, which is what keeps
  /// the arrows still. Ten a second is faster than anyone can walk into
  /// something.
  private let minimumInterval: TimeInterval

  private var request: VNCoreMLRequest?
  private var lastRun = Date.distantPast
  private var inFlight = false
  private let lock = NSLock()

  /// Why there is no model, if there is no model. Surfaced to JS so a missing
  /// or broken file reads as "model not installed" rather than as a camera that
  /// silently never finds anything.
  private(set) var loadFailure: String?

  init(minimumInterval: TimeInterval = 0.1) {
    self.minimumInterval = minimumInterval
    load()
  }

  // MARK: - Loading

  private func load() {
    do {
      let configuration = MLModelConfiguration()
      // Neural Engine first, then GPU, then CPU. The exported model is fp16,
      // which is what the Neural Engine wants anyway.
      configuration.computeUnits = .all

      let model = try MLModel(contentsOf: try Self.compiledModelURL(), configuration: configuration)
      let visionModel = try VNCoreMLModel(for: model)

      let request = VNCoreMLRequest(model: visionModel)
      // The model was trained on whole letterboxed frames, so the whole frame is
      // what it should see. Cropping to a centre square would silently blind it
      // to the edges of the path, which is where an obstruction usually is.
      request.imageCropAndScaleOption = .scaleFill
      self.request = request
    } catch {
      loadFailure = error.localizedDescription
    }
  }

  /// The compiled model, compiling it on first launch and keeping the result.
  ///
  /// `MLModel.compileModel` writes to a temporary directory the system may clear
  /// at any time, so the result is moved somewhere durable. Compiling takes a
  /// second or two, which is fine once on first launch and not fine on every
  /// launch.
  private static func compiledModelURL() throws -> URL {
    let fileManager = FileManager.default
    let support = try fileManager.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let cached = support.appendingPathComponent("HazardDetector.mlmodelc")

    if fileManager.fileExists(atPath: cached.path) {
      return cached
    }

    guard let package = packageURL() else {
      throw DetectorError.missingModel
    }

    let compiled = try MLModel.compileModel(at: package)
    if fileManager.fileExists(atPath: cached.path) {
      try fileManager.removeItem(at: cached)
    }
    try fileManager.moveItem(at: compiled, to: cached)
    return cached
  }

  /// CocoaPods copies the pod's resources into the app bundle, but exactly which
  /// bundle depends on how the pod was linked, so the search widens rather than
  /// assuming.
  private static func packageURL() -> URL? {
    if let url = Bundle.main.url(forResource: "HazardDetector", withExtension: "mlpackage") {
      return url
    }
    for bundle in Bundle.allBundles + Bundle.allFrameworks {
      if let url = bundle.url(forResource: "HazardDetector", withExtension: "mlpackage") {
        return url
      }
    }
    return nil
  }

  enum DetectorError: LocalizedError {
    case missingModel

    var errorDescription: String? {
      switch self {
      case .missingModel:
        return "HazardDetector.mlpackage is not in the app bundle. Train the model and put it in modules/ar-geospatial/ios/."
      }
    }
  }

  // MARK: - Inference

  /// Runs the model if it is time to, and does nothing at all if it is not.
  ///
  /// Both guards matter. Without the interval this would run flat out; without
  /// the in-flight check a slow frame would queue up behind itself and the
  /// backlog would grow for as long as the camera ran.
  func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation,
    completion: @escaping ([[String: Any]]) -> Void
  ) {
    guard let request else { return }

    lock.lock()
    let now = Date()
    let ready = !inFlight && now.timeIntervalSince(lastRun) >= minimumInterval
    if ready {
      inFlight = true
      lastRun = now
    }
    lock.unlock()

    guard ready else { return }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation)
    do {
      try handler.perform([request])
      completion(Self.hazards(from: request.results))
    } catch {
      completion([])
    }

    lock.lock()
    inFlight = false
    lock.unlock()
  }

  private static func hazards(from results: [VNObservation]?) -> [[String: Any]] {
    guard let observations = results as? [VNRecognizedObjectObservation] else { return [] }

    return observations.compactMap { observation in
      guard let label = observation.labels.first else { return nil }
      let box = observation.boundingBox

      return [
        // The model's class names were trained to match HazardClass in the TS
        // exactly, so this crosses the bridge as-is. JS still validates it -
        // retraining with a renamed class should show up as a dropped detection,
        // not as an unknown string reaching the overlay.
        "hazardClass": label.identifier,
        "confidence": Double(label.confidence),
        // Vision's origin is bottom-left and the app's is top-left, so y flips.
        // Width and height are unaffected by the flip.
        "x": Double(box.minX),
        "y": Double(1 - box.maxY),
        "width": Double(box.width),
        "height": Double(box.height),
      ]
    }
  }
}
