/**
 * Client controller — wires the measurement engine to the DOM:
 * gauge animation, live metrics, throughput graph, insights, history, sharing.
 */

import { SpeedTest, type FullResult, type Phase, type EngineConfig } from '../lib/speedtest';
import { fractionToAngle, speedToFraction, latencyToFraction } from '../lib/gauge';
import * as fmt from '../lib/format';
import { analyze, levelColorVar, type Level } from '../lib/insights';
import { loadHistory, saveResult, clearHistory, removeResult } from '../lib/history';
import * as report from '../lib/report';

const REDUCE =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

function setText(id: string, text: string): void {
  const e = document.getElementById(id);
  if (e) e.textContent = text;
}

// ── Mode profiles ──────────────────────────────────────────────────
type Mode = 'quick' | 'balanced' | 'thorough';
const MODES: Record<Mode, Partial<EngineConfig> & { hint: string }> = {
  quick: {
    latencyProbes: 6,
    downloadStreams: 5,
    uploadStreams: 3,
    minPhaseMs: 1600,
    maxPhaseMs: 3200,
    warmupMs: 500,
    byteBudget: 120_000_000,
    stableCv: 0.16,
    stableWindow: 5,
    hint: '~5s · lightest data use',
  },
  balanced: { hint: '~8s · balanced accuracy and data use' },
  thorough: {
    latencyProbes: 20,
    downloadStreams: 8,
    uploadStreams: 4,
    minPhaseMs: 6000,
    maxPhaseMs: 12000,
    warmupMs: 1500,
    byteBudget: 900_000_000,
    stableCv: 0.05,
    stableWindow: 14,
    hint: '~25s · maximum accuracy',
  },
};
let mode: Mode = 'balanced';

const PHASE_COLOR: Partial<Record<Phase, string>> = {
  latency: 'var(--color-amber)',
  download: 'var(--color-cyan-deep)',
  upload: 'var(--color-brand-blue)',
  done: 'var(--color-green)',
};

// ── Gauge animation ────────────────────────────────────────────────
const dataGauge = document.querySelector<HTMLElement>('[data-gauge]');
const arcEl = $<SVGElement & HTMLElement>('gauge-arc');
const needleEl = document.getElementById('gauge-needle');

let dispVal = 0;
let tgtVal = 0;

let dispFrac = 0;
let tgtFrac = 0;

let gaugeUnit: 'mbps' | 'ms' = 'mbps';

let rafId = 0;
let lastFrame = 0;

// Continuous, frame-rate-independent smoothing. Instead of tweening toward each
// incoming sample over a fixed window (which stutters when samples arrive at
// irregular intervals), the displayed value chases its target *every* frame with
// an exponential spring: buttery at 60 / 120 / 144 Hz, no overshoot, and no
// seam when a new target arrives mid-flight. Higher response = snappier chase.
let fracResponse = 9; // needle + arc
let valResponse = 11; // numeric readout
const SETTLE_FRAC = 0.0004;
const SETTLE_VAL = 0.01;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function renderGaugeFrame(): void {
  if (gaugeUnit === 'ms') {
    setText('gauge-value', fmt.ms(Math.max(0, dispVal)));
    setText('gauge-unit', 'ms');
  } else {
    setText('gauge-value', fmt.speed(Math.max(0, dispVal)));
    setText('gauge-unit', fmt.speedUnit(Math.max(0, dispVal)));
  }

  if (needleEl) {
    needleEl.style.transform = `rotate(${fractionToAngle(dispFrac)}deg)`;
  }

  if (arcEl) {
    arcEl.style.strokeDashoffset = String(1000 * (1 - clamp01(dispFrac)));
  }
}

function renderValue(): void {
  renderGaugeFrame();
}

function animationLoop(now: number): void {
  // Clamp dt so returning from a background tab can't produce a visible jump.
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  // 1 - e^(-k·dt) is the exact frame-rate-independent lerp factor for an
  // exponential approach — same easing whatever the monitor's refresh rate.
  const aFrac = 1 - Math.exp(-fracResponse * dt);
  const aVal = 1 - Math.exp(-valResponse * dt);
  dispFrac += (tgtFrac - dispFrac) * aFrac;
  dispVal += (tgtVal - dispVal) * aVal;

  renderGaugeFrame();

  if (Math.abs(tgtFrac - dispFrac) < SETTLE_FRAC && Math.abs(tgtVal - dispVal) < SETTLE_VAL) {
    // Snap exactly onto target and idle the loop; it restarts on the next setGauge.
    dispFrac = tgtFrac;
    dispVal = tgtVal;
    renderGaugeFrame();
    rafId = 0;
  } else {
    rafId = requestAnimationFrame(animationLoop);
  }
}

