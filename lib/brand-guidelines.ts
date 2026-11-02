import { buildLlmInput, LLM_ENDPOINT, llmModel } from '@/lib/fal-models';
import { runFalJob } from '@/lib/fal';
import { extractFromGuidelines, type ExtractedPart } from '@/lib/extract-guidelines';
import { cleanFileName, cleanHex, cleanHttpUrl, cleanText, svgIsUnsafe } from '@/lib/guard';
import { isRecord } from '@/lib/json';
import { MAX_BYTES, MAX_SHORT } from '@/lib/limits';
import { mimeAllowed, type AssetKind } from '@/lib/platforms';
import { logUsage, reportFalUsage } from '@/lib/usage';

// ---------------------------------------------------------------------------
// Brand hunt from a name alone, all inside this app (no Sim workflow):
//   1. find the official site (user URL → Gemini → slug guess → web search)
//   2. read the homepage + one brand/press page + its stylesheets
//   3. collect logos (img / inline svg / icons), @font-face files, hero
//      creatives, colours, and any public brand-kit PDF / ZIP
//   4. Gemini (fal any-llm) picks colours, product line, best logos, fonts
//   5. download everything into assets; brand-kit docs run through the same
//      extractor as a manual guidelines upload
// Public functions never throw.
// ---------------------------------------------------------------------------

const DEFAULT_C1 = '#1B365D';
const DEFAULT_C2 = '#2E6DA4';
const DEFAULT_C3 = '#FFFFFF';
const HEX_IN_TEXT = /#([0-9a-f]{6})\b/gi;
const FETCH_MS = 8000;
const MAX_HTML = 400_000;
const MAX_CSS = 300_000;
const MAX_LOGO = 2 * 1024 * 1024;
const MAX_REF = 4 * 1024 * 1024;
const MAX_FONT = 3 * 1024 * 1024;
const MAX_DOC = MAX_BYTES;
const MAX_LOGOS = 6;
const WELL_KNOWN_LOGO_PATHS = [
  '/favicon.svg',
  '/logo.svg',
  '/logo.png',
  '/logo-white.svg',
  '/images/logo.svg',
  '/images/logo.png',
  '/img/logo.svg',
  '/img/logo.png',
  '/assets/logo.svg',
  '/assets/logo.png',
  '/assets/images/logo.svg',
  '/assets/img/logo.svg',
  '/static/logo.svg',
  '/static/images/logo.svg',
  '/safari-pinned-tab.svg',
];

export type LogoVariant = 'Primary' | 'Reverse (white)' | 'Icon' | 'Stacked' | 'Mono' | 'Alternate';
type LogoZone = 'header' | 'footer' | 'body' | 'icon' | 'inline' | 'meta' | 'wellknown' | 'external';
interface LogoMeta {
  hint: string;
  zone: LogoZone;
}
const MAX_FONTS = 4;
const MAX_REFS = 6;
const MAX_DOCS = 2;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AdCreativeGen/1.0';

