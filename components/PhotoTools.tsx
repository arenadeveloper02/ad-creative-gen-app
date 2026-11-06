'use client';

import { useRef, useState } from 'react';
import { DEFAULT_FINISH, readImageFinish } from '@/lib/image-finish';
import type { ImageFinish, VersionDTO } from '@/lib/types';

type Pill = 'adjust' | 'crop' | 'background' | 'edit' | 'finish';

const PILLS: { id: Pill; label: string }[] = [
  { id: 'adjust', label: 'Adjust' },
  { id: 'crop', label: 'Crop' },
  { id: 'background', label: 'Background' },
  { id: 'edit', label: 'Edit' },
  { id: 'finish', label: 'Finish' },
];

const GRADES: { key: keyof ImageFinish; label: string; min: number; max: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
  { key: 'blur', label: 'Background blur', min: 0, max: 100 },
];

export interface PhotoEdit {
  prompt: string;
  directed: true;
  referenceAssetId?: string;
  variantCount?: number;
  versionIds?: string[];
}

export default function PhotoTools({
  version,
  versions,
  busy,
  image,
  onChange,
  onApplyLook,
  onEdit,
  onUndo,
}: {
  version: VersionDTO;
  versions: VersionDTO[];
  busy: boolean;
  image: HTMLImageElement | null;
  onChange: (partial: Partial<VersionDTO>) => void;
  onApplyLook: (next: VersionDTO[]) => void;
  onEdit: (edit: PhotoEdit) => void;
  onUndo: () => void;
}) {
  const [pill, setPill] = useState<Pill>('adjust');
  const [backgroundNote, setBackgroundNote] = useState('');
  const [regionNote, setRegionNote] = useState('');
  const [strength, setStrength] = useState(45);
  const [referenceName, setReferenceName] = useState('');
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const brushRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const finish = readImageFinish(version.imageFinish);
  const hasPhoto = Boolean(version.imageUrl && /^https:\/\//i.test(version.imageUrl));

  function setFinish(partial: Partial<ImageFinish>) {
    onChange({ imageFinish: { ...finish, ...partial } });
  }

  function strengthWord(value: number): string {
    if (value <= 30) return 'slight';
    if (value <= 70) return 'moderate';
    return 'strong';
  }

  async function uploadReference(file: File) {
    setNote('');
    const body = new FormData();
    body.set('file', file);
    body.set('kind', 'refs');
    const res = await fetch('/api/upload', { method: 'POST', body });
    const data = await res.json().catch(() => null) as { id?: string; error?: string } | null;
    if (!res.ok || !data?.id) {
      setNote(data?.error || 'That reference could not be added.');
      return;
    }
    setReferenceId(data.id);
    setReferenceName(file.name);
  }

  async function markedReference(): Promise<string | null> {
    const pad = brushRef.current;
    if (!pad || !image) return referenceId;
    const board = document.createElement('canvas');
    board.width = image.naturalWidth;
    board.height = image.naturalHeight;
    const ctx = board.getContext('2d');
    if (!ctx) return referenceId;
    try {
      ctx.drawImage(image, 0, 0);
      ctx.drawImage(pad, 0, 0, board.width, board.height);
      const blob = await new Promise<Blob | null>((resolve) => board.toBlob(resolve, 'image/png'));
      if (!blob) return referenceId;
      const body = new FormData();
      body.set('file', new File([blob], 'region-mark.png', { type: 'image/png' }));
      body.set('kind', 'refs');
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = await res.json().catch(() => null) as { id?: string } | null;
      return data?.id || referenceId;
    } catch {
      return referenceId;
    }
  }

  function paintBrush(event: React.PointerEvent<HTMLCanvasElement>) {
    const pad = brushRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * pad.width;
    const y = ((event.clientY - rect.top) / rect.height) * pad.height;
    const ctx = pad.getContext('2d');
    if (!ctx) return;
    if (event.type === 'pointerdown') {
      drawing.current = true;
      pad.setPointerCapture(event.pointerId);
      ctx.beginPath();
      ctx.moveTo(x, y);
      return;
    }
    if (!drawing.current) return;
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      drawing.current = false;
      return;
    }
    ctx.strokeStyle = 'rgba(255, 48, 64, 0.85)';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function clearBrush() {
    const pad = brushRef.current;
    const ctx = pad?.getContext('2d');
    if (!pad || !ctx) return;
    ctx.clearRect(0, 0, pad.width, pad.height);
  }

  return (
    <div className="photo-tools">
      <div className="photo-pills" role="tablist" aria-label="Photo tools">
        {PILLS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={pill === item.id}
            className={`gen-tool-chip${pill === item.id ? ' on' : ''}`}
            onClick={() => setPill(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {pill === 'adjust' && (
        <div className="photo-pane">
          {GRADES.map((item) => (
            <label key={item.key} className="photo-slider">
              <span>{item.label}</span>
              <input
                type="range"
                min={item.min}
                max={item.max}
                value={Number(finish[item.key])}
                onChange={(e) => setFinish({ [item.key]: Number(e.target.value) })}
              />
              <span>{finish[item.key]}</span>
            </label>
          ))}
          <button type="button" className="btn ghost sm" onClick={() => setFinish({ ...DEFAULT_FINISH, rotate: finish.rotate, flipH: finish.flipH, flipV: finish.flipV })}>
            Reset grade
          </button>
        </div>
      )}

      {pill === 'crop' && (
        <div className="photo-pane">
          <span className="text-edit-pop-label">Drag to place the photo</span>
          <div
            className="photo-pad"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const place = (target: HTMLDivElement, point: { clientX: number; clientY: number }) => {
                const rect = target.getBoundingClientRect();
                const x = Math.min(1, Math.max(0, (point.clientX - rect.left) / rect.width));
                const y = Math.min(1, Math.max(0, (point.clientY - rect.top) / rect.height));
                onChange({ imageFocusX: x, imageFocusY: y });
              };
              place(event.currentTarget, event);
              event.currentTarget.onpointermove = (move) => place(event.currentTarget, move);
              event.currentTarget.onpointerup = () => {
                event.currentTarget.onpointermove = null;
              };
            }}
          >
            <span className="photo-pad-dot" style={{ left: `${(version.imageFocusX ?? 0.5) * 100}%`, top: `${(version.imageFocusY ?? 0.5) * 100}%` }} />
          </div>
          <label className="photo-slider">
            <span>Zoom</span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.05}
              value={version.imageZoom || 1}
              onChange={(e) => onChange({ imageZoom: Number(e.target.value) })}
            />
            <span>{(version.imageZoom || 1).toFixed(2)}</span>
          </label>
          <div className="photo-pills">
            {[0, 90, 180, 270].map((turn) => (
              <button key={turn} type="button" className={`gen-tool-chip${finish.rotate === turn ? ' on' : ''}`} onClick={() => setFinish({ rotate: turn as ImageFinish['rotate'] })}>
                {turn}°
              </button>
            ))}
            <button type="button" className={`gen-tool-chip${finish.flipH ? ' on' : ''}`} onClick={() => setFinish({ flipH: !finish.flipH })}>Flip H</button>
            <button type="button" className={`gen-tool-chip${finish.flipV ? ' on' : ''}`} onClick={() => setFinish({ flipV: !finish.flipV })}>Flip V</button>
          </div>
        </div>
      )}

      {pill === 'background' && (
        <div className="photo-pane">
          <p className="hint">The subject stays. Only the room, light, or set changes.</p>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasPhoto}
            onClick={() => onEdit({
              directed: true,
              prompt: 'Remove the background. Keep the subject and product identical, including edges, colour, and pose. Replace the background with a smooth neutral studio sweep that matches the existing light.',
            })}
          >
            Remove background
          </button>
          <label htmlFor="photo-bg">New background</label>
          <textarea id="photo-bg" className="gen-image-edit-input" rows={2} value={backgroundNote} placeholder="e.g. Soft daylight office, shallow depth" onChange={(e) => setBackgroundNote(e.target.value)} />
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasPhoto || backgroundNote.trim().length < 2}
            onClick={() => onEdit({
              directed: true,
              prompt: `Keep the subject and product identical. Change only the room, light, and set to: ${backgroundNote.trim()}`,
            })}
          >
            Replace background
          </button>
        </div>
      )}

      {pill === 'edit' && (
        <div className="photo-pane">
          <span className="text-edit-pop-label">Mark the area to change</span>
          <canvas
            ref={brushRef}
            className="photo-brush"
            width={320}
            height={180}
            onPointerDown={paintBrush}
            onPointerMove={paintBrush}
            onPointerUp={paintBrush}
            onPointerCancel={paintBrush}
          />
          <button type="button" className="btn ghost sm" onClick={clearBrush}>Clear mark</button>
          <label htmlFor="photo-region">What should change there</label>
          <textarea id="photo-region" className="gen-image-edit-input" rows={2} value={regionNote} placeholder="e.g. Remove the cup, fix the hand" onChange={(e) => setRegionNote(e.target.value)} />
          <label className="photo-slider">
            <span>Strength</span>
            <input type="range" min={10} max={100} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
            <span>{strength}</span>
          </label>
          <label className="photo-file">
            Reference photo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadReference(file);
              }}
            />
          </label>
          {referenceName && <p className="hint">Using {referenceName}</p>}
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasPhoto || regionNote.trim().length < 2}
            onClick={() => {
              void (async () => {
                const marked = await markedReference();
                onEdit({
                  directed: true,
                  referenceAssetId: marked || undefined,
                  prompt: `Change only the marked region: ${regionNote.trim()}. Strength is ${strengthWord(strength)} (${strength}/100). If a reference image is attached, match its product or light. Leave every unmarked pixel identical.`,
                });
              })();
            }}
          >
            Apply region edit
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy || !hasPhoto || regionNote.trim().length < 2}
            onClick={() => onEdit({
              directed: true,
              variantCount: 3,
              referenceAssetId: referenceId || undefined,
              prompt: `Region edit at ${strengthWord(strength)} strength (${strength}/100): ${regionNote.trim()}. Keep the same subject and product.`,
            })}
          >
            3 variations
          </button>
          <button type="button" className="btn ghost sm" disabled={busy || !version.imagePrevUrl} onClick={onUndo}>
            Undo last photo
          </button>
        </div>
      )}

      {pill === 'finish' && (
        <div className="photo-pane">
          <p className="hint">Enhance cleans detail on this photo. Apply look copies the grade and crop onto the other versions without redrawing them.</p>
          <button
            type="button"
            className="btn sm"
            disabled={busy || !hasPhoto}
            onClick={() => onEdit({
              directed: true,
              prompt: 'Enhance this photograph for a professional ad. Recover fine detail, clean edges, and keep natural skin and product texture. Do not change the composition, people, product, colours, or framing.',
            })}
          >
            Enhance for print
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={versions.length < 2}
            onClick={() => {
              onApplyLook(versions.map((item) => (
                item.id === version.id
                  ? version
                  : {
                    ...item,
                    imageZoom: version.imageZoom,
                    imageFocusX: version.imageFocusX,
                    imageFocusY: version.imageFocusY,
                    imageFinish: { ...finish },
                  }
              )));
              setNote('Crop and grade copied to every version.');
            }}
          >
            Apply this look to all
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy || !hasPhoto || versions.length < 2 || backgroundNote.trim().length < 2}
            onClick={() => onEdit({
              directed: true,
              versionIds: versions.map((item) => item.id),
              prompt: `Keep each subject and product identical. Change only the room, light, and set to: ${backgroundNote.trim()}`,
            })}
          >
            Same background on all
          </button>
          {backgroundNote.trim().length < 2 && <p className="hint">Write the new background under the Background pill first.</p>}
        </div>
      )}
      {note && <p className="hint">{note}</p>}
    </div>
  );
}