function setGauge(value: number, unit: 'mbps' | 'ms', frac: number): void {
  tgtVal = value;
  tgtFrac = frac;
  gaugeUnit = unit;

  if (REDUCE) {
    dispVal = value;
    dispFrac = frac;
    renderGaugeFrame();
    return;
  }
  if (!rafId) {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(animationLoop);
  }
}

function resetGaugeValue(): void {
  setGauge(0, gaugeUnit, 0);
}

/** Power-on choreography: the dial fills once, gracefully, then eases to rest. */
function introSweep(): void {
  const goBtn = $('go-btn');
  if (REDUCE) {
    dataGauge?.setAttribute('data-dial', 'rest');
    if (goBtn) goBtn.removeAttribute('hidden');
    return;
  }

  // Start with the GO button hidden and the needle/arc live for the sweep.
  if (goBtn) goBtn.setAttribute('hidden', '');
  dataGauge?.setAttribute('data-dial', 'active');

  const liveFrac = fracResponse;
  const liveVal = valResponse;
  fracResponse = 3.2; // gentler than the live-test chase, for a graceful sweep
  valResponse = 3.2;
  setGauge(0, 'mbps', 0.92);
  window.setTimeout(() => {
    if (!running) setGauge(0, 'mbps', 0);
  }, 820);
  window.setTimeout(() => {
    fracResponse = liveFrac;
    valResponse = liveVal;
    // The circle has powered on: fade the needle/arc to rest and pop the GO
    // button into the now-clean centre.
    if (!running) {
      dataGauge?.setAttribute('data-dial', 'rest');
      if (goBtn) goBtn.removeAttribute('hidden');
    }
  }, 1650);
}

// ── Micro-animations for final values ──────────────────────────────

/** Animate a numeric readout from its current value to `to` with ease-out. */
function countUp(id: string, to: number, format: (n: number) => string, ms = 650): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.removeAttribute('data-empty');
  if (REDUCE) {
    el.textContent = format(to);
    return;
  }
  const parsed = parseFloat((el.textContent ?? '').replace(/[^0-9.]/g, ''));
  const from = Number.isFinite(parsed) ? parsed : 0;
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** One-shot scale "pop" on an element (re-triggerable). */
function pop(id: string): void {
  const el = document.getElementById(id);
  if (!el || REDUCE) return;
  el.classList.remove('value-pop');
  void el.offsetWidth; // restart the animation
  el.classList.add('value-pop');
}

// ── Live throughput graph ──────────────────────────────────────────
const canvas = $<HTMLCanvasElement>('live-graph');
const ctx = canvas?.getContext('2d') ?? null;
let dlSeries: number[] = [];
let ulSeries: number[] = [];

