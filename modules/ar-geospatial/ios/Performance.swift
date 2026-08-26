import Foundation
import QuartzCore

// Measurement for the two numbers the project is actually held to: how often a
// frame reaches the screen, and how long the model takes on one.
//
// It lives in the app rather than in Instruments because the development
// hardware here cannot run a current Xcode - which is the same reason the .ipa
// is built in CI and sideloaded. A profiler attached over USB was never an
// option, so the numbers have to come off the device's own screen.
//
// That is a weaker instrument than a profiler in one specific way and no other:
// it measures wall clock rather than CPU time, so a sample includes any moment
// the thread spent descheduled. For a latency budget that is the right quantity
// anyway - the walker waits for wall clock.

/// A window of durations, summarised as percentiles.
///
/// Percentiles rather than a mean, because a mean is the wrong statistic for a
/// latency budget. Inference that is usually fast and occasionally terrible
/// averages out to acceptable and does not feel acceptable, and it is the slow
/// tail that drops frames. The p95 is the number a budget should be written
/// against; the max is what the worst frame cost.
struct DurationSampler {
  /// How many samples the percentiles are drawn from.
  ///
  /// At ten inferences a second this is about eight minutes of walking, which
  /// covers a test route with room to spare. Older samples fall out the back so
  /// a long session reports the walk rather than the moment the app launched,
  /// when the model was still warming up.
  private let capacity: Int

  private var recent: [Double] = []

  /// Kept separately from `recent` so that a session longer than the window
  /// still reports how many inferences it actually ran.
  private(set) var count = 0
  private(set) var peak: Double = 0
  private var total: Double = 0

  init(capacity: Int = 5_000) {
    self.capacity = capacity
    recent.reserveCapacity(capacity)
  }

  mutating func record(_ seconds: Double) {
    count += 1
    total += seconds
    peak = max(peak, seconds)

    recent.append(seconds)
    if recent.count > capacity {
      recent.removeFirst(recent.count - capacity)
    }
  }

  /// Milliseconds throughout: the numbers are tens of milliseconds, and a
  /// report full of 0.0413 is harder to read than one full of 41.3.
  struct Summary {
    let count: Int
    let meanMs: Double
    let p50Ms: Double
    let p95Ms: Double
    let maxMs: Double

    var dictionary: [String: Any] {
      [
        "count": count,
        "meanMs": meanMs,
        "p50Ms": p50Ms,
        "p95Ms": p95Ms,
        "maxMs": maxMs,
      ]
    }
  }

  var summary: Summary? {
    guard !recent.isEmpty else { return nil }

    let sorted = recent.sorted()
    return Summary(
      count: count,
      meanMs: (total / Double(count)) * 1000,
      p50Ms: sorted[percentileIndex(0.50, of: sorted.count)] * 1000,
      p95Ms: sorted[percentileIndex(0.95, of: sorted.count)] * 1000,
      maxMs: peak * 1000
    )
  }

  /// Nearest-rank, which is the definition that always names a sample that was
  /// actually observed rather than interpolating between two that were.
  private func percentileIndex(_ fraction: Double, of size: Int) -> Int {
    let rank = Int((fraction * Double(size)).rounded(.up))
    return min(max(rank - 1, 0), size - 1)
  }
}

/// How often something happens: over the whole run, and over the last second.
///
/// Both, because they answer different questions. The average is what goes in
/// the report; the instantaneous figure is what tells the person holding the
/// phone whether the number they are watching has settled yet.
struct RateCounter {
  private var began: CFTimeInterval?
  private var windowBegan: CFTimeInterval = 0
  private var windowCount = 0

  private(set) var count = 0
  private(set) var current: Double = 0

  mutating func tick(at now: CFTimeInterval = CACurrentMediaTime()) {
    if began == nil {
      began = now
      windowBegan = now
    }

    count += 1
    windowCount += 1

    let elapsed = now - windowBegan
    guard elapsed >= 1 else { return }
    current = Double(windowCount) / elapsed
    windowCount = 0
    windowBegan = now
  }

  var average: Double {
    guard let began else { return 0 }
    let elapsed = CACurrentMediaTime() - began
    guard elapsed > 0 else { return 0 }
    return Double(count) / elapsed
  }

  var dictionary: [String: Any] {
    ["count": count, "current": current, "average": average]
  }
}

/// Times a block and hands back what it returned.
///
/// A function rather than a pair of timestamps at each call site, so that an
/// early return cannot skip the stop and quietly leave a sample unrecorded.
@inline(__always)
func measuring<T>(_ record: (Double) -> Void, _ work: () throws -> T) rethrows -> T {
  let started = CACurrentMediaTime()
  defer { record(CACurrentMediaTime() - started) }
  return try work()
}
