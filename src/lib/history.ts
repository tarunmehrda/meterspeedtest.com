/** Local, private test history — never leaves the browser (localStorage). */

import type { FullResult } from './speedtest';

const KEY = 'meter:history:v1';
const MAX = 50;

function available(): boolean {
  try {
    const k = '__meter_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function loadHistory(): FullResult[] {
  if (!available()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FullResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResult(r: FullResult): FullResult[] {
  const list = [r, ...loadHistory().filter((x) => x.id !== r.id)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked — history is best-effort */
  }
  return list;
}

export function removeResult(id: string): FullResult[] {
  const list = loadHistory().filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
