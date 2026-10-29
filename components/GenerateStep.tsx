'use client';

import { useEffect, useRef, useState } from 'react';
import { drawAd } from '@/lib/draw-ad';
import { MAX_VERSIONS } from '@/lib/limits';
import { SIZES } from '@/lib/platforms';
import type { ProjectDTO, VersionDTO } from '@/lib/types';
import { zipStored } from '@/lib/zip-store';

interface GenerateStepProps {
  project: ProjectDTO;
  generating: boolean;
  busy: boolean;
  think: { title: string; detail: string; state: 'wait' | 'run' | 'done' }[];
  bar: number;
  error: string | null;
  onBack: () => void;
  onPatch: (version: VersionDTO) => void;
  onRefresh: () => void;
  onAdd: (count: number) => void;
  onRewrite: (id: string) => void;
  onImage: (id: string, editPrompt: string) => void;
}

function letter(index: number): string {
  return String.fromCharCode(65 + index);
}

function isHttpsUrl(value: string | null): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

export default function GenerateStep({ project, generating, busy, think, bar, error, onBack, onPatch, onRefresh, onAdd, onRewrite, onImage }: GenerateStepProps) {
  const [activeId, setActiveId] = useState(project.versions[0]?.id ?? '');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [moreText, setMoreText] = useState('1');
  const [zipNote, setZipNote] = useState<string | null>(null);
  const room = Math.max(0, MAX_VERSIONS - project.versions.length);
  const active = project.versions.find((item) => item.id === activeId) ?? project.versions[0];

  useEffect(() => {
    if (!project.versions.some((item) => item.id === activeId)) {
      setActiveId(project.versions[0]?.id ?? '');
    }
  }, [project.versions, activeId]);

  // Fal images are fetched once per URL with CORS so the canvas can export them.
  useEffect(() => {
    for (const version of project.versions) {
      const url = version.imageUrl;
      if (!isHttpsUrl(url) || imageCache.current[url]) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => setLoadedUrls((current) => ({ ...current, [url]: true }));
      img.onerror = () => setLoadedUrls((current) => ({ ...current, [url]: false }));
      img.src = url;
      imageCache.current[url] = img;
    }
  }, [project.versions]);

  useEffect(() => {
    for (const version of project.versions) {
      const canvas = canvasRefs.current[version.id];
      const image = isHttpsUrl(version.imageUrl) && loadedUrls[version.imageUrl] ? imageCache.current[version.imageUrl] : null;
      if (canvas) drawAd(canvas, version, project.brandName, image);
    }
  }, [project.versions, project.brandName, loadedUrls]);

  function patch(partial: Partial<VersionDTO>) {
    if (!active) return;
    onPatch({ ...active, ...partial });
  }

  function download(version: VersionDTO) {
    const link = document.createElement('a');
    link.download = fileName(version);
    const painted = isHttpsUrl(version.imageUrl) && loadedUrls[version.imageUrl] === true;
    const canvas = canvasRefs.current[version.id];
    if (painted && canvas) {
      try {
        link.href = canvas.toDataURL('image/png');
        link.click();
        return;
      } catch {
        // Canvas is tainted when the image host blocks CORS: hand over the raw image instead.
      }
    }
    if (!isHttpsUrl(version.imageUrl)) return;
    link.href = version.imageUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.click();
  }

  function fileName(version: VersionDTO): string {
    const safePlatform = project.platform.replace(/[^\w]+/g, '-').toLowerCase();
    return `ad-${safePlatform}-v${letter(version.position)}-${version.size}.png`;
  }

  function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))).catch(() => resolve(null));
      }, 'image/png');
    });
  }

  async function pngBytes(version: VersionDTO): Promise<Uint8Array | null> {
    const canvas = canvasRefs.current[version.id];
    if (canvas) {
      const drawn = await canvasPng(canvas);
      if (drawn) return drawn;
    }
    if (!isHttpsUrl(version.imageUrl)) return null;
    try {
      const res = await fetch(version.imageUrl);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async function downloadAll() {
    setZipNote(null);
    const files: { name: string; data: Uint8Array }[] = [];
    for (const version of project.versions) {
      const data = await pngBytes(version);
      if (data) files.push({ name: fileName(version), data });
    }
    if (files.length === 0) {
      setZipNote('Could not package the images. Use PNG on each version.');
      return;
    }
    const blob = zipStored(files);
    const link = document.createElement('a');
    const safePlatform = project.platform.replace(/[^\w]+/g, '-').toLowerCase();
    link.href = URL.createObjectURL(blob);
    link.download = `ad-${safePlatform}-versions.zip`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    if (files.length < project.versions.length) setZipNote(`Packaged ${files.length} of ${project.versions.length} versions.`);
  }

  function typedCount(): number | null {
    if (!/^\d+$/.test(moreText)) return null;
    const next = Number(moreText);
    if (next < 1 || next > room) return null;
    return next;
  }

  function plannedLetters(count: number): string {
    const start = project.versions.length;
    const names = Array.from({ length: count }, (_, index) => letter(start + index));
    if (names.length <= 1) return names[0] ?? '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }

  function imageReady(version: VersionDTO): boolean {
    if (!isHttpsUrl(version.imageUrl)) return false;
    return loadedUrls[version.imageUrl] !== undefined;
  }

  const allReady = project.versions.length > 0 && project.versions.every(imageReady);

  function imageState(version: VersionDTO): string {
    if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] === false ? 'Image could not be displayed' : loadedUrls[version.imageUrl] ? 'fal.ai image' : 'Loading image…';
    if (version.imageError) return `Image failed: ${version.imageError}`;
    return 'No image yet';
  }

  return (
    <div className="wide-single">
      <div className="card">
        <h3>Your ad</h3>
        <p className="sub">Edit copy, colors, and layout. The preview updates live. Download when it looks right.</p>
        {error && <div className="err" role="alert">{error}</div>}

        {generating && (
          <div className="gen-layout" aria-live="polite">
            <div className="versions">
              {[0, 1].map((item) => (
                <div key={item} className="vcard">
                  <div className="vhead"><strong>Version {letter(item)}</strong></div>
                  <div className="sk" style={{ height: 180, background: 'var(--aurora-inset)' }} />
                </div>
              ))}
            </div>
            <div>
              <h4>Creating your ads…</h4>
              <p className="hint">Gemini writes the words from your copy prompt, then fal.ai renders each image. This can take up to a minute.</p>
              {think.map((step) => (
                <div key={step.title} className={`think-step ${step.state}`}>
                  <span>{step.state === 'done' ? '✓' : step.state === 'run' ? '•' : '○'}</span>
                  <span>
                    {step.title}
                    <span className="detail">{step.detail}</span>
                  </span>
                </div>
              ))}
              <div className="bar"><span style={{ width: `${bar}%` }} /></div>
            </div>
          </div>
        )}

        {!generating && active && (
          <div className="preview-grid">
            <div>
              <div className="versions">
                {project.versions.map((version) => (
                  <div key={version.id} className={`vcard${version.id === active.id ? ' on' : ''}`} onClick={() => setActiveId(version.id)} role="button" tabIndex={0}>
                    <div className="vhead">
                      <strong>Version {letter(version.position)}</strong>
                      <span>{version.size.replace('x', '×')}</span>
                    </div>
                    <canvas ref={(node) => { canvasRefs.current[version.id] = node; }} />
                    <div className="vcopy">{version.primary}</div>
                    <div className="hint" style={{ marginTop: 6 }}>{imageState(version)}</div>
                    <label htmlFor={`edit-${version.id}`} className="hint" style={{ display: 'block', marginTop: 8 }}>What should change? Nano Banana Pro edits this image only.</label>
                    <textarea
                      id={`edit-${version.id}`}
                      className="short"
                      value={edits[version.id] ?? ''}
                      placeholder="e.g. Remove the flowers on the table"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEdits((current) => ({ ...current, [version.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn sm"
                      style={{ marginTop: 8 }}
                      disabled={busy || (edits[version.id] ?? '').trim() === ''}
                      onClick={(e) => { e.stopPropagation(); onImage(version.id, edits[version.id] ?? ''); }}
                    >
                      {busy ? 'Working…' : 'Update this image'}
                    </button>
                    <div className="vactions">
                      <button type="button" disabled={!imageReady(version) || busy} onClick={(e) => { e.stopPropagation(); download(version); }}>PNG</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="more-row">
                <div>
                  <label htmlFor="moreCount">How many more versions?</label>
                  <input
                    id="moreCount"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="4"
                    value={moreText}
                    disabled={busy || room === 0}
                    onChange={(e) => setMoreText(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  />
                </div>
                <button type="button" className="btn sm" disabled={busy || typedCount() === null} onClick={() => { const count = typedCount(); if (count) onAdd(count); }}>
                  {busy ? 'Working…' : typedCount() === null ? 'Generate' : `Generate ${typedCount()}`}
                </button>
              </div>
              <p className="hint">
                {room === 0
                  ? `You already have ${MAX_VERSIONS} versions.`
                  : typedCount() === null
                    ? `Type a number from 1 to ${room}, such as 4, 5, or 6.`
                    : `Type a number, such as 4, 5, or 6. ${typedCount()} makes ${plannedLetters(typedCount() ?? 1)}. Up to ${MAX_VERSIONS} in total.`}
              </p>
              <div className="footer">
                <button type="button" className="btn ghost sm" disabled={busy} onClick={onRefresh}>{busy ? 'Working…' : 'Regenerate both images'}</button>
                <button type="button" className="btn ghost sm" disabled={busy || !allReady} onClick={() => void downloadAll()}>
                  Download all versions
                </button>
              </div>
              {!allReady && <p className="hint">Download opens after every image has finished.</p>}
              {zipNote && <p className="hint">{zipNote}</p>}
              <div className="card" style={{ marginTop: 14, padding: 14 }}>
                <h4>Primary text</h4>
                <p>{active.primary}</p>
                <p className="hint">{project.platform} · {project.format} · {active.size.replace('x', '×')}px · {project.tone} · {project.visualStyle} · {project.imageModel}</p>
                {active.imagePrompt && (
                  <details style={{ marginTop: 8 }}>
                    <summary className="hint" style={{ cursor: 'pointer' }}>Image prompt sent to fal.ai</summary>
                    <pre className="hint" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{active.imagePrompt}</pre>
                  </details>
                )}
              </div>
            </div>
            <div>
              <h4>Modify version {letter(active.position)}</h4>
              <label htmlFor="mHeadline">Headline</label>
              <input id="mHeadline" type="text" value={active.headline} onChange={(e) => patch({ headline: e.target.value })} />
              <label htmlFor="mSub">Subline</label>
              <input id="mSub" type="text" value={active.sub} onChange={(e) => patch({ sub: e.target.value })} />
              <label htmlFor="mCta">CTA button</label>
              <input id="mCta" type="text" value={active.cta} onChange={(e) => patch({ cta: e.target.value })} />
              <label htmlFor="mPrimary">Primary text</label>
              <textarea id="mPrimary" className="short" value={active.primary} onChange={(e) => patch({ primary: e.target.value })} />
              <label htmlFor="mLayout">Layout</label>
              <select id="mLayout" value={active.layout} onChange={(e) => patch({ layout: e.target.value as VersionDTO['layout'] })}>
                <option value="left">Left aligned</option>
                <option value="center">Centered</option>
                <option value="bottom">Bottom band</option>
              </select>
              <label htmlFor="mBg">Background</label>
              <select id="mBg" value={active.bg} onChange={(e) => patch({ bg: e.target.value as VersionDTO['bg'] })}>
                <option value="gradient">Brand gradient</option>
                <option value="solid">Solid brand</option>
                <option value="light">Light / white</option>
              </select>
              <label>Colors</label>
              <div className="swatches">
                <input type="color" value={active.c1} onChange={(e) => patch({ c1: e.target.value })} aria-label="Color 1" />
                <input type="color" value={active.c2} onChange={(e) => patch({ c2: e.target.value })} aria-label="Color 2" />
                <input type="color" value={active.c3} onChange={(e) => patch({ c3: e.target.value })} aria-label="Color 3" />
              </div>
              <label htmlFor="mSize">Size</label>
              <select id="mSize" value={active.size} onChange={(e) => patch({ size: e.target.value })}>
                {SIZES.map((size) => (
                  <option key={size} value={size}>{size.replace('x', ' × ')}</option>
                ))}
              </select>
              <div className="footer">
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => onRewrite(active.id)}>Rewrite copy</button>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={onRefresh}>{busy ? 'Working…' : 'Regenerate both images'}</button>
                <button type="button" className="btn sm" disabled={busy || !imageReady(active)} onClick={() => download(active)}>Download PNG</button>
              </div>
              <div className="footer" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="btn ghost sm" onClick={onBack}>Change platform / brief</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
