import type { VersionDTO } from '@/lib/types';

export type TextKind = 'headline' | 'sub' | 'cta';

export interface TextBox {
  kind: TextKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

function sizeOf(version: VersionDTO): [number, number] {
  const [width, height] = version.size.split('x').map((n) => Number(n));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return [1080, 1080];
  return [width, height];
}

/** Default pixel boxes for headline, subline, and CTA from the layout preset. */
export function defaultTextBoxes(version: VersionDTO): Record<TextKind, { x: number; y: number; w: number; h: number }> {
  const [width, height] = sizeOf(version);
  const pad = Math.round(width * 0.08);
  const maxW = width - pad * 2;
  const hSize = Math.round(width * (version.layout === 'bottom' ? 0.085 : 0.098));
  const sSize = Math.round(width * 0.042);
  const headline = version.headline.trim();
  const sub = version.sub.trim();
  const hLines = Math.max(1, Math.min(4, Math.ceil(headline.length / 18) || 1));
  const sLines = sub ? Math.max(1, Math.min(3, Math.ceil(sub.length / 28))) : 0;
  const blockH = hLines * hSize * 1.12 + (sLines ? sLines * sSize * 1.3 + hSize * 0.4 : 0);

  let headlineY: number;
  let headlineX = pad;
  if (version.layout === 'center') {
    headlineX = pad;
    headlineY = (height - blockH) / 2;
  } else if (version.layout === 'bottom') {
    headlineY = height - pad - blockH - Math.round(width * 0.14) - hSize;
  } else {
    headlineY = height * 0.42 - hSize;
  }

  const headlineH = hLines * hSize * 1.12;
  const subY = headlineY + headlineH + hSize * 0.2;
  const subH = sLines ? sLines * sSize * 1.3 : sSize * 1.3;
  const cta = version.cta.trim() || 'Learn more';
  const approxTw = Math.min(maxW, Math.max(width * 0.2, cta.length * width * 0.022));
  const bw = approxTw + width * 0.09;
  const bh = width * 0.095;
  const ctaY = (sLines ? subY + subH : headlineY + headlineH) + width * 0.03;
  const ctaX = version.layout === 'center' ? (width - bw) / 2 : pad;

  return {
    headline: { x: headlineX, y: headlineY, w: maxW, h: headlineH },
    sub: { x: headlineX, y: subY, w: maxW, h: subH },
    cta: { x: ctaX, y: ctaY, w: bw, h: bh },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Resolved pixel boxes using saved positions when present. */
export function resolveTextBoxes(version: VersionDTO): TextBox[] {
  const [width, height] = sizeOf(version);
  const defaults = defaultTextBoxes(version);
  const boxes: TextBox[] = [];

  const showHeadline = version.showHeadline !== false;
  const showSub = version.showSub !== false;
  const showCta = version.showCta !== false;

  if (showHeadline && version.headline.trim()) {
    const d = defaults.headline;
    boxes.push({
      kind: 'headline',
      x: version.headlineX != null ? clamp01(version.headlineX) * width : d.x,
      y: version.headlineY != null ? clamp01(version.headlineY) * height : d.y,
      w: d.w,
      h: d.h,
    });
  }
  if (showSub && version.sub.trim()) {
    const d = defaults.sub;
    boxes.push({
      kind: 'sub',
      x: version.subX != null ? clamp01(version.subX) * width : d.x,
      y: version.subY != null ? clamp01(version.subY) * height : d.y,
      w: d.w,
      h: d.h,
    });
  }
  if (showCta && version.cta.trim()) {
    const d = defaults.cta;
    boxes.push({
      kind: 'cta',
      x: version.ctaX != null ? clamp01(version.ctaX) * width : d.x,
      y: version.ctaY != null ? clamp01(version.ctaY) * height : d.y,
      w: d.w,
      h: d.h,
    });
  }
  return boxes;
}

export function positionPatch(kind: TextKind, x: number, y: number, width: number, height: number): Partial<VersionDTO> {
  const nx = clamp01(x / width);
  const ny = clamp01(y / height);
  if (kind === 'headline') return { headlineX: nx, headlineY: ny };
  if (kind === 'sub') return { subX: nx, subY: ny };
  return { ctaX: nx, ctaY: ny };
}
