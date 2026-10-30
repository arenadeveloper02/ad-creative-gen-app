'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { positionPatch, type TextBox, type TextKind } from '@/lib/ad-layout';
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

export default function GenerateStep({ project, generating, busy, thoughts, error, onBack, onPatch, onRefresh, onAdd, onRewrite, onImage }: GenerateStepProps) {
  const [activeId, setActiveId] = useState(project.versions[0]?.id ?? '');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [moreText, setMoreText] = useState('1');
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [holdPanel, setHoldPanel] = useState(false);
  const [localThoughts, setLocalThoughts] = useState('');
  const [appendBusy, setAppendBusy] = useState(false);
  const [pendingExtra, setPendingExtra] = useState(0);
  const appendFromRef = useRef(0);
  const room = Math.max(0, MAX_VERSIONS - project.versions.length);
  const active = project.versions.find((item) => item.id === activeId) ?? project.versions[0];
  const thoughtText = [thoughts, localThoughts].filter(Boolean).join('\n\n');

  useEffect(() => {
    if (!project.versions.some((item) => item.id === activeId)) {
      setActiveId(project.versions[0]?.id ?? '');
    }
  }, [project.versions, activeId]);

  // Keep the step list and thinking open until every preview image has settled on the canvas.
  useEffect(() => {
    if (!generating) return;
    setHoldPanel(true);
    setLocalThoughts('');
    setLoadedUrls({});
    imageCache.current = {};
  }, [generating]);

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

  function requestRefresh() {
    const ids = project.versions.filter((version) => version.position < 2).map((version) => version.id);
    for (const version of project.versions) {
      if (isHttpsUrl(version.imageUrl) && ids.includes(version.id)) delete imageCache.current[version.imageUrl];
    }
    setRedrawIds(ids);
    onRefresh();
  }

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
            <div>
              <div className="versions">
                {project.versions.map((version) => (
                  <div key={version.id} className={`vcard${version.id === active.id ? ' on' : ''}`} onClick={() => setActiveId(version.id)} role="button" tabIndex={0}>
                    <div className="vhead">
                      <strong>Version {letter(version.position)}</strong>
                      <span>{version.size.replace('x', '×')}</span>
                    </div>
                    {extraPending(version) ? (
                      <div className="preview-wait" role="status" aria-label={`Version ${letter(version.position)} is still rendering`}>
                        <span className="ad-spinner" aria-hidden="true" />
                        <span className="preview-wait-label">Rendering…</span>
                      </div>
                    ) : (
                      <AdStage
                        version={version}
                        brand={project.brandName}
                        image={isHttpsUrl(version.imageUrl) && loadedUrls[version.imageUrl] ? imageCache.current[version.imageUrl] : null}
                        active={version.id === active.id}
                        onCanvas={(node) => { canvasRefs.current[version.id] = node; }}
                        onMove={(kind, x, y, width, height) => {
                          if (version.id !== active.id) setActiveId(version.id);
                          onPatch({ ...version, ...positionPatch(kind, x, y, width, height) });
                        }}
                      />
                    )}
                    <div className="vcopy">{version.primary}</div>
                    <div className="hint" style={{ marginTop: 6 }}>
                      {extraPending(version)
                        ? 'Same quality as A and B — still drawing…'
                        : `${imageState(version)}. Drag headline, subline, or CTA on the preview to move them.`}
                    </div>
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
                      disabled={busy || appendBusy || (edits[version.id] ?? '').trim() === ''}
                      onClick={(e) => { e.stopPropagation(); requestImage(version.id, edits[version.id] ?? ''); }}
                    >
                      {busy && !appendBusy ? 'Working…' : 'Update this image'}
                    </button>
                    <div className="vactions">
                      <button type="button" disabled={!imageReady(version) || busy || appendBusy} onClick={(e) => { e.stopPropagation(); download(version); }}>PNG</button>
                    </div>
                  </div>
                ))}
                {Array.from({ length: stillNeeded }, (_, index) => {
                  const position = project.versions.length + index;
                  return (
                    <div key={`pending-${position}`} className="vcard">
                      <div className="vhead"><strong>Version {letter(position)}</strong></div>
                      <div className="preview-wait" role="status" aria-label={`Version ${letter(position)} is still rendering`}>
                        <span className="ad-spinner" aria-hidden="true" />
                        <span className="preview-wait-label">Rendering…</span>
                      </div>
                      <div className="hint" style={{ marginTop: 6 }}>Same format and quality as A and B.</div>
                    </div>
                  );
                })}
              </div>
              {appendBusy && (
                <p className="hint creating-live" style={{ marginTop: 12 }}>
                  Adding more versions — A and B stay as they are. Only the new cards show a loader.
                </p>
              )}
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
                    disabled={busy || appendBusy || room === 0}
                    onChange={(e) => setMoreText(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  />
                </div>
                <button type="button" className="btn sm" disabled={busy || appendBusy || typedCount() === null} onClick={() => { const count = typedCount(); if (count) requestAdd(count); }}>
                  {appendBusy ? 'Adding…' : typedCount() === null ? 'Generate' : `Generate ${typedCount()}`}
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
                <button type="button" className="btn ghost sm" disabled={working} onClick={requestRefresh}>{working ? 'Working…' : 'Regenerate both images'}</button>
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
              {(thoughtText || working) && <ThoughtChain text={thoughtText} thinking={working} />}
              <h4>Modify version {letter(active.position)}</h4>
              <p className="hint">Rename here. Drag on the preview to move. Subline is optional.</p>
              <label htmlFor="mHeadline">Headline</label>
              <input id="mHeadline" type="text" value={active.headline} onChange={(e) => patch({ headline: e.target.value, showHeadline: true })} />
              <div className="text-toggle-row">
                <button type="button" className="btn ghost sm" disabled={active.showHeadline === false} onClick={() => patch({ showHeadline: false })}>Remove from ad</button>
                <button type="button" className="btn ghost sm" disabled={active.showHeadline !== false || active.headline.trim() === ''} onClick={() => patch({ showHeadline: true })}>Show on ad</button>
              </div>
              <label htmlFor="mSub">Subline (optional)</label>
              <input
                id="mSub"
                type="text"
                value={active.sub}
                placeholder="Leave blank if you do not want a subline"
                onChange={(e) => {
                  const sub = e.target.value;
                  patch({ sub, showSub: sub.trim() !== '' ? true : active.showSub });
                }}
              />
              <div className="text-toggle-row">
                <button type="button" className="btn ghost sm" disabled={active.showSub === false || active.sub.trim() === ''} onClick={() => patch({ showSub: false })}>Remove from ad</button>
                <button type="button" className="btn ghost sm" disabled={active.showSub !== false || active.sub.trim() === ''} onClick={() => patch({ showSub: true })}>Show on ad</button>
              </div>
              <label htmlFor="mCta">CTA button</label>
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
              <p className="hint">Turn this off and the button is left off the ad.</p>
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
                <option value="photo">Photo — colour 1 button, colour 2 bar, colour 3 text</option>
                <option value="gradient">Brand tint — colour 1 to colour 2 over the photo</option>
                <option value="solid">Solid panel — colour 1 panel behind the text</option>
                <option value="light">Light panel — white panel, colour 1 text</option>
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
                <button type="button" className="btn ghost sm" disabled={working} onClick={requestRefresh}>{working ? 'Working…' : 'Regenerate both images'}</button>
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

function AdStage({
  version,
  brand,
  image,
  active,
  onCanvas,
  onMove,
}: {
  version: VersionDTO;
  brand: string;
  image: HTMLImageElement | null | undefined;
  active: boolean;
  onCanvas: (node: HTMLCanvasElement | null) => void;
  onMove: (kind: TextKind, x: number, y: number, width: number, height: number) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ kind: TextKind; ox: number; oy: number; x: number; y: number } | null>(null);
  const [frame, setFrame] = useState({ sw: 1, sh: 1, cw: 1, ch: 1 });
  const [dragLive, setDragLive] = useState<{ kind: TextKind; x: number; y: number } | null>(null);
  const [boxes, setBoxes] = useState<TextBox[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const [cw, ch] = version.size.split('x').map((n) => Number(n));
    const painted = dragLive
      ? { ...version, ...positionPatch(dragLive.kind, dragLive.x, dragLive.y, cw || 1, ch || 1) }
      : version;
    // drawAd measures the real text, so the handles match what is painted.
    setBoxes(drawAd(canvas, painted, brand, image));
    const stage = stageRef.current;
    if (!stage) return;
    const sync = () => {
      const rect = stage.getBoundingClientRect();
      setFrame({ sw: rect.width, sh: rect.height, cw: canvas.width || 1, ch: canvas.height || 1 });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [version, brand, image, dragLive]);

  const scaleX = frame.sw / frame.cw;
  const scaleY = frame.sh / frame.ch;

  function onPointerDown(kind: TextKind, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const box = boxes.find((item) => item.kind === kind);
    if (!box) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    dragRef.current = {
      kind,
      ox: event.clientX - rect.left - box.x * scaleX,
      oy: event.clientY - rect.top - box.y * scaleY,
      x: box.x,
      y: box.y,
    };
    setDragLive({ kind, x: box.x, y: box.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const stage = stageRef.current;
    if (!drag || !stage) return;
    const rect = stage.getBoundingClientRect();
    const box = boxes.find((item) => item.kind === drag.kind);
    const maxX = Math.max(0, frame.cw - (box?.w ?? 0));
    const maxY = Math.max(0, frame.ch - (box?.h ?? 0));
    const x = Math.min(maxX, Math.max(0, (event.clientX - rect.left - drag.ox) / scaleX));
    const y = Math.min(maxY, Math.max(0, (event.clientY - rect.top - drag.oy) / scaleY));
    drag.x = x;
    drag.y = y;
    setDragLive({ kind: drag.kind, x, y });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag) {
      onMove(drag.kind, drag.x, drag.y, frame.cw, frame.ch);
      dragRef.current = null;
      setDragLive(null);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Capture may already be released.
      }
    }
  }

  return (
    <div ref={stageRef} className={`ad-stage${active ? ' on' : ''}`}>
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          onCanvas(node);
        }}
      />
      {boxes.map((box) => (
        <div
          key={box.kind}
          className={`ad-handle${dragLive?.kind === box.kind ? ' dragging' : ''}`}
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
          aria-label={`Move ${box.kind}`}
        >
          <span>{box.kind === 'headline' ? 'Headline' : box.kind === 'sub' ? 'Subline' : 'CTA'}</span>
        </div>
      ))}
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
