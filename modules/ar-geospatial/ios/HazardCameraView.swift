import AVFoundation
import ExpoModulesCore
// CACurrentMediaTime and CFTimeInterval, used by the measurement below.
// AVFoundation happens to pull QuartzCore in, but relying on that would make
// the build depend on someone else's import list.
import QuartzCore

/// A plain camera preview that runs the hazard model over its frames.
///
/// This is the Hazard Detection screen's camera. It deliberately does *not* use
/// ARKit: that screen has no route, no arrows and nothing to anchor, and world
/// tracking would run visual-inertial odometry continuously for no benefit and a
/// real battery cost. AVFoundation gives the frames and nothing else, which is
/// all this screen needs.
///
/// The detector itself is shared with the AR screen, so both flag the same
/// hazard the same way.
final class HazardCameraView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onHazards = EventDispatcher()
  let onPerformance = EventDispatcher()

  /// How fast frames arrive, and how long this class holds one.
  ///
  /// The comparison against the AR screen is the point of measuring here at all.
  /// Both run the same model on the same device; the difference is that this one
  /// is on `frameQueue` and that one is on the main thread. Whatever the two
  /// report, the gap between them is attributable to that and to little else.
  private var frameRate = RateCounter()
  private var frameWork = DurationSampler()
  private let perfLock = NSLock()
  private var lastPerformanceSent: CFTimeInterval = 0

  private let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let preview = AVCaptureVideoPreviewLayer()
  private let detector = HazardDetector()

  // Capture work stays off the main thread; only the preview layer and the
  // event dispatch touch it.
  private let sessionQueue = DispatchQueue(label: "hazard.camera.session")
  private let frameQueue = DispatchQueue(label: "hazard.camera.frames")

  private var isActive = true
  private var reportedLoadFailure = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    clipsToBounds = true
    preview.session = session
    preview.videoGravity = .resizeAspectFill
    layer.addSublayer(preview)

    configureSession()
  }

  deinit {
    session.stopRunning()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // No implicit animation: the layer would otherwise slide into place on
    // rotation and every layout pass, which reads as the whole camera sliding.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    preview.frame = bounds
    CATransaction.commit()
  }

  // MARK: - Props

  func setIsActive(_ active: Bool) {
    guard active != isActive else { return }
    isActive = active

    sessionQueue.async { [weak self] in
      guard let self else { return }
      if active {
        if !self.session.isRunning { self.session.startRunning() }
      } else if self.session.isRunning {
        self.session.stopRunning()
      }
    }
  }

  // MARK: - Capture

  private func configureSession() {
    sessionQueue.async { [weak self] in
      guard let self else { return }

      self.session.beginConfiguration()
      // 1280x720 rather than the highest available: the model sees 640x640, so
      // capturing 4K would cost memory bandwidth on every frame purely to throw
      // it away again.
      self.session.sessionPreset = .hd1280x720

      guard
        let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
        let input = try? AVCaptureDeviceInput(device: camera),
        self.session.canAddInput(input)
      else {
        self.session.commitConfiguration()
        self.report(failure: "No back camera available.")
        return
      }
      self.session.addInput(input)

      self.output.alwaysDiscardsLateVideoFrames = true
      self.output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
      ]
      self.output.setSampleBufferDelegate(self, queue: self.frameQueue)
      if self.session.canAddOutput(self.output) {
        self.session.addOutput(self.output)
      }

      self.session.commitConfiguration()

      if self.isActive {
        self.session.startRunning()
      }
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if let failure = detector.loadFailure {
      report(failure: failure)
      return
    }
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    // The app is portrait-locked and this is the back camera, whose buffers
    // arrive rotated a quarter turn from how they are displayed.
    var elapsed: Double = 0
    measuring({ elapsed = $0 }) {
      detector.detect(pixelBuffer: pixelBuffer, orientation: .right) { [weak self] hazards in
        self?.onHazards(["hazards": hazards])
      }
    }

    perfLock.lock()
    frameRate.tick()
    frameWork.record(elapsed)
    perfLock.unlock()

    emitPerformanceIfDue()
  }

  /// A snapshot a second, on the capture queue.
  ///
  /// There is no render-thread figure to report here, unlike the AR screen: the
  /// preview is a capture layer the system composites itself, so nothing this
  /// class does can drop one of its frames. That absence is the finding.
  private func emitPerformanceIfDue() {
    let now = CACurrentMediaTime()
    guard now - lastPerformanceSent >= 1 else { return }
    lastPerformanceSent = now

    perfLock.lock()
    var payload: [String: Any] = ["frames": frameRate.dictionary]
    if let work = frameWork.summary { payload["frameWork"] = work.dictionary }
    perfLock.unlock()

    payload["screen"] = "hazard"
    if let detector = detector.performance() { payload["detector"] = detector }
    onPerformance(payload)
  }

  func setBenchmarking(_ on: Bool) {
    detector.setUnthrottled(on)
  }

  /// Sent once. A model that failed to load will fail identically on every
  /// frame, and sixty identical error events a second would be its own bug.
  private func report(failure: String) {
    guard !reportedLoadFailure else { return }
    reportedLoadFailure = true
    onHazards(["hazards": [] as [[String: Any]], "error": failure])
  }
}