const LOGO_RE = /logo|wordmark|brandmark|lockup|brand-mark|site-?brand/i;
const ICON_JUNK_RE = /sprite|pixel|tracking|spacer|blank\.|1x1|arrow|chevron|hamburger|close|play|search|cart|menu|flag|star|check|avatar|badge-app|appstore|googleplay|google-play|facebook|twitter|instagram|linkedin|youtube|tiktok/i;
const BRAND_PAGE_RE = /brand|press|media.?kit|newsroom|guideline|identity|style.?guide|logo|assets|resources\/brand/i;
const DOC_RE = /\.(pdf|zip)(\?|$)/i;
const FONT_EXT_RE = /\.(woff2|woff|ttf|otf)(\?|#|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i;
const SOCIAL_HOST_RE = /facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|pinterest|wikipedia|yelp|glassdoor|indeed|crunchbase|bloomberg|zoominfo/i;

const SITE_SYSTEM = [
  'You identify the official website of a company or brand.',
  'Return only JSON: {"website":"https://...","altNames":["..."]}',
  'website is the official homepage (https). Empty string if unsure. Never return social media, Wikipedia, or directories.',
].join(' ');

const GUIDE_SYSTEM = [
  'You extract brand guidelines for paid social ads from scraped website data.',
  'Return only JSON with this shape:',
  '{"brandName":"","product":"","website":"","c1":"#RRGGBB","c2":"#RRGGBB","c3":"#RRGGBB","summary":"","logoUrls":[],"fontNames":[],"refUrls":[],"headlineFont":""}',
  'c1 is the primary brand colour, c2 secondary, c3 accent or light contrast for text/logo. Use real #RRGGBB values seen on the site when available; prefer distinctive brand colours over greys, pure black, or generic blue.',
  'product is a short product or service line (under 80 characters). summary is one sentence on tone and visual style (under 240 characters).',
  'logoUrls: up to 6 URLs from the candidates that are this brand\'s own logo in any variant (full colour, white/reverse, icon mark, stacked, mono), best first. Exclude client, partner, award, app-store and social logos, and photos. Header and footer zones are the most reliable.',
  'refUrls: up to 6 candidate image URLs that are real marketing visuals / hero creatives, best first.',
  'fontNames: brand font family names seen in the CSS, primary first. headlineFont is the single best headline font name.',
  'Only use URLs that appear in the candidates. Do not invent prices, awards, or customer counts.',
].join(' ');

export interface BrandAssetPart {
  kind: AssetKind;
  name: string;
  mimeType: string;
  data: Buffer;
  sourceUrl: string | null;
  variant?: LogoVariant;
}

export interface BrandGuidelinesResult {
  brandName: string;
  product: string;
  website: string;
  c1: string;
  c2: string;
  c3: string;
  summary: string;
  fontNames: string[];
  headlineFont: string;
  logoUrl: string | null;
  parts: BrandAssetPart[];
  pagesRead: string[];
}

export interface Hunt {
  pages: string[];
  title: string;
  description: string;
  text: string;
  colors: string[];
  logoCandidates: string[];
  logoMeta: Map<string, LogoMeta>;
  inlineSvgLogos: Buffer[];
  inlineSvgZones: LogoZone[];
  brandTokens: string[];
  imageCandidates: string[];
  fontCandidates: string[];
  fontNames: string[];
  docCandidates: string[];
}

// ----------------------------------------------------------------- utilities

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clip(item, 500);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function findOutput(value: unknown, depth = 0): string | null {
  if (depth > 5 || !isRecord(value)) return null;
  if (typeof value.output === 'string' && value.output.trim() !== '') return value.output;
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const found = findOutput(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueHex(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const hex = cleanHex(value, '');
    if (hex === '' || seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
    if (out.length >= 16) break;
  }
  return out;
}

/** Default palettes shipped by CSS frameworks; present on most sites and rarely brand colours. */
const FRAMEWORK_COLORS = new Set(
  [
    '#007BFF', '#6C757D', '#28A745', '#DC3545', '#FFC107', '#17A2B8', '#343A40', '#F8F9FA', '#E9ECEF', '#DEE2E6', '#CED4DA', '#ADB5BD', '#495057', '#212529',
    '#0D6EFD', '#6F42C1', '#D63384', '#FD7E14', '#198754', '#0DCAF0', '#20C997', '#6610F2', '#E83E8C',
    '#FFFFFF', '#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#EEEEEE', '#DDDDDD', '#F5F5F5', '#FAFAFA', '#111111', '#222222', '#444444', '#555555', '#777777', '#888888',
  ].map((c) => c.toUpperCase()),
);

/** Counts colours by frequency and drops near-greys / framework defaults so brand hues float to the top. */
function rankColors(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const hex = cleanHex(raw, '');
    if (hex === '') continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const scored = [...counts.entries()].map(([hex, count]) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const grey = spread < 18;
    const framework = FRAMEWORK_COLORS.has(hex);
    return { hex, score: count * (grey ? 0.15 : 1 + spread / 255) * (framework ? 0.2 : 1) };
  });
  scored.sort((a, b) => b.score - a.score);
  return uniqueHex(scored.map((s) => s.hex));
}

function absoluteUrl(base: string, href: string): string | null {
  const trimmed = href.trim().replace(/&amp;/g, '&');
  if (trimmed === '' || trimmed.startsWith('data:') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return null;
  try {
    const abs = new URL(trimmed, base).toString();
    return cleanHttpUrl(abs);
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a);
  const hb = hostOf(b);
  if (!ha || !hb) return false;
  const root = (h: string) => h.split('.').slice(-2).join('.');
  return root(ha) === root(hb);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function metaContent(html: string, names: string[]): string {
  const re = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  const found: Record<string, string> = {};
  while ((match = re.exec(html))) {
    const tag = match[0];
    const key = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase();
    const content = attr(tag, 'content');
    if (key && content && !(key in found)) found[key] = content;
  }
  for (const name of names) {
    const value = found[name.toLowerCase()];
    if (value) return value;
  }
  return '';
}

function linkHrefs(html: string, relTest: RegExp): string[] {
  const re = /<link\b[^>]*>/gi;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const tag = match[0];
    if (!relTest.test(attr(tag, 'rel'))) continue;
    const href = attr(tag, 'href');
    if (href) out.push(href);
  }
  return out;
}

function firstSrcset(value: string): string {
  const first = value.split(',')[0]?.trim() ?? '';
  return first.split(/\s+/)[0] ?? '';
}

function pushUnique(list: string[], value: string | null, max = 40): void {
  if (!value || list.includes(value) || list.length >= max) return;
  list.push(value);
}

function slugCandidates(brandName: string): string[] {
  const lower = brandName.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (lower.length < 2) return [];
  const words = lower.split(/\s+/).filter(Boolean);
  const joined = words.join('');
  const dashed = words.join('-');
  const out: string[] = [];
  for (const slug of [joined, dashed]) {
    if (slug.length < 3 || slug.length > 48) continue;
    pushUnique(out, `https://www.${slug}.com`);
    pushUnique(out, `https://${slug}.com`);
  }
  return out;
}

// -------------------------------------------------------------------- fetch

interface FetchText {
  ok: true;
  text: string;
  finalUrl: string;
  contentType: string;
}

async function fetchText(url: string, accept: string, maxBytes: number, requireType?: RegExp): Promise<FetchText | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: accept, 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return { ok: false };
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (requireType && !requireType.test(contentType)) return { ok: false };
    const text = (await res.text()).slice(0, maxBytes);
    return { ok: true, text, finalUrl: res.url || url, contentType };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBinary(url: string, accept: string, maxBytes: number): Promise<{ ok: true; data: Buffer; contentType: string; finalUrl: string } | { ok: false }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: accept, 'User-Agent': UA, Referer: `${new URL(url).origin}/` },
    });
    if (!res.ok) return { ok: false };
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > maxBytes) return { ok: false };
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) return { ok: false };
    return { ok: true, data, contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), finalUrl: res.url || url };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------- site discovery

