'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_KINDS, GOALS, type AssetKind } from '@/lib/platforms';
import { readJson } from '@/lib/read-response';
import type { AssetDTO, ProfileDTO, ProjectDTO } from '@/lib/types';

const FIELDS: { key: AssetKind; title: string; sub: string; accept: string; prompt: string }[] = [
  { key: 'guidelines', title: 'Brand guidelines', sub: 'PDF, Word or PowerPoint brand book', accept: '.pdf,.doc,.docx,.ppt,.pptx,.txt', prompt: 'Click or drop guideline documents' },
  { key: 'logos', title: 'Logos', sub: 'PNG, SVG, JPG or WebP', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', prompt: 'Click or drop logo files' },
  { key: 'fonts', title: 'Fonts', sub: 'TTF, OTF, WOFF or WOFF2', accept: '.ttf,.otf,.woff,.woff2', prompt: 'Click or drop font files' },
  { key: 'refs', title: 'Reference creatives', sub: 'Past ads or visuals to match', accept: 'image/png,image/jpeg,image/webp,image/gif,.pdf', prompt: 'Click or drop reference images' },
];

export interface BriefPayload {
  description: string;
  sceneNote: string;
  goal: string;
  brandName: string;
  product: string;
  guidelineUrl: string;
  profileId: string | null;
  c1: string;
  c2: string;
  c3: string;
  assetIds: string[];
}

interface BriefStepProps {
  project: ProjectDTO | null;
  profiles: ProfileDTO[];
  saving: boolean;
  error: string | null;
  onContinue: (data: BriefPayload) => void;
  onDraft: (data: BriefPayload) => void;
  onProfiles: (profiles: ProfileDTO[]) => void;
}

function fmtSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function BriefStep({ project, profiles, saving, error, onContinue, onDraft, onProfiles }: BriefStepProps) {
  const [description, setDescription] = useState(project?.description ?? '');
  const [sceneNote, setSceneNote] = useState(project?.sceneNote ?? '');
  const [goal, setGoal] = useState(project?.goal ?? 'Awareness');
  const [profileId, setProfileId] = useState(project?.profileId ?? '');
  const [brandName, setBrandName] = useState(project?.brandName ?? '');
  const [product, setProduct] = useState(project?.product ?? '');
  const [guidelineUrl, setGuidelineUrl] = useState(project?.guidelineUrl ?? '');
  const [c1, setC1] = useState(project?.c1 ?? '#1B365D');
  const [c2, setC2] = useState(project?.c2 ?? '#2E6DA4');
  const [c3, setC3] = useState(project?.c3 ?? '#FFFFFF');
  const [assets, setAssets] = useState<AssetDTO[]>(project?.assets ?? []);
  const [profileName, setProfileName] = useState('');
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'ok' | 'err' | ''>('');
  const [overwrite, setOverwrite] = useState(false);
  const [uploading, setUploading] = useState(false);

  const selected = profiles.find((item) => item.id === profileId) ?? null;
  const isNew = profileId === '__new__';

  const grouped = useMemo(() => {
    const map: Record<string, AssetDTO[]> = {};
    for (const kind of ASSET_KINDS) map[kind] = [];
    const source = selected && assets.length === 0 ? selected.assets : assets;
    for (const asset of source) {
      if (!map[asset.kind]) map[asset.kind] = [];
      map[asset.kind].push(asset);
    }
    return map;
  }, [assets, selected]);

  function applyProfile(id: string) {
    setProfileId(id);
    setOverwrite(false);
    setStatus('');
    const next = profiles.find((item) => item.id === id);
    if (!next) return;
    setBrandName(next.brandName);
    setProduct(next.product);
    setGuidelineUrl(next.guidelineUrl);
    setC1(next.c1);
    setC2(next.c2);
    setC3(next.c3);
    setAssets(next.assets);
  }

  async function upload(kind: AssetKind, list: FileList | File[]) {
    setUploading(true);
    setStatus('');
    const added: AssetDTO[] = [];
    for (const file of [...list]) {
      const form = new FormData();
      form.set('file', file);
      form.set('kind', kind);
      if (project) form.set('projectId', project.id);
      else if (selected) form.set('profileId', selected.id);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const parsed = await readJson(res);
      if (!parsed.ok) {
        setStatus(parsed.error);
        setStatusKind('err');
        break;
      }
      const data = parsed.data as AssetDTO;
      if (data && typeof data.id === 'string') added.push(data);
    }
    if (added.length) setAssets((current) => [...current, ...added]);
    setUploading(false);
  }

  async function removeAsset(id: string) {
    setAssets((current) => current.filter((item) => item.id !== id));
  }

  function draftPayload(): BriefPayload {
    const ids = assets.filter((item) => !selected?.assets.some((owned) => owned.id === item.id)).map((item) => item.id);
    return payload(ids);
  }

  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    onDraftRef.current(draftPayload());
    // draftPayload reads the fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, sceneNote, goal, brandName, product, guidelineUrl, profileId, c1, c2, c3, assets]);

  function payload(ids: string[]): BriefPayload {
    return {
      description: description.trim(),
      sceneNote: sceneNote.trim(),
      goal,
      brandName: brandName.trim(),
      product: product.trim(),
      guidelineUrl: guidelineUrl.trim(),
      profileId: selected ? selected.id : null,
      c1,
      c2,
      c3,
      assetIds: ids,
    };
  }

  async function saveProfile() {
    const name = profileName.trim();
    if (name === '') {
      setStatus('Enter a name for the profile.');
      setStatusKind('err');
      return;
    }
    const unassigned = project ? [] : assets.map((item) => item.id);
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, brandName, product, guidelineUrl, c1, c2, c3, assetIds: unassigned, overwrite }),
    });
    const parsed = await readJson(res);
    if (!parsed.ok) {
      if (res.status === 409) setOverwrite(true);
      setStatus(parsed.error);
      setStatusKind('err');
      return;
    }
    const saved = parsed.data as ProfileDTO;
    const next = [...profiles.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
    onProfiles(next);
    setProfileId(saved.id);
    setAssets(saved.assets);
    setOverwrite(false);
    setStatus(`Saved profile "${saved.name}".`);
    setStatusKind('ok');
  }

  async function updateProfile() {
    if (!selected) return;
    const res = await fetch(`/api/profiles/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selected.name, brandName, product, guidelineUrl, c1, c2, c3, assetIds: [] }),
    });
    const parsed = await readJson(res);
    if (!parsed.ok) {
      setStatus(parsed.error);
      setStatusKind('err');
      return;
    }
    const saved = parsed.data as ProfileDTO;
    onProfiles(profiles.map((item) => (item.id === saved.id ? saved : item)));
    setStatus(`Updated "${saved.name}".`);
    setStatusKind('ok');
  }

  async function deleteProfile() {
    if (!selected) return;
    if (!window.confirm(`Delete profile "${selected.name}"?`)) return;
    const res = await fetch(`/api/profiles/${selected.id}`, { method: 'DELETE' });
    const parsed = await readJson(res);
    if (!parsed.ok) {
      setStatus(parsed.error);
      setStatusKind('err');
      return;
    }
    onProfiles(profiles.filter((item) => item.id !== selected.id));
    setProfileId('');
    setStatus(`Deleted "${selected.name}".`);
    setStatusKind('ok');
  }

  return (
    <div className="wide-single">
      <div className="card">
        <h3>Tell us about the ad</h3>
        <p className="sub">Start with the product, the goal, and your brand rules. Choose a saved brand profile or upload new brand assets.</p>

        <label htmlFor="desc">Describe the ad you want</label>
        <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Two founders in a glass office reviewing a sales dashboard. Clean daylight, no clutter. Keep professional navy blue on the screen and suits, or brand red on the logo and one accent." />
        <p className="hint">Write the picture here. This is what the image follows. Say professional blue or red if that is the brand colour you want kept.</p>

        <label htmlFor="goal">What should this ad achieve?</label>
        <select id="goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
          {GOALS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>

        <h4 style={{ marginTop: 22 }}>Brand profile, guidelines and assets</h4>
        <p className="hint">A saved profile is optional. Type the brand details below, or pick a profile to fill them in.</p>

        <div className="brand-panel">
          <label htmlFor="profileSelect">Brand profile</label>
          <select
            id="profileSelect"
            value={profileId}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '__new__' || value === '') {
                setProfileId(value);
                if (value === '__new__') setAssets([]);
                return;
              }
              applyProfile(value);
            }}
          >
            <option value="">No saved profile</option>
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value="__new__">+ Add new profile…</option>
          </select>

          {selected && (
            <div className="footer" style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost sm" onClick={() => void updateProfile()}>
                Update profile
              </button>
              <button type="button" className="btn danger sm" onClick={() => void deleteProfile()}>
                Delete
              </button>
            </div>
          )}

          <div className="row">
              <div>
                <label htmlFor="brand">Brand / company name</label>
                <input id="brand" type="text" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g. Position2" />
              </div>
              <div>
                <label htmlFor="product">Product or service</label>
                <input id="product" type="text" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Arena AI workflow platform" />
              </div>
          </div>

          {isNew && (
            <div style={{ marginTop: 12 }}>
              <label htmlFor="profileName">New profile name</label>
              <input id="profileName" type="text" value={profileName} onChange={(e) => { setProfileName(e.target.value); setOverwrite(false); }} placeholder="e.g. Position2 – Arena" />
              <div className="footer">
                <button type="button" className="btn sm" onClick={() => void saveProfile()}>
                  {overwrite ? 'Overwrite' : 'Save profile'}
                </button>
              </div>
            </div>
          )}

          <div className="asset-grid">
                {FIELDS.map((field) => (
                  <div key={field.key} className="asset-card">
                    <h4>{field.title}</h4>
                    <p className="hint">{field.sub}</p>
                    <label className="drop">
                      {uploading ? 'Uploading…' : field.prompt}
                      <input
                        type="file"
                        multiple
                        accept={field.accept}
                        hidden
                        onChange={(e) => {
                          if (e.target.files) void upload(field.key, e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <ul className="filelist">
                      {(grouped[field.key] ?? []).map((file) => (
                        <li key={file.id}>
                          <span className="nm">{file.name}</span>
                          <span className="sz">{fmtSize(file.size)}</span>
                          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => void removeAsset(file.id)}>
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="asset-card">
                  <h4>Brand colors</h4>
                  <p className="hint">Primary, secondary and accent</p>
                  <div className="swatches">
                    <input type="color" value={c1} onChange={(e) => setC1(e.target.value)} aria-label="Primary color" />
                    <input type="color" value={c2} onChange={(e) => setC2(e.target.value)} aria-label="Secondary color" />
                    <input type="color" value={c3} onChange={(e) => setC3(e.target.value)} aria-label="Accent color" />
                  </div>
                </div>
              </div>
          <label htmlFor="guidelineUrl">Guidelines link (optional)</label>
          <input id="guidelineUrl" type="url" value={guidelineUrl} onChange={(e) => setGuidelineUrl(e.target.value)} placeholder="https://brand.example.com" />
          {status && <p className={`status-line ${statusKind}`}>{status}</p>}
        </div>

        {error && <div className="err" role="alert">{error}</div>}
        <div className="footer">
          <span />
          <button
            type="button"
            className="btn"
            disabled={saving || uploading}
            onClick={() => onContinue(draftPayload())}
          >
            {saving ? 'Saving…' : 'Next: platform'}
          </button>
        </div>
      </div>
    </div>
  );
}
