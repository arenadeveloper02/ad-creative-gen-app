import JSZip from 'jszip';
import type { AssetKind } from '@/lib/platforms';
import { MAX_BYTES } from '@/lib/limits';

export type ExtractedPart = {
  kind: Exclude<AssetKind, 'guidelines'>;
  name: string;
  mimeType: string;
  data: Buffer;
};

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  emf: '',
  wmf: '',
};

const FONT_EXT: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

const LOGO_NAME = /logo|wordmark|brandmark|icon|favicon|mark|lockup|symbol/i;
const MAX_LOGOS = 4;
const MAX_REFS = 8;
const MAX_FONTS = 4;
const MIN_IMAGE_BYTES = 800;
const MAX_PART_BYTES = MAX_BYTES;

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function classifyImage(name: string): 'logos' | 'refs' {
  return LOGO_NAME.test(name) ? 'logos' : 'refs';
}

function pushPart(out: ExtractedPart[], part: ExtractedPart, counts: { logos: number; refs: number; fonts: number }) {
  if (part.data.length < MIN_IMAGE_BYTES && part.kind !== 'fonts') return;
  if (part.data.length > MAX_PART_BYTES) return;
  if (part.kind === 'logos' && counts.logos >= MAX_LOGOS) return;
  if (part.kind === 'refs' && counts.refs >= MAX_REFS) return;
  if (part.kind === 'fonts' && counts.fonts >= MAX_FONTS) return;
  out.push(part);
  counts[part.kind] += 1;
}

/** Pull JPEG/PNG byte streams that many brand PDFs embed as raw image objects. */
function extractFromPdf(buf: Buffer): ExtractedPart[] {
  const out: ExtractedPart[] = [];
  const counts = { logos: 0, refs: 0, fonts: 0 };
  let i = 0;
  let img = 0;
  while (i < buf.length - 8) {
    // PNG
    if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47) {
      const end = buf.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), i);
      if (end > i) {
        const data = buf.subarray(i, end + 8);
        img += 1;
        const name = `guideline-image-${img}.png`;
        pushPart(out, { kind: classifyImage(name), name, mimeType: 'image/png', data: Buffer.from(data) }, counts);
        i = end + 8;
        continue;
      }
    }
    // JPEG
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      let j = i + 2;
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const data = buf.subarray(i, j + 2);
          img += 1;
          const name = `guideline-image-${img}.jpg`;
          pushPart(out, { kind: classifyImage(name), name, mimeType: 'image/jpeg', data: Buffer.from(data) }, counts);
          i = j + 2;
          break;
        }
        j += 1;
      }
      if (j >= buf.length - 1) i += 1;
      continue;
    }
    i += 1;
  }
  // PDFs rarely embed downloadable TTF/OTF; leave fonts empty unless found as raw files above.
  return out;
}

async function extractFromZip(buf: Buffer): Promise<ExtractedPart[]> {
  const zip = await JSZip.loadAsync(buf);
  const out: ExtractedPart[] = [];
  const counts = { logos: 0, refs: 0, fonts: 0 };
  const paths = Object.keys(zip.files).sort();
  for (const path of paths) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    const lower = path.toLowerCase();
    // Skip theme/thumbnail junk that floods Office packages.
    if (lower.includes('/_rels/') || lower.includes('/theme/') || lower.endsWith('thumbnail.jpeg') || lower.endsWith('thumbnail.jpg')) {
      continue;
    }
    const name = baseName(path);
    const ext = extOf(name);
    const fontMime = FONT_EXT[ext];
    if (fontMime) {
      const data = Buffer.from(await entry.async('uint8array'));
      pushPart(out, { kind: 'fonts', name, mimeType: fontMime, data }, counts);
      continue;
    }
    const imageMime = IMAGE_EXT[ext];
    if (!imageMime) continue;
    // Prefer media folders; still allow other embedded images.
    const inMedia = lower.includes('/media/') || lower.includes('/embeddings/') || lower.includes('/image');
    if (!inMedia && !LOGO_NAME.test(name)) continue;
    const data = Buffer.from(await entry.async('uint8array'));
    pushPart(out, { kind: classifyImage(name), name, mimeType: imageMime, data }, counts);
  }
  // If nothing looked like a logo, promote the first small-ish ref.
  if (counts.logos === 0) {
    const first = out.find((p) => p.kind === 'refs');
    if (first) first.kind = 'logos';
  }
  return out;
}

export async function extractFromGuidelines(fileName: string, mime: string, buf: Buffer): Promise<ExtractedPart[]> {
  const lower = fileName.toLowerCase();
  const isPdf = mime === 'application/pdf' || lower.endsWith('.pdf');
  const isZipDoc =
    lower.endsWith('.zip') ||
    mime === 'application/zip' ||
    mime === 'application/x-zip-compressed' ||
    lower.endsWith('.docx') ||
    lower.endsWith('.pptx') ||
    mime.includes('wordprocessingml') ||
    mime.includes('presentationml') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  if (isPdf) return extractFromPdf(buf);
  if (isZipDoc) {
    try {
      return await extractFromZip(buf);
    } catch {
      return [];
    }
  }
  // Legacy .doc/.ppt/.txt: no reliable embedded media without heavy parsers.
  return [];
}
