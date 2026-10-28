export function readError(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error: unknown }).error;
    if (typeof error === 'string' && error !== '') return error;
  }
  return fallback;
}

export async function readJson(res: Response): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const text = await res.text();
  let data: unknown = null;
  if (text.trim() !== '') {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, error: `The server sent a page instead of data (HTTP ${res.status}). Try again.` };
    }
  }
  if (!res.ok) return { ok: false, error: readError(data, `Request failed (HTTP ${res.status}).`) };
  return { ok: true, data };
}