async function askSite(brandName: string): Promise<string | null> {
  const run = await runFalJob(LLM_ENDPOINT, buildLlmInput(SITE_SYSTEM, `Brand: ${brandName}\nReturn its official website.`), 30000);
  if (!run.ok) return null;
  const text = findOutput(run.output);
  const parsed = text ? parseJsonObject(text) : null;
  const site = parsed ? cleanHttpUrl(parsed.website) : null;
  if (!site || SOCIAL_HOST_RE.test(hostOf(site))) return null;
  return site;
}

async function searchSite(brandName: string): Promise<string | null> {
  const query = encodeURIComponent(`${brandName} official website`);
  const page = await fetchText(`https://html.duckduckgo.com/html/?q=${query}`, 'text/html', MAX_HTML);
  if (!page.ok) return null;
  const re = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(page.text))) {
    let href = match[1].replace(/&amp;/g, '&');
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        continue;
      }
    }
    const url = cleanHttpUrl(href);
    if (!url) continue;
    if (SOCIAL_HOST_RE.test(hostOf(url))) continue;
    return url;
  }
  return null;
}

// ------------------------------------------------------------- page reading

function emptyHunt(): Hunt {
  return {
    pages: [],
    title: '',
    description: '',
    text: '',
    colors: [],
    logoCandidates: [],
    logoMeta: new Map(),
    inlineSvgLogos: [],
    inlineSvgZones: [],
    brandTokens: [],
    imageCandidates: [],
    fontCandidates: [],
    fontNames: [],
    docCandidates: [],
  };
}

