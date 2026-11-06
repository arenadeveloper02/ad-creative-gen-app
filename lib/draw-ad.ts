import { readTextStyle, type TextBox } from '@/lib/ad-layout';
import { finishChangesPhoto, paintFinishedPhoto } from '@/lib/image-finish';
import { fitInside, logoSlot, type ZoneRect } from '@/lib/ad-zones';
import type { Layout } from '@/lib/platforms';
import type { VersionDTO } from '@/lib/types';

function typeFace(bold: boolean, italic: boolean, sizePx: number, family?: string | null): string {
  const style = italic ? 'italic' : 'normal';
  const weight = bold ? '700' : '400';
  const safe = family?.replace(/["']/g, '').trim();
  const face = safe ? `"${safe}", Arial, sans-serif` : 'Arial, sans-serif';
  return `${style} ${weight} ${Math.max(8, Math.round(sizePx))}px ${face}`;
}

export function sharedInk(bg: string, c1: string, c3: string): string {
  return bg === 'light' ? c1 : c3;
}

export function sharedCtaFill(bg: string, c1: string, c3: string): string {
  return bg === 'light' || bg === 'photo' ? c1 : c3;
}

export function sharedCtaInk(bg: string, c1: string, c3: string): string {
  if (bg === 'light') return '#FFFFFF';
  if (bg === 'photo') return c3;
  return c1;
}

function applyTrack(ctx: CanvasRenderingContext2D, trackEm: number, sizePx: number): void {
  const spacing = `${Math.max(0, trackEm) * sizePx}px`;
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
  } catch {
    // Older engines ignore letterSpacing; size and weight still apply.
  }
}

export interface DrawAdOptions {
  /** Brand mark composited on the canvas so its bounds are known and text can clear it. */
  logo?: HTMLImageElement | null;
  /** Loaded Brief font family name for on-ad type. */
  fontFamily?: string | null;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hexToRgb(hex: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number, fallback: [number, number, number] = [12, 16, 28]): string {
  const [r, g, b] = hexToRgb(hex, fallback);
  return `rgba(${r},${g},${b},${alpha})`;
}

function coverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  zoom = 1,
  focusX = 0.5,
  focusY = 0.5,
): void {
  const z = Math.min(2, Math.max(1, zoom || 1));
  const fx = Math.min(1, Math.max(0, focusX));
  const fy = Math.min(1, Math.max(0, focusY));
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * z;
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  let dx = width / 2 - fx * dw;
  let dy = height / 2 - fy * dh;
  dx = Math.min(0, Math.max(width - dw, dx));
  dy = Math.min(0, Math.max(height - dh, dy));
  ctx.drawImage(image, dx, dy, dw, dh);
}

function widest(ctx: CanvasRenderingContext2D, lines: string[]): number {
  let max = 0;
  for (const line of lines) max = Math.max(max, ctx.measureText(line).width);
  return max;
}

function overlaps(a: ZoneRect, b: ZoneRect, gap: number): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

function clampBox(box: ZoneRect, width: number, height: number): void {
  box.w = Math.min(box.w, width);
  box.h = Math.min(box.h, height);
  box.x = Math.min(width - box.w, Math.max(0, box.x));
  box.y = Math.min(height - box.h, Math.max(0, box.y));
}

/**
 * Settles movable text boxes so none overlap each other or any fixed obstacle
 * (brand label, logo). Prefers the nearest free spot; if the canvas is crowded,
 * packs the stack into the clearest vertical band that still clears obstacles.
 */
function resolveCollisions(boxes: TextBox[], fixed: ZoneRect[], width: number, height: number, gap: number): void {
  const settled: ZoneRect[] = [...fixed];
  const free = (r: ZoneRect) =>
    r.x >= 0 && r.y >= 0 && r.x + r.w <= width + 0.5 && r.y + r.h <= height + 0.5
    && !settled.some((o) => overlaps(r, o, gap));

  for (const box of boxes) {
    clampBox(box, width, height);
    if (free(box)) {
      settled.push(box);
      continue;
    }

    const candidates: ZoneRect[] = [];
    for (const o of settled) {
      candidates.push({ ...box, y: o.y + o.h + gap });
      candidates.push({ ...box, y: o.y - gap - box.h });
      candidates.push({ ...box, x: o.x + o.w + gap, y: o.y });
      candidates.push({ ...box, x: o.x - gap - box.w, y: o.y });
      candidates.push({ ...box, x: o.x + o.w + gap });
      candidates.push({ ...box, x: o.x - gap - box.w });
    }
    for (const a of settled) {
      for (const b of settled) {
        if (a === b) continue;
        candidates.push({ ...box, y: a.y + a.h + gap, x: b.x + b.w + gap });
        candidates.push({ ...box, y: a.y + a.h + gap, x: Math.max(0, b.x - gap - box.w) });
      }
    }
    // Light scan across the frame for a free slot when corner nudges are not enough.
    const stepY = Math.max(8, Math.round(height * 0.04));
    const stepX = Math.max(8, Math.round(width * 0.05));
    for (let y = 0; y <= height - box.h; y += stepY) {
      for (let x of [0, Math.max(0, (width - box.w) / 2), Math.max(0, width - box.w)]) {
        candidates.push({ ...box, x, y });
      }
      for (let x = 0; x <= width - box.w; x += stepX) {
        candidates.push({ ...box, x, y });
      }
    }

    const ok = candidates.map((c) => {
      const next = { ...c };
      clampBox(next, width, height);
      return next;
    }).filter(free);

    const dist = (r: ZoneRect) => Math.hypot(r.x - box.x, r.y - box.y) + (Math.abs(r.x - box.x) > 1 ? width * 0.12 : 0);
    ok.sort((a, b) => dist(a) - dist(b));
    const best = ok[0];
    if (best) {
      box.x = best.x;
      box.y = best.y;
    } else {
      // Last resort: sit just below the lowest fixed obstacle that collides, still in bounds.
      clampBox(box, width, height);
      const blockers = [...fixed, ...settled.filter((s) => s !== box)].filter((o) => overlaps(box, o, gap));
      if (blockers.length) {
        const bottom = Math.max(...blockers.map((o) => o.y + o.h));
        box.y = Math.min(height - box.h, bottom + gap);
        clampBox(box, width, height);
        if (!free(box)) {
          box.x = Math.min(width - box.w, Math.max(0, box.x === 0 ? 0 : width - box.w));
          clampBox(box, width, height);
        }
      }
    }
    settled.push(box);
  }
}

function logoReady(logo: HTMLImageElement | null | undefined): logo is HTMLImageElement {
  return !!logo && logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0;
}

/**
 * Draws one ad version. Text is painted, never inserted as HTML. The generated Fal image, when loaded, is the backdrop.
 * The brand logo (when provided) is composited in a fixed layout slot so copy can never sit on it.
 *
 * Background templates, each driven by the three colour chips:
 *   photo    – the picture with a neutral shade. c1 = CTA button, c2 = accent bar, c3 = text.
 *   gradient – the picture tinted c1 → c2. c3 = text and CTA button.
 *   solid    – a solid c1 panel behind the text. c2 = accent bar, c3 = text and CTA button.
 *   light    – a white panel behind the text. c1 = text and CTA button, c2 = accent bar.
 *
 * Returns the boxes of the painted headline, subline, and CTA in canvas pixels so the editor can place drag handles exactly.
 */
export function drawAd(
  canvas: HTMLCanvasElement,
  version: VersionDTO,
  brand: string,
  image?: HTMLImageElement | null,
  options?: DrawAdOptions,
): TextBox[] {
  const [width, height] = version.size.split('x').map((n) => Number(n));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return [];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const pad = Math.round(width * 0.08);
  const maxW = width - pad * 2;
  const hasImage = !!image && image.complete && image.naturalWidth > 0;
  const bg = version.bg;
  const layout = version.layout as Layout;
  const { c1, c2, c3 } = version;
  const logo = logoReady(options?.logo) ? options.logo : null;
  const fontFamily = options?.fontFamily?.trim() || null;
  const imageZoom = typeof version.imageZoom === 'number' && Number.isFinite(version.imageZoom) ? version.imageZoom : 1;
  const focusX = version.imageFocusX != null ? version.imageFocusX : 0.5;
  const focusY = version.imageFocusY != null ? version.imageFocusY : 0.5;

  // Backdrop.
  if (hasImage) {
    if (finishChangesPhoto(version.imageFinish)) paintFinishedPhoto(ctx, image, width, height, version);
    else coverImage(ctx, image, width, height, imageZoom, focusX, focusY);
    if (bg === 'gradient') {
      const tint = layout === 'bottom'
        ? ctx.createLinearGradient(0, height * 0.3, 0, height)
        : layout === 'center'
          ? ctx.createRadialGradient(width / 2, height / 2, width * 0.05, width / 2, height / 2, width * 0.75)
          : ctx.createLinearGradient(0, 0, width, 0);
      tint.addColorStop(0, rgba(c1, layout === 'bottom' ? 0 : 0.86));
      tint.addColorStop(1, rgba(c2, layout === 'bottom' ? 0.88 : 0.18));
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
    } else if (bg === 'photo') {
      const scrim = layout === 'bottom'
        ? ctx.createLinearGradient(0, height * 0.45, 0, height)
        : layout === 'center'
          ? ctx.createRadialGradient(width / 2, height / 2, width * 0.1, width / 2, height / 2, width * 0.7)
          : ctx.createLinearGradient(0, 0, width, 0);
      scrim.addColorStop(0, `rgba(12,16,28,${layout === 'bottom' ? 0 : 0.42})`);
      scrim.addColorStop(1, `rgba(12,16,28,${layout === 'bottom' ? 0.55 : layout === 'center' ? 0.12 : 0.05})`);
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = 'rgba(12,16,28,0.08)';
      ctx.fillRect(0, 0, width, height);
    }
  } else {
    if (bg === 'gradient' || bg === 'photo') {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, c1);
      gradient.addColorStop(1, c2);
      ctx.fillStyle = gradient;
    } else if (bg === 'solid') {
      ctx.fillStyle = c1;
    } else {
      ctx.fillStyle = '#F4F7FB';
    }
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = bg === 'light' ? 0.1 : 0.16;
    ctx.fillStyle = bg === 'light' ? c2 : c3;
    ctx.beginPath();
    ctx.arc(width * 0.86, height * 0.14, width * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(width * 0.1, height * 0.92, width * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Brand mark — Brief-selected logo only. Default slot, or user-dragged logoX/logoY.
  const slot = logoSlot(layout, width, height);
  let logoBox: ZoneRect | null = null;
  if (logo) {
    const fitted = fitInside(slot, logo.naturalWidth, logo.naturalHeight);
    if (fitted.w > 0 && fitted.h > 0) {
      const x = version.logoX != null
        ? Math.min(width - fitted.w, Math.max(0, version.logoX * width))
        : fitted.x;
      const y = version.logoY != null
        ? Math.min(height - fitted.h, Math.max(0, version.logoY * height))
        : fitted.y;
      logoBox = { x, y, w: fitted.w, h: fitted.h };
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(logo, logoBox.x, logoBox.y, logoBox.w, logoBox.h);
      ctx.restore();
    }
  }

  // Colour roles per template.
  const ink = sharedInk(bg, c1, c3);
  const ctaFill = sharedCtaFill(bg, c1, c3);
  const ctaInk = version.ctaColor || sharedCtaInk(bg, c1, c3);
  const headlineInk = version.headlineColor || ink;
  const subInk = version.subColor || ink;
  const accent = c2;

  // Measure every visible block first so the stack is aligned from real text sizes.
  const showHeadline = version.showHeadline !== false && version.headline.trim() !== '';
  const showSub = version.showSub !== false && version.sub.trim() !== '';
  const showCta = version.showCta !== false && version.cta.trim() !== '';
  const headStyle = readTextStyle(version, 'headline');
  const subStyle = readTextStyle(version, 'sub');
  const ctaStyle = readTextStyle(version, 'cta');

  const hSize = Math.round(width * (layout === 'bottom' ? 0.085 : 0.098) * headStyle.scale);
  const sSize = Math.round(width * 0.042 * subStyle.scale);
  const cSize = Math.round(width * 0.036 * ctaStyle.scale);
  const hLead = hSize * 1.12 * headStyle.lead;
  const sLead = sSize * 1.3 * subStyle.lead;
  const gapHS = hSize * 0.3;
  const gapCta = width * 0.045;
  const barH = Math.max(4, Math.round(width * 0.008));
  const barGap = Math.round(width * 0.03);

  // When a logo occupies the right side, keep the default text column from undercutting it.
  const textMaxW = logoBox && layout === 'left'
    ? Math.min(maxW, Math.max(width * 0.4, logoBox.x - pad - Math.round(width * 0.03)))
    : maxW;

  ctx.font = typeFace(headStyle.bold, headStyle.italic, hSize, fontFamily);
  applyTrack(ctx, headStyle.track, hSize);
  const hLines = showHeadline ? wrap(ctx, version.headline.trim(), textMaxW).slice(0, 4) : [];
  const hW = Math.min(textMaxW, widest(ctx, hLines));
  const hH = hLines.length * hLead;

  ctx.font = typeFace(subStyle.bold, subStyle.italic, sSize, fontFamily);
  applyTrack(ctx, subStyle.track, sSize);
  const sLines = showSub ? wrap(ctx, version.sub.trim(), textMaxW).slice(0, 3) : [];
  const sW = Math.min(textMaxW, widest(ctx, sLines));
  const sH = sLines.length * sLead;

  ctx.font = typeFace(ctaStyle.bold, ctaStyle.italic, cSize, fontFamily);
  applyTrack(ctx, ctaStyle.track, cSize);
  const ctaText = version.cta.trim();
  const ctaW = showCta ? Math.min(textMaxW, ctx.measureText(ctaText).width + width * 0.09 * ctaStyle.scale) : 0;
  const ctaH = showCta ? width * 0.095 * Math.max(ctaStyle.scale, ctaStyle.lead * 0.85) : 0;

  const blockH = (showHeadline ? hH : 0)
    + (showSub ? (showHeadline ? gapHS : 0) + sH : 0)
    + (showCta ? ((showHeadline || showSub) ? gapCta : 0) + ctaH : 0);

  let flowY: number;
  if (layout === 'center') flowY = (height - blockH) / 2;
  else if (layout === 'bottom') flowY = height - pad - blockH - Math.round(width * 0.06);
  else flowY = Math.max(pad * 2, height * 0.42 - hSize);

  // Keep the default center stack above a bottom-right logo.
  if (logoBox && layout === 'center') {
    const logoTop = logoBox.y - Math.round(height * 0.02);
    if (flowY + blockH > logoTop) {
      flowY = Math.max(pad * 2, logoTop - blockH);
    }
  }

  const centered = layout === 'center';
  let cursorY = flowY;

  // Each block uses its saved spot when the user has dragged it; otherwise it follows the stack.
  const place = (saved: { x: number | null; y: number | null }, w: number, h: number): { x: number; y: number; moved: boolean } => {
    const moved = saved.x != null || saved.y != null;
    const defaultX = centered ? (width - w) / 2 : pad;
    const x = saved.x != null ? Math.min(width - w, Math.max(0, saved.x * width)) : defaultX;
    const y = saved.y != null ? Math.min(height - h, Math.max(0, saved.y * height)) : cursorY;
    return { x, y, moved };
  };

  const headSpot = showHeadline ? place({ x: version.headlineX, y: version.headlineY }, hW, hH) : null;
  if (headSpot && !headSpot.moved) cursorY = headSpot.y + hH + (showSub ? gapHS : showCta ? gapCta : 0);
  const subSpot = showSub ? place({ x: version.subX, y: version.subY }, sW, sH) : null;
  if (subSpot && !subSpot.moved) cursorY = subSpot.y + sH + (showCta ? gapCta : 0);
  const ctaSpot = showCta ? place({ x: version.ctaX, y: version.ctaY }, ctaW, ctaH) : null;

  const boxes: TextBox[] = [];
  if (headSpot) boxes.push({ kind: 'headline', x: headSpot.x, y: headSpot.y, w: hW, h: hH });
  if (subSpot) boxes.push({ kind: 'sub', x: subSpot.x, y: subSpot.y, w: sW, h: sH });
  if (ctaSpot) boxes.push({ kind: 'cta', x: ctaSpot.x, y: ctaSpot.y, w: ctaW, h: ctaH });

  // Brand label in the top-left is a fixed obstacle; logo slot is too when present.
  const labelSize = Math.round(width * 0.032);
  const labelFont = fontFamily ? typeFace(true, false, labelSize, fontFamily) : `600 ${labelSize}px Arial`;
  ctx.font = labelFont;
  const labelText = (brand || 'Your brand').toUpperCase().slice(0, 40);
  const labelBox: ZoneRect = { x: pad, y: pad - labelSize * 0.2, w: ctx.measureText(labelText).width, h: labelSize * 1.4 };
  const fixed: ZoneRect[] = [labelBox];
  if (logoBox) fixed.push(logoBox);

  const collideGap = Math.round(width * 0.02);
  if (boxes.length > 0) {
    const first = boxes[0];
    const grown: TextBox = { ...first, y: first.y - barGap - barH, h: first.h + barGap + barH };
    resolveCollisions([grown, ...boxes.slice(1)], fixed, width, height, collideGap);
    first.x = grown.x;
    first.y = grown.y + barGap + barH;
  }
  for (const box of boxes) {
    if (box.kind === 'headline' && headSpot) {
      headSpot.x = box.x;
      headSpot.y = box.y;
    } else if (box.kind === 'sub' && subSpot) {
      subSpot.x = box.x;
      subSpot.y = box.y;
    } else if (box.kind === 'cta' && ctaSpot) {
      ctaSpot.x = box.x;
      ctaSpot.y = box.y;
    }
  }

  // Solid and light templates sit the text on a panel over the photo.
  if (hasImage && (bg === 'solid' || bg === 'light') && boxes.length > 0) {
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const inset = Math.round(width * 0.045);
    const px = Math.max(0, minX - inset);
    const py = Math.max(0, minY - inset - barH - barGap);
    const pw = Math.min(width - px, maxX - minX + inset * 2);
    const ph = Math.min(height - py, maxY - minY + inset * 2 + barH + barGap);
    ctx.fillStyle = bg === 'solid' ? rgba(c1, 0.94) : 'rgba(255,255,255,0.94)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, Math.round(width * 0.02));
    ctx.fill();
  } else if (hasImage && layout === 'bottom' && bg === 'photo') {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, flowY - hSize * 0.6, width, blockH + hSize * 1.2);
    ctx.globalAlpha = 1;
  }

  // Brand label.
  ctx.fillStyle = bg === 'light' && hasImage ? '#FFFFFF' : ink;
  ctx.font = labelFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText((brand || 'Your brand').toUpperCase().slice(0, 40), pad, pad + Math.round(width * 0.03));

  // Accent bar above the first block uses c2.
  const first = boxes[0];
  if (first) {
    const barW = Math.round(width * 0.09);
    const barX = centered && !(first.kind === 'headline' ? headSpot?.moved : first.kind === 'sub' ? subSpot?.moved : ctaSpot?.moved)
      ? (width - barW) / 2
      : first.x;
    ctx.fillStyle = accent;
    ctx.fillRect(barX, first.y - barGap - barH, barW, barH);
  }

  if (headSpot) {
    ctx.font = typeFace(headStyle.bold, headStyle.italic, hSize, fontFamily);
    applyTrack(ctx, headStyle.track, hSize);
    ctx.fillStyle = headlineInk;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let y = headSpot.y + hSize * 0.88;
    for (const line of hLines) {
      const lineW = ctx.measureText(line).width;
      const lineX = centered && !headSpot.moved ? headSpot.x + (hW - lineW) / 2 : headSpot.x;
      ctx.fillText(line, lineX, y);
      y += hLead;
    }
  }

  if (subSpot) {
    ctx.font = typeFace(subStyle.bold, subStyle.italic, sSize, fontFamily);
    applyTrack(ctx, subStyle.track, sSize);
    ctx.fillStyle = subInk;
    ctx.globalAlpha = 0.92;
    ctx.textAlign = 'left';
    let y = subSpot.y + sSize * 0.9;
    for (const line of sLines) {
      const lineW = ctx.measureText(line).width;
      const lineX = centered && !subSpot.moved ? subSpot.x + (sW - lineW) / 2 : subSpot.x;
      ctx.fillText(line, lineX, y);
      y += sLead;
    }
    ctx.globalAlpha = 1;
  }

  if (ctaSpot) {
    ctx.font = typeFace(ctaStyle.bold, ctaStyle.italic, cSize, fontFamily);
    applyTrack(ctx, ctaStyle.track, cSize);
    ctx.fillStyle = ctaFill;
    ctx.beginPath();
    ctx.roundRect(ctaSpot.x, ctaSpot.y, ctaW, ctaH, ctaH / 2);
    ctx.fill();
    ctx.fillStyle = ctaInk;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ctaText, ctaSpot.x + ctaW / 2, ctaSpot.y + ctaH / 2 + cSize * 0.04);
    ctx.textBaseline = 'alphabetic';
  }

  // Logo handle last so the UI can drag the same mark the canvas painted.
  if (logoBox) boxes.push({ kind: 'logo', x: logoBox.x, y: logoBox.y, w: logoBox.w, h: logoBox.h });
  return boxes;
}