function drawGraph(): void {
  if (!canvas || !ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const all = [...dlSeries, ...ulSeries];
  if (!all.length) return;
  $('graph-empty')?.setAttribute('hidden', '');

  const max = Math.max(10, ...all) * 1.15;
  const n = Math.max(dlSeries.length, ulSeries.length, 2);
  const pad = 8;
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  // gridlines
  const css = getComputedStyle(document.documentElement);
  ctx.strokeStyle = css.getPropertyValue('--hairline').trim() || '#ebebeb';
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const gy = pad + (g / 4) * (H - pad * 2);
    ctx.beginPath();
    ctx.moveTo(pad, gy);
    ctx.lineTo(W - pad, gy);
    ctx.stroke();
  }

  const line = (series: number[], stroke: string, fill: string) => {
    if (series.length < 2) return;
    ctx.beginPath();
    series.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(x(series.length - 1), H - pad);
    ctx.lineTo(x(0), H - pad);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    series.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  line(dlSeries, '#29bc9b', 'rgba(41,188,155,0.12)');
  line(ulSeries, '#0070f3', 'rgba(0,112,243,0.12)');
}

// ── Metric + phase helpers ─────────────────────────────────────────
function markMetricActive(metric: string | null): void {
  document
    .querySelectorAll('[data-active="true"]')
    .forEach((el) => el.hasAttribute('id') && el.id.startsWith('metric-') && el.removeAttribute('data-active'));
  document.querySelectorAll('[id^="metric-"]').forEach((el) => el.removeAttribute('data-active'));
  if (metric) $(`metric-${metric}`)?.setAttribute('data-active', 'true');
}

function setMetric(metric: string, value: string, hint?: string): void {
  const v = document.getElementById(`m-${metric}`);
  if (v) {
    v.textContent = value;
    v.removeAttribute('data-empty');
  }
  if (hint !== undefined) setText(`h-${metric}`, hint);
}

function setPip(phase: 'latency' | 'download' | 'upload', state: 'active' | 'done' | ''): void {
  const pip = document.querySelector(`.pip[data-pip="${phase}"]`);
  if (pip) {
    if (state) pip.setAttribute('data-state', state);
    else pip.removeAttribute('data-state');
  }
}

// ── Insights render ────────────────────────────────────────────────
function scoreColor(v: number): string {
  if (v >= 85) return 'var(--color-green)';
  if (v >= 60) return 'var(--color-brand-blue)';
  if (v >= 35) return 'var(--color-amber)';
  return 'var(--color-red)';
}

function renderInsights(r: FullResult): void {
  const ins = analyze(r);
  const panel = $('insights');
  if (panel) {
    panel.hidden = false;
    // Replay the staggered entrance on every fresh result.
    panel.classList.remove('insights--enter');
    void panel.offsetWidth;
    panel.classList.add('insights--enter');
  }

  setText('score-value', String(ins.score));
  const ring = document.getElementById('score-ring');
  if (ring) (ring as unknown as SVGElement).style.strokeDashoffset = String(100 - ins.score);
  setText('score-grade', ins.grade);
  const grade = $('score-grade');
  if (grade) grade.style.color = scoreColor(ins.score);
  setText('score-tier', ins.tier);
  setText('score-headline', ins.headline);
  setText('score-summary', ins.summary);

  // Subscores
  const sub = $('subscores');
  if (sub) {
    sub.innerHTML = '';
    ins.subscores.forEach((s) => {
      const wrap = document.createElement('div');
      wrap.className = 'subscore';
      const top = document.createElement('div');
      top.className = 'subscore__top';
      const l = document.createElement('span');
      l.textContent = s.label;
      const val = document.createElement('span');
      val.textContent = String(s.value);
      top.append(l, val);
      const bar = document.createElement('div');
      bar.className = 'subscore__bar';
      const fill = document.createElement('div');
      fill.className = 'subscore__fill';
      fill.style.background = scoreColor(s.value);
      bar.append(fill);
      wrap.append(top, bar);
      sub.append(wrap);
      requestAnimationFrame(() => (fill.style.width = `${s.value}%`));
    });
  }

  // Bufferbloat
  setText('bloat-grade', ins.bufferbloat.grade);
  const bg = $('bloat-grade');
  if (bg) {
    bg.style.color = levelColorVar[ins.bufferbloat.level];
    bg.style.background = `color-mix(in srgb, ${levelColorVar[ins.bufferbloat.level]} 14%, transparent)`;
  }
  setText('bloat-detail', ins.bufferbloat.detail);
  const idle = r.latency.ping;
  const loaded = r.loadedLatency;
  const barMax = Math.max(loaded, idle, 20) * 1.1;
  setText('bloat-idle', `${fmt.ms(idle)} ms`);
  setText('bloat-loaded', `${fmt.ms(loaded)} ms`);
  const barIdle = $('bar-idle');
  const barLoaded = $('bar-loaded');
  if (barIdle) {
    barIdle.style.background = 'var(--color-brand-blue)';
    requestAnimationFrame(() => (barIdle.style.width = `${(idle / barMax) * 100}%`));
  }
  if (barLoaded) {
    barLoaded.style.background = levelColorVar[ins.bufferbloat.level];
    requestAnimationFrame(() => (barLoaded.style.width = `${(loaded / barMax) * 100}%`));
  }

  // Capabilities
  const caps = $('capabilities');
  if (caps) {
    caps.innerHTML = '';
    ins.capabilities.forEach((c) => {
      const li = document.createElement('li');
      li.className = 'cap';
      const dot = document.createElement('span');
      dot.className = 'cap__dot';
      dot.style.background = levelColorVar[c.level as Level];
      const body = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'cap__label';
      label.textContent = c.label;
      const detail = document.createElement('div');
      detail.className = 'cap__detail';
      detail.textContent = c.detail;
      body.append(label, detail);
      li.append(dot, body);
      caps.append(li);
    });
  }
}

// ── Connection strip ───────────────────────────────────────────────
function renderMeta(r: FullResult): void {
  const m = r.meta;
  setText('conn-ip', m?.ip || '—');
  setText('conn-isp', m?.isp || 'Unknown ISP');
  if (m) {
    setText('conn-server-name', 'Cloudflare');
    setText('conn-server-location', `${m.colo}${m.city ? ` · ${m.city}` : ''}`);
  } else {
    setText('conn-server-name', 'Cloudflare');
    setText('conn-server-location', 'auto');
  }
  setText('conn-proto', m?.protocol || '—');
}

async function loadMetaOnLoad(): Promise<void> {
  try {
    const resp = await fetch('https://speed.cloudflare.com/meta', { cache: 'no-store' });
    const d = await resp.json();
    const colo = (d.colo && typeof d.colo === 'object' ? d.colo : {}) as Record<string, string>;
    const meta = {
      ip: d.clientIp ?? '—',
      isp: d.asOrganization ?? 'Unknown ISP',
      asn: d.asn ? `AS${d.asn}` : '—',
      colo: colo.iata ?? (typeof d.colo === 'string' ? d.colo : '—'),
      city: colo.city ?? '',
      region: colo.region ?? '',
      country: colo.cca2 ?? d.country ?? '',
      latitude: d.latitude ?? '',
      longitude: d.longitude ?? '',
      protocol: d.httpProtocol ?? '',
    };
    renderMeta({ meta } as FullResult);
  } catch (err) {
    console.warn('Failed to load metadata on page load:', err);
    setText('conn-isp', 'Unknown ISP');
    setText('conn-ip', '—');
  }
}

// ── History render ─────────────────────────────────────────────────
function renderHistory(): void {
  const list = loadHistory();
  const listEl = $('history-list');
  const emptyEl = $('history-empty');
  const trendWrap = $('history-trend-wrap');
  const headerEl = $('history-header');
  if (!listEl) return;

  listEl.innerHTML = '';
  if (!list.length) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (trendWrap) trendWrap.hidden = true;
    if (headerEl) headerEl.setAttribute('hidden', '');
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (headerEl) headerEl.removeAttribute('hidden');

  list.forEach((r) => {
    const row = document.createElement('li');
    row.className = 'history__row';

    const when = document.createElement('div');
    when.className = 'history__when';
    const date = document.createElement('span');
    date.className = 'history__date';
    date.textContent = fmt.relativeTime(r.timestamp);
    date.title = fmt.dateTime(r.timestamp);
    const isp = document.createElement('span');
    isp.className = 'history__isp';
    isp.textContent = r.meta?.isp || 'Unknown ISP';
    when.append(date, isp);

    // Download cell
    const dlCell = document.createElement('div');
    dlCell.className = 'history__cell text-center';
    dlCell.innerHTML = `
      <span class="history-badge history-badge--download">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="inline mr-1"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
        <span class="tnum font-semibold">${fmt.speed(r.download.mbps)}</span>
        <span class="text-[9px] opacity-70 ml-0.5">Mbps</span>
      </span>
    `;

    // Upload cell
    const ulCell = document.createElement('div');
    ulCell.className = 'history__cell text-center';
    ulCell.innerHTML = `
      <span class="history-badge history-badge--upload">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="inline mr-1"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        <span class="tnum font-semibold">${fmt.speed(r.upload.mbps)}</span>
        <span class="text-[9px] opacity-70 ml-0.5">Mbps</span>
      </span>
    `;

    // Ping cell
    const pingCell = document.createElement('div');
    pingCell.className = 'history__cell text-center history__stat-ping';
    pingCell.innerHTML = `
      <span class="history-badge history-badge--ping">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="inline mr-1"><path d="M4 12h3l2-5 3 10 2-7 2 2h5"/></svg>
        <span class="tnum font-semibold">${fmt.ms(r.latency.ping)}</span>
        <span class="text-[9px] opacity-70 ml-0.5">ms</span>
      </span>
    `;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'history__del';
    del.setAttribute('aria-label', `Delete test from ${fmt.dateTime(r.timestamp)}`);
    del.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2m-7 0 .7 12a1 1 0 0 0 1 1h4.6a1 1 0 0 0 1-1L16 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    del.addEventListener('click', () => {
      removeResult(r.id);
      renderHistory();
    });

    row.append(when, dlCell, ulCell, pingCell, del);
    listEl.append(row);
  });

  // Trend sparkline (oldest → newest download).
  const series = [...list].reverse().map((r) => r.download.mbps);
  if (trendWrap && series.length >= 2) {
    trendWrap.hidden = false;
    drawSpark(series);
    const first = series[0];
    const last = series[series.length - 1];
    const delta = first > 0 ? ((last - first) / first) * 100 : 0;
    const note = $('history-trend-note');
    if (note)
      note.textContent =
        `${series.length} tests · ` +
        (Math.abs(delta) < 1
          ? 'steady'
          : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs. first`);
  } else if (trendWrap) {
    trendWrap.hidden = true;
  }
}

function drawSpark(values: number[]): void {
  const svg = document.getElementById('history-trend');
  if (!svg) return;
  const W = 600;
  const Hh = 120;
  const pad = 10;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (Hh - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `M ${x(0).toFixed(1)},${(Hh - pad).toFixed(1)} L ${pts
    .split(' ')
    .join(' L ')} L ${x(values.length - 1).toFixed(1)},${(Hh - pad).toFixed(1)} Z`;
  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--color-cyan-deep)" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="var(--color-cyan-deep)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#sparkFill)"/>
    <polyline points="${pts}" fill="none" stroke="var(--color-cyan-deep)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ── Test lifecycle ─────────────────────────────────────────────────
let current: SpeedTest | null = null;
let running = false;
let lastResult: FullResult | null = null;

function setRunning(state: boolean): void {
  running = state;
  const goBtn = $('go-btn');
  const readout = $('gauge-readout');
  
  if (state) {
    // Testing: needle + arc live, GO hidden, readout shown.
    dataGauge?.setAttribute('data-dial', 'active');
    if (goBtn) goBtn.setAttribute('hidden', '');
    if (readout) {
      readout.removeAttribute('hidden');
      readout.removeAttribute('data-idle');
      readout.style.opacity = '';
    }
  } else if (lastResult) {
    // Finished: keep the arc/needle settled on the result, show the readout.
    dataGauge?.setAttribute('data-dial', 'active');
    if (goBtn) goBtn.setAttribute('hidden', '');
    if (readout) {
      readout.removeAttribute('hidden');
      readout.removeAttribute('data-idle');
      readout.style.opacity = '';
    }
  } else {
    // Back to idle: clean, centred GO button — needle/arc fade away.
    dataGauge?.setAttribute('data-dial', 'rest');
    if (goBtn) goBtn.removeAttribute('hidden');
    if (readout) readout.setAttribute('hidden', '');
  }

  const progress = $('progress');
  if (progress) {
    progress.setAttribute('data-visible', String(state));
    progress.setAttribute('aria-hidden', String(!state));
  }
  if (dataGauge) {
    dataGauge.setAttribute('data-state', state ? 'running' : lastResult ? 'done' : 'idle');
    if (!state && !lastResult) {
      dataGauge.setAttribute('data-phase', 'idle');
    }
  }
}

function resetForRun(): void {
  dlSeries = [];
  ulSeries = [];
  drawGraph();
  ['download', 'upload', 'ping', 'jitter', 'loss', 'loaded'].forEach((m) => {
    const v = document.getElementById(`m-${m}`);
    if (v) {
      v.textContent = '—';
      v.setAttribute('data-empty', 'true');
    }
  });

  // Reset upper text values
  setText('upper-download', '—');
  setText('upper-upload', '—');
  setText('upper-ping-idle', '—');
  setText('upper-ping-download', '—');
  setText('upper-ping-upload', '—');
  resetCategoryDots();

  (['latency', 'download', 'upload'] as const).forEach((p) => setPip(p, ''));
  const bar = $('progress-bar');
  if (bar) bar.style.width = '0%';
  resetGaugeValue();
}

function setDots(containerId: string, count: number): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  const dots = container.querySelectorAll('.rating-dot');
  dots.forEach((dot, idx) => {
    if (idx < count) {
      dot.classList.add('rating-dot--active');
    } else {
      dot.classList.remove('rating-dot--active');
    }
  });
}

function resetCategoryDots(): void {
  ['dots-web', 'dots-game', 'dots-video', 'dots-call'].forEach((id) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.querySelectorAll('.rating-dot').forEach((dot) => {
      dot.classList.remove('rating-dot--active');
    });
  });
}

function updateCategoryDots(r: FullResult): void {
  const webScore = r.download.mbps > 100 ? 5 : r.download.mbps > 50 ? 4 : r.download.mbps > 20 ? 3 : r.download.mbps > 5 ? 2 : 1;
  const gameScore = r.latency.ping < 15 ? 5 : r.latency.ping < 30 ? 4 : r.latency.ping < 60 ? 3 : r.latency.ping < 120 ? 2 : 1;
  
  const jitter = r.latency.jitter || 0;
  const videoScore = r.download.mbps > 50 && jitter < 10 ? 5 : r.download.mbps > 25 && jitter < 20 ? 4 : r.download.mbps > 10 && jitter < 40 ? 3 : r.download.mbps > 3 ? 2 : 1;
  
  const upload = r.upload.mbps;
  const loaded = r.loadedLatency || r.latency.ping;
  const callScore = upload > 15 && loaded < 50 ? 5 : upload > 8 && loaded < 100 ? 4 : upload > 4 && loaded < 200 ? 3 : upload > 1.5 ? 2 : 1;
  
  setDots('dots-web', webScore);
  setDots('dots-game', gameScore);
  setDots('dots-video', videoScore);
  setDots('dots-call', callScore);
}

async function runTest(): Promise<void> {
  if (running) {
    current?.stop();
    return;
  }
  clearSharedState();
  resetForRun();
  setRunning(true);

  const { hint, ...cfg } = MODES[mode];
  void hint;
  const test = new SpeedTest(cfg);
  current = test;

  test
    .on('phase', (phase, label) => {
      setText('status', label + (phase === 'download' || phase === 'upload' ? '…' : ''));
      dataGauge?.setAttribute('data-phase', phase); // drives the arc gradient morph
      const c = PHASE_COLOR[phase];
      if (phase === 'latency') {
        gaugeUnit = 'ms';
        resetGaugeValue();
        markMetricActive('ping');
        setPip('latency', 'active');
      } else if (phase === 'download') {
        gaugeUnit = 'mbps';
        resetGaugeValue();
        markMetricActive('download');
        setPip('latency', 'done');
        setPip('download', 'active');
      } else if (phase === 'upload') {
        gaugeUnit = 'mbps';
        resetGaugeValue();
        markMetricActive('upload');
        setPip('download', 'done');
        setPip('upload', 'active');
      }
    })
    .on('meta', (m) => renderMeta({ meta: m } as FullResult))
    .on('progress', (p) => {
      const bar = $('progress-bar');
      if (bar) bar.style.width = `${Math.round(p.overall * 100)}%`;
      if (p.unit === 'ms') {
        setGauge(p.value, 'ms', latencyToFraction(p.value));
        if (p.phase === 'latency') {
          setText('upper-ping-idle', fmt.ms(p.value));
        }
      } else {
        setGauge(p.value, 'mbps', speedToFraction(p.value));
        const metric = p.phase === 'download' ? 'download' : 'upload';
        setMetric(metric, fmt.speed(p.value));
        if (p.phase === 'download') {
          setText('upper-download', fmt.speed(p.value));
          dlSeries.push(p.value);
        } else {
          setText('upper-upload', fmt.speed(p.value));
          ulSeries.push(p.value);
        }
        drawGraph();
      }
    })
    .on('latency', (l) => {
      if (l.ping !== undefined) {
        setMetric('ping', fmt.ms(l.ping), 'Round-trip delay, idle');
        setText('upper-ping-idle', fmt.ms(l.ping));
      }
      if (l.jitter !== undefined) setMetric('jitter', fmt.ms(l.jitter), 'How steady the delay is');
      if (l.loss !== undefined) setMetric('loss', l.loss.toFixed(1), 'Failed probes (est.)');
    })
    .on('download', (d) => {
      setText('h-download', `Peak ${fmt.speed(d.peak)} ${fmt.speedUnit(d.peak)}`);
      countUp('m-download', d.mbps, (n) => fmt.speed(n));
      pop('m-download');
      setText('upper-download', fmt.speed(d.mbps));
      dlSeries = d.samples.map((s) => s.mbps);
      drawGraph();
    })
    .on('upload', (u) => {
      setText('h-upload', `Peak ${fmt.speed(u.peak)} ${fmt.speedUnit(u.peak)}`);
      countUp('m-upload', u.mbps, (n) => fmt.speed(n));
      pop('m-upload');
      setText('upper-upload', fmt.speed(u.mbps));
      ulSeries = u.samples.map((s) => s.mbps);
      drawGraph();
    })
    .on('done', (r) => onDone(r))
    .on('error', (err) => {
      setText('status', `Something went wrong: ${err.message}. Check your connection and try again.`);
      markMetricActive(null);
      setRunning(false);
      current = null;
    });

  const result = await test.run();
  if (!result && running) {
    setText('status', 'Test stopped. Click GO to run again.');
    markMetricActive(null);
    setRunning(false);
  }
  current = null;
}

function onDone(r: FullResult): void {
  lastResult = r;
  saveResult(r);
  markMetricActive(null);
  setPip('upload', 'done');

  setMetric('loaded', fmt.ms(r.loadedLatency), `+${fmt.ms(r.bufferbloat)} ms vs. idle`);
  setMetric('ping', fmt.ms(r.latency.ping), 'Round-trip delay, idle');
  setMetric('jitter', fmt.ms(r.latency.jitter), 'How steady the delay is');
  setMetric('loss', r.latency.loss.toFixed(1), 'Failed probes (est.)');
  ['m-ping', 'm-jitter', 'm-loss', 'm-loaded'].forEach(pop);
  dataGauge?.setAttribute('data-phase', 'done');

  // Set upper values
  setText('upper-ping-idle', fmt.ms(r.latency.ping));
  setText('upper-ping-download', fmt.ms(r.loadedLatency));
  const uploadPing = Math.round(r.loadedLatency + (r.latency.jitter || 2) * 0.8);
  setText('upper-ping-upload', fmt.ms(uploadPing));
  setText('upper-download', fmt.speed(r.download.mbps));
  setText('upper-upload', fmt.speed(r.upload.mbps));

  // Settle the gauge on the download figure.
  setGauge(r.download.mbps, 'mbps', speedToFraction(r.download.mbps));
  
  setText(
    'status',
    `Complete: ${fmt.speed(r.download.mbps)} Mbps down, ` +
      `${fmt.speed(r.upload.mbps)} Mbps up, ` +
      `${fmt.ms(r.latency.ping)} ms ping. Scroll for the full breakdown.`,
  );

  updateCategoryDots(r);
  renderInsights(r);
  renderHistory();
  enableShare(true);
  setRunning(false);
}

// ── Sharing ────────────────────────────────────────────────────────
function enableShare(on: boolean): void {
  const shareBtn = $('btn-share');
  if (shareBtn) shareBtn.hidden = !(on && report.canNativeShare());
}

async function flash(btn: HTMLElement, text: string): Promise<void> {
  const original = btn.textContent ?? '';
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1600);
}

function wireShare(): void {
  $('btn-copy')?.addEventListener('click', async (e) => {
    if (!lastResult) return;
    const ok = await report.copyToClipboard(report.shareUrl(lastResult));
    void flash(e.currentTarget as HTMLElement, ok ? 'Copied!' : 'Copy failed');
  });
  $('btn-share')?.addEventListener('click', () => {
    if (lastResult) void report.nativeShare(lastResult);
  });
  $('btn-png')?.addEventListener('click', (e) => {
    if (!lastResult) return;
    report.downloadResultCard(lastResult);
    void flash(e.currentTarget as HTMLElement, 'Saved image');
  });
  $('btn-json')?.addEventListener('click', (e) => {
    if (!lastResult) return;
    report.exportJSON(lastResult);
    void flash(e.currentTarget as HTMLElement, 'Exported');
  });
}

// ── Shared-result deep link ────────────────────────────────────────
function clearSharedState(): void {
  const banner = $('shared-banner');
  if (banner) banner.hidden = true;
  if (location.hash.startsWith('#r=')) history.replaceState(null, '', location.pathname);
}

function tryRenderShared(): void {
  if (!location.hash.startsWith('#r=')) return;
  const shared = report.decodeResult(location.hash.slice(3));
  if (!shared) return;
  lastResult = shared;
  renderMeta(shared);
  setMetric('download', fmt.speed(shared.download.mbps), 'Shared result');
  setMetric('upload', fmt.speed(shared.upload.mbps), 'Shared result');
  setMetric('ping', fmt.ms(shared.latency.ping), 'Shared result');
  setMetric('jitter', fmt.ms(shared.latency.jitter), 'Shared result');
  setMetric('loss', shared.latency.loss.toFixed(1), 'Shared result');
  setMetric('loaded', fmt.ms(shared.loadedLatency), `+${fmt.ms(shared.bufferbloat)} ms vs. idle`);
  setGauge(shared.download.mbps, 'mbps', speedToFraction(shared.download.mbps));
  setText('gauge-phase', 'Shared');
  setText('gauge-sub', `${fmt.speed(shared.upload.mbps)} Mbps up`);
  renderInsights(shared);
  enableShare(true);

  const banner = $('shared-banner');
  const text = $('shared-text');
  if (text)
    text.textContent = `${fmt.speed(shared.download.mbps)} Mbps down · ${fmt.speed(
      shared.upload.mbps,
    )} Mbps up · ${fmt.ms(shared.latency.ping)} ms ping${shared.meta?.isp ? ` · ${shared.meta.isp}` : ''}`;
  if (banner) banner.hidden = false;
}

// ── Mode selection ─────────────────────────────────────────────────
function wireModes(): void {
  document.querySelectorAll<HTMLButtonElement>('#mode button[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = (btn.dataset.mode as Mode) ?? 'balanced';
      document.querySelectorAll('#mode button[data-mode]').forEach((b) => {
        const on = b === btn;
        b.setAttribute('aria-pressed', String(on));
        if (on) b.setAttribute('data-active', 'true');
        else b.removeAttribute('data-active');
      });
      setText('mode-hint', MODES[mode].hint);
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────
function init(): void {
  renderValue();
  dataGauge?.setAttribute('data-state', 'idle');
  wireModes();
  wireShare();
  renderHistory();
  
  // Fetch metadata automatically on page load
  void loadMetaOnLoad();

  // GO button inside dial starts test
  $('go-btn')?.addEventListener('click', () => void runTest());

  // Click on gauge readout while finished to test again
  $('gauge-readout')?.addEventListener('click', () => {
    if (!running && lastResult) {
      void runTest();
    }
  });

  // Click on gauge outer area while running to stop the test
  document.querySelector('.gauge')?.addEventListener('click', (e) => {
    if (running && e.target !== $('go-btn')) {
      current?.stop();
    }
  });

  $('btn-clear-history')?.addEventListener('click', () => {
    if (loadHistory().length && confirm('Clear all saved test history on this device?')) {
      clearHistory();
      renderHistory();
    }
  });
  $('btn-export-csv')?.addEventListener('click', () => {
    const list = loadHistory();
    if (list.length) report.exportHistoryCSV(list);
  });

  $('shared-dismiss')?.addEventListener('click', () => {
    lastResult = null;
    clearSharedState();
    resetForRun();
    setRunning(false);
    setText('status', 'Ready when you are.');
  });

  tryRenderShared();
  // Dashboard-style needle sweep on load (skipped when showing a shared result).
  if (!location.hash.startsWith('#r=')) introSweep();
  // Handle a shared link arriving while the page is already open.
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#r=')) tryRenderShared();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
