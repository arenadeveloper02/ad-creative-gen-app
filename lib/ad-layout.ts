import type { VersionDTO } from '@/lib/types';

export type TextKind = 'headline' | 'sub' | 'cta' | 'logo';

/** A painted block in canvas pixels. Returned by drawAd so handles match the real art. */
export interface TextBox {
  kind: TextKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  scale: number;
  /** Letter spacing as a fraction of font size (0–0.25). */
  track: number;
  /** Line-height multiplier vs the layout default (0.85–1.6). */
  lead: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.6, Math.max(0.7, Math.round(value * 20) / 20));
}

export function clampTextTrack(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.25, Math.max(0, Math.round(value * 100) / 100));
}

export function clampTextLead(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.6, Math.max(0.85, Math.round(value * 20) / 20));
}

export function positionPatch(kind: TextKind, x: number, y: number, width: number, height: number): Partial<VersionDTO> {
  const nx = clamp01(x / width);
  const ny = clamp01(y / height);
  if (kind === 'headline') return { headlineX: nx, headlineY: ny };
  if (kind === 'sub') return { subX: nx, subY: ny };
  if (kind === 'cta') return { ctaX: nx, ctaY: ny };
  return { logoX: nx, logoY: ny };
}

export function readTextStyle(version: VersionDTO, kind: TextKind): TextStyle {
  if (kind === 'headline') {
    return {
      bold: version.headlineBold !== false,
      italic: version.headlineItalic === true,
      scale: clampTextScale(version.headlineScale ?? 1),
      track: clampTextTrack(version.headlineTrack ?? 0),
      lead: clampTextLead(version.headlineLead ?? 1),
    };
  }
  if (kind === 'sub') {
    return {
      bold: version.subBold === true,
      italic: version.subItalic === true,
      scale: clampTextScale(version.subScale ?? 1),
      track: clampTextTrack(version.subTrack ?? 0),
      lead: clampTextLead(version.subLead ?? 1),
    };
  }
  if (kind === 'cta') {
    return {
      bold: version.ctaBold !== false,
      italic: version.ctaItalic === true,
      scale: clampTextScale(version.ctaScale ?? 1),
      track: clampTextTrack(version.ctaTrack ?? 0),
      lead: clampTextLead(version.ctaLead ?? 1),
    };
  }
  return { bold: false, italic: false, scale: 1, track: 0, lead: 1 };
}

export function stylePatch(kind: TextKind, style: Partial<TextStyle>): Partial<VersionDTO> {
  if (kind === 'headline') {
    return {
      ...(typeof style.bold === 'boolean' ? { headlineBold: style.bold } : {}),
      ...(typeof style.italic === 'boolean' ? { headlineItalic: style.italic } : {}),
      ...(typeof style.scale === 'number' ? { headlineScale: clampTextScale(style.scale) } : {}),
      ...(typeof style.track === 'number' ? { headlineTrack: clampTextTrack(style.track) } : {}),
      ...(typeof style.lead === 'number' ? { headlineLead: clampTextLead(style.lead) } : {}),
    };
  }
  if (kind === 'sub') {
    return {
      ...(typeof style.bold === 'boolean' ? { subBold: style.bold } : {}),
      ...(typeof style.italic === 'boolean' ? { subItalic: style.italic } : {}),
      ...(typeof style.scale === 'number' ? { subScale: clampTextScale(style.scale) } : {}),
      ...(typeof style.track === 'number' ? { subTrack: clampTextTrack(style.track) } : {}),
      ...(typeof style.lead === 'number' ? { subLead: clampTextLead(style.lead) } : {}),
    };
  }
  if (kind === 'cta') {
    return {
      ...(typeof style.bold === 'boolean' ? { ctaBold: style.bold } : {}),
      ...(typeof style.italic === 'boolean' ? { ctaItalic: style.italic } : {}),
      ...(typeof style.scale === 'number' ? { ctaScale: clampTextScale(style.scale) } : {}),
      ...(typeof style.track === 'number' ? { ctaTrack: clampTextTrack(style.track) } : {}),
      ...(typeof style.lead === 'number' ? { ctaLead: clampTextLead(style.lead) } : {}),
    };
  }
  return {};
}

export function readTextValue(version: VersionDTO, kind: TextKind): string {
  if (kind === 'headline') return version.headline;
  if (kind === 'sub') return version.sub;
  if (kind === 'cta') return version.cta;
  return '';
}

export function textValuePatch(kind: TextKind, value: string): Partial<VersionDTO> {
  if (kind === 'headline') return { headline: value, showHeadline: true };
  if (kind === 'sub') {
    const patch: Partial<VersionDTO> = { sub: value };
    if (value.trim() !== '') patch.showSub = true;
    return patch;
  }
  if (kind === 'cta') return { cta: value };
  return {};
}

export function textKindLabel(kind: TextKind): string {
  if (kind === 'headline') return 'Headline';
  if (kind === 'sub') return 'Subline';
  if (kind === 'cta') return 'CTA';
  return 'Logo';
}

/**
 * Places a popup of known size so it does not cover the selected text box.
 * Prefers left, then right, then above, then below — all in stage CSS pixels.
 */
export function clearPopupOrigin(
  box: TextBox,
  scaleX: number,
  scaleY: number,
  stageW: number,
  stageH: number,
  popW: number,
  popH: number,
  gap = 14,
): { x: number; y: number } {
  const left = box.x * scaleX;
  const top = box.y * scaleY;
  const right = left + box.w * scaleX;
  const bottom = top + box.h * scaleY;
  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(8, x), Math.max(8, stageW - popW - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, stageH - popH - 8)),
  });

  const candidates = [
    { x: left - popW - gap, y: top }, // left
    { x: right + gap, y: top }, // right
    { x: left, y: top - popH - gap }, // above
    { x: left, y: bottom + gap }, // below
  ];

  for (const spot of candidates) {
    const next = clamp(spot.x, spot.y);
    const overlaps =
      next.x < right + gap
      && next.x + popW > left - gap
      && next.y < bottom + gap
      && next.y + popH > top - gap;
    if (!overlaps) return next;
  }
  // Last resort: park in the top-left of the stage, clear of the box as much as possible.
  return clamp(8, 8);
}