function harvestCss(css: string, base: string, hunt: Hunt, rawColors: string[]): void {
  for (const m of css.matchAll(HEX_IN_TEXT)) rawColors.push(`#${m[1]}`);
  const faces = css.match(/@font-face\s*{[^}]*}/gi) ?? [];
  for (const face of faces) {
    const family = face.match(/font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}]+))/i);
    const name = clip(family?.[1] ?? family?.[2] ?? family?.[3] ?? '', 80);
    if (name && !hunt.fontNames.includes(name)) hunt.fontNames.push(name);
    const urls = face.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]+))\s*\)/gi);
    for (const u of urls) {
      const href = (u[1] ?? u[2] ?? u[3] ?? '').trim();
      if (!FONT_EXT_RE.test(href)) continue;
      pushUnique(hunt.fontCandidates, absoluteUrl(base, href), 24);
    }
  }
  const families = css.matchAll(/font-family\s*:\s*([^;}]+)/gi);
  for (const f of families) {
    const first = f[1].split(',')[0]?.replace(/["']/g, '').trim() ?? '';
    if (!first || /^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|var\()/i.test(first)) continue;
    if (hunt.fontNames.length < 12 && !hunt.fontNames.includes(first)) hunt.fontNames.push(clip(first, 80));
  }
}

function addLogo(hunt: Hunt, url: string | null, hint: string, zone: LogoZone): void {
  if (!url) return;
  if (!hunt.logoCandidates.includes(url)) {
    if (hunt.logoCandidates.length >= 60) return;
    hunt.logoCandidates.push(url);
  }
  const prev = hunt.logoMeta.get(url);
  // Keep the strongest zone seen for this URL.
  const rank: Record<LogoZone, number> = { header: 6, inline: 6, footer: 5, meta: 4, icon: 3, wellknown: 3, body: 2, external: 1 };
  if (!prev || rank[zone] > rank[prev.zone]) hunt.logoMeta.set(url, { hint: `${prev?.hint ?? ''} ${hint}`.trim(), zone });
  else prev.hint = `${prev.hint} ${hint}`.trim();
}

function mentionsBrand(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return tokens.some((t) => lower.includes(t));
}

function harvestHtml(url: string, html: string, hunt: Hunt, rawColors: string[], primary: boolean): string[] {
  hunt.pages.push(url);
  const isBrandPage = !primary;
  if (primary) {
    hunt.title = clip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', 160);
    hunt.description = clip(metaContent(html, ['description', 'og:description', 'twitter:description']), 400);
    hunt.text = stripTags(html).slice(0, 3000);
  }
  const theme = metaContent(html, ['theme-color', 'msapplication-TileColor']);
  if (theme) rawColors.push(theme, theme, theme);
  for (const m of html.matchAll(HEX_IN_TEXT)) rawColors.push(`#${m[1]}`);
  const inlineStyles = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  for (const block of inlineStyles) harvestCss(block, url, hunt, rawColors);

  // Icons are weak logo sources; queue them after real <img> logos.
  const icons: string[] = [];
  for (const href of linkHrefs(html, /apple-touch-icon/i)) pushUnique(icons, absoluteUrl(url, href), 6);
  for (const href of linkHrefs(html, /(^|\s)icon(\s|$)|shortcut icon|mask-icon/i)) {
    if (/\.ico(\?|$)/i.test(href)) continue;
    pushUnique(icons, absoluteUrl(url, href), 6);
  }
  const og = metaContent(html, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']);
  if (og) pushUnique(hunt.imageCandidates, absoluteUrl(url, og));
  const ogLogo = metaContent(html, ['og:logo']);
  if (ogLogo) addLogo(hunt, absoluteUrl(url, ogLogo), 'og:logo', 'meta');

  // JSON-LD "logo".
  for (const m of html.matchAll(/"logo"\s*:\s*(?:"([^"]+)"|{[^}]*"url"\s*:\s*"([^"]+)")/gi)) {
    addLogo(hunt, absoluteUrl(url, m[1] ?? m[2] ?? ''), 'json-ld logo', 'meta');
  }

  // <img> tags, ordered so header logos come first.
  const headerEnd = (() => {
    const i = html.search(/<\/header>|<main\b|<\/nav>/i);
    return i > 0 ? i : Math.min(html.length, 60_000);
  })();
  const footerStart = (() => {
    const i = html.search(/<footer\b|class=["'][^"']*footer/i);
    return i > 0 ? i : html.length;
  })();
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html))) {
    const tag = match[0];
    const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src') || firstSrcset(attr(tag, 'srcset') || attr(tag, 'data-srcset'));
    const abs = absoluteUrl(url, src);
    if (!abs) continue;
    const alt = attr(tag, 'alt');
    const cls = `${attr(tag, 'class')} ${attr(tag, 'id')}`;
    const hint = `${src} ${alt} ${cls}`;
    if (ICON_JUNK_RE.test(hint) && !LOGO_RE.test(hint)) continue;
    const inHeader = match.index < headerEnd;
    const inFooter = match.index >= footerStart;
    const zone: LogoZone = inHeader ? 'header' : inFooter ? 'footer' : 'body';
    const brandish = mentionsBrand(hint, hunt.brandTokens);
    // On a press/brand page every same-site image that names the brand or says "logo" is a logo variant.
    if (LOGO_RE.test(hint) || (inHeader && IMAGE_EXT_RE.test(src) && /svg|png/i.test(src)) || (isBrandPage && brandish && sameSite(abs, url))) {
      addLogo(hunt, abs, hint, zone);
      continue;
    }
    const width = Number(attr(tag, 'width') || '0');
    const height = Number(attr(tag, 'height') || '0');
    if ((width && width < 120) || (height && height < 120)) continue;
    if (/\.svg(\?|$)/i.test(src)) continue;
    pushUnique(hunt.imageCandidates, abs, 40);
  }

  // Also <source srcset> and <picture> variants that swap a logo for dark mode.
  const sourceRe = /<source\b[^>]*>/gi;
  while ((match = sourceRe.exec(html))) {
    const tag = match[0];
    const media = attr(tag, 'media');
    const srcset = firstSrcset(attr(tag, 'srcset') || attr(tag, 'data-srcset'));
    const abs = absoluteUrl(url, srcset);
    if (!abs) continue;
    const near = html.slice(match.index, Math.min(html.length, match.index + 600));
    const hint = `${srcset} ${media} ${attr(tag, 'class')}`;
    if (LOGO_RE.test(hint) || LOGO_RE.test(near)) {
      const zone: LogoZone = match.index < headerEnd ? 'header' : match.index >= footerStart ? 'footer' : 'body';
      addLogo(hunt, abs, /dark/i.test(media) ? `${hint} dark-mode` : hint, zone);
    }
  }

  for (const icon of icons) addLogo(hunt, icon, 'site icon', 'icon');

  // Inline SVG logos (the most "exact" source when a site inlines its mark).
  const svgRe = /<svg\b[\s\S]*?<\/svg>/gi;
  while ((match = svgRe.exec(html)) && hunt.inlineSvgLogos.length < 4) {
    const svg = match[0];
    // Tiny inline SVGs next to a .logo wrapper are usually menu/search icons, not the mark.
    if (svg.length < 2500 || svg.length > 200_000) continue;
    const before = html.slice(Math.max(0, match.index - 400), match.index);
    const open = svg.slice(0, svg.indexOf('>') + 1);
    if (!LOGO_RE.test(open) && !LOGO_RE.test(before)) continue;
    if (/<use\b/i.test(svg) && !/<path|<polygon|<rect|<circle|<text/i.test(svg)) continue;
    const withNs = /xmlns=/.test(open) ? svg : svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    const buf = Buffer.from(withNs, 'utf8');
    if (svgIsUnsafe(buf)) continue;
    if (hunt.inlineSvgLogos.some((b) => b.equals(buf))) continue;
    hunt.inlineSvgLogos.push(buf);
    hunt.inlineSvgZones.push(match.index < headerEnd ? 'header' : match.index >= footerStart ? 'footer' : 'inline');
  }

  // Background images in inline style attributes (hero banners).
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]+))\s*\)/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!IMAGE_EXT_RE.test(href) || /\.svg/i.test(href)) continue;
    pushUnique(hunt.imageCandidates, absoluteUrl(url, href), 40);
  }

  // Links: brand pages, brand-kit documents, stylesheets.
  const brandPages: string[] = [];
  const aRe = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]{0,200}?)<\/a>/gi;
  while ((match = aRe.exec(html))) {
    const href = match[1] ?? match[2] ?? '';
    const label = stripTags(match[3] ?? '');
    const abs = absoluteUrl(url, href);
    if (!abs) continue;
    if (DOC_RE.test(abs) && (BRAND_PAGE_RE.test(`${abs} ${label}`) || /brand|logo|guide/i.test(label))) {
      pushUnique(hunt.docCandidates, abs, 8);
      continue;
    }
    if (sameSite(abs, url) && BRAND_PAGE_RE.test(`${href} ${label}`) && !/login|careers|privacy|terms/i.test(abs)) {
      pushUnique(brandPages, abs, 6);
    }
  }
  const sheets = linkHrefs(html, /stylesheet/i).map((href) => absoluteUrl(url, href)).filter((v): v is string => v !== null);
  return [...brandPages, ...sheets.map((s) => `css:${s}`)];
}

/** Reads a brand site (home + brand/press page + stylesheets) and lists what could be pulled. Never throws. */
export async function readBrandSite(site: string, brandName = ''): Promise<Hunt | null> {
  try {
    return await readSite(site, brandName);
  } catch {
    return null;
  }
}

