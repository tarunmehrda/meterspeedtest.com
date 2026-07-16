/**
 * Meter Speed Test — measurement engine.
 *
 * Runs entirely in the browser against Cloudflare's open, CORS-enabled
 * measurement endpoints (speed.cloudflare.com), so the site stays a static
 * deploy while producing real numbers.
 *
 *   /meta                 → client IP, ISP/ASN, edge colo, geo, HTTP protocol
 *   /__down?bytes=N       → N bytes of payload (download + latency)
 *   /__up                 → sink for POST bodies (upload)
 *
 * Phases: meta → idle latency → download (+ latency under load) → upload.
 */

export const CF_BASE = 'https://speed.cloudflare.com';

export type Phase =
  | 'idle'
  | 'meta'
  | 'latency'
  | 'download'
  | 'upload'
  | 'finalizing'
  | 'done'
  | 'aborted'
  | 'error';

export interface ServerMeta {
  ip: string;
  isp: string;
  asn: string;
  colo: string;
  city: string;
  region: string;
  country: string;
  latitude: string;
  longitude: string;
  protocol: string;
}

export interface LatencyResult {
  /** Lowest observed round trip — the "true" ping. */
  ping: number;
  /** Mean round trip. */
  avg: number;
  /** Mean deviation between consecutive samples. */
  jitter: number;
  /** Estimated loss = timed-out or failed probes / total (see caveat in UI). */
  loss: number;
  samples: number[];
}

export interface ThroughputSample {
  /** ms since phase start */
  t: number;
  /** instantaneous Mbps */
  mbps: number;
}

export interface ThroughputResult {
  /** Headline throughput (stable window average), Mbps. */
  mbps: number;
  /** Peak instantaneous throughput, Mbps. */
  peak: number;
  bytes: number;
  durationMs: number;
  samples: ThroughputSample[];
}

export interface FullResult {
  id: string;
  timestamp: number;
  meta: ServerMeta | null;
  latency: LatencyResult;
  /** Latency measured while the link is saturated (bufferbloat probe). */
  loadedLatency: number;
  bufferbloat: number;
  download: ThroughputResult;
  upload: ThroughputResult;
}

export interface ProgressEvent {
  phase: Phase;
  /** 0..1 within the current phase. */
  phaseProgress: number;
  /** 0..1 across the whole run. */
  overall: number;
  /** Live value to drive the gauge (Mbps for dl/up, ms for latency). */
  value: number;
  /** Unit hint for the gauge label. */
  unit: 'mbps' | 'ms';
}

type Handlers = {
  phase: (phase: Phase, label: string) => void;
  meta: (meta: ServerMeta) => void;
  latency: (partial: Partial<LatencyResult>) => void;
  progress: (p: ProgressEvent) => void;
  download: (r: ThroughputResult) => void;
  upload: (r: ThroughputResult) => void;
  done: (r: FullResult) => void;
  error: (err: Error) => void;
};

export interface EngineConfig {
  /** Idle-latency probe count. */
  latencyProbes: number;
  /** Parallel streams for download. */
  downloadStreams: number;
  /** Parallel streams for upload. */
  uploadStreams: number;
  /** Bytes per download request. */
  downloadChunk: number;
  /** Bytes per upload request. */
  uploadChunk: number;
  /** Min / max wall-clock per throughput phase (ms). */
  minPhaseMs: number;
  maxPhaseMs: number;
  /** Warmup ignored from the head of each throughput phase (ms). */
  warmupMs: number;
  /** Byte budget per throughput phase (caps data use on fast links). */
  byteBudget: number;
  /** Early exit: end a phase once the rate's coefficient of variation stays below this. */
  stableCv: number;
  /** Number of consecutive ticker samples that must be stable to early-exit. */
  stableWindow: number;
}

const DEFAULTS: EngineConfig = {
  latencyProbes: 10,
  downloadStreams: 6,
  uploadStreams: 4,
  downloadChunk: 25_000_000,
  uploadChunk: 10_000_000,
  minPhaseMs: 2_500,
  maxPhaseMs: 5_000,
  warmupMs: 800,
  byteBudget: 400_000_000,
  // Loose enough to actually trigger on real consumer links; the trimmed-mean
  // headline stays robust to this level of fluctuation.
  stableCv: 0.12,
  stableWindow: 7,
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  meta: 'Locating nearest server',
  latency: 'Measuring latency',
  download: 'Testing download',
  upload: 'Testing upload',
  finalizing: 'Crunching results',
  done: 'Complete',
  aborted: 'Stopped',
  error: 'Error',
};

