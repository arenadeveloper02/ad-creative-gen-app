import type { VersionDTO } from '@/lib/types';

export type TextKind = 'headline' | 'sub' | 'cta';

/** A painted text block in canvas pixels. Returned by drawAd so handles match the real text. */
export interface TextBox {
  kind: TextKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function positionPatch(kind: TextKind, x: number, y: number, width: number, height: number): Partial<VersionDTO> {
  const nx = clamp01(x / width);
  const ny = clamp01(y / height);
  if (kind === 'headline') return { headlineX: nx, headlineY: ny };
  if (kind === 'sub') return { subX: nx, subY: ny };
  return { ctaX: nx, ctaY: ny };
}