function brandTokens(brandName: string, site: string): string[] {
  const out = new Set<string>();
  const host = hostOf(site).split('.')[0] ?? '';
  if (host.length >= 3) out.add(host.replace(/[^a-z0-9]+/g, ''));
  const words = brandName.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !/^(the|and|inc|llc|ltd|group|company|co)$/.test(w));
  if (words.length) out.add(words.join(''));
  for (const w of words) if (w.length >= 5) out.add(w);
  return [...out];
}

async function readSite(site: string, brandName: string): Promise<Hunt | null> {
  const hunt = emptyHunt();
  const rawColors: string[] = [];
  const home = await fetchText(site, 'text/html,application/xhtml+xml', MAX_HTML, /text\/html|application\/xhtml/);
  if (!home.ok) return null;
  hunt.brandTokens = brandTokens(brandName, home.finalUrl);
  const follow = harvestHtml(home.finalUrl, home.text, hunt, rawColors, true);

  const brandPages = follow.filter((f) => !f.startsWith('css:')).slice(0, 2);
  const sheets = follow.filter((f) => f.startsWith('css:')).map((f) => f.slice(4)).slice(0, 4);

  const [pageResults, cssResults] = await Promise.all([
    Promise.all(brandPages.map((p) => fetchText(p, 'text/html,application/xhtml+xml', MAX_HTML, /text\/html|application\/xhtml/))),
    Promise.all(sheets.map((s) => fetchText(s, 'text/css,*/*;q=0.1', MAX_CSS))),
  ]);
  const extraSheets: string[] = [];
  pageResults.forEach((res, i) => {
    if (!res.ok) return;
    const more = harvestHtml(res.finalUrl, res.text, hunt, rawColors, false);
    for (const s of more.filter((f) => f.startsWith('css:'))) extraSheets.push(s.slice(4));
    void brandPages[i];
  });
  cssResults.forEach((res, i) => {
    if (res.ok) harvestCss(res.text, sheets[i], hunt, rawColors);
  });
  if (hunt.fontCandidates.length === 0 && extraSheets.length > 0) {
    const more = await Promise.all(extraSheets.slice(0, 2).map((s) => fetchText(s, 'text/css,*/*;q=0.1', MAX_CSS)));
    more.forEach((res, i) => {
      if (res.ok) harvestCss(res.text, extraSheets[i], hunt, rawColors);
    });
  }
  hunt.colors = rankColors(rawColors);
  // Well-known logo paths many sites expose; checked at download time, cheap to list.
  try {
    const origin = new URL(home.finalUrl).origin;
    for (const path of WELL_KNOWN_LOGO_PATHS) addLogo(hunt, `${origin}${path}`, path, 'wellknown');
  } catch {
    /* ignore */
  }
  const host = hostOf(home.finalUrl);
  if (host) {
    addLogo(hunt, `https://logo.clearbit.com/${host}`, 'clearbit', 'external');
    addLogo(hunt, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`, 'favicon service', 'external');
  }
  return hunt;
}

// ------------------------------------------------------------ AI synthesis

function buildPrompt(brandName: string, hunt: Hunt | null, site: string | null): string {
  const lines = [`Brand the user typed: ${brandName}`];
  if (!hunt) {
    lines.push(site ? `Official website (could not be read): ${site}` : 'No website could be found or read.');
    lines.push('Use well-known public brand colours for this company if confident, otherwise sensible professional defaults. Leave logoUrls, refUrls, fontNames empty.');
    return lines.join('\n');
  }
  lines.push(`Pages read: ${hunt.pages.join(', ')}`);
  if (hunt.title) lines.push(`Page title: ${hunt.title}`);
  if (hunt.description) lines.push(`Page description: ${hunt.description}`);
  if (hunt.colors.length) lines.push(`Colours on site, most used first (greys down-ranked): ${hunt.colors.join(', ')}`);
  if (hunt.fontNames.length) lines.push(`Font families in CSS: ${hunt.fontNames.join(', ')}`);
  if (hunt.inlineSvgLogos.length) lines.push(`${hunt.inlineSvgLogos.length} inline SVG logo(s) were captured directly from the header.`);
  const listed = hunt.logoCandidates.filter((u) => hunt.logoMeta.get(u)?.zone !== 'wellknown').slice(0, 24);
  if (listed.length) lines.push(`Logo URL candidates (zone in brackets):\n${listed.map((u) => `- [${hunt.logoMeta.get(u)?.zone ?? 'body'}] ${u}`).join('\n')}`);
  if (hunt.imageCandidates.length) lines.push(`Marketing image candidates:\n${hunt.imageCandidates.slice(0, 25).map((u) => `- ${u}`).join('\n')}`);
  if (hunt.docCandidates.length) lines.push(`Brand kit documents found: ${hunt.docCandidates.join(', ')}`);
  if (hunt.text) lines.push(`Page text sample:\n${hunt.text}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- downloads

function imageMime(contentType: string, url: string): string | null {
  if (mimeAllowed('logos', contentType)) return contentType;
  const lower = url.toLowerCase();
  if (/\.svg/.test(lower)) return 'image/svg+xml';
  if (/\.webp/.test(lower)) return 'image/webp';
  if (/\.gif/.test(lower)) return 'image/gif';
  if (/\.jpe?g/.test(lower)) return 'image/jpeg';
  if (/\.png|clearbit|favicons/.test(lower)) return 'image/png';
  return null;
}

function extFor(mime: string): string {
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'font/ttf') return 'ttf';
  if (mime === 'font/otf') return 'otf';
  if (mime === 'font/woff') return 'woff';
  if (mime === 'font/woff2') return 'woff2';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/zip') return 'zip';
  return 'png';
}

function nameFromUrl(url: string, fallback: string, ext: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    const base = last.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.\- ]+/g, '-').slice(0, 60);
    return cleanFileName(`${base || fallback}.${ext}`);
  } catch {
    return cleanFileName(`${fallback}.${ext}`);
  }
}

