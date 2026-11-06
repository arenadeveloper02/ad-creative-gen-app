import type { ImageFinish, VersionDTO } from '@/lib/types';

export const DEFAULT_FINISH: ImageFinish = {
  exposure: 0,
  contrast: 0,
  warmth: 0,
  saturation: 0,
  shadows: 0,
  highlights: 0,
  sharpness: 0,
  blur: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
};

function clampUnit(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Reads a stored grade. Missing or broken data falls back to no change. */
export function readImageFinish(value: unknown): ImageFinish {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...DEFAULT_FINISH };
  const row = value as Partial<ImageFinish>;
  const rotate = row.rotate === 90 || row.rotate === 180 || row.rotate === 270 ? row.rotate : 0;
  return {
    exposure: clampUnit(row.exposure, -100, 100, 0),
    contrast: clampUnit(row.contrast, -100, 100, 0),
    warmth: clampUnit(row.warmth, -100, 100, 0),
    saturation: clampUnit(row.saturation, -100, 100, 0),
    shadows: clampUnit(row.shadows, -100, 100, 0),
    highlights: clampUnit(row.highlights, -100, 100, 0),
    sharpness: clampUnit(row.sharpness, 0, 100, 0),
    blur: clampUnit(row.blur, 0, 100, 0),
    rotate,
    flipH: row.flipH === true,
    flipV: row.flipV === true,
  };
}

export function finishChangesPhoto(value: unknown): boolean {
  const finish = readImageFinish(value);
  return finish.exposure !== 0
    || finish.contrast !== 0
    || finish.warmth !== 0
    || finish.saturation !== 0
    || finish.shadows !== 0
    || finish.highlights !== 0
    || finish.sharpness !== 0
    || finish.blur !== 0
    || finish.rotate !== 0
    || finish.flipH
    || finish.flipV;
}

function coverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  zoom: number,
  focusX: number,
  focusY: number,
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

function gradePixels(canvas: HTMLCanvasElement, finish: ImageFinish): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  const exp = 1 + finish.exposure / 125;
  const con = 1 + finish.contrast / 100;
  const sat = 1 + finish.saturation / 100;
  const warm = finish.warmth / 100;
  const shadow = finish.shadows / 100;
  const high = finish.highlights / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    r *= exp;
    g *= exp;
    b *= exp;
    r = (r - 0.5) * con + 0.5;
    g = (g - 0.5) * con + 0.5;
    b = (b - 0.5) * con + 0.5;
    r += warm * 0.12;
    b -= warm * 0.12;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    r = luma + (r - luma) * sat;
    g = luma + (g - luma) * sat;
    b = luma + (b - luma) * sat;
    const nextLuma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (nextLuma < 0.5 && shadow !== 0) {
      const lift = shadow * 0.35 * ((0.5 - nextLuma) / 0.5);
      r += lift;
      g += lift;
      b += lift;
    } else if (nextLuma >= 0.5 && high !== 0) {
      const lift = high * 0.35 * ((nextLuma - 0.5) / 0.5);
      r += lift;
      g += lift;
      b += lift;
    }
    data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
    data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
    data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
  }
  ctx.putImageData(frame, 0, 0);
}

function blurBackground(source: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const blurPx = Math.max(2, Math.round((amount / 100) * 22));
  const soft = document.createElement('canvas');
  soft.width = source.width;
  soft.height = source.height;
  const sctx = soft.getContext('2d');
  if (!sctx) return source;
  sctx.filter = `blur(${blurPx}px)`;
  sctx.drawImage(source, 0, 0);
  sctx.filter = 'none';
  const mask = document.createElement('canvas');
  mask.width = source.width;
  mask.height = source.height;
  const mctx = mask.getContext('2d');
  if (!mctx) return soft;
  mctx.drawImage(source, 0, 0);
  mctx.globalCompositeOperation = 'destination-in';
  const glow = mctx.createRadialGradient(
    source.width / 2,
    source.height / 2,
    Math.min(source.width, source.height) * 0.18,
    source.width / 2,
    source.height / 2,
    Math.max(source.width, source.height) * 0.62,
  );
  glow.addColorStop(0, 'rgba(0,0,0,1)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  mctx.fillStyle = glow;
  mctx.fillRect(0, 0, source.width, source.height);
  sctx.drawImage(mask, 0, 0);
  return soft;
}

function sharpen(source: HTMLCanvasElement, amount: number): void {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const blur = document.createElement('canvas');
  blur.width = source.width;
  blur.height = source.height;
  const bctx = blur.getContext('2d', { willReadFrequently: true });
  if (!bctx) return;
  bctx.filter = 'blur(1.4px)';
  bctx.drawImage(source, 0, 0);
  const sharp = ctx.getImageData(0, 0, source.width, source.height);
  const soft = bctx.getImageData(0, 0, source.width, source.height);
  const gain = (amount / 100) * 0.85;
  for (let i = 0; i < sharp.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const value = sharp.data[i + c] + gain * (sharp.data[i + c] - soft.data[i + c]);
      sharp.data[i + c] = Math.round(Math.min(255, Math.max(0, value)));
    }
  }
  ctx.putImageData(sharp, 0, 0);
}

const cache = new Map<string, HTMLCanvasElement>();

function remember(key: string, canvas: HTMLCanvasElement): HTMLCanvasElement {
  cache.set(key, canvas);
  if (cache.size > 8) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return canvas;
}

/** Draws the photo with crop, rotate, flip, and grade. Text and logo are painted afterwards by the caller. */
export function paintFinishedPhoto(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  version: VersionDTO,
): void {
  const finish = readImageFinish(version.imageFinish);
  const zoom = typeof version.imageZoom === 'number' && Number.isFinite(version.imageZoom) ? version.imageZoom : 1;
  const focusX = version.imageFocusX != null ? version.imageFocusX : 0.5;
  const focusY = version.imageFocusY != null ? version.imageFocusY : 0.5;
  const key = [
    image.src,
    width,
    height,
    zoom,
    focusX,
    focusY,
    finish.exposure,
    finish.contrast,
    finish.warmth,
    finish.saturation,
    finish.shadows,
    finish.highlights,
    finish.sharpness,
    finish.blur,
    finish.rotate,
    finish.flipH ? 1 : 0,
    finish.flipV ? 1 : 0,
  ].join('|');
  let painted = cache.get(key);
  if (!painted) {
    const board = document.createElement('canvas');
    board.width = width;
    board.height = height;
    const bctx = board.getContext('2d', { willReadFrequently: true });
    if (!bctx) {
      coverImage(ctx, image, width, height, zoom, focusX, focusY);
      return;
    }
    const turned = finish.rotate === 90 || finish.rotate === 270;
    const dw = turned ? height : width;
    const dh = turned ? width : height;
    bctx.save();
    bctx.translate(width / 2, height / 2);
    bctx.rotate((finish.rotate * Math.PI) / 180);
    bctx.scale(finish.flipH ? -1 : 1, finish.flipV ? -1 : 1);
    bctx.translate(-dw / 2, -dh / 2);
    coverImage(bctx, image, dw, dh, zoom, focusX, focusY);
    bctx.restore();
    gradePixels(board, finish);
    if (finish.sharpness > 0) sharpen(board, finish.sharpness);
    painted = finish.blur > 0 ? remember(key, blurBackground(board, finish.blur)) : remember(key, board);
  }
  ctx.drawImage(painted, 0, 0, width, height);
}
