import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PerformanceEvent } from '../../modules/ar-geospatial';

// The measured frame rate and inference cost, on the screen being measured.
//
// It reads off the device rather than out of a profiler because the development
// hardware for this project cannot run a current Xcode - the same reason the
// .ipa is built in CI and sideloaded. Instruments over USB was never available,
// so the numbers have to be legible on the phone itself, in daylight, while
// walking.
//
// Hence the styling: opaque black rather than a blur, monospace so the digits
// do not jitter as they change, and top-left where neither the instruction
// banner nor the sheet reaches.

interface PerformanceHudProps {
  reading: PerformanceEvent | null;
  /** Whether the model is currently running unthrottled. */
  benchmarking: boolean;
  onToggleBenchmark: () => void;
}

const ms = (value: number) => `${value.toFixed(1)}`;
const hz = (value: number) => `${value.toFixed(1)}`;

export function PerformanceHud({
  reading,
  benchmarking,
  onToggleBenchmark,
}: PerformanceHudProps) {
  return (
    <View style={styles.card} pointerEvents="box-none">
      {reading === null ? (
        <Text style={styles.waiting}>measuring…</Text>
      ) : (
        <>
          {/* Present frames first: it is the one the requirement is written
              against, and the one that degrades when anything else here goes
              wrong. The hazard screen has no render figure to report - its
              preview is a capture layer the system composites itself. */}
          {reading.render ? (
            <Row
              label="render"
              value={`${hz(reading.render.current)} fps`}
              note={`avg ${hz(reading.render.average)}`}
            />
          ) : (
            <Row label="render" value="n/a" note="capture layer" />
          )}

          <Row
            label="camera"
            value={`${hz(reading.frames.current)} fps`}
            note={`${reading.frames.count} frames`}
          />

          {/* How long the native view holds the thread it was called on. On the
              AR screen that thread is the main one, so this is time the
              renderer did not get. */}
          {reading.frameWork ? (
            <Row
              label="on-thread"
              value={`${ms(reading.frameWork.p95Ms)} ms`}
              note={`p50 ${ms(reading.frameWork.p50Ms)} · max ${ms(reading.frameWork.maxMs)}`}
            />
          ) : null}

          {reading.detector ? (
            <>
              <View style={styles.rule} />
              <Row
                label="inference"
                value={`${ms(reading.detector.inference.p95Ms)} ms`}
                note={`p50 ${ms(reading.detector.inference.p50Ms)} · max ${ms(
                  reading.detector.inference.maxMs,
                )}`}
              />
              <Row
                label="detector"
                value={`${hz(reading.detector.rate.average)} Hz`}
                note={
                  reading.detector.unthrottled
                    ? `${reading.detector.inference.count} runs · unthrottled`
                    : `${reading.detector.inference.count} runs · cap ${hz(
                        reading.detector.throttleHz,
                      )}`
                }
              />
            </>
          ) : null}
        </>
      )}

      <Pressable
        onPress={onToggleBenchmark}
        style={({ pressed }) => [
          styles.button,
          benchmarking && styles.buttonOn,
          pressed && styles.buttonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          benchmarking
            ? 'Stop the unthrottled benchmark'
            : 'Run the hazard model unthrottled to measure its ceiling'
        }
      >
        <Text style={styles.buttonText}>
          {benchmarking ? 'stop benchmark' : 'benchmark'}
        </Text>
      </Pressable>
    </View>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.figures}>
        <Text style={styles.value}>{value}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    top: 200,
    left: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    // Opaque, not translucent. This is read against a moving street in
    // daylight, and a blur takes its legibility from whatever happens to be
    // behind it.
    backgroundColor: 'rgba(0,0,0,0.82)',
    minWidth: 208,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  figures: { alignItems: 'flex-end' },
  label: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  value: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    // Tabular figures so the numbers do not shuffle sideways as they update,
    // which at one update a second is otherwise the most distracting thing on
    // the screen.
    fontVariant: ['tabular-nums'],
  },
  note: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginVertical: 5,
  },
  waiting: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  button: {
    marginTop: 7,
    paddingVertical: 5,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  buttonOn: { backgroundColor: '#c8321f' },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
});