// Weighting for the "overall" progress bar across phases.
// (Meta runs in parallel with latency, so it carries no weight of its own.)
const PHASE_WEIGHT = { latency: 0.16, download: 0.48, upload: 0.36 };

export class SpeedTest {
  private cfg: EngineConfig;
  private handlers: Partial<Handlers> = {};
  private abort = new AbortController();
  private stopped = false;
  private uploadBlob: Blob;

  constructor(cfg: Partial<EngineConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    const payload = new Uint8Array(this.cfg.uploadChunk);
    // Non-zero bytes so nothing along the path is tempted to special-case zeros.
    for (let i = 0; i < payload.length; i += 4096) payload[i] = 120;
    this.uploadBlob = new Blob([payload]);
  }

  on<K extends keyof Handlers>(event: K, cb: Handlers[K]): this {
    this.handlers[event] = cb;
    return this;
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
  }

  private emit<K extends keyof Handlers>(event: K, ...args: Parameters<Handlers[K]>): void {
    const cb = this.handlers[event] as ((...a: unknown[]) => void) | undefined;
    if (cb) cb(...(args as unknown[]));
  }

  private setPhase(phase: Phase): void {
    this.emit('phase', phase, PHASE_LABEL[phase]);
  }

  private overall(done: number, current: keyof typeof PHASE_WEIGHT, frac: number): number {
    return Math.min(1, done + PHASE_WEIGHT[current] * frac);
  }

  // ---- Orchestration -------------------------------------------------