async function downloadImage(url: string, kind: 'logos' | 'refs', maxBytes: number, minBytes: number, label: string): Promise<BrandAssetPart | null> {
  const res = await fetchBinary(url, 'image/*,*/*;q=0.8', maxBytes);
  if (!res.ok) return null;
  const mime = imageMime(res.contentType, url);
  if (!mime || !mimeAllowed(kind, mime)) return null;
  if (res.data.length < minBytes) return null;
  if (mime === 'image/svg+xml' && svgIsUnsafe(res.data)) return null;
  return { kind, name: nameFromUrl(url, label, extFor(mime)), mimeType: mime, data: res.data, sourceUrl: res.finalUrl };
}

function fontMime(contentType: string, url: string): string | null {
  const ext = url.toLowerCase().match(FONT_EXT_RE)?.[1] ?? '';
  const byExt: Record<string, string> = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
  if (byExt[ext]) return byExt[ext];
  if (mimeAllowed('fonts', contentType) && contentType !== 'application/octet-stream') return contentType;
  return null;
}

async function downloadFont(url: string): Promise<BrandAssetPart | null> {
  const res = await fetchBinary(url, 'font/*,application/octet-stream,*/*;q=0.5', MAX_FONT);
  if (!res.ok) return null;
  const mime = fontMime(res.contentType, url);
  if (!mime || res.data.length < 1024) return null;
  return { kind: 'fonts', name: nameFromUrl(url, 'brand-font', extFor(mime)), mimeType: mime, data: res.data, sourceUrl: res.finalUrl };
}

async function downloadDoc(url: string): Promise<{ doc: BrandAssetPart; parts: ExtractedPart[] } | null> {
  const res = await fetchBinary(url, 'application/pdf,application/zip,*/*;q=0.5', MAX_DOC);
  if (!res.ok || res.data.length < 2048) return null;
  const isPdf = res.contentType === 'application/pdf' || /\.pdf(\?|$)/i.test(url) || res.data.subarray(0, 4).toString() === '%PDF';
  const isZip = res.contentType.includes('zip') || /\.zip(\?|$)/i.test(url) || (res.data[0] === 0x50 && res.data[1] === 0x4b);
  if (!isPdf && !isZip) return null;
  const mime = isPdf ? 'application/pdf' : 'application/zip';
  const name = nameFromUrl(url, 'brand-guidelines', extFor(mime));
  const parts = await extractFromGuidelines(name, mime, res.data).catch(() => [] as ExtractedPart[]);
  return { doc: { kind: 'guidelines', name, mimeType: mime, data: res.data, sourceUrl: res.finalUrl }, parts };
}

// ---------------------------------------------------------- logo variants

function imageSize(mime: string, data: Buffer): { w: number; h: number } | null {
  if (mime === 'image/png' && data.length > 24 && data[0] === 0x89) {
    return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
  }
  if (mime === 'image/svg+xml') {
    const text = data.subarray(0, 4000).toString('utf8');
    const open = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
    const vb = attr(open, 'viewBox').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
    const w = parseFloat(attr(open, 'width'));
    const h = parseFloat(attr(open, 'height'));
    if (w > 0 && h > 0) return { w, h };
  }
  if (mime === 'image/webp' && data.length > 30) {
    const chunk = data.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { w: 1 + data.readUIntLE(24, 3), h: 1 + data.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { w: data.readUInt16LE(26) & 0x3fff, h: data.readUInt16LE(28) & 0x3fff };
  }
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) break;
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: data.readUInt16BE(i + 5), w: data.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Share of SVG paint that is light (white-ish). 1 = all white marks, 0 = none. */
function svgLightShare(data: Buffer): number | null {
  const text = data.toString('utf8');
  const paints: string[] = [];
  for (const m of text.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|white|black|rgba?\([^)]*\)|currentColor)/gi)) paints.push(m[1]);
  const useful = paints.filter((p) => !/^currentColor$/i.test(p));
  if (useful.length === 0) {
    // Inline SVGs often inherit fill from CSS; treat `fill="#fff"` absence as unknown.
    return null;
  }
  let light = 0;
  for (const paint of useful) {
    const p = paint.toLowerCase();
    let r = 0;
    let g = 0;
    let b = 0;
    if (p === 'white') (r = g = b = 255);
    else if (p === 'black') (r = g = b = 0);
    else if (p.startsWith('#')) {
      const hex = p.length <= 5 ? p.slice(1, 4).split('').map((c) => c + c).join('') : p.slice(1, 7);
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      const nums = p.match(/[\d.]+/g)?.map(Number) ?? [];
      if (nums.length >= 3) [r, g, b] = nums;
      else continue;
    }
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.85) light += 1;
  }
  return light / useful.length;
}

