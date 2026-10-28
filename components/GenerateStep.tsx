'use client';

import { useEffect, useRef, useState } from 'react';
import { drawAd } from '@/lib/draw-ad';
import { SIZES } from '@/lib/platforms';
import type { ProjectDTO, VersionDTO } from '@/lib/types';

interface GenerateStepProps {
  project: ProjectDTO;
  generating: boolean;
  busy: boolean;
  think: { title: string; detail: string; state: 'wait' | 'run' | 'done' }[];
  bar: number;
  error: string | null;
  onBack: () => void;
  onPatch: (version: VersionDTO) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRewrite: (id: string) => void;
  onImage: (id: string) => void;
}

function letter(index: number): string {
  return String.fromCharCode(65 + index);
}

function isHttpsUrl(value: string | null): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

export default function GenerateStep({ project, generating, busy, think, bar, error, onBack, onPatch, onAdd, onRemove, onRewrite, onImage }: GenerateStepProps) {
  const [activeId, setActiveId] = useState(project.versions[0]?.id ?? '');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
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
    const canvas = canvasRefs.current[version.id];
    if (!canvas) return;
    const link = document.createElement('a');
    const safePlatform = project.platform.replace(/[^\w]+/g, '-').toLowerCase();
    link.download = `ad-${safePlatform}-v${letter(version.position)}-${version.size}.png`;
    try {
      link.href = canvas.toDataURL('image/png');
    } catch {
      // Canvas is tainted when the image host blocks CORS: hand over the raw image instead.
      if (!isHttpsUrl(version.imageUrl)) return;
      link.href = version.imageUrl;
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.click();
  }

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
                  <div className="sk" style={{ height: 180, borderRadius: 12, background: 'var(--aurora-inset)' }} />
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
                    <div className="vactions">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setActiveId(version.id); }}>Edit</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); download(version); }}>PNG</button>
                      <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onImage(version.id); }}>
                        {busy ? 'Working…' : version.imageUrl ? 'New image' : 'Generate image'}
                      </button>
                      {project.versions.length > 1 && (
                        <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onRemove(version.id); }}>Remove</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="footer">
                <button type="button" className="btn ghost sm" disabled={busy} onClick={onAdd}>{busy ? 'Working…' : '+ Generate another version'}</button>
                <button type="button" className="btn ghost sm" onClick={() => project.versions.forEach((version, index) => setTimeout(() => download(version), index * 300))}>
                  Download all
                </button>
              </div>
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
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => onImage(active.id)}>{busy ? 'Working…' : 'Regenerate image'}</button>
                <button type="button" className="btn sm" onClick={() => download(active)}>Download PNG</button>
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
