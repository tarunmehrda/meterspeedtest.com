/** Locale-aware formatting helpers (Intl per web-interface guidelines). */

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';

const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

/** Adaptive speed display: sub-100 shows one decimal, ≥100 rounds to whole. */
export function speed(mbps: number): string {
  if (!isFinite(mbps) || mbps <= 0) return '0.0';
  if (mbps >= 1000) return nf2.format(mbps / 1000); // Gbps handled by caller unit
  if (mbps >= 100) return nf0.format(mbps);
  return nf1.format(mbps);
}

export function speedUnit(mbps: number): string {
  return mbps >= 1000 ? 'Gbps' : 'Mbps';
}

export function ms(value: number): string {
  if (!isFinite(value) || value < 0) return '0';
  return value >= 100 ? nf0.format(value) : nf1.format(value);
}

export function percent(value: number): string {
  return `${nf1.format(value)}%`;
}

/** Human-readable byte size. */
export function bytes(n: number): string {
  if (n < 1024) return `${nf0.format(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${nf1.format(v)} ${units[i]}`;
}

/** Duration in seconds → compact "1.2 s" / "340 ms". */
export function duration(msValue: number): string {
  if (msValue < 1000) return `${nf0.format(msValue)} ms`;
  return `${nf1.format(msValue / 1000)} s`;
}

const dateFmt = new Intl.DateTimeFormat(locale, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function dateTime(ts: number): string {
  return dateFmt.format(new Date(ts));
}

const relFmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

export function relativeTime(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (abs < min) return relFmt.format(Math.round(diff / 1000), 'second');
  if (abs < hour) return relFmt.format(Math.round(diff / min), 'minute');
  if (abs < day) return relFmt.format(Math.round(diff / hour), 'hour');
  return relFmt.format(Math.round(diff / day), 'day');
}

/** ETA to move `sizeBytes` at `mbps`, as human text. */
export function transferEta(sizeBytes: number, mbps: number): string {
  if (mbps <= 0) return '—';
  const seconds = (sizeBytes * 8) / (mbps * 1e6);
  if (seconds < 1) return '<1 s';
  if (seconds < 60) return `${nf0.format(seconds)} s`;
  if (seconds < 3600) return `${nf1.format(seconds / 60)} min`;
  return `${nf1.format(seconds / 3600)} hr`;
}
