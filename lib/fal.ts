import { isRecord } from '@/lib/json';

// ---------------------------------------------------------------------------
// Fal queue client, same transport as the video agent:
//   submit : POST https://queue.fal.run/<endpoint>
//   status : GET  <status_url>
//   result : GET  <status_url without /status>
// Public functions never throw.
// ---------------------------------------------------------------------------

const QUEUE_BASE = 'https://queue.fal.run';

export function falKey(): string {
  const candidates = [process.env.FAL_KEY, process.env.FAL_API_KEY, process.env.FALAI_API_KEY_1, process.env.FALAI_API_KEY];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return '';
}

export function falConfigError(): string | null {
  return falKey() === '' ? 'FAL_KEY is missing. Add your fal.ai API key to the environment.' : null;
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Key ${falKey()}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

interface HttpResult {
  ok: boolean;
  status: number;
  body: unknown;
}

async function falFetch(url: string, init: RequestInit): Promise<HttpResult> {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  const raw = await res.text();
  let body: unknown = null;
  if (raw !== '') {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = raw;
    }
  }
  if (!res.ok) console.error(`Fal ${init.method ?? 'GET'} ${url} -> HTTP ${res.status}: ${raw.slice(0, 300)}`);
  return { ok: res.ok, status: res.status, body };
}

function readString(data: unknown, keys: string[]): string | null {
  if (!isRecord(data)) return null;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

export function describeFalError(status: number, body: unknown, endpoint: string): string {
  let detail: string | null = null;
  if (isRecord(body)) {
    const d = body.detail;
    if (typeof d === 'string') detail = d;
    else if (Array.isArray(d)) detail = d.map((item) => (isRecord(item) && typeof item.msg === 'string' ? item.msg : String(item))).join('; ');
    else if (isRecord(d) && typeof d.message === 'string') detail = d.message;
    if (detail === null) detail = readString(body, ['error', 'message']);
  } else if (typeof body === 'string' && body.trim() !== '') {
    detail = body.slice(0, 300);
  }
  const base = `Fal ${endpoint} returned HTTP ${status}`;
  if (status === 401 || status === 403) return `${base} — check FAL_KEY.`;
  if (status === 402) return `${base} — fal.ai balance exhausted.`;
  if (status === 429) return `${base} — rate limit reached, try again shortly.`;
  return detail ? `${base}: ${detail}` : `${base}.`;
}

export interface FalRunResult {
  ok: boolean;
  output: unknown;
  requestId: string | null;
  endpointId: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Submit and poll until done. Image jobs finish within the timeout. */
export async function runFalJob(endpoint: string, input: Record<string, unknown>, timeoutMs = 90000): Promise<FalRunResult> {
  const cfg = falConfigError();
  if (cfg) return { ok: false, output: null, requestId: null, endpointId: endpoint, error: cfg };
  try {
    const submit = await falFetch(`${QUEUE_BASE}/${endpoint}`, { method: 'POST', headers: headers(true), body: JSON.stringify(input) });
    if (!submit.ok) {
      return { ok: false, output: null, requestId: null, endpointId: endpoint, error: describeFalError(submit.status, submit.body, endpoint) };
    }
    const requestId = readString(submit.body, ['request_id']);
    const root = endpoint.split('/').slice(0, 2).join('/');
    const statusUrl = readString(submit.body, ['status_url']) ?? `${QUEUE_BASE}/${root}/requests/${encodeURIComponent(requestId ?? '')}/status`;
    if (!requestId) return { ok: false, output: null, requestId: null, endpointId: endpoint, error: `Fal ${endpoint} returned no request id.` };

    const deadline = Date.now() + timeoutMs;
    let wait = 1000;
    while (Date.now() < deadline) {
      await sleep(wait);
      wait = Math.min(3000, wait + 500);
      const state = await falFetch(statusUrl, { method: 'GET', headers: headers(false) });
      if (!state.ok) {
        if (state.status >= 500) continue;
        return { ok: false, output: null, requestId, endpointId: endpoint, error: describeFalError(state.status, state.body, endpoint) };
      }
      const status = (readString(state.body, ['status']) ?? '').toUpperCase();
      if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') continue;
      if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
        return { ok: false, output: state.body, requestId, endpointId: endpoint, error: `Fal reported ${endpoint} as ${status.toLowerCase()}.` };
      }
      if (status !== 'COMPLETED') continue;
      const resultUrl = readString(state.body, ['response_url']) ?? statusUrl.replace(/\/status(\?.*)?$/, '');
      const result = await falFetch(resultUrl, { method: 'GET', headers: headers(false) });
      if (!result.ok) {
        if (result.status >= 500) continue;
        return { ok: false, output: result.body, requestId, endpointId: endpoint, error: describeFalError(result.status, result.body, endpoint) };
      }
      const soft = isRecord(result.body) && typeof result.body.error === 'string' && result.body.error !== '' ? result.body.error : null;
      if (soft) return { ok: false, output: result.body, requestId, endpointId: endpoint, error: soft };
      return { ok: true, output: result.body, requestId, endpointId: endpoint };
    }
    return { ok: false, output: null, requestId, endpointId: endpoint, error: `${endpoint} did not finish in time — try again.` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: null, requestId: null, endpointId: endpoint, error: `Could not reach fal.ai: ${message}` };
  }
}
