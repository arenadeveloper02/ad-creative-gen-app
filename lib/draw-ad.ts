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

/** Draws one ad version. Text is painted, never inserted as HTML. */
export function drawAd(canvas: HTMLCanvasElement, version: VersionDTO, brand: string): void {
  const [width, height] = version.size.split('x').map((n) => Number(n));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pad = Math.round(width * 0.08);
  const maxW = width - pad * 2;

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

  const ink = version.bg === 'light' ? version.c1 : version.c3;
  ctx.fillStyle = ink;
  ctx.font = `600 ${Math.round(width * 0.032)}px Arial`;
  ctx.textAlign = 'left';
  ctx.fillText((brand || 'Your brand').toUpperCase().slice(0, 40), pad, pad + Math.round(width * 0.03));

  const hSize = Math.round(width * (version.layout === 'bottom' ? 0.085 : 0.098));
  const sSize = Math.round(width * 0.042);
  ctx.font = `bold ${hSize}px Arial`;
  const hLines = wrap(ctx, version.headline || 'Headline', maxW).slice(0, 4);
  const sLines = wrap(ctx, version.sub || '', maxW).slice(0, 3);
  const blockH = hLines.length * hSize * 1.12 + (sLines.length ? sLines.length * sSize * 1.3 + hSize * 0.4 : 0);

  let y: number;
  let x = pad;
  if (version.layout === 'center') {
    ctx.textAlign = 'center';
    x = width / 2;
    y = (height - blockH) / 2 + hSize;
  } else if (version.layout === 'bottom') {
    y = height - pad - blockH - Math.round(width * 0.14);
  } else {
    y = height * 0.42;
  }

  if (version.layout === 'bottom') {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = version.bg === 'light' ? '#FFFFFF' : '#000000';
    ctx.fillRect(0, y - hSize * 1.3, width, blockH + Math.round(width * 0.22));
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = ink;
  ctx.font = `bold ${hSize}px Arial`;
  for (const line of hLines) {
    ctx.fillText(line, x, y);
    y += hSize * 1.12;
  }
  if (sLines.length) {
    y += hSize * 0.2;
    ctx.font = `${sSize}px Arial`;
    ctx.globalAlpha = 0.9;
    for (const line of sLines) {
      ctx.fillText(line, x, y);
      y += sSize * 1.3;
    }
    ctx.globalAlpha = 1;
  }

  const cta = version.cta || 'Learn more';
  ctx.font = `600 ${Math.round(width * 0.036)}px Arial`;
  const tw = ctx.measureText(cta).width;
  const bw = tw + width * 0.09;
  const bh = width * 0.095;
  const bx = version.layout === 'center' ? (width - bw) / 2 : pad;
  const by = y + width * 0.03;
  ctx.fillStyle = version.bg === 'light' ? version.c1 : version.c3;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = version.bg === 'light' ? '#FFFFFF' : version.c1;
  ctx.textAlign = 'center';
  ctx.fillText(cta, bx + bw / 2, by + bh * 0.66);
}
