/** Sharing + export: deep-link URLs, clipboard, native share, JSON/CSV, PNG card. */

import type { FullResult } from './speedtest';
import { analyze, type Insights } from './insights';
import * as fmt from './format';

/* ---- Deep-link encode / decode ------------------------------------- *
 * A compact, URL-safe snapshot lives in the hash so a shared link renders
 * the same result (URL reflects state — web-interface guideline).         */

interface Snapshot {
  d: number;
  u: number;
  p: number;
  j: number;
  l: number;
  b: number;
  t: number;
  i?: string;
  c?: string;
}

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)));
}

export function encodeResult(r: FullResult): string {
  const snap: Snapshot = {
    d: r.download.mbps,
    u: r.upload.mbps,
    p: r.latency.ping,
    j: r.latency.jitter,
    l: r.latency.loss,
    b: r.bufferbloat,
    t: r.timestamp,
    i: r.meta?.isp,
    c: r.meta?.colo,
  };
  return b64urlEncode(JSON.stringify(snap));
}

export function decodeResult(code: string): FullResult | null {
  try {
    const s = JSON.parse(b64urlDecode(code)) as Snapshot;
    return {
      id: `shared-${s.t}`,
      timestamp: s.t,
      meta: s.i
        ? {
            ip: '—',
            isp: s.i,
            asn: '',
            colo: s.c ?? '—',
            city: '',
            region: '',
            country: '',
            latitude: '',
            longitude: '',
            protocol: '',
          }
        : null,
      latency: { ping: s.p, avg: s.p, jitter: s.j, loss: s.l, samples: [] },
      loadedLatency: s.p + s.b,
      bufferbloat: s.b,
      download: { mbps: s.d, peak: s.d, bytes: 0, durationMs: 0, samples: [] },
      upload: { mbps: s.u, peak: s.u, bytes: 0, durationMs: 0, samples: [] },
    };
  } catch {
    return null;
  }
}

export function shareUrl(r: FullResult): string {
  const base =
    typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'https://meterspeedtest.com/';
  return `${base}#r=${encodeResult(r)}`;
}

export function shareText(r: FullResult): string {
  const dl = `${fmt.speed(r.download.mbps)} ${fmt.speedUnit(r.download.mbps)}`;
  const ul = `${fmt.speed(r.upload.mbps)} ${fmt.speedUnit(r.upload.mbps)}`;
  return `My internet: ${dl} down · ${ul} up · ${fmt.ms(r.latency.ping)} ms ping — tested on Meter Speed Test`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function nativeShare(r: FullResult): Promise<boolean> {
  if (!canNativeShare()) return false;
  try {
    await navigator.share({ title: 'Meter Speed Test', text: shareText(r), url: shareUrl(r) });
    return true;
  } catch {
    return false;
  }
}

/* ---- Data export --------------------------------------------------- */

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function exportJSON(r: FullResult): void {
  const insights = analyze(r);
  const payload = { source: 'meterspeedtest.com', version: 1, result: r, insights };
  triggerDownload(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `meter-speedtest-${stamp(r.timestamp)}.json`,
  );
}

export function exportHistoryCSV(list: FullResult[]): void {
  const head = [
    'timestamp_iso',
    'download_mbps',
    'upload_mbps',
    'ping_ms',
    'jitter_ms',
    'loss_pct',
    'loaded_latency_ms',
    'bufferbloat_ms',
    'isp',
    'server_colo',
    'ip',
  ];
  const rows = list.map((r) =>
    [
      new Date(r.timestamp).toISOString(),
      r.download.mbps,
      r.upload.mbps,
      r.latency.ping,
      r.latency.jitter,
      r.latency.loss,
      r.loadedLatency,
      r.bufferbloat,
      csvCell(r.meta?.isp ?? ''),
      csvCell(r.meta?.colo ?? ''),
      csvCell(r.meta?.ip ?? ''),
    ].join(','),
  );
  triggerDownload(
    new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }),
    `meter-speedtest-history-${stamp(Date.now())}.csv`,
  );
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ---- Branded PNG result card (canvas, no dependencies) ------------- */

const CARD = { w: 1200, h: 630, dpr: 2 };

export function downloadResultCard(r: FullResult): void {
  const insights = analyze(r);
  const canvas = renderCard(r, insights);
  canvas.toBlob((blob) => {
    if (blob) triggerDownload(blob, `meter-speedtest-${stamp(r.timestamp)}.png`);
  }, 'image/png');
}

