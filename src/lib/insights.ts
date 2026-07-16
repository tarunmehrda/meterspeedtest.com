/**
 * Insight layer — turns raw numbers into meaning.
 * This is where Meter aims past the competition: a single quality score,
 * a bufferbloat grade, and plain-language "can my line actually do X" verdicts.
 */

import type { FullResult } from './speedtest';
import { transferEta } from './format';

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export type Level = 'excellent' | 'good' | 'fair' | 'poor';

export interface Capability {
  key: string;
  label: string;
  detail: string;
  level: Level;
}

export interface Insights {
  score: number; // 0..100
  grade: Grade;
  headline: string;
  summary: string;
  tier: string; // e.g. "Gigabit fibre-class"
  bufferbloat: { grade: Grade; level: Level; detail: string };
  capabilities: Capability[];
  subscores: { label: string; value: number }[];
}

const LEVEL_ORDER: Record<Level, number> = { excellent: 3, good: 2, fair: 1, poor: 0 };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Diminishing-returns curve for "bigger is better" metrics. */
function curveUp(value: number, good: number): number {
  return clamp01(1 - Math.exp((-Math.LN2 * value) / good));
}

/** Falling curve for "smaller is better" metrics. */
function curveDown(value: number, good: number): number {
  return clamp01(Math.exp((-Math.LN2 * value) / good));
}

function scoreToGrade(s: number): Grade {
  if (s >= 95) return 'A+';
  if (s >= 85) return 'A';
  if (s >= 70) return 'B';
  if (s >= 55) return 'C';
  if (s >= 40) return 'D';
  return 'F';
}

function levelFrom(score: number): Level {
  if (score >= 0.85) return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.35) return 'fair';
  return 'poor';
}

/** Bufferbloat grade from latency increase under load (Waveform-style bands). */
export function bufferbloatGrade(ms: number): { grade: Grade; level: Level; detail: string } {
  let grade: Grade;
  let level: Level;
  if (ms < 5) [grade, level] = ['A+', 'excellent'];
  else if (ms < 30) [grade, level] = ['A', 'excellent'];
  else if (ms < 60) [grade, level] = ['B', 'good'];
  else if (ms < 150) [grade, level] = ['C', 'fair'];
  else if (ms < 400) [grade, level] = ['D', 'poor'];
  else [grade, level] = ['F', 'poor'];
  const detail =
    ms < 30
      ? 'Latency barely moves under load — video calls and gaming stay smooth even during big downloads.'
      : ms < 150
        ? 'Latency climbs somewhat when the link is busy. Calls may stutter during large transfers.'
        : 'Latency spikes sharply under load. Expect lag on calls and games whenever something is downloading.';
  return { grade, level, detail };
}

function connectionTier(down: number): string {
  if (down >= 900) return 'Gigabit fibre-class';
  if (down >= 400) return 'Ultra-fast broadband';
  if (down >= 200) return 'Very fast broadband';
  if (down >= 100) return 'Fast broadband';
  if (down >= 50) return 'Standard broadband';
  if (down >= 25) return 'Basic broadband';
  if (down >= 10) return 'Entry-level';
  return 'Constrained connection';
}

function cap(key: string, label: string, level: Level, detail: string): Capability {
  return { key, label, detail, level };
}

