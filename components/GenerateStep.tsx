'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import HexColorField from '@/components/HexColorField';
import {
  clearPopupOrigin,
  positionPatch,
  readTextStyle,
  readTextValue,
  stylePatch,
  textKindLabel,
  textValuePatch,
  type TextBox,
  type TextKind,
  type TextStyle,
} from '@/lib/ad-layout';
import { drawAd } from '@/lib/draw-ad';
import { MAX_VERSIONS } from '@/lib/limits';
import { SIZES } from '@/lib/platforms';
import type { ProjectDTO, VersionDTO } from '@/lib/types';
import { zipStored } from '@/lib/zip-store';

interface GenerateStepProps {
  project: ProjectDTO;
  generating: boolean;
  busy: boolean;
  thoughts: string;
  error: string | null;
  onPatch: (version: VersionDTO) => void;
  onAdd: (count: number) => void;
  onImage: (id: string, editPrompt: string) => void;
  onDelete: () => void;
}

function letter(index: number): string {
  return String.fromCharCode(65 + index);
}

function isHttpsUrl(value: string | null): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value);
}

const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

function brandLogos(project: ProjectDTO) {
  return project.assets.filter((item) => item.kind === 'logos' && LOGO_MIMES.has(item.mimeType));
}

/** Brief "On ad" pick, or the first brand logo if nothing was ticked. */
function defaultLogoId(project: ProjectDTO): string | null {
  const logos = brandLogos(project);
  if (logos.length === 0) return null;
  const picked = new Set(project.renderAssetIds);
  const chosen = (picked.size ? logos.filter((item) => picked.has(item.id)) : logos)[0] ?? logos[0];
  return chosen?.id ?? null;
}

/** Logo drawn on a version: cancelled → none; else version pick or Brief default. */
function resolveLogoId(project: ProjectDTO, version: VersionDTO): string | null {
  if (version.showLogo === false) return null;
  const logos = brandLogos(project);
  if (logos.length === 0) return null;
  if (version.logoAssetId && logos.some((item) => item.id === version.logoAssetId)) return version.logoAssetId;
  return defaultLogoId(project);
}

