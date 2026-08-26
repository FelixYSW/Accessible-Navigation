import { useCallback, useState } from 'react';
import type { PerformanceEvent } from '../../modules/ar-geospatial';

// Holds the latest measurement, and the benchmark switch that goes with it.
//
// The reading is replaced wholesale once a second rather than accumulated here,
// because the accumulating is done natively: percentiles over five thousand
// samples are not something to recompute in JS at the camera's rate, and the
// native side is where the clock being measured actually runs.
export function usePerformanceReadout(enabled: boolean) {
  const [reading, setReading] = useState<PerformanceEvent | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);

  const onPerformance = useCallback(
    (event: { nativeEvent: PerformanceEvent }) => setReading(event.nativeEvent),
    [],
  );

  const toggleBenchmark = useCallback(() => setBenchmarking((on) => !on), []);

  return {
    reading: enabled ? reading : null,
    benchmarking,
    toggleBenchmark,
    // Only subscribed when the readout is on, so a normal walk pays nothing:
    // the native side still measures, but nothing crosses the bridge and
    // nothing re-renders once a second.
    onPerformance: enabled ? onPerformance : undefined,
    benchmarkMode: enabled && benchmarking,
  };
}