function capabilities(r: FullResult): Capability[] {
  const down = r.download.mbps;
  const up = r.upload.mbps;
  const lat = r.latency.ping;
  const jit = r.latency.jitter;
  const loss = r.latency.loss;
  const loadedLat = r.loadedLatency;

  const list: Capability[] = [];

  // Simultaneous 4K streams (≈25 Mbps each, keep 20% headroom).
  const streams = Math.floor((down * 0.8) / 25);
  list.push(
    cap(
      '4k',
      '4K streaming',
      streams >= 4 ? 'excellent' : streams >= 2 ? 'good' : streams >= 1 ? 'fair' : 'poor',
      streams >= 1
        ? `Handles about ${streams} simultaneous 4K stream${streams === 1 ? '' : 's'}.`
        : 'Below the ~25 Mbps a single 4K stream needs.',
    ),
  );

  // Video conferencing (upload + latency + jitter sensitive).
  const callGood = up >= 4 && loadedLat < 100 && jit < 30 && loss < 2;
  const callOk = up >= 1.5 && loadedLat < 200 && jit < 60;
  list.push(
    cap(
      'calls',
      'Video calls',
      callGood ? 'excellent' : callOk ? 'good' : up >= 1 ? 'fair' : 'poor',
      callGood
        ? 'Plenty of upload and steady latency for HD group calls.'
        : callOk
          ? 'Fine for one-to-one HD calls; large group calls may soften.'
          : 'Upload or latency is tight — calls may freeze or drop quality.',
    ),
  );

  // Cloud / competitive gaming (latency, jitter, loss dominated).
  const gameGreat = lat < 40 && jit < 10 && loss < 1 && loadedLat < 80;
  const gameOk = lat < 80 && jit < 25 && loss < 3;
  list.push(
    cap(
      'gaming',
      'Online & cloud gaming',
      gameGreat ? 'excellent' : gameOk ? 'good' : lat < 130 ? 'fair' : 'poor',
      gameGreat
        ? 'Low, stable latency — responsive for competitive and cloud gaming.'
        : gameOk
          ? 'Playable, though you may feel occasional lag spikes.'
          : 'High or unstable latency will cause noticeable lag.',
    ),
  );

  // Big file / game download ETA (50 GB modern game).
  const eta = transferEta(50 * 1024 ** 3, down);
  list.push(
    cap(
      'download',
      '50 GB game download',
      down >= 300 ? 'excellent' : down >= 100 ? 'good' : down >= 40 ? 'fair' : 'poor',
      `About ${eta} at this speed.`,
    ),
  );

  // Cloud backup / large upload (100 GB).
  const upEta = transferEta(100 * 1024 ** 3, up);
  list.push(
    cap(
      'backup',
      '100 GB cloud backup',
      up >= 100 ? 'excellent' : up >= 40 ? 'good' : up >= 10 ? 'fair' : 'poor',
      `About ${upEta} to upload.`,
    ),
  );

  // Smart-home / many devices headroom.
  list.push(
    cap(
      'household',
      'Busy household',
      down >= 300 && loadedLat < 80
        ? 'excellent'
        : down >= 100
          ? 'good'
          : down >= 40
            ? 'fair'
            : 'poor',
      down >= 100
        ? 'Comfortable headroom for many devices online at once.'
        : 'May slow noticeably when several devices are active together.',
    ),
  );

  return list;
}

export function analyze(r: FullResult): Insights {
  const down = r.download.mbps;
  const up = r.upload.mbps;
  const lat = r.latency.ping;
  const jit = r.latency.jitter;
  const loss = r.latency.loss;

  // Sub-scores on 0..1.
  const sDown = curveUp(down, 250); // 250 Mbps ≈ 0.5, ~1000 ≈ 0.94
  const sUp = curveUp(up, 100);
  const sLat = curveDown(lat, 30); // 30 ms ≈ 0.5
  const sJit = curveDown(jit, 12);
  const sLoss = curveDown(loss, 1.2);
  const bb = bufferbloatGrade(r.bufferbloat);
  const sBloat = curveDown(r.bufferbloat, 40);

  const score01 =
    sDown * 0.3 + sUp * 0.14 + sLat * 0.22 + sJit * 0.1 + sLoss * 0.12 + sBloat * 0.12;
  const score = Math.round(score01 * 100);
  const grade = scoreToGrade(score);

  const caps = capabilities(r);
  const weakest = caps.reduce((min, c) =>
    LEVEL_ORDER[c.level] < LEVEL_ORDER[min.level] ? c : min,
  );

  const headline =
    score >= 85
      ? 'Excellent connection'
      : score >= 70
        ? 'Solid, dependable connection'
        : score >= 55
          ? 'Usable, with rough edges'
          : score >= 40
            ? 'Struggling connection'
            : 'Poor connection';

  const summary =
    score >= 70
      ? `Fast enough for demanding use with room to spare. Weakest area: ${weakest.label.toLowerCase()}.`
      : `The biggest limiter is ${weakest.label.toLowerCase()} — that's what to fix first.`;

  return {
    score,
    grade,
    headline,
    summary,
    tier: connectionTier(down),
    bufferbloat: bb,
    capabilities: caps,
    subscores: [
      { label: 'Download', value: Math.round(sDown * 100) },
      { label: 'Upload', value: Math.round(sUp * 100) },
      { label: 'Latency', value: Math.round(sLat * 100) },
      { label: 'Jitter', value: Math.round(sJit * 100) },
      { label: 'Loss', value: Math.round(sLoss * 100) },
      { label: 'Under load', value: Math.round(sBloat * 100) },
    ],
  };
}

export const levelColorVar: Record<Level, string> = {
  excellent: 'var(--color-green)',
  good: 'var(--color-brand-blue)',
  fair: 'var(--color-amber)',
  poor: 'var(--color-red)',
};