function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`;
}

export default function GenerateStep({ project, generating, busy, thoughts, error, onPatch, onAdd, onImage, onDelete }: GenerateStepProps) {
  const [deleting, setDeleting] = useState(false);
  const [activeId, setActiveId] = useState(project.versions[0]?.id ?? '');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const logoCache = useRef<Record<string, HTMLImageElement>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [logoReadyIds, setLogoReadyIds] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [moreText, setMoreText] = useState('1');
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [holdPanel, setHoldPanel] = useState(false);
  const [localThoughts, setLocalThoughts] = useState('');
  const [appendBusy, setAppendBusy] = useState(false);
  const [pendingExtra, setPendingExtra] = useState(0);
  /** Which on-ad text block is open in the left popup editor. */
  const [textEdit, setTextEdit] = useState<{ versionId: string; kind: TextKind } | null>(null);
  const appendFromRef = useRef(0);
  const room = Math.max(0, MAX_VERSIONS - project.versions.length);
  const active = project.versions.find((item) => item.id === activeId) ?? project.versions[0];
  const thoughtText = [thoughts, localThoughts].filter(Boolean).join('\n\n');
  const logos = brandLogos(project);
  const activeLogoId = active ? resolveLogoId(project, active) : null;

  useEffect(() => {
    if (!project.versions.some((item) => item.id === activeId)) {
      setActiveId(project.versions[0]?.id ?? '');
    }
  }, [project.versions, activeId]);

  useEffect(() => {
    if (!textEdit) return;
    if (!project.versions.some((item) => item.id === textEdit.versionId)) setTextEdit(null);
  }, [project.versions, textEdit]);

  // Keep the step list and thinking open until every preview image has settled on the canvas.
  useEffect(() => {
    if (!generating) return;
    setHoldPanel(true);
    setLocalThoughts('');
    setLoadedUrls({});
    imageCache.current = {};
  }, [generating]);

  // Brand logos for canvas overlay — same-origin asset URLs, so downloads stay untainted.
  const logoIdsKey = logos.map((item) => item.id).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const logo of logos) {
      if (logoCache.current[logo.id]) continue;
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        logoCache.current[logo.id] = img;
        setLogoReadyIds((current) => ({ ...current, [logo.id]: true }));
      };
      img.onerror = () => {
        if (cancelled) return;
        delete logoCache.current[logo.id];
        setLogoReadyIds((current) => ({ ...current, [logo.id]: false }));
      };
      img.src = assetUrl(logo.id);
    }
    return () => {
      cancelled = true;
    };
  }, [logoIdsKey]);

  function logoImageFor(version: VersionDTO): HTMLImageElement | null {
    const id = resolveLogoId(project, version);
    if (!id || logoReadyIds[id] !== true) return null;
    return logoCache.current[id] ?? null;
  }

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
    if (!holdPanel || generating) return;
    if (project.versions.length === 0) return;
    const settled = project.versions.every((version) => {
      if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] !== undefined;
      return Boolean(version.imageError);
    });
    if (!settled) return;
    setLocalThoughts('The previews are on the canvas. The ad is ready to review.');
    setHoldPanel(false);
  }, [holdPanel, generating, project.versions, loadedUrls]);

  // Extra versions: keep A/B as finished previews; only wait on the new cards.
  useEffect(() => {
    if (!appendBusy) return;
    if (busy) return;
    const extras = project.versions.filter((version) => version.position >= appendFromRef.current);
    if (extras.length === 0) {
      setAppendBusy(false);
      setPendingExtra(0);
      return;
    }
    const settled = extras.every((version) => {
      if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] !== undefined;
      return Boolean(version.imageError);
    });
    if (!settled) return;
    setAppendBusy(false);
    setPendingExtra(0);
  }, [appendBusy, busy, project.versions, loadedUrls]);

  const showCreating = generating || holdPanel;
  const stillNeeded = appendBusy ? Math.max(0, appendFromRef.current + pendingExtra - project.versions.length) : 0;
  const imagesSettled = project.versions.length > 0 && project.versions.every((version) => {
    if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] !== undefined;
    return Boolean(version.imageError);
  });
  const progress = buildProgress(project, thoughtText, showCreating, imagesSettled && !showCreating);

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

  function requestAdd(count: number) {
    appendFromRef.current = project.versions.length;
    setPendingExtra(count);
    setAppendBusy(true);
    onAdd(count);
  }

  // Which cards are being redrawn right now: new extras, both A and B on a redraw, or one card on an edit.
  const [redrawIds, setRedrawIds] = useState<string[]>([]);

  useEffect(() => {
    if (busy) return;
    if (redrawIds.length === 0) return;
    const pending = project.versions.filter((version) => redrawIds.includes(version.id));
    const settled = pending.every((version) => {
      if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] !== undefined;
      return Boolean(version.imageError);
    });
    if (settled) setRedrawIds([]);
  }, [busy, redrawIds, project.versions, loadedUrls]);

  function requestImage(id: string, editPrompt: string) {
    setRedrawIds([id]);
    onImage(id, editPrompt);
  }

  function extraPending(version: VersionDTO): boolean {
    if (redrawIds.includes(version.id)) {
      if (busy) return true;
      if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] === undefined;
      return !version.imageError;
    }
    if (!appendBusy) return false;
    if (version.position < appendFromRef.current) return false;
    if (isHttpsUrl(version.imageUrl)) return loadedUrls[version.imageUrl] === undefined;
    return !version.imageError;
  }

  const working = busy || appendBusy || redrawIds.length > 0;
  // Extra versions show loaders only. Thinking streams for the first generate, redraws, and single-image edits.
  const thinkingNow = redrawIds.length > 0 || (busy && !appendBusy);

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
        <p className="sub">Edit copy, colors, and layout — preview updates live.</p>
        {error && <div className="err" role="alert">{error}</div>}

        {showCreating && (
          <div className="preview-grid" aria-live="polite">
            <div>
              <div className="versions">
                {[0, 1].map((item) => (
                  <div key={item} className="vcard">
                    <div className="vhead"><strong>Version {letter(item)}</strong></div>
                    <div className="preview-wait" role="status" aria-label={`Version ${letter(item)} is still rendering`}>
                      <span className="ad-spinner" aria-hidden="true" />
                      <span className="preview-wait-label">Rendering…</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="creating-head">
                <span className="ad-spinner sm" aria-hidden="true" />
                <h4>Creating your ads…</h4>
              </div>
              <p className="hint">Still working. Spinners stay until the final pictures show in Version A and B.</p>
              {progress.steps.map((step) => (
                <div key={step.title} className={`think-step ${step.state}`}>
                  <span aria-hidden="true">
                    {step.state === 'done' ? '✓' : step.state === 'run' ? <span className="ad-spinner sm" /> : '○'}
                  </span>
                  <span>
                    {step.title}
                    <span className="detail">{step.detail}</span>
                  </span>
                </div>
              ))}
              <div className="bar run"><span style={{ width: `${progress.bar}%` }} /></div>
              <p className="hint creating-live">In progress — do not leave this page until the images finish.</p>
              <ThoughtChain text={thoughtText} thinking />
            </div>
          </div>
        )}

        {!showCreating && active && (
          <div className="preview-grid">
            <div className="gen-focus-col">
              <div className="gen-rail-bar">
                <div className="gen-rail" role="listbox" aria-label="Ad versions">
                  {project.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      role="option"
                      aria-selected={version.id === active.id}
                      className={`gen-rail-item${version.id === active.id ? ' on' : ''}`}
                      onClick={() => setActiveId(version.id)}
                    >
                      <span className="gen-rail-label">
                        <strong>{letter(version.position)}</strong>
                        <span>{version.size.replace('x', '×')}</span>
                      </span>
                      {extraPending(version) ? (
                        <div className="gen-rail-wait" aria-hidden="true">
                          <span className="ad-spinner sm" />
                        </div>
                      ) : (
                        <AdStage
                          compact
                          version={version}
                          brand={project.brandName}
                          image={isHttpsUrl(version.imageUrl) && loadedUrls[version.imageUrl] ? imageCache.current[version.imageUrl] : null}
                          logo={logoImageFor(version)}
                          logos={[]}
                          activeLogoId={null}
                          active={version.id === active.id}
                          editingKind={null}
                          onCanvas={(node) => {
                            if (version.id === active.id) return;
                            canvasRefs.current[version.id] = node;
                          }}
                          onMove={() => {}}
                          onStyle={() => {}}
                          onText={() => {}}
                          onOpenEdit={() => setActiveId(version.id)}
                          onSaveEdit={() => {}}
                          onPickLogo={() => {}}
                          onCancelLogo={() => {}}
                        />
                      )}
                    </button>
                  ))}
                  {Array.from({ length: stillNeeded }, (_, index) => {
                    const position = project.versions.length + index;
                    return (
                      <div key={`pending-${position}`} className="gen-rail-item pending" aria-hidden="true">
                        <span className="gen-rail-label"><strong>{letter(position)}</strong></span>
                        <div className="gen-rail-wait">
                          <span className="ad-spinner sm" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="gen-rail-more">
                  <label htmlFor="moreCount" className="sr-only">Add more versions</label>
                  <input
                    id="moreCount"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="+"
                    title={room === 0 ? `Already at ${MAX_VERSIONS} versions` : `Add 1–${room} more`}
                    value={moreText}
                    disabled={busy || appendBusy || room === 0}
                    onChange={(e) => setMoreText(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  />
                  <button type="button" className="btn ghost sm" disabled={busy || appendBusy || typedCount() === null} onClick={() => { const count = typedCount(); if (count) requestAdd(count); }}>
                    {appendBusy ? '…' : typedCount() === null ? 'Add' : `+${typedCount()}`}
                  </button>
                </div>
              </div>
              {appendBusy && (
                <p className="hint creating-live">
                  Adding versions in the strip above — selected ad stays as it is.
                </p>
              )}
              <p className="hint gen-rail-hint">
                {room === 0
                  ? `You already have ${MAX_VERSIONS} versions.`
                  : 'Pick a miniature above, then edit the large preview. Add more versions from the + control.'}
              </p>

              <div className="gen-focus-card">
                <div className="vhead">
                  <strong>Version {letter(active.position)}</strong>
                  <span>{active.size.replace('x', '×')}</span>
                </div>
                {extraPending(active) ? (
                  <div className="preview-wait" role="status" aria-label={`Version ${letter(active.position)} is still rendering`}>
                    <span className="ad-spinner" aria-hidden="true" />
                    <span className="preview-wait-label">Rendering…</span>
                  </div>
                ) : (
                  <AdStage
                    version={active}
                    brand={project.brandName}
                    image={isHttpsUrl(active.imageUrl) && loadedUrls[active.imageUrl] ? imageCache.current[active.imageUrl] : null}
                    logo={logoImageFor(active)}
                    logos={logos.map((item) => ({ id: item.id, name: item.name, url: assetUrl(item.id) }))}
                    activeLogoId={activeLogoId}
                    active
                    editingKind={textEdit?.versionId === active.id ? textEdit.kind : null}
                    onCanvas={(node) => { canvasRefs.current[active.id] = node; }}
                    onMove={(kind, x, y, width, height) => {
                      onPatch({ ...active, ...positionPatch(kind, x, y, width, height) });
                    }}
                    onStyle={(kind, style) => {
                      onPatch({ ...active, ...stylePatch(kind, style) });
                    }}
                    onText={(kind, value) => {
                      onPatch({ ...active, ...textValuePatch(kind, value) });
                    }}
                    onOpenEdit={(kind) => {
                      setTextEdit((current) =>
                        current?.versionId === active.id && current.kind === kind
                          ? null
                          : { versionId: active.id, kind },
                      );
                    }}
                    onSaveEdit={() => setTextEdit(null)}
                    onPickLogo={(id) => {
                      onPatch({ ...active, logoAssetId: id, showLogo: true });
                      setTextEdit(null);
                    }}
                    onCancelLogo={() => {
                      onPatch({ ...active, showLogo: false });
                      setTextEdit(null);
                    }}
                  />
                )}
                <p className="hint gen-focus-status">
                  {extraPending(active)
                    ? 'Still drawing this version…'
                    : `${imageState(active)}. Click the logo for options · drag to move · click text to edit.`}
                </p>
                <div className="gen-image-edit">
                  <label htmlFor={`edit-${active.id}`}>Update this image</label>
                  <textarea
                    id={`edit-${active.id}`}
                    className="gen-image-edit-input"
                    rows={2}
                    value={edits[active.id] ?? ''}
                    placeholder="e.g. Brighter daylight, remove the flowers"
                    onChange={(e) => setEdits((current) => ({ ...current, [active.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy || appendBusy || (edits[active.id] ?? '').trim() === ''}
                    onClick={() => requestImage(active.id, edits[active.id] ?? '')}
                  >
                    {busy && !appendBusy ? 'Working…' : 'Update this image'}
                  </button>
                </div>
              </div>

              <div className="gen-secondary">
                <button type="button" className="btn ghost sm" disabled={busy || !allReady} onClick={() => void downloadAll()}>
                  Download all versions
                </button>
              </div>
              {!allReady && <p className="hint">Download all opens after every image has finished.</p>}
              {zipNote && <p className="hint">{zipNote}</p>}
              <details className="gen-meta-card">
                <summary>Primary text &amp; details</summary>
                <p>{active.primary}</p>
                <p className="hint">{project.platform} · {project.format} · {active.size.replace('x', '×')}px · {project.tone} · {project.visualStyle} · {project.imageModel} · {project.imageResolution}</p>
                {active.imagePrompt && (
                  <details style={{ marginTop: 8 }}>
                    <summary className="hint" style={{ cursor: 'pointer' }}>Image prompt sent to fal.ai</summary>
                    <pre className="hint" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{active.imagePrompt}</pre>
                  </details>
                )}
              </details>
            </div>

            <div className="gen-side">
              {(thoughtText || thinkingNow) && <ThoughtChain text={thoughtText} thinking={thinkingNow} />}
              <h4>Modify version {letter(active.position)}</h4>
              <p className="hint">Click headline, subline or CTA on the preview to edit type. Save or click the same text again to close.</p>
              <label htmlFor="mHeadline">Headline</label>
              <input id="mHeadline" type="text" value={active.headline} onChange={(e) => patch({ headline: e.target.value, showHeadline: true })} />
              <div className="text-toggle-row">
                <button type="button" className="btn ghost sm" disabled={active.showHeadline === false} onClick={() => patch({ showHeadline: false })}>Hide</button>
                <button type="button" className="btn ghost sm" disabled={active.showHeadline !== false || active.headline.trim() === ''} onClick={() => patch({ showHeadline: true })}>Show</button>
              </div>
              <label htmlFor="mSub">Subline</label>
              <input
                id="mSub"
                type="text"
                value={active.sub}
                placeholder="Optional"
                onChange={(e) => {
                  const sub = e.target.value;
                  patch({ sub, showSub: sub.trim() !== '' ? true : active.showSub });
                }}
              />
              <div className="text-toggle-row">
                <button type="button" className="btn ghost sm" disabled={active.showSub === false || active.sub.trim() === ''} onClick={() => patch({ showSub: false })}>Hide</button>
                <button type="button" className="btn ghost sm" disabled={active.showSub !== false || active.sub.trim() === ''} onClick={() => patch({ showSub: true })}>Show</button>
              </div>
              <label htmlFor="mCta">CTA</label>
              <input id="mCta" type="text" value={active.cta} onChange={(e) => patch({ cta: e.target.value })} />
              <label className="show-toggle" htmlFor="showCta">
                <input
                  id="showCta"
                  type="checkbox"
                  checked={active.showCta !== false}
                  onChange={(e) => patch({ showCta: e.target.checked })}
                />
                <span>Show CTA on the image</span>
              </label>
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
                <option value="photo">Photo</option>
                <option value="gradient">Brand tint</option>
                <option value="solid">Solid panel</option>
                <option value="light">Light panel</option>
              </select>
              <label>Colors</label>
              <div className="color-fields">
                <HexColorField id="c1" label="C1" value={active.c1} onChange={(hex) => patch({ c1: hex })} />
                <HexColorField id="c2" label="C2" value={active.c2} onChange={(hex) => patch({ c2: hex })} />
                <HexColorField id="c3" label="C3" value={active.c3} onChange={(hex) => patch({ c3: hex })} />
              </div>
              <label htmlFor="mSize">Size</label>
              <select id="mSize" value={active.size} onChange={(e) => patch({ size: e.target.value })}>
                {SIZES.map((size) => (
                  <option key={size} value={size}>{size.replace('x', ' × ')}</option>
                ))}
              </select>

              <div className="gen-actions">
                <p className="gen-actions-label">Main actions</p>
                <button type="button" className="btn sm" disabled={busy || !imageReady(active)} onClick={() => download(active)}>
                  Download PNG
                </button>
                <button
                  type="button"
                  className="btn ghost sm gen-delete"
                  disabled={busy || working || deleting}
                  onClick={() => {
                    if (!window.confirm('Delete this ad? This cannot be undone.')) return;
                    setDeleting(true);
                    onDelete();
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete ad'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdStage({
  version,
  brand,
  image,
  logo,
  logos,
  activeLogoId,
  active,
  editingKind,
  compact = false,
  onCanvas,
  onMove,
  onStyle,
  onText,
  onOpenEdit,
  onSaveEdit,
  onPickLogo,
  onCancelLogo,
}: {
  version: VersionDTO;
  brand: string;
  image: HTMLImageElement | null | undefined;
  logo: HTMLImageElement | null;
  logos: { id: string; name: string; url: string }[];
  activeLogoId: string | null;
  active: boolean;
  editingKind: TextKind | null;
  compact?: boolean;
  onCanvas: (node: HTMLCanvasElement | null) => void;
  onMove: (kind: TextKind, x: number, y: number, width: number, height: number) => void;
  onStyle: (kind: TextKind, style: Partial<TextStyle>) => void;
  onText: (kind: TextKind, value: string) => void;
  onOpenEdit: (kind: TextKind) => void;
  onSaveEdit: () => void;
  onPickLogo: (id: string) => void;
  onCancelLogo: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ kind: TextKind; ox: number; oy: number; x: number; y: number; moved: boolean } | null>(null);
  const popDragRef = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [frame, setFrame] = useState({ sw: 1, sh: 1, cw: 1, ch: 1 });
  const [dragLive, setDragLive] = useState<{ kind: TextKind; x: number; y: number } | null>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);
  const [popPos, setPopPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [cw, ch] = version.size.split('x').map((n) => Number(n));
    const painted = dragLive
      ? { ...version, ...positionPatch(dragLive.kind, dragLive.x, dragLive.y, cw || 1, ch || 1) }
      : version;
    setBoxes(drawAd(canvas, painted, brand, image, { logo }));
    const host = frameRef.current;
    if (!host) return;
    const sync = () => {
      const rect = host.getBoundingClientRect();
      setFrame({ sw: rect.width, sh: rect.height, cw: canvas.width || 1, ch: canvas.height || 1 });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(host);
    return () => ro.disconnect();
  }, [version, brand, image, logo, dragLive]);

  // Fresh open → park the popup clear of the selected text; user can drag it anywhere after.
  useEffect(() => {
    setPopPos(null);
  }, [editingKind, version.id]);

  const scaleX = frame.sw / frame.cw;
  const scaleY = frame.sh / frame.ch;
  const editBox = editingKind && editingKind !== 'logo' ? boxes.find((box) => box.kind === editingKind) ?? null : null;
  const logoBox = boxes.find((box) => box.kind === 'logo') ?? null;
  const editStyle = editingKind && editingKind !== 'logo' ? readTextStyle(version, editingKind) : null;
  const sizeLabel = editStyle ? Math.round(editStyle.scale * 100) : 100;
  const trackLabel = editStyle ? Math.round(editStyle.track * 100) : 0;
  const leadLabel = editStyle ? Math.round(editStyle.lead * 100) : 100;
  const popW = 260;
  const popH = 360;
  const logoPopW = 280;
  const logoPopH = 168;
  const logoDrawerOpen = !compact && editingKind === 'logo';
  const logoPopOrigin = logoBox
    ? clearPopupOrigin(logoBox, scaleX, scaleY, frame.sw, frame.sh, logoPopW, logoPopH)
    : { x: Math.max(8, frame.sw - logoPopW - 8), y: 8 };
  const logoPopLeft = popPos && logoDrawerOpen ? popPos.x : logoPopOrigin.x;
  const logoPopTop = popPos && logoDrawerOpen ? popPos.y : logoPopOrigin.y;

  function onPointerDown(kind: TextKind, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    onOpenEdit(kind);
    const box = boxes.find((item) => item.kind === kind);
    if (!box) return;
    const host = frameRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    dragRef.current = {
      kind,
      ox: event.clientX - rect.left - box.x * scaleX,
      oy: event.clientY - rect.top - box.y * scaleY,
      x: box.x,
      y: box.y,
      moved: false,
    };
    setDragLive({ kind, x: box.x, y: box.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const host = frameRef.current;
    if (!drag || !host) return;
    const rect = host.getBoundingClientRect();
    const box = boxes.find((item) => item.kind === drag.kind);
    const maxX = Math.max(0, frame.cw - (box?.w ?? 0));
    const maxY = Math.max(0, frame.ch - (box?.h ?? 0));
    const x = Math.min(maxX, Math.max(0, (event.clientX - rect.left - drag.ox) / scaleX));
    const y = Math.min(maxY, Math.max(0, (event.clientY - rect.top - drag.oy) / scaleY));
    if (Math.hypot(x - drag.x, y - drag.y) > 2) drag.moved = true;
    drag.x = x;
    drag.y = y;
    setDragLive({ kind: drag.kind, x, y });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag) {
      if (drag.moved) onMove(drag.kind, drag.x, drag.y, frame.cw, frame.ch);
      dragRef.current = null;
      setDragLive(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be released.
      }
    }
  }

  function onPopPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const stage = stageRef.current;
    if (!stage) return;
    const origin = popPos ?? (logoDrawerOpen
      ? logoPopOrigin
      : editBox
        ? clearPopupOrigin(editBox, scaleX, scaleY, frame.sw, frame.sh, popW, popH)
        : { x: 8, y: 8 });
    const rect = stage.getBoundingClientRect();
    popDragRef.current = {
      ox: event.clientX - rect.left - origin.x,
      oy: event.clientY - rect.top - origin.y,
      x: origin.x,
      y: origin.y,
    };
    setPopPos(origin);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPopPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = popDragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    const x = Math.min(Math.max(-40, event.clientX - rect.left - drag.ox), Math.max(8, frame.sw - 48));
    const y = Math.min(Math.max(-20, event.clientY - rect.top - drag.oy), Math.max(8, frame.sh - 48));
    drag.x = x;
    drag.y = y;
    setPopPos({ x, y });
  }

  function onPopPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    popDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released.
    }
  }

  const defaultPop = editBox
    ? clearPopupOrigin(editBox, scaleX, scaleY, frame.sw, frame.sh, popW, popH)
    : { x: 8, y: 8 };
  const popLeft = popPos?.x ?? defaultPop.x;
  const popTop = popPos?.y ?? defaultPop.y;

  return (
    <div ref={stageRef} className={`ad-stage${active ? ' on' : ''}${editingKind ? ' editing' : ''}${compact ? ' compact' : ''}`}>
      <div ref={frameRef} className="ad-stage-frame">
        <canvas
          ref={(node) => {
            canvasRef.current = node;
            onCanvas(node);
          }}
        />
        {!compact && boxes.map((box) => (
          <div
            key={box.kind}
            className={`ad-handle${dragLive?.kind === box.kind ? ' dragging' : ''}${editingKind === box.kind ? ' selected' : ''}`}
            style={{
              left: box.x * scaleX - 6,
              top: box.y * scaleY - 6,
              width: box.w * scaleX + 12,
              height: box.h * scaleY + 12,
            }}
            onPointerDown={(event) => onPointerDown(box.kind, event)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={(event) => event.stopPropagation()}
            role="button"
            tabIndex={0}
            aria-label={`Edit ${box.kind}`}
          >
            <span>{textKindLabel(box.kind)}</span>
          </div>
        ))}
      </div>
      {!compact && !logo && logos.length > 0 && (
        <button
          type="button"
          className="logo-stage-open"
          onClick={(event) => {
            event.stopPropagation();
            onOpenEdit('logo');
          }}
        >
          Logo
        </button>
      )}
      {logoDrawerOpen && (
        <div
          className="logo-edit-pop"
          style={{ left: logoPopLeft, top: logoPopTop, width: logoPopW }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-label="Brand logos"
        >
          <div
            className="text-edit-pop-drag"
            onPointerDown={onPopPointerDown}
            onPointerMove={onPopPointerMove}
            onPointerUp={onPopPointerUp}
            onPointerCancel={onPopPointerUp}
            title="Drag to move"
          >
            <p className="text-edit-pop-title">Brand logos</p>
            <span className="text-edit-pop-grip" aria-hidden="true">⋮⋮</span>
          </div>
          <p className="hint logo-edit-hint">Pick one for this ad, or cancel the logo.</p>
          <div className="logo-drawer-strip" role="listbox" aria-label="Brand logos">
            {logos.map((item) => {
              const selected = activeLogoId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`logo-drawer-item${selected ? ' on' : ''}`}
                  title={item.name || 'Logo'}
                  onClick={() => onPickLogo(item.id)}
                >
                  <img src={item.url} alt={item.name || 'Logo'} />
                </button>
              );
            })}
          </div>
          <div className="logo-edit-actions">
            <button type="button" className="btn ghost sm" disabled={!activeLogoId} onClick={onCancelLogo}>
              Cancel logo
            </button>
            <button type="button" className="btn sm" onClick={onSaveEdit}>
              Close
            </button>
          </div>
        </div>
      )}
      {!compact && editingKind && editingKind !== 'logo' && editBox && editStyle && (
        <div
          className="text-edit-pop"
          style={{ left: popLeft, top: popTop, width: popW }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-label={`Edit ${textKindLabel(editingKind)}`}
        >
          <div
            className="text-edit-pop-drag"
            onPointerDown={onPopPointerDown}
            onPointerMove={onPopPointerMove}
            onPointerUp={onPopPointerUp}
            onPointerCancel={onPopPointerUp}
            title="Drag to move"
          >
            <p className="text-edit-pop-title">{textKindLabel(editingKind)}</p>
            <span className="text-edit-pop-grip" aria-hidden="true">⋮⋮</span>
          </div>
          <textarea
            className="text-edit-pop-input"
            rows={editingKind === 'cta' ? 2 : 3}
            value={readTextValue(version, editingKind)}
            onChange={(e) => onText(editingKind, e.target.value)}
            placeholder={editingKind === 'sub' ? 'Optional subline' : undefined}
          />
          <div className="text-edit-pop-section">
            <span className="text-edit-pop-section-label">Weight &amp; style</span>
            <div className="text-edit-pop-tools" role="toolbar" aria-label="Type style">
              <button
                type="button"
                className={`text-style-btn${editStyle.bold ? ' on' : ''}`}
                aria-pressed={editStyle.bold}
                title="Bold"
                onClick={() => onStyle(editingKind, { bold: !editStyle.bold })}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className={`text-style-btn italic${editStyle.italic ? ' on' : ''}`}
                aria-pressed={editStyle.italic}
                title="Italic"
                onClick={() => onStyle(editingKind, { italic: !editStyle.italic })}
              >
                I
              </button>
            </div>
          </div>
          <div className="text-edit-pop-row">
            <span className="text-edit-pop-label">Size</span>
            <div className="text-edit-pop-tools">
              <button
                type="button"
                className="text-style-btn"
                title="Smaller"
                disabled={editStyle.scale <= 0.7}
                onClick={() => onStyle(editingKind, { scale: Math.round((editStyle.scale - 0.05) * 100) / 100 })}
              >
                −
              </button>
              <span className="text-style-size" aria-live="polite">{sizeLabel}%</span>
              <button
                type="button"
                className="text-style-btn"
                title="Larger"
                disabled={editStyle.scale >= 1.6}
                onClick={() => onStyle(editingKind, { scale: Math.round((editStyle.scale + 0.05) * 100) / 100 })}
              >
                +
              </button>
            </div>
          </div>
          <div className="text-edit-pop-row">
            <span className="text-edit-pop-label">Letter spacing</span>
            <div className="text-edit-pop-tools">
              <button
                type="button"
                className="text-style-btn"
                title="Tighter"
                disabled={editStyle.track <= 0}
                onClick={() => onStyle(editingKind, { track: Math.round((editStyle.track - 0.01) * 100) / 100 })}
              >
                −
              </button>
              <span className="text-style-size" aria-live="polite">{trackLabel}</span>
              <button
                type="button"
                className="text-style-btn"
                title="Looser"
                disabled={editStyle.track >= 0.25}
                onClick={() => onStyle(editingKind, { track: Math.round((editStyle.track + 0.01) * 100) / 100 })}
              >
                +
              </button>
            </div>
          </div>
          <div className="text-edit-pop-row">
            <span className="text-edit-pop-label">Line height</span>
            <div className="text-edit-pop-tools">
              <button
                type="button"
                className="text-style-btn"
                title="Tighter lines"
                disabled={editStyle.lead <= 0.85}
                onClick={() => onStyle(editingKind, { lead: Math.round((editStyle.lead - 0.05) * 100) / 100 })}
              >
                −
              </button>
              <span className="text-style-size" aria-live="polite">{leadLabel}%</span>
              <button
                type="button"
                className="text-style-btn"
                title="More line space"
                disabled={editStyle.lead >= 1.6}
                onClick={() => onStyle(editingKind, { lead: Math.round((editStyle.lead + 0.05) * 100) / 100 })}
              >
                +
              </button>
            </div>
          </div>
          <div className="text-edit-pop-footer">
            <button type="button" className="btn sm text-edit-pop-save" onClick={onSaveEdit}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function buildProgress(project: ProjectDTO, thoughts: string, creating: boolean, finished: boolean): {
  steps: { title: string; detail: string; state: 'wait' | 'run' | 'done' }[];
  bar: number;
} {
  const tone = project.tone ? project.tone.toLowerCase() : 'professional';
  const definitions = [
    { title: 'Reading your brief', detail: 'Understanding your product and who it\'s for' },
    { title: 'Analysing audience & goal', detail: 'Tailoring the message for your audience' },
    { title: 'Writing headline & copy options', detail: `Matching a ${tone} tone` },
    { title: 'Applying brand colors & layout', detail: `Composing for ${project.platform || 'the platform'} · ${project.format || 'the placement'}` },
    { title: 'Rendering versions', detail: 'Building your ad previews' },
  ];
  const text = thoughts.toLowerCase();
  let active = 0;
  if (/audience:|goal:|tone:|platform:/.test(text)) active = 1;
  if (/approved copy|copy stays|copy will be used|using the copy|locked in|headline:/.test(text)) active = 2;
  if (/applying brand colors|brand colours|brand colors|composition:|image prompt/.test(text)) active = 3;
  if (/nano banana|drawing each|\bfal\b|in queue|pictures are stored|previews are on the canvas/.test(text)) active = 4;
  if (finished || !creating) active = definitions.length;
  else if (text === '') active = 0;

  const steps = definitions.map((item, index) => ({
    ...item,
    state: (index < active ? 'done' : index === active ? 'run' : 'wait') as 'wait' | 'run' | 'done',
  }));
  const bar = finished || active >= definitions.length
    ? 100
    : Math.min(95, 12 + active * 18 + (creating ? 8 : 0));
  return { steps, bar };
}

function ThoughtChain({ text, thinking }: { text: string; thinking: boolean }) {
  const [open, setOpen] = useState(thinking);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thinking) setOpen(true);
  }, [thinking, text]);

  useEffect(() => {
    if (!thinking) setOpen(false);
  }, [thinking]);

  useEffect(() => {
    const node = bodyRef.current;
    if (node && open && thinking) node.scrollTop = node.scrollHeight;
  }, [text, open, thinking]);

  return (
    <div className="thought-chain">
      <button type="button" className="thought-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {thinking && <span className="ad-spinner sm" aria-hidden="true" />}
        <span className={thinking ? 'thought-label run' : 'thought-label'}>{thinking ? 'Thinking…' : 'Thoughts'}</span>
      </button>
      {open && (
        <div ref={bodyRef} className="thought-body">
          {text || 'Starting…'}
        </div>
      )}
    </div>
  );
}
