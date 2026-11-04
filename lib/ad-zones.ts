import type { Layout } from '@/lib/platforms';

/** Axis-aligned box in canvas pixels. */
export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Single source of truth for where the brand mark and the copy live on each layout.
 * drawAd uses these as hard obstacles; the image prompt uses the matching prose so the
 * photograph keeps that corner quiet while the logo is composited in post.
 */
const LOGO_SIZE = 0.13;
const LOGO_INSET = 0.06;

export function logoSlot(layout: Layout, width: number, height: number): ZoneRect {
  const short = Math.min(width, height);
  const size = Math.round(short * LOGO_SIZE);
  const inset = Math.round(short * LOGO_INSET);
  if (layout === 'center') {
    return { x: width - inset - size, y: height - inset - size, w: size, h: size };
  }
  // left + bottom: top-right, clear of the brand name in the top-left
  return { x: width - inset - size, y: inset, w: size, h: size };
}

/** Human-readable zone for the image model — must stay in sync with logoSlot(). */
export function logoZoneNote(layout: Layout): string {
  if (layout === 'center') {
    return 'the bottom-right corner, never in the middle of the frame and never along the top-left edge';
  }
  return 'the top-right corner, never in the left half and never along the top-left edge';
}

export function layoutCopyNote(layout: Layout): string {
  if (layout === 'left') return 'keep the left 45% of the frame visually quiet so a headline can sit there';
  if (layout === 'center') return 'keep the centre of the frame open for a headline; subject framed around the edges';
  return 'keep the bottom third of the frame simple and darker so a text band can sit there';
}

/** Fits an image inside a slot without cropping; returns the painted bounds. */
export function fitInside(slot: ZoneRect, naturalW: number, naturalH: number): ZoneRect {
  if (naturalW < 1 || naturalH < 1) return { ...slot, w: 0, h: 0 };
  const scale = Math.min(slot.w / naturalW, slot.h / naturalH);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return {
    x: slot.x + (slot.w - w) / 2,
    y: slot.y + (slot.h - h) / 2,
    w,
    h,
  };
}
