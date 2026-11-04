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

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  scale: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clampTextScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.6, Math.max(0.7, Math.round(value * 20) / 20));
}

export function positionPatch(kind: TextKind, x: number, y: number, width: number, height: number): Partial<VersionDTO> {
  const nx = clamp01(x / width);
  const ny = clamp01(y / height);
  if (kind === 'headline') return { headlineX: nx, headlineY: ny };
  if (kind === 'sub') return { subX: nx, subY: ny };
  return { ctaX: nx, ctaY: ny };
}

export function readTextStyle(version: VersionDTO, kind: TextKind): TextStyle {
  if (kind === 'headline') {
    return {
      bold: version.headlineBold !== false,
      italic: version.headlineItalic === true,
      scale: clampTextScale(version.headlineScale ?? 1),
    };
  }
  if (kind === 'sub') {
    return {
      bold: version.subBold === true,
      italic: version.subItalic === true,
      scale: clampTextScale(version.subScale ?? 1),
    };
  }
  return {
    bold: version.ctaBold !== false,
    italic: version.ctaItalic === true,
    scale: clampTextScale(version.ctaScale ?? 1),
  };
}

export function stylePatch(kind: TextKind, style: Partial<TextStyle>): Partial<VersionDTO> {
  if (kind === 'headline') {
    return {
      ...(typeof style.bold === 'boolean' ? { headlineBold: style.bold } : {}),
      ...(typeof style.italic === 'boolean' ? { headlineItalic: style.italic } : {}),
      ...(typeof style.scale === 'number' ? { headlineScale: clampTextScale(style.scale) } : {}),
    };
  }
  if (kind === 'sub') {
    return {
      ...(typeof style.bold === 'boolean' ? { subBold: style.bold } : {}),
      ...(typeof style.italic === 'boolean' ? { subItalic: style.italic } : {}),
      ...(typeof style.scale === 'number' ? { subScale: clampTextScale(style.scale) } : {}),
    };
  }
  return {
    ...(typeof style.bold === 'boolean' ? { ctaBold: style.bold } : {}),
    ...(typeof style.italic === 'boolean' ? { ctaItalic: style.italic } : {}),
    ...(typeof style.scale === 'number' ? { ctaScale: clampTextScale(style.scale) } : {}),
  };
}