function classifyLogo(part: BrandAssetPart, meta: LogoMeta | undefined, taken: Set<LogoVariant>): LogoVariant {
  const hint = `${part.name} ${part.sourceUrl ?? ''} ${meta?.hint ?? ''}`.toLowerCase();
  const zone = meta?.zone ?? 'body';
  const size = imageSize(part.mimeType, part.data);
  const ratio = size ? size.w / size.h : null;
  const lightShare = part.mimeType === 'image/svg+xml' ? svgLightShare(part.data) : null;

  if (/stacked|vertical|portrait/.test(hint)) return 'Stacked';
  if (/mono|black|one-?colou?r|single-?colou?r|greyscale|grayscale/.test(hint) && !/white/.test(hint)) return 'Mono';
  if (/white|reverse|inverse|inverted|negative|light|knockout|on-dark|dark-mode|-dark|_dark/.test(hint)) return 'Reverse (white)';
  if (lightShare !== null && lightShare >= 0.7) return 'Reverse (white)';
  if (zone === 'icon' || /favicon|apple-touch|mask-icon|pinned-tab|\bicon\b|symbol|brandmark|\bmark\b/.test(hint)) return 'Icon';
  if (ratio !== null && ratio >= 0.8 && ratio <= 1.25) return 'Icon';
  if (zone === 'footer' && taken.has('Primary') && !taken.has('Reverse (white)')) return 'Reverse (white)';
  if (ratio !== null && ratio > 0.45 && ratio < 0.8 && taken.has('Primary')) return 'Stacked';
  if (!taken.has('Primary')) return 'Primary';
  return 'Alternate';
}

function labelLogo(part: BrandAssetPart, variant: LogoVariant): BrandAssetPart {
  const base = part.name.replace(/^(Primary|Reverse \(white\)|Icon|Stacked|Mono|Alternate) - /, '');
  return { ...part, variant, name: cleanFileName(`${variant} - ${base}`) };
}

function zoneOrder(zone: LogoZone | undefined): number {
  const rank: Record<LogoZone, number> = { header: 0, inline: 0, footer: 1, meta: 2, body: 3, icon: 4, wellknown: 5, external: 6 };
  return rank[zone ?? 'body'];
}

async function collectUntil<T>(urls: string[], max: number, concurrency: number, fn: (url: string) => Promise<T | null>): Promise<T[]> {
  const out: T[] = [];
  const queue = [...urls];
  while (queue.length > 0 && out.length < max) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.all(batch.map((u) => fn(u)));
    for (const r of results) {
      if (r && out.length < max) out.push(r);
    }
  }
  return out;
}

