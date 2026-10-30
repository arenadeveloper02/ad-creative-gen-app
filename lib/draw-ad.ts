import type { TextBox } from '@/lib/ad-layout';
import type { VersionDTO } from '@/lib/types';

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

function coverImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function widest(ctx: CanvasRenderingContext2D, lines: string[]): number {
  let max = 0;
  for (const line of lines) max = Math.max(max, ctx.measureText(line).width);
  return max;
}

/**
 * Draws one ad version. Text is painted, never inserted as HTML. The generated Fal image, when loaded, is the backdrop.
 *
 * Background templates, each driven by the three colour chips:
 *   photo    – the picture with a neutral shade. c1 = CTA button, c2 = accent bar, c3 = text.
 *   gradient – the picture tinted c1 → c2. c3 = text and CTA button.
 *   solid    – a solid c1 panel behind the text. c2 = accent bar, c3 = text and CTA button.
 *   light    – a white panel behind the text. c1 = text and CTA button, c2 = accent bar.
 *
 * Returns the boxes of the painted headline, subline, and CTA in canvas pixels so the editor can place drag handles exactly.
 */
export function drawAd(canvas: HTMLCanvasElement, version: VersionDTO, brand: string, image?: HTMLImageElement | null): TextBox[] {
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
  const { c1, c2, c3 } = version;

  // Backdrop.
  if (hasImage) {
    coverImage(ctx, image, width, height);
    if (bg === 'gradient') {
      const tint = version.layout === 'bottom'
        ? ctx.createLinearGradient(0, height * 0.3, 0, height)
        : version.layout === 'center'
          ? ctx.createRadialGradient(width / 2, height / 2, width * 0.05, width / 2, height / 2, width * 0.75)
          : ctx.createLinearGradient(0, 0, width, 0);
      tint.addColorStop(0, rgba(c1, version.layout === 'bottom' ? 0 : 0.86));
      tint.addColorStop(1, rgba(c2, version.layout === 'bottom' ? 0.88 : 0.18));
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, width, height);
    } else if (bg === 'photo') {
      const scrim = version.layout === 'bottom'
        ? ctx.createLinearGradient(0, height * 0.45, 0, height)
        : version.layout === 'center'
          ? ctx.createRadialGradient(width / 2, height / 2, width * 0.1, width / 2, height / 2, width * 0.7)
          : ctx.createLinearGradient(0, 0, width, 0);
      scrim.addColorStop(0, `rgba(12,16,28,${version.layout === 'bottom' ? 0 : 0.42})`);
      scrim.addColorStop(1, `rgba(12,16,28,${version.layout === 'bottom' ? 0.55 : version.layout === 'center' ? 0.12 : 0.05})`);
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, width, height);
    } else {
      // Solid and light draw a panel behind the text later; keep the photo clean here.
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

  // Colour roles per template.
  const ink = bg === 'light' ? c1 : c3;
  const ctaFill = bg === 'light' ? c1 : bg === 'photo' ? c1 : c3;
  const ctaInk = bg === 'light' ? '#FFFFFF' : bg === 'photo' ? c3 : c1;
  const accent = c2;

  // Measure every visible block first so the stack is aligned from real text sizes.
  const showHeadline = version.showHeadline !== false && version.headline.trim() !== '';
  const showSub = version.showSub !== false && version.sub.trim() !== '';
  const showCta = version.showCta !== false && version.cta.trim() !== '';

  const hSize = Math.round(width * (version.layout === 'bottom' ? 0.085 : 0.098));
  const sSize = Math.round(width * 0.042);
  const cSize = Math.round(width * 0.036);
  const hLead = hSize * 1.12;
  const sLead = sSize * 1.3;
  const gapHS = hSize * 0.3;
  const gapCta = width * 0.045;
  const barH = Math.max(4, Math.round(width * 0.008));
  const barGap = Math.round(width * 0.03);

  ctx.font = `bold ${hSize}px Arial`;
  const hLines = showHeadline ? wrap(ctx, version.headline.trim(), maxW).slice(0, 4) : [];
  const hW = Math.min(maxW, widest(ctx, hLines));
  const hH = hLines.length * hLead;

  ctx.font = `${sSize}px Arial`;
  const sLines = showSub ? wrap(ctx, version.sub.trim(), maxW).slice(0, 3) : [];
  const sW = Math.min(maxW, widest(ctx, sLines));
  const sH = sLines.length * sLead;

  ctx.font = `600 ${cSize}px Arial`;
  const ctaText = version.cta.trim();
  const ctaW = showCta ? Math.min(maxW, ctx.measureText(ctaText).width + width * 0.09) : 0;
  const ctaH = showCta ? width * 0.095 : 0;

  const blockH = (showHeadline ? hH : 0)
    + (showSub ? (showHeadline ? gapHS : 0) + sH : 0)
    + (showCta ? ((showHeadline || showSub) ? gapCta : 0) + ctaH : 0);

  let flowY: number;
  if (version.layout === 'center') flowY = (height - blockH) / 2;
  else if (version.layout === 'bottom') flowY = height - pad - blockH - Math.round(width * 0.06);
  else flowY = Math.max(pad * 2, height * 0.42 - hSize);

  const centered = version.layout === 'center';
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
  } else if (hasImage && version.layout === 'bottom' && bg === 'photo') {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, flowY - hSize * 0.6, width, blockH + hSize * 1.2);
    ctx.globalAlpha = 1;
  }

  // Brand label.
  ctx.fillStyle = bg === 'light' && hasImage ? '#FFFFFF' : ink;
  ctx.font = `600 ${Math.round(width * 0.032)}px Arial`;
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
    ctx.font = `bold ${hSize}px Arial`;
    ctx.fillStyle = ink;
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
    ctx.font = `${sSize}px Arial`;
    ctx.fillStyle = ink;
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
    ctx.font = `600 ${cSize}px Arial`;
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

  return boxes;
}
