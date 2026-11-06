'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import HexColorField from '@/components/HexColorField';
import PhotoTools, { type PhotoEdit } from '@/components/PhotoTools';
import {
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
import { BACKGROUNDS, SIZES, type Background } from '@/lib/platforms';
import type { AssetDTO, ProjectDTO, VersionDTO } from '@/lib/types';
import { zipStored } from '@/lib/zip-store';

const CROP_PRESETS = [
  { id: 'fit', label: 'Fit', zoom: 1 },
  { id: 'medium', label: 'Medium', zoom: 1.25 },
  { id: 'close', label: 'Close', zoom: 1.5 },
  { id: 'tight', label: 'Tight', zoom: 1.75 },
] as const;

const FOCUS_PRESETS = [
  { id: 'center', label: 'Center', x: 0.5, y: 0.5 },
  { id: 'top', label: 'Top', x: 0.5, y: 0.28 },
  { id: 'bottom', label: 'Bottom', x: 0.5, y: 0.72 },
  { id: 'left', label: 'Left', x: 0.28, y: 0.5 },
  { id: 'right', label: 'Right', x: 0.72, y: 0.5 },
] as const;

const BG_LABELS: Record<Background, string> = {
  photo: 'Photo',
  gradient: 'Brand tint',
  solid: 'Solid',
  light: 'Light',
};

function fontFamilyName(id: string): string {
  return `ad-font-${id}`;
}

function near(a: number, b: number, eps = 0.03): boolean {
  return Math.abs(a - b) <= eps;
}

interface GenerateStepProps {
  project: ProjectDTO;
  generating: boolean;
  busy: boolean;
  thoughts: string;
  error: string | null;
  onPatch: (version: VersionDTO) => void;
  onAdd: (count: number) => void;
  onImage: (id: string, editPrompt: string, extra?: Omit<PhotoEdit, 'prompt' | 'directed'> & { directed?: boolean }) => void;
  onPatchMany: (versions: VersionDTO[]) => void;
  onUndoImage: (id: string) => void;
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

function brandFonts(project: ProjectDTO): AssetDTO[] {
  return project.assets.filter((item) => item.kind === 'fonts');
}

/** Brief "On ad" font, or the first uploaded font. */
function defaultFontId(project: ProjectDTO): string | null {
  const fonts = brandFonts(project);
  if (fonts.length === 0) return null;
  const picked = new Set(project.renderAssetIds);
  const chosen = (picked.size ? fonts.filter((item) => picked.has(item.id)) : fonts)[0] ?? fonts[0];
  return chosen?.id ?? null;
}

function resolveFontId(project: ProjectDTO, version: VersionDTO): string | null {
  const fonts = brandFonts(project);
  if (fonts.length === 0) return null;
  if (version.fontAssetId && fonts.some((item) => item.id === version.fontAssetId)) return version.fontAssetId;
  return defaultFontId(project);
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

export default function GenerateStep({ project, generating, busy, thoughts, error, onPatch, onPatchMany, onAdd, onImage, onUndoImage, onDelete }: GenerateStepProps) {
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const deletePhrase = 'Delete the Project';
  const canConfirmDelete = deleteTyped.trim() === deletePhrase;
  const [activeId, setActiveId] = useState(project.versions[0]?.id ?? '');
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const imageCache = useRef<Record<string, HTMLImageElement>>({});
  const logoCache = useRef<Record<string, HTMLImageElement>>({});
  const [loadedUrls, setLoadedUrls] = useState<Record<string, boolean>>({});
  const [logoReadyIds, setLogoReadyIds] = useState<Record<string, boolean>>({});
  const [fontReadyIds, setFontReadyIds] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
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
  const fonts = brandFonts(project);
  const activeLogoId = active ? resolveLogoId(project, active) : null;
  const activeFontId = active ? resolveFontId(project, active) : null;
  const activeFontFamily = activeFontId && fontReadyIds[activeFontId] === true ? fontFamilyName(activeFontId) : null;

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

  // Brief fonts for on-ad type — load once, then paint with the CSS family name.
  const fontIdsKey = fonts.map((item) => item.id).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const font of fonts) {
      if (fontReadyIds[font.id] === true) continue;
      const family = fontFamilyName(font.id);
      const face = new FontFace(family, `url(${JSON.stringify(assetUrl(font.id))})`);
      void face.load().then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setFontReadyIds((current) => ({ ...current, [font.id]: true }));
      }).catch(() => {
        if (cancelled) return;
        setFontReadyIds((current) => ({ ...current, [font.id]: false }));
      });
    }
    return () => {
      cancelled = true;
    };
    // fontReadyIds intentionally omitted — only reload when the Brief font set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontIdsKey]);

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

  function requestAddOne() {
    if (room < 1) return;
    appendFromRef.current = project.versions.length;
    setPendingExtra(1);
    setAppendBusy(true);
    onAdd(1);
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

  function requestImage(id: string, editPrompt: string, extra?: Omit<PhotoEdit, 'prompt' | 'directed'> & { directed?: boolean }) {
    setRedrawIds(extra?.versionIds && extra.versionIds.length > 0 ? extra.versionIds : [id]);
    onImage(id, editPrompt, extra);
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
                          fontFamily={(() => {
                            const id = resolveFontId(project, version);
                            return id && fontReadyIds[id] === true ? fontFamilyName(id) : null;
                          })()}
                          active={version.id === active.id}
                          editingKind={null}
                          onCanvas={(node) => {
                            if (version.id === active.id) return;
                            canvasRefs.current[version.id] = node;
                          }}
                          onMove={() => {}}
                          onOpenEdit={() => setActiveId(version.id)}
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
                  <button
                    type="button"
                    className="btn sm gen-add-version"
                    title={room === 0 ? `Already at ${MAX_VERSIONS} versions` : 'Add one more version'}
                    disabled={busy || appendBusy || room === 0}
                    onClick={() => requestAddOne()}
                  >
                    {appendBusy ? 'Adding…' : room === 0 ? 'Full' : 'Add version'}
                  </button>
                </div>
              </div>
              {appendBusy && (
                <p className="hint creating-live">
                  Adding one version in the strip above — selected ad stays as it is.
                </p>
              )}
              <p className="hint gen-rail-hint">
                {room === 0
                  ? `You already have ${MAX_VERSIONS} versions.`
                  : 'Pick a miniature above, then edit the large preview. Use Add version for one more at a time.'}
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
                    fontFamily={activeFontFamily}
                    active
                    editingKind={textEdit?.versionId === active.id ? textEdit.kind : null}
                    onCanvas={(node) => { canvasRefs.current[active.id] = node; }}
                    onMove={(kind, x, y, width, height) => {
                      onPatch({ ...active, ...positionPatch(kind, x, y, width, height) });
                    }}
                    onOpenEdit={(kind) => {
                      setTextEdit((current) =>
                        current?.versionId === active.id && current.kind === kind
                          ? null
                          : { versionId: active.id, kind },
                      );
                    }}
                  />
                )}
                <p className="hint gen-focus-status">
                  {extraPending(active)
                    ? 'Still drawing this version…'
                    : `${imageState(active)}. Drag text or the logo to move it. Crop and type settings are on the right.`}
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
                <button type="button" className="btn sm" disabled={busy || !allReady} onClick={() => void downloadAll()}>
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
              <SideInspector
                version={active}
                selected={textEdit?.versionId === active.id ? textEdit.kind : null}
                logos={logos.map((item) => ({ id: item.id, name: item.name, url: assetUrl(item.id) }))}
                fonts={fonts.map((item) => ({ id: item.id, name: item.name, ready: fontReadyIds[item.id] === true }))}
                activeLogoId={activeLogoId}
                activeFontId={activeFontId}
                onPickFont={(id) => patch({ fontAssetId: id })}
                onSelectLayer={(kind) => {
                  const next: Partial<VersionDTO> = {};
                  if (kind === 'headline') {
                    next.showHeadline = true;
                    if (!active.headline.trim()) next.headline = project.headline.trim() || 'Your headline';
                  } else if (kind === 'sub') {
                    next.showSub = true;
                    if (!active.sub.trim()) next.sub = project.subline.trim() || 'Supporting line';
                  } else if (kind === 'cta') {
                    next.showCta = true;
                    if (!active.cta.trim()) next.cta = project.cta.trim() || 'Learn more';
                  } else {
                    next.showLogo = true;
                  }
                  patch(next);
                  setTextEdit({ versionId: active.id, kind });
                }}
                onText={(kind, value) => patch(textValuePatch(kind, value))}
                onStyle={(kind, style) => patch(stylePatch(kind, style))}
                onPickLogo={(id) => {
                  patch({ logoAssetId: id, showLogo: true });
                }}
                onCancelLogo={() => patch({ showLogo: false })}
                onDone={() => setTextEdit(null)}
                onToggle={(kind, show) => {
                  if (kind === 'headline') patch({ showHeadline: show });
                  if (kind === 'sub') patch({ showSub: show });
                  if (kind === 'cta') patch({ showCta: show });
                  if (kind === 'logo') patch({ showLogo: show });
                }}
              />
              <details className="gen-meta-card gen-image-card" open>
                <summary>Image</summary>
                <div className="gen-image-edit">
                  <p className="hint">Quick crop, focus, and background — live on the preview. The prompt under the ad still redraws with AI.</p>
                  <span className="text-edit-pop-label">Crop</span>
                  <div className="gen-tool-chips" role="toolbar" aria-label="Crop">
                    {CROP_PRESETS.map((item) => {
                      const zoom = active.imageZoom ?? 1;
                      const on = near(zoom, item.zoom, 0.05);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`gen-tool-chip${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => patch({ imageZoom: item.zoom })}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-edit-pop-label">Focus</span>
                  <div className="gen-tool-chips" role="toolbar" aria-label="Focus">
                    {FOCUS_PRESETS.map((item) => {
                      const fx = active.imageFocusX ?? 0.5;
                      const fy = active.imageFocusY ?? 0.5;
                      const on = near(fx, item.x) && near(fy, item.y);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`gen-tool-chip${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => patch({ imageFocusX: item.x, imageFocusY: item.y })}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-edit-pop-label">Background</span>
                  <div className="gen-tool-chips" role="toolbar" aria-label="Background">
                    {BACKGROUNDS.map((item) => {
                      const on = active.bg === item;
                      return (
                        <button
                          key={item}
                          type="button"
                          className={`gen-tool-chip${on ? ' on' : ''}`}
                          aria-pressed={on}
                          onClick={() => patch({ bg: item })}
                        >
                          {BG_LABELS[item]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </details>
              <details className="gen-meta-card">
                <summary>Photo tools</summary>
                <PhotoTools
                  version={active}
                  versions={project.versions}
                  busy={busy || appendBusy}
                  image={isHttpsUrl(active.imageUrl) ? imageCache.current[active.imageUrl] ?? null : null}
                  onChange={patch}
                  onApplyLook={onPatchMany}
                  onUndo={() => onUndoImage(active.id)}
                  onEdit={(edit) => requestImage(active.id, edit.prompt, edit)}
                />
              </details>
              <details className="gen-meta-card gen-more">
                <summary>Layout, colors &amp; size</summary>
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
              </details>

              <div className="gen-actions">
                <p className="gen-actions-label">Main actions</p>
                <button type="button" className="btn sm" disabled={busy || !imageReady(active)} onClick={() => download(active)}>
                  Download PNG
                </button>
              </div>

              <div className="gen-delete-row">
                <button
                  type="button"
                  className="btn danger gen-delete"
                  disabled={busy || working || deleting}
                  onClick={() => {
                    setDeleteTyped('');
                    setDeleteOpen(true);
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete this project'}
                </button>
                <p className="hint">Deletes this whole ad project, including every version.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {deleteOpen && (
        <div className="gen-delete-modal" role="presentation" onClick={() => { if (!deleting) setDeleteOpen(false); }}>
          <div
            className="gen-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 id="delete-project-title">Delete this project?</h4>
            <p className="hint">
              This permanently deletes the whole ad — all versions, copy, and images. Type <strong>{deletePhrase}</strong> to confirm.
            </p>
            <label htmlFor="deleteConfirm">Confirmation</label>
            <input
              id="deleteConfirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={deleteTyped}
              placeholder={deletePhrase}
              disabled={deleting}
              onChange={(e) => setDeleteTyped(e.target.value)}
            />
            <div className="gen-delete-dialog-actions">
              <button type="button" className="btn ghost" disabled={deleting} onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger gen-delete"
                disabled={deleting || !canConfirmDelete}
                onClick={() => {
                  setDeleting(true);
                  onDelete();
                }}
              >
                {deleting ? 'Deleting…' : 'Delete the Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdStage({
  version,
  brand,
  image,
  logo,
  fontFamily = null,
  active,
  editingKind,
  compact = false,
  onCanvas,
  onMove,
  onOpenEdit,
}: {
  version: VersionDTO;
  brand: string;
  image: HTMLImageElement | null | undefined;
  logo: HTMLImageElement | null;
  fontFamily?: string | null;
  active: boolean;
  editingKind: TextKind | null;
  compact?: boolean;
  onCanvas: (node: HTMLCanvasElement | null) => void;
  onMove: (kind: TextKind, x: number, y: number, width: number, height: number) => void;
  onOpenEdit: (kind: TextKind) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ kind: TextKind; ox: number; oy: number; x: number; y: number; moved: boolean } | null>(null);
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
    setBoxes(drawAd(canvas, painted, brand, image, { logo, fontFamily }));
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
  }, [version, brand, image, logo, fontFamily, dragLive]);

  const scaleX = frame.sw / frame.cw;
  const scaleY = frame.sh / frame.ch;

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

  return (
    <div className={`ad-stage${active ? ' on' : ''}${editingKind ? ' editing' : ''}${compact ? ' compact' : ''}`}>
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
      {!compact && (
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
    </div>
  );
}

function shown(version: VersionDTO, kind: TextKind): boolean {
  if (kind === 'headline') return version.showHeadline !== false;
  if (kind === 'sub') return version.showSub !== false;
  if (kind === 'cta') return version.showCta !== false;
  return version.showLogo !== false;
}

const LAYER_KINDS: TextKind[] = ['headline', 'sub', 'cta', 'logo'];

function SideInspector({
  version,
  selected,
  logos,
  fonts,
  activeLogoId,
  activeFontId,
  onPickFont,
  onSelectLayer,
  onText,
  onStyle,
  onPickLogo,
  onCancelLogo,
  onDone,
  onToggle,
}: {
  version: VersionDTO;
  selected: TextKind | null;
  logos: { id: string; name: string; url: string }[];
  fonts: { id: string; name: string; ready: boolean }[];
  activeLogoId: string | null;
  activeFontId: string | null;
  onPickFont: (id: string) => void;
  onSelectLayer: (kind: TextKind) => void;
  onText: (kind: TextKind, value: string) => void;
  onStyle: (kind: TextKind, style: Partial<TextStyle>) => void;
  onPickLogo: (id: string) => void;
  onCancelLogo: () => void;
  onDone: () => void;
  onToggle: (kind: TextKind, show: boolean) => void;
}) {
  const layers = (
    <div className="gen-layers">
      <p className="text-edit-pop-title">On the ad</p>
      <p className="hint">Turn a line back on, or open its settings.</p>
      <div className="gen-layer-chips" role="toolbar" aria-label="Ad layers">
        {LAYER_KINDS.map((kind) => {
          const visible = shown(version, kind);
          const active = selected === kind;
          return (
            <button
              key={kind}
              type="button"
              className={`gen-layer-chip${active ? ' on' : ''}${visible ? '' : ' off'}`}
              aria-pressed={active}
              title={visible ? `Edit ${textKindLabel(kind)}` : `Add ${textKindLabel(kind)} back`}
              onClick={() => onSelectLayer(kind)}
            >
              <span>{textKindLabel(kind)}</span>
              <span className="gen-layer-chip-state">{visible ? 'On' : 'Add'}</span>
            </button>
          );
        })}
      </div>
      {fonts.length > 0 && (
        <div className="gen-font-picker">
          <span className="text-edit-pop-label">Brand font</span>
          <p className="hint">From Brief — change it here for this ad.</p>
          <div className="gen-tool-chips" role="listbox" aria-label="Brand fonts">
            {fonts.map((item) => {
              const on = activeFontId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`gen-tool-chip gen-font-chip${on ? ' on' : ''}`}
                  disabled={!item.ready}
                  title={item.ready ? item.name : `Loading ${item.name}`}
                  style={item.ready ? { fontFamily: `"${fontFamilyName(item.id)}", Arial, sans-serif` } : undefined}
                  onClick={() => onPickFont(item.id)}
                >
                  {item.name.replace(/^Primary - /i, '').slice(0, 22) || 'Font'}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  let body: ReactNode;
  if (!selected) {
    body = (
      <div className="gen-inspector-empty">
        <p className="hint">Click a layer above, or click text / logo on the preview.</p>
      </div>
    );
  } else if (selected === 'logo') {
    body = (
      <div className="gen-inspector" role="region" aria-label="Brand logos">
        <p className="text-edit-pop-title">Brand logos</p>
        {logos.length === 0 ? (
          <p className="hint">No logo uploaded on the brief yet.</p>
        ) : (
          <>
            <p className="hint logo-edit-hint">Pick one for this ad, or cancel the logo.</p>
            <div className="logo-drawer-strip" role="listbox" aria-label="Brand logos">
              {logos.map((item) => {
                const on = activeLogoId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`logo-drawer-item${on ? ' on' : ''}`}
                    title={item.name || 'Logo'}
                    onClick={() => onPickLogo(item.id)}
                  >
                    <img src={item.url} alt={item.name || 'Logo'} />
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div className="logo-edit-actions">
          <button type="button" className="btn ghost sm" disabled={!activeLogoId} onClick={onCancelLogo}>
            Cancel logo
          </button>
          <button type="button" className="btn sm" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  } else {
    const style = readTextStyle(version, selected);
    const sizeLabel = Math.round(style.scale * 100);
    const trackLabel = Math.round(style.track * 100);
    const leadLabel = Math.round(style.lead * 100);
    const visible = shown(version, selected);
    body = (
      <div className="gen-inspector" role="region" aria-label={`Edit ${textKindLabel(selected)}`}>
        <p className="text-edit-pop-title">{textKindLabel(selected)}</p>
        <textarea
          className="text-edit-pop-input"
          rows={selected === 'cta' ? 2 : 3}
          value={readTextValue(version, selected)}
          onChange={(e) => onText(selected, e.target.value)}
          placeholder={selected === 'sub' ? 'Optional subline' : undefined}
        />
        <div className="text-toggle-row">
          <button type="button" className="btn ghost sm" disabled={!visible} onClick={() => onToggle(selected, false)}>Hide</button>
          <button type="button" className="btn ghost sm" disabled={visible} onClick={() => onSelectLayer(selected)}>Show</button>
        </div>
        <div className="text-edit-pop-section">
          <span className="text-edit-pop-section-label">Weight &amp; style</span>
          <div className="text-edit-pop-tools" role="toolbar" aria-label="Type style">
            <button
              type="button"
              className={`text-style-btn${style.bold ? ' on' : ''}`}
              aria-pressed={style.bold}
              title="Bold"
              onClick={() => onStyle(selected, { bold: !style.bold })}
            >
              <strong>B</strong>
            </button>
            <button
              type="button"
              className={`text-style-btn italic${style.italic ? ' on' : ''}`}
              aria-pressed={style.italic}
              title="Italic"
              onClick={() => onStyle(selected, { italic: !style.italic })}
            >
              I
            </button>
          </div>
        </div>
        <div className="text-edit-pop-row">
          <span className="text-edit-pop-label">Size</span>
          <div className="text-edit-pop-tools">
            <button type="button" className="text-style-btn" title="Smaller" disabled={style.scale <= 0.7} onClick={() => onStyle(selected, { scale: Math.round((style.scale - 0.05) * 100) / 100 })}>−</button>
            <span className="text-style-size" aria-live="polite">{sizeLabel}%</span>
            <button type="button" className="text-style-btn" title="Larger" disabled={style.scale >= 1.6} onClick={() => onStyle(selected, { scale: Math.round((style.scale + 0.05) * 100) / 100 })}>+</button>
          </div>
        </div>
        <div className="text-edit-pop-row">
          <span className="text-edit-pop-label">Letter spacing</span>
          <div className="text-edit-pop-tools">
            <button type="button" className="text-style-btn" title="Tighter" disabled={style.track <= 0} onClick={() => onStyle(selected, { track: Math.round((style.track - 0.01) * 100) / 100 })}>−</button>
            <span className="text-style-size" aria-live="polite">{trackLabel}</span>
            <button type="button" className="text-style-btn" title="Looser" disabled={style.track >= 0.25} onClick={() => onStyle(selected, { track: Math.round((style.track + 0.01) * 100) / 100 })}>+</button>
          </div>
        </div>
        <div className="text-edit-pop-row">
          <span className="text-edit-pop-label">Line height</span>
          <div className="text-edit-pop-tools">
            <button type="button" className="text-style-btn" title="Tighter lines" disabled={style.lead <= 0.85} onClick={() => onStyle(selected, { lead: Math.round((style.lead - 0.05) * 100) / 100 })}>−</button>
            <span className="text-style-size" aria-live="polite">{leadLabel}%</span>
            <button type="button" className="text-style-btn" title="More line space" disabled={style.lead >= 1.6} onClick={() => onStyle(selected, { lead: Math.round((style.lead + 0.05) * 100) / 100 })}>+</button>
          </div>
        </div>
        <div className="text-edit-pop-footer">
          <button type="button" className="btn sm text-edit-pop-save" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="gen-inspector-stack">
      {layers}
      {body}
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