  async run(): Promise<FullResult | null> {
    try {
      // Meta shares no bandwidth with the probes, so fetch it in parallel with
      // the latency phase instead of spending a round-trip up front.
      const metaPromise = this.fetchMeta().then((m) => {
        if (m && !this.stopped) this.emit('meta', m);
        return m;
      });

      this.setPhase('latency');
      const latency = await this.measureLatency((v, frac) =>
        this.emit('progress', {
          phase: 'latency',
          phaseProgress: frac,
          overall: this.overall(0, 'latency', frac),
          value: v,
          unit: 'ms',
        }),
      );
      this.emit('latency', latency);
      if (this.stopped) return null;

      this.setPhase('download');
      const loaded: number[] = [];
      const doneBefore = PHASE_WEIGHT.latency;
      const download = await this.measureThroughput('download', loaded, (v, frac) =>
        this.emit('progress', {
          phase: 'download',
          phaseProgress: frac,
          overall: this.overall(doneBefore, 'download', frac),
          value: v,
          unit: 'mbps',
        }),
      );
      this.emit('download', download);
      if (this.stopped) return null;

      this.setPhase('upload');
      const doneBefore2 = doneBefore + PHASE_WEIGHT.download;
      const upload = await this.measureThroughput('upload', null, (v, frac) =>
        this.emit('progress', {
          phase: 'upload',
          phaseProgress: frac,
          overall: this.overall(doneBefore2, 'upload', frac),
          value: v,
          unit: 'mbps',
        }),
      );
      this.emit('upload', upload);

      this.setPhase('finalizing');
      const meta = await metaPromise;
      const loadedLatency = loaded.length
        ? median(loaded)
        : latency.avg;
      const result: FullResult = {
        id: cryptoId(),
        timestamp: Date.now(),
        meta,
        latency,
        loadedLatency: round(loadedLatency, 1),
        bufferbloat: round(Math.max(0, loadedLatency - latency.ping), 1),
        download,
        upload,
      };
      this.setPhase('done');
      this.emit('done', result);
      return result;
    } catch (err) {
      if (this.stopped || (err instanceof DOMException && err.name === 'AbortError')) {
        this.setPhase('aborted');
        return null;
      }
      this.setPhase('error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }

  // ---- Meta ----------------------------------------------------------

  private async fetchMeta(): Promise<ServerMeta | null> {
    try {
      const resp = await fetch(`${CF_BASE}/meta`, {
        cache: 'no-store',
        signal: this.abort.signal,
      });
      const d = await resp.json();
      // `colo` is the Cloudflare edge (server); top-level city/country is the client.
      const colo = (d.colo && typeof d.colo === 'object' ? d.colo : {}) as Record<string, string>;
      return {
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
    } catch {
      return null; // Non-fatal: the test still runs without geo/ISP context.
    }
  }

  // ---- Latency / jitter / loss --------------------------------------

  private async probe(): Promise<number | null> {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    this.abort.signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    const t0 = performance.now();
    try {
      const resp = await fetch(`${CF_BASE}/__down?bytes=0&s=${seed()}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      let rtt = performance.now() - t0;
      // Subtract server processing time when Cloudflare exposes it.
      const st = resp.headers.get('server-timing');
      if (st) {
        const m = /cfRequestDuration;dur=([\d.]+)/.exec(st);
        if (m) rtt = Math.max(0, rtt - parseFloat(m[1]));
      }
      await resp.arrayBuffer().catch(() => undefined);
      return rtt;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', onAbort);
    }
  }

  private async measureLatency(
    onTick: (value: number, frac: number) => void,
  ): Promise<LatencyResult> {
    const samples: number[] = [];
    let failures = 0;
    const total = this.cfg.latencyProbes;
    for (let i = 0; i < total; i++) {
      if (this.stopped) break;
      const rtt = await this.probe();
      if (rtt == null) failures++;
      else {
        samples.push(rtt);
        onTick(round(rtt, 1), (i + 1) / total);
        this.emit('latency', partialLatency(samples, failures, i + 1));
      }
      await sleep(15);
    }
    return finalizeLatency(samples, failures, total);
  }

  // Lightweight probe used to sample latency *while the link is saturated*.
  private async loadedProbe(into: number[]): Promise<void> {
    const rtt = await this.probe();
    if (rtt != null) into.push(rtt);
  }

  // ---- Throughput (download & upload) -------------------------------

  private async measureThroughput(
    kind: 'download' | 'upload',
    loadedLatencyInto: number[] | null,
    onTick: (value: number, frac: number) => void,
  ): Promise<ThroughputResult> {
    const streams = kind === 'download' ? this.cfg.downloadStreams : this.cfg.uploadStreams;
    const start = performance.now();
    const samples: ThroughputSample[] = [];
    let totalBytes = 0;
    let peak = 0;
    let lastBytes = 0;
    let lastT = start;
    let stable = false;
    const recent: number[] = [];

    // Per-phase abort cuts in-flight requests the instant the phase ends, so a
    // large chunk on a slow link can't drag the tail past the deadline.
    const phaseCtrl = new AbortController();
    const onMasterAbort = () => phaseCtrl.abort();
    this.abort.signal.addEventListener('abort', onMasterAbort);

    const done = () => {
      const elapsed = performance.now() - start;
      return (
        this.stopped ||
        elapsed >= this.cfg.maxPhaseMs ||
        (elapsed >= this.cfg.minPhaseMs && (stable || totalBytes >= this.cfg.byteBudget))
      );
    };

    // Sliding-window ticker → instantaneous speed for the gauge, stability
    // detection for the early exit, and the phase kill-switch.
    const ticker = setInterval(() => {
      const now = performance.now();
      const dt = now - lastT;
      if (dt < 90) return;
      const inst = ((totalBytes - lastBytes) * 8) / (dt / 1000) / 1e6;
      lastBytes = totalBytes;
      lastT = now;
      if (inst > peak) peak = inst;
      const elapsed = now - start;
      if (elapsed > 250) samples.push({ t: Math.round(elapsed), mbps: round(inst, 2) });

      // Once the post-warmup rate stops moving, more time adds nothing but
      // data use — ending here is what makes the test feel instant.
      if (elapsed > this.cfg.warmupMs && inst > 0) {
        recent.push(inst);
        if (recent.length > this.cfg.stableWindow) recent.shift();
        if (recent.length === this.cfg.stableWindow) {
          const m = mean(recent);
          const sd = Math.sqrt(mean(recent.map((v) => (v - m) ** 2)));
          if (m > 0 && sd / m < this.cfg.stableCv) stable = true;
        }
      }

      const frac = Math.min(
        0.99,
        Math.max(
          elapsed / this.cfg.maxPhaseMs,
          totalBytes / this.cfg.byteBudget,
        ),
      );
      onTick(round(inst, 1), frac);
      if (done()) phaseCtrl.abort();
    }, 120);

    // Bufferbloat sampler runs a few probes during saturation.
    let loadedTimer: ReturnType<typeof setInterval> | null = null;
    if (loadedLatencyInto) {
      loadedTimer = setInterval(() => {
        if (performance.now() - start > this.cfg.warmupMs) {
          void this.loadedProbe(loadedLatencyInto);
        }
      }, 550);
    }

    // Bytes are counted as they stream in, not when a request finishes — so the
    // sampling ticker sees real-time throughput instead of a flat line + spikes.
    const addBytes = (n: number) => {
      totalBytes += n;
    };
    const worker = async (): Promise<void> => {
      while (!done() && !phaseCtrl.signal.aborted) {
        try {
          if (kind === 'download') await this.downloadOnce(addBytes, phaseCtrl.signal);
          else await this.uploadOnce(addBytes, phaseCtrl.signal);
        } catch {
          if (phaseCtrl.signal.aborted || this.stopped) break;
          await sleep(150); // transient network error — brief backoff, then retry
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: streams }, () => worker()));
    } finally {
      clearInterval(ticker);
      if (loadedTimer) clearInterval(loadedTimer);
      phaseCtrl.abort();
      this.abort.signal.removeEventListener('abort', onMasterAbort);
    }

    // Headline throughput = stable window (post-warmup) average.
    const steadyWindow = samples.filter((s) => s.t >= this.cfg.warmupMs);
    const durationMs = performance.now() - start;
    let mbps: number;
    if (steadyWindow.length >= 3) {
      // Trimmed mean of the stable window resists spikes/dips.
      const vals = steadyWindow.map((s) => s.mbps).sort((a, b) => a - b);
      const lo = Math.floor(vals.length * 0.1);
      const hi = Math.ceil(vals.length * 0.9);
      const mid = vals.slice(lo, hi);
      mbps = mid.reduce((a, b) => a + b, 0) / mid.length;
    } else {
      const effective = Math.max(1, durationMs - this.cfg.warmupMs);
      mbps = (totalBytes * 8) / (effective / 1000) / 1e6;
    }

    return {
      mbps: round(mbps, 2),
      peak: round(peak, 2),
      bytes: totalBytes,
      durationMs: Math.round(durationMs),
      samples,
    };
  }

  private async downloadOnce(onBytes: (n: number) => void, signal: AbortSignal): Promise<void> {
    const url = `${CF_BASE}/__down?bytes=${this.cfg.downloadChunk}&s=${seed()}`;
    const resp = await fetch(url, { cache: 'no-store', signal });
    const body = resp.body;
    if (!body) {
      const buf = await resp.arrayBuffer();
      onBytes(buf.byteLength);
      return;
    }
    // Aborting `signal` rejects the pending read, which ends the request promptly.
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onBytes(value.length);
    }
  }

  private uploadOnce(onBytes: (n: number) => void, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${CF_BASE}/__up?s=${seed()}`, true);
      xhr.responseType = 'text';
      let prev = 0;
      // Report each increment as bytes leave the machine → real-time upload rate.
      xhr.upload.onprogress = (e) => {
        const delta = e.loaded - prev;
        prev = e.loaded;
        if (delta > 0) onBytes(delta);
      };
      const onAbort = () => xhr.abort();
      signal.addEventListener('abort', onAbort);
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      xhr.onload = () => {
        cleanup();
        resolve();
      };
      xhr.onerror = () => {
        cleanup();
        resolve(); // Count what we sent rather than failing the whole phase.
      };
      xhr.onabort = () => {
        cleanup();
        resolve();
      };
      try {
        xhr.send(this.uploadBlob);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }
}

// ---- helpers ---------------------------------------------------------

function partialLatency(samples: number[], failures: number, count: number): Partial<LatencyResult> {
  return {
    ping: round(Math.min(...samples), 1),
    avg: round(mean(samples), 1),
    jitter: round(jitterOf(samples), 1),
    loss: round((failures / count) * 100, 1),
  };
}

function finalizeLatency(samples: number[], failures: number, total: number): LatencyResult {
  if (!samples.length) {
    return { ping: 0, avg: 0, jitter: 0, loss: round((failures / total) * 100, 1), samples: [] };
  }
  return {
    ping: round(Math.min(...samples), 1),
    avg: round(mean(samples), 1),
    jitter: round(jitterOf(samples), 1),
    loss: round((failures / total) * 100, 1),
    samples,
  };
}

function jitterOf(samples: number[]): number {
  if (samples.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < samples.length; i++) sum += Math.abs(samples[i] - samples[i - 1]);
  return sum / (samples.length - 1);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cache-busting seed; combines time + randomness. */
function seed(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function cryptoId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}