function renderCard(r: FullResult, ins: Insights): HTMLCanvasElement {
  const { w, h, dpr } = CARD;
  const canvas = document.createElement('canvas');
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  // Background — dark, on-brand.
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, w, h);

  // Mesh-ish glow accents.
  glow(ctx, 120, 120, 420, '#007cf033');
  glow(ctx, w - 140, 90, 380, '#ff008022');
  glow(ctx, w - 240, h - 120, 460, '#7928ca22');

  // Frame line.
  ctx.strokeStyle = '#ffffff14';
  ctx.lineWidth = 1;
  roundRect(ctx, 24, 24, w - 48, h - 48, 20);
  ctx.stroke();

  const pad = 72;
  // Wordmark.
  ctx.fillStyle = '#ededed';
  ctx.font = '600 30px Geist, Inter, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Meter Speed Test', pad, 108);
  ctx.fillStyle = '#7a7a7a';
  ctx.font = "400 20px 'Geist Mono', ui-monospace, monospace";
  ctx.fillText('meterspeedtest.com', pad, 138);

  // Score badge (top right).
  const gradeColor = gradeToColor(ins.grade);
  ctx.textAlign = 'right';
  ctx.fillStyle = gradeColor;
  ctx.font = '600 76px Geist, Inter, system-ui, sans-serif';
  ctx.fillText(ins.grade, w - pad, 128);
  ctx.fillStyle = '#7a7a7a';
  ctx.font = "400 18px 'Geist Mono', ui-monospace, monospace";
  ctx.fillText(`SCORE ${ins.score}/100`, w - pad, 156);
  ctx.textAlign = 'left';

  // Big two: download / upload.
  const midY = 300;
  bigMetric(ctx, pad, midY, 'DOWNLOAD', fmt.speed(r.download.mbps), fmt.speedUnit(r.download.mbps), '#00dfd8');
  bigMetric(ctx, w / 2 + 20, midY, 'UPLOAD', fmt.speed(r.upload.mbps), fmt.speedUnit(r.upload.mbps), '#0070f3');

  // Divider.
  ctx.strokeStyle = '#ffffff12';
  ctx.beginPath();
  ctx.moveTo(pad, 360);
  ctx.lineTo(w - pad, 360);
  ctx.stroke();

  // Secondary metrics row.
  const y2 = 440;
  smallMetric(ctx, pad, y2, 'PING', `${fmt.ms(r.latency.ping)} ms`);
  smallMetric(ctx, pad + 250, y2, 'JITTER', `${fmt.ms(r.latency.jitter)} ms`);
  smallMetric(ctx, pad + 500, y2, 'PACKET LOSS', `${r.latency.loss.toFixed(1)}%`);
  smallMetric(ctx, pad + 800, y2, 'BUFFERBLOAT', `${ins.bufferbloat.grade}`);

  // Footer meta.
  ctx.fillStyle = '#7a7a7a';
  ctx.font = "400 20px 'Geist Mono', ui-monospace, monospace";
  const isp = r.meta?.isp ? r.meta.isp : 'Unknown ISP';
  const where = r.meta?.colo ? `via ${r.meta.colo}` : '';
  ctx.fillText(`${isp}  ${where}`.trim(), pad, h - 70);
  ctx.textAlign = 'right';
  ctx.fillText(fmt.dateTime(r.timestamp), w - pad, h - 70);
  ctx.textAlign = 'left';

  return canvas;
}

function bigMetric(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string,
  unit: string,
  color: string,
): void {
  ctx.fillStyle = '#7a7a7a';
  ctx.font = "400 20px 'Geist Mono', ui-monospace, monospace";
  ctx.fillText(label, x, y - 74);
  ctx.fillStyle = color;
  ctx.font = '600 92px Geist, Inter, system-ui, sans-serif';
  ctx.fillText(value, x, y);
  const vw = ctx.measureText(value).width;
  ctx.fillStyle = '#a1a1a1';
  ctx.font = '500 28px Geist, Inter, system-ui, sans-serif';
  ctx.fillText(unit, x + vw + 14, y);
}

function smallMetric(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, value: string): void {
  ctx.fillStyle = '#7a7a7a';
  ctx.font = "400 16px 'Geist Mono', ui-monospace, monospace";
  ctx.fillText(label, x, y - 30);
  ctx.fillStyle = '#ededed';
  ctx.font = '600 34px Geist, Inter, system-ui, sans-serif';
  ctx.fillText(value, x, y);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, '#0a0a0a00');
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function gradeToColor(grade: string): string {
  if (grade === 'A+' || grade === 'A') return '#17c964';
  if (grade === 'B') return '#0070f3';
  if (grade === 'C') return '#f5a623';
  return '#ee0000';
}
