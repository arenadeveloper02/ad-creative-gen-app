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

  if (hasImage) {
    coverImage(ctx, image, width, height);
    const [r, g, b] = [12, 16, 28];
    const scrim = version.layout === 'bottom'
      ? ctx.createLinearGradient(0, height * 0.45, 0, height)
      : version.layout === 'center'
        ? ctx.createRadialGradient(width / 2, height / 2, width * 0.1, width / 2, height / 2, width * 0.7)
        : ctx.createLinearGradient(0, 0, width, 0);
    scrim.addColorStop(0, `rgba(${r},${g},${b},${version.layout === 'bottom' ? 0 : 0.42})`);
    scrim.addColorStop(1, `rgba(${r},${g},${b},${version.layout === 'bottom' ? 0.55 : version.layout === 'center' ? 0.12 : 0.05})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  } else {
    if (version.bg === 'gradient') {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, version.c1);
      gradient.addColorStop(1, version.c2);
      ctx.fillStyle = gradient;
    } else if (version.bg === 'solid') {
      ctx.fillStyle = version.c1;
    } else {
      ctx.fillStyle = '#F4F7FB';
    }
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = version.bg === 'light' ? 0.1 : 0.16;
    ctx.fillStyle = version.bg === 'light' ? version.c2 : version.c3;
    ctx.beginPath();
    ctx.arc(width * 0.86, height * 0.14, width * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(width * 0.1, height * 0.92, width * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const ink = version.bg === 'light' ? version.c1 : version.c3;
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(width * 0.032)}px Arial`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText((brand || 'Your brand').toUpperCase().slice(0, 40), pad, pad + Math.round(width * 0.03));

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

  if (version.layout === 'bottom' && hasImage) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = version.bg === 'light' ? '#FFFFFF' : '#000000';
    ctx.fillRect(0, flowY - hSize * 0.6, width, blockH + hSize * 1.2);
    ctx.globalAlpha = 1;
  }

  const centered = version.layout === 'center';
  const boxes: TextBox[] = [];
  let cursorY = flowY;

  // Each block uses its saved spot when the user has dragged it; otherwise it follows the stack.
  const place = (saved: { x: number | null; y: number | null }, w: number, h: number): { x: number; y: number; moved: boolean } => {
    const moved = saved.x != null || saved.y != null;
    const defaultX = centered ? (width - w) / 2 : pad;
    const x = saved.x != null ? Math.min(width - w, Math.max(0, saved.x * width)) : defaultX;
    const y = saved.y != null ? Math.min(height - h, Math.max(0, saved.y * height)) : cursorY;
    return { x, y, moved };
  };

  if (showHeadline) {
    const spot = place({ x: version.headlineX, y: version.headlineY }, hW, hH);
    ctx.font = `bold ${hSize}px Arial`;
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let y = spot.y + hSize * 0.88;
    for (const line of hLines) {
      const lineW = ctx.measureText(line).width;
      const lineX = centered && !spot.moved ? spot.x + (hW - lineW) / 2 : spot.x;
      ctx.fillText(line, lineX, y);
      y += hLead;
    }
    boxes.push({ kind: 'headline', x: spot.x, y: spot.y, w: hW, h: hH });
    if (!spot.moved) cursorY = spot.y + hH + (showSub ? gapHS : showCta ? gapCta : 0);
  }

  if (showSub) {
    const spot = place({ x: version.subX, y: version.subY }, sW, sH);
    ctx.font = `${sSize}px Arial`;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.92;
    ctx.textAlign = 'left';
    let y = spot.y + sSize * 0.9;
    for (const line of sLines) {
      const lineW = ctx.measureText(line).width;
      const lineX = centered && !spot.moved ? spot.x + (sW - lineW) / 2 : spot.x;
      ctx.fillText(line, lineX, y);
      y += sLead;
    }
    ctx.globalAlpha = 1;
    boxes.push({ kind: 'sub', x: spot.x, y: spot.y, w: sW, h: sH });
    if (!spot.moved) cursorY = spot.y + sH + (showCta ? gapCta : 0);
  }

  if (showCta) {
    const spot = place({ x: version.ctaX, y: version.ctaY }, ctaW, ctaH);
    ctx.font = `600 ${cSize}px Arial`;
    ctx.fillStyle = version.bg === 'light' ? version.c1 : version.c3;
    ctx.beginPath();
    ctx.roundRect(spot.x, spot.y, ctaW, ctaH, ctaH / 2);
    ctx.fill();
    ctx.fillStyle = version.bg === 'light' ? '#FFFFFF' : version.c1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ctaText, spot.x + ctaW / 2, spot.y + ctaH / 2 + cSize * 0.04);
    ctx.textBaseline = 'alphabetic';
    boxes.push({ kind: 'cta', x: spot.x, y: spot.y, w: ctaW, h: ctaH });
  }

  return boxes;
}
