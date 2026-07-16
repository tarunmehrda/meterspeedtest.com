/** Shared speedometer geometry + scales (used at build time and at runtime). */

export const GAUGE = {
  cx: 160,
  cy: 160,
  r: 132,
  /** Arc spans 270°, centred on 12 o'clock (start at 7:30, end at 4:30). */
  startDeg: -225,
  sweepDeg: 270,
  /** Normalised path length so dashoffset math is geometry-independent. */
  pathLength: 1000,
} as const;

/** Log domains keep both slow and gigabit connections readable on one dial. */
export const SPEED_DOMAIN = { min: 0.3, max: 2000 };
export const LATENCY_DOMAIN = { min: 2, max: 400 };

function logFraction(value: number, min: number, max: number): number {
  const v = Math.max(min, Math.min(max, value || min));
  const f = (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return Math.max(0, Math.min(1, f));
}

export function speedToFraction(mbps: number): number {
  if (mbps <= 0) return 0;
  return logFraction(mbps, SPEED_DOMAIN.min, SPEED_DOMAIN.max);
}

export function latencyToFraction(ms: number): number {
  if (ms <= 0) return 0;
  return logFraction(ms, LATENCY_DOMAIN.min, LATENCY_DOMAIN.max);
}

/** Needle rotation (deg) for a 0..1 fill fraction. Needle art points up. */
export function fractionToAngle(frac: number): number {
  return -135 + Math.max(0, Math.min(1, frac)) * GAUGE.sweepDeg;
}

/** Point on the dial for a given fraction, at an optional radius. */
export function pointAt(frac: number, radius: number = GAUGE.r): { x: number; y: number } {
  const deg = GAUGE.startDeg + Math.max(0, Math.min(1, frac)) * GAUGE.sweepDeg;
  const rad = (deg * Math.PI) / 180;
  return { x: GAUGE.cx + radius * Math.cos(rad), y: GAUGE.cy + radius * Math.sin(rad) };
}

/** SVG path `d` for the full dial arc. */
export function arcPath(): string {
  const a = pointAt(0);
  const b = pointAt(1);
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${GAUGE.r} ${GAUGE.r} 0 1 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export interface Tick {
  label: string;
  frac: number;
  major: boolean;
  inner: { x: number; y: number };
  outer: { x: number; y: number };
  labelPos: { x: number; y: number };
}

/** Fixed log-scale speed ticks for the printed dial. */
export function speedTicks(): Tick[] {
  const majors = [1, 10, 100, 1000];
  const minors = [3, 30, 300];
  const build = (v: number, major: boolean): Tick => {
    const frac = speedToFraction(v);
    return {
      label: v >= 1000 ? `${v / 1000}G` : String(v),
      frac,
      major,
      inner: pointAt(frac, GAUGE.r - (major ? 16 : 9)),
      outer: pointAt(frac, GAUGE.r),
      labelPos: pointAt(frac, GAUGE.r - 34),
    };
  };
  return [
    ...majors.map((v) => build(v, true)),
    ...minors.map((v) => build(v, false)),
  ].sort((a, b) => a.frac - b.frac);
}