function dedupeParts(parts: BrandAssetPart[]): BrandAssetPart[] {
  const seen = new Set<string>();
  const out: BrandAssetPart[] = [];
  for (const part of parts) {
    const key = `${part.kind}:${part.data.length}:${part.data.subarray(0, 64).toString('base64')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out;
}

// -------------------------------------------------------------------- main

/** Full brand hunt from a name (and optional site). AI via fal any-llm; downloads logos, fonts, creatives, brand kit. Never throws. */
export async function lookupBrandGuidelines(opts: {
  brandName: string;
  website?: string | null;
  ownerEmail: string;
  projectId?: string | null;
}): Promise<{ ok: true; result: BrandGuidelinesResult } | { ok: false; error: string }> {
  const brandName = cleanText(opts.brandName, MAX_SHORT);
  if (brandName.length < 2) return { ok: false, error: 'Enter a brand name first.' };

  // 1. Official site.
  const siteQueue: string[] = [];
  const given = opts.website ? cleanHttpUrl(opts.website) : null;
  if (given) siteQueue.push(given);
  if (!given) {
    const [fromAi, fromSearch] = await Promise.all([askSite(brandName), searchSite(brandName)]);
    pushUnique(siteQueue, fromAi);
    for (const guess of slugCandidates(brandName)) pushUnique(siteQueue, guess);
    pushUnique(siteQueue, fromSearch);
  }

  // 2–3. Read the first site that answers.
  let hunt: Hunt | null = null;
  let site: string | null = null;
  for (const candidate of siteQueue) {
    const read = await readSite(candidate, brandName);
    if (read) {
      hunt = read;
      site = read.pages[0] ?? candidate;
      break;
    }
  }

  // 4. Gemini turns the hunt into guidelines.
  const run = await runFalJob(LLM_ENDPOINT, buildLlmInput(GUIDE_SYSTEM, buildPrompt(brandName, hunt, site ?? siteQueue[0] ?? null)), 60000);
  if (!run.ok) return { ok: false, error: run.error ?? 'The brand model failed.' };
  const text = findOutput(run.output);
  const parsed = text ? parseJsonObject(text) : null;
  if (!parsed) return { ok: false, error: 'The brand model returned text that could not be used. Try again.' };

  await logUsage({
    ownerEmail: opts.ownerEmail,
    projectId: opts.projectId ?? null,
    kind: 'text',
    provider: 'fal',
    model: llmModel(),
    meta: { endpoint: LLM_ENDPOINT, requestId: run.requestId, purpose: 'brand-guidelines', site },
  });
  if (run.requestId) await reportFalUsage({ email: opts.ownerEmail, endpointId: run.endpointId, requestId: run.requestId });

  const resolvedName = clip(parsed.brandName, MAX_SHORT) || brandName;
  const product = clip(parsed.product, MAX_SHORT);
  const website = cleanHttpUrl(parsed.website) ?? site ?? given ?? '';
  const c1 = cleanHex(parsed.c1, hunt?.colors[0] ?? DEFAULT_C1);
  const c2 = cleanHex(parsed.c2, hunt?.colors[1] ?? DEFAULT_C2);
  const c3 = cleanHex(parsed.c3, hunt?.colors[2] ?? DEFAULT_C3);
  const summary = clip(parsed.summary, 400);
  const fontNames = stringList(parsed.fontNames, 6).length ? stringList(parsed.fontNames, 6) : (hunt?.fontNames.slice(0, 6) ?? []);
  const headlineFont = clip(parsed.headlineFont, 80) || fontNames[0] || '';

  // 5. Downloads.
  const parts: BrandAssetPart[] = [];
  if (hunt) {
    const aiLogos = stringList(parsed.logoUrls, MAX_LOGOS).map((u) => cleanHttpUrl(u)).filter((u): u is string => u !== null);
    const aiRefs = stringList(parsed.refUrls, 6).map((u) => cleanHttpUrl(u)).filter((u): u is string => u !== null);
    const refOrder: string[] = [];
    for (const u of [...aiRefs, ...hunt.imageCandidates]) pushUnique(refOrder, u, 30);

    const rawLogos: BrandAssetPart[] = [];
    const host = hostOf(site ?? '') || 'brand';
    hunt.inlineSvgLogos.forEach((svg, i) => {
      const zone = hunt.inlineSvgZones[i] ?? 'inline';
      const url = `inline:${zone}:${i}`;
      hunt.logoMeta.set(url, { hint: `inline svg ${zone}`, zone });
      rawLogos.push({ kind: 'logos', name: cleanFileName(`${host}-logo${i ? `-${i + 1}` : ''}.svg`), mimeType: 'image/svg+xml', data: svg, sourceUrl: url });
    });

    // Every distinct variant the brand exposes: model picks first, then same-site header/footer/meta/body
    // logos that name the brand, then icons and well-known paths. Partner logos are only reachable
    // through the model's list, never through the fallback.
    const pickLogos = async (): Promise<BrandAssetPart[]> => {
      const siteUrl = site ?? '';
      const order: string[] = [];
      for (const u of aiLogos) pushUnique(order, u, 60);
      const own = hunt.logoCandidates
        .filter((u) => !aiLogos.includes(u))
        .filter((u) => {
          const meta = hunt.logoMeta.get(u);
          const zone = meta?.zone ?? 'body';
          if (zone === 'external') return false;
          if (zone === 'wellknown' || zone === 'icon') return sameSite(u, siteUrl);
          const hint = `${u} ${meta?.hint ?? ''}`;
          // Same-site and either sits in header/footer or names the brand.
          return sameSite(u, siteUrl) && (zone === 'header' || zone === 'footer' || zone === 'meta' || mentionsBrand(hint, hunt.brandTokens));
        })
        .sort((a, b) => zoneOrder(hunt.logoMeta.get(a)?.zone) - zoneOrder(hunt.logoMeta.get(b)?.zone));
      for (const u of own) pushUnique(order, u, 60);
      const slots = Math.max(1, MAX_LOGOS - rawLogos.length);
      const got = await collectUntil(order, slots, 4, (u) => downloadImage(u, 'logos', MAX_LOGO, 200, 'logo'));
      if (got.length === 0 && rawLogos.length === 0) {
        const external = hunt.logoCandidates.filter((u) => hunt.logoMeta.get(u)?.zone === 'external');
        return collectUntil(external, 1, 2, (u) => downloadImage(u, 'logos', MAX_LOGO, 200, 'logo'));
      }
      return got;
    };

    const [logos, refs, fonts, docs] = await Promise.all([
      pickLogos(),
      collectUntil(refOrder, MAX_REFS, 4, (u) => downloadImage(u, 'refs', MAX_REF, 15_000, 'creative')),
      collectUntil(hunt.fontCandidates, MAX_FONTS, 4, downloadFont),
      collectUntil(hunt.docCandidates, MAX_DOCS, 2, downloadDoc),
    ]);
    // Label each logo variant; drop exact duplicates before labelling so "Primary" lands on a real file.
    const taken = new Set<LogoVariant>();
    for (const logo of dedupeParts([...rawLogos, ...logos])) {
      const metaKey = logo.sourceUrl ?? '';
      let meta = hunt.logoMeta.get(metaKey);
      if (!meta) {
        // Redirected downloads: match by original candidate whose final URL we stored.
        for (const [u, m] of hunt.logoMeta) if (metaKey.startsWith(u.split('?')[0])) meta = m;
      }
      const variant = classifyLogo(logo, meta, taken);
      taken.add(variant);
      parts.push(labelLogo({ ...logo, sourceUrl: logo.sourceUrl?.startsWith('inline:') ? site : logo.sourceUrl }, variant));
    }
    parts.push(...refs, ...fonts);
    for (const d of docs) {
      parts.push(d.doc);
      for (const p of d.parts) {
        const part: BrandAssetPart = { kind: p.kind, name: p.name, mimeType: p.mimeType, data: p.data, sourceUrl: d.doc.sourceUrl };
        if (p.kind === 'logos') {
          const variant = classifyLogo(part, { hint: `brand kit ${p.name}`, zone: 'body' }, taken);
          taken.add(variant);
          parts.push(labelLogo(part, variant));
        } else parts.push(part);
      }
    }
  }

  const finalParts = dedupeParts(parts);
  const firstLogo = finalParts.find((p) => p.kind === 'logos');

  return {
    ok: true,
    result: {
      brandName: resolvedName,
      product,
      website,
      c1,
      c2,
      c3,
      summary,
      fontNames,
      headlineFont,
      logoUrl: firstLogo?.sourceUrl ?? null,
      parts: finalParts,
      pagesRead: hunt?.pages ?? [],
    },
  };
}
