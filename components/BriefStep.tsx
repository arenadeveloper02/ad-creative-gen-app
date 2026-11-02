'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_KINDS, GOALS, type AssetKind } from '@/lib/platforms';
import { readJson } from '@/lib/read-response';
import type { AssetDTO, ProfileDTO, ProjectDTO } from '@/lib/types';

const FIELDS: { key: AssetKind; title: string; sub: string; accept: string; prompt: string }[] = [
  {
    key: 'guidelines',
    title: 'Brand guidelines',
    sub: 'PDF, Word or PowerPoint — logos, fonts and creatives fill in automatically when found',
    accept: '.pdf,.doc,.docx,.ppt,.pptx,.txt',
    prompt: 'Click or drop guideline documents',
  },
  { key: 'logos', title: 'Logos', sub: 'PNG, SVG, JPG or WebP — auto-filled from guidelines, still editable', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', prompt: 'Click or drop logo files' },
  { key: 'fonts', title: 'Fonts', sub: 'TTF, OTF, WOFF or WOFF2 — auto-filled when the file includes fonts', accept: '.ttf,.otf,.woff,.woff2', prompt: 'Click or drop font files' },
  { key: 'refs', title: 'Reference creatives', sub: 'Past ads or visuals — auto-filled from guidelines, still editable', accept: 'image/png,image/jpeg,image/webp,image/gif,.pdf', prompt: 'Click or drop reference images' },
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

type UploadResult = AssetDTO & { extracted?: AssetDTO[] };

function fmtSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type BrandMode = 'new' | 'existing';

export default function BriefStep({ project, profiles, saving, error, onContinue, onDraft, onProfiles }: BriefStepProps) {
  const [description, setDescription] = useState(project?.description ?? '');
  const [sceneNote, setSceneNote] = useState(project?.sceneNote ?? '');
  const [goal, setGoal] = useState(project?.goal ?? 'Awareness');
  const [profileId, setProfileId] = useState(project?.profileId ?? '');
  const [brandMode, setBrandMode] = useState<BrandMode>(
    project?.profileId && profiles.some((item) => item.id === project.profileId) ? 'existing' : 'new',
  );
  const [brandName, setBrandName] = useState(project?.brandName ?? '');
  const [website, setWebsite] = useState('');
  const [product, setProduct] = useState(project?.product ?? '');
  const [c1, setC1] = useState(project?.c1 ?? '#1B365D');
  const [c2, setC2] = useState(project?.c2 ?? '#2E6DA4');
  const [c3, setC3] = useState(project?.c3 ?? '#FFFFFF');
  const [assets, setAssets] = useState<AssetDTO[]>(project?.assets ?? []);
  const [profileName, setProfileName] = useState('');
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState<'ok' | 'err' | ''>('');
  const [overwrite, setOverwrite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const lastLookupKey = useRef('');
  const lookupAbort = useRef(0);

  const selected = brandMode === 'existing' ? (profiles.find((item) => item.id === profileId) ?? null) : null;
  const isNew = brandMode === 'new';

  function chooseNewProfile() {
    const leavingExisting = brandMode === 'existing';
    setBrandMode('new');
    setProfileId('__new__');
    setOverwrite(false);
    setStatus('');
    // Drop profile-owned assets so they are not reattached as project uploads.
    if (leavingExisting) setAssets([]);
  }

  function chooseExisting() {
    if (profiles.length === 0) {
      setStatus('No saved profiles yet. Create a new one first.');
      setStatusKind('err');
      return;
    }
    setBrandMode('existing');
    setOverwrite(false);
    setStatus('');
    const keep = profiles.find((item) => item.id === profileId);
    if (keep) {
      applyProfile(keep.id);
      return;
    }
    applyProfile(profiles[0].id);
  }

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
    setC1(next.c1);
    setC2(next.c2);
    setC3(next.c3);
    setAssets(next.assets);
  }

  async function fillBrandWithAi(force = false) {
    const name = brandName.trim();
    if (name.length < 2) {
      setStatus('Enter a brand name first.');
      setStatusKind('err');
      return;
    }
    const key = `${name.toLowerCase()}|${website.trim().toLowerCase()}`;
    if (!force && key === lastLookupKey.current) return;

    const ticket = lookupAbort.current + 1;
    lookupAbort.current = ticket;
    setLookingUp(true);
    setStatus('Finding the brand site and pulling logo, colours, fonts and creatives with AI…');
    setStatusKind('');

    const res = await fetch('/api/brand-guidelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName: name,
        website: website.trim(),
        projectId: project?.id ?? undefined,
        profileId: selected?.id ?? undefined,
      }),
    });
    const parsed = await readJson(res);
    if (ticket !== lookupAbort.current) return;
    setLookingUp(false);
    if (!parsed.ok) {
      setStatus(parsed.error);
      setStatusKind('err');
      return;
    }

    const data = parsed.data as {
      brandName?: string;
      product?: string;
      website?: string;
      c1?: string;
      c2?: string;
      c3?: string;
      summary?: string;
      headlineFont?: string;
      assets?: AssetDTO[];
      counts?: Record<string, number>;
    };

    lastLookupKey.current = key;
    if (typeof data.brandName === 'string' && data.brandName.trim() !== '') setBrandName(data.brandName);
    if (typeof data.product === 'string' && data.product.trim() !== '' && product.trim() === '') setProduct(data.product);
    if (typeof data.website === 'string' && data.website.trim() !== '' && website.trim() === '') setWebsite(data.website);
    if (typeof data.c1 === 'string') setC1(data.c1);
    if (typeof data.c2 === 'string') setC2(data.c2);
    if (typeof data.c3 === 'string') setC3(data.c3);
    const found = Array.isArray(data.assets) ? data.assets.filter((item) => item && typeof item.id === 'string') : [];
    if (found.length > 0) {
      setAssets((current) => {
        const ids = new Set(current.map((item) => item.id));
        const added = found.filter((item) => !ids.has(item.id));
        return added.length ? [...current, ...added] : current;
      });
    }

    const counts = data.counts ?? {};
    const bits: string[] = [];
    if (counts.logos) bits.push(`${counts.logos} logo${counts.logos === 1 ? '' : 's'}`);
    if (counts.fonts) bits.push(`${counts.fonts} font file${counts.fonts === 1 ? '' : 's'}`);
    if (counts.refs) bits.push(`${counts.refs} creative${counts.refs === 1 ? '' : 's'}`);
    if (counts.guidelines) bits.push(`${counts.guidelines} brand kit doc${counts.guidelines === 1 ? '' : 's'}`);
    const fontNote = typeof data.headlineFont === 'string' && data.headlineFont.trim() !== '' ? ` Headline font: ${data.headlineFont.trim()}.` : '';
    const summary = typeof data.summary === 'string' && data.summary.trim() !== '' ? ` ${data.summary.trim()}` : '';
    const filled = bits.length ? ` Pulled ${bits.join(', ')} from the brand site — everything stays editable.` : ' No logo, fonts or creatives were reachable online — upload them below if you have them.';
    setStatus(`Brand colours filled with AI.${filled}${fontNote}${summary}`);
    setStatusKind('ok');
  }

  async function upload(kind: AssetKind, list: FileList | File[]) {
    setUploading(true);
    setStatus(kind === 'guidelines' ? 'Reading brand guidelines…' : '');
    setStatusKind('');
    const added: AssetDTO[] = [];
    let extractedCount = 0;
    let failed = false;
    for (const file of [...list]) {
      const form = new FormData();
      form.set('file', file);
      form.set('kind', kind);
      if (project) form.set('projectId', project.id);
      else if (selected) form.set('profileId', selected.id);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const parsed = await readJson(res);
      if (!parsed.ok) {
        failed = true;
        setStatus(parsed.error);
        setStatusKind('err');
        break;
      }
      const data = parsed.data as UploadResult;
      if (data && typeof data.id === 'string') {
        const { extracted, ...asset } = data;
        added.push(asset);
        if (Array.isArray(extracted)) {
          for (const part of extracted) {
            if (part && typeof part.id === 'string') {
              added.push(part);
              extractedCount += 1;
            }
          }
        }
      }
    }
    if (added.length) setAssets((current) => [...current, ...added]);
    if (kind === 'guidelines' && !failed) {
      if (extractedCount > 0) {
        setStatus(`Guidelines saved. Prefilling ${extractedCount} logo, font or creative file${extractedCount === 1 ? '' : 's'} — you can still edit them.`);
        setStatusKind('ok');
      } else {
        setStatus('Guidelines saved. No embedded logos, fonts or creatives found — add them below if you have them.');
        setStatusKind('ok');
      }
    }
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
  }, [description, sceneNote, goal, brandName, product, profileId, c1, c2, c3, assets]);

  function payload(ids: string[]): BriefPayload {
    return {
      description: description.trim(),
      sceneNote: sceneNote.trim(),
      goal,
      brandName: brandName.trim(),
      product: product.trim(),
      guidelineUrl: '',
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
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        brandName,
        product,
        guidelineUrl: '',
        c1,
        c2,
        c3,
        assetIds: assets.map((item) => item.id),
        overwrite,
      }),
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
    setBrandMode('existing');
    setProfileId(saved.id);
    setAssets(saved.assets);
    setOverwrite(false);
    setStatus(`Saved profile "${saved.name}" with guidelines, logos, fonts and creatives.`);
    setStatusKind('ok');
  }

  async function updateProfile() {
    if (!selected) return;
    const res = await fetch(`/api/profiles/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: selected.name,
        brandName,
        product,
        guidelineUrl: '',
        c1,
        c2,
        c3,
        assetIds: assets.map((item) => item.id),
      }),
    });
    const parsed = await readJson(res);
    if (!parsed.ok) {
      setStatus(parsed.error);
      setStatusKind('err');
      return;
    }
    const saved = parsed.data as ProfileDTO;
    onProfiles(profiles.map((item) => (item.id === saved.id ? saved : item)));
    setAssets(saved.assets);
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
    const rest = profiles.filter((item) => item.id !== selected.id);
    onProfiles(rest);
    if (rest.length === 0) {
      setBrandMode('new');
      setProfileId('__new__');
      setAssets([]);
    } else {
      applyProfile(rest[0].id);
    }
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
        <p className="hint">Fill brand colours and logo with AI from the company name, upload guideline files, or pick a saved profile under Use existing.</p>

        <div className="brand-panel">
          <label>Brand profile</label>
          <div className="chips brand-mode-chips" role="group" aria-label="Brand profile choice">
            <button type="button" className={`chip${brandMode === 'new' ? ' on' : ''}`} onClick={chooseNewProfile}>
              New profile
            </button>
            <span className="brand-or" aria-hidden="true">or</span>
            <button
              type="button"
              className={`chip${brandMode === 'existing' ? ' on' : ''}`}
              disabled={profiles.length === 0}
              onClick={chooseExisting}
            >
              Use existing
            </button>
          </div>
          {profiles.length === 0 && (
            <p className="hint">No saved profiles yet. Stay on New profile, fill the brand in, and save it if you want to reuse it.</p>
          )}

          {brandMode === 'existing' && (
            <>
              <label htmlFor="profileSelect">Saved profile</label>
              <select
                id="profileSelect"
                value={selected?.id ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') return;
                  applyProfile(value);
                }}
              >
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </>
          )}

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
              <input
                id="brand"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                onBlur={() => {
                  if (isNew && brandName.trim().length >= 2 && !lookingUp && !uploading) void fillBrandWithAi(false);
                }}
                placeholder="e.g. Gentle Dental"
              />
            </div>
            <div>
              <label htmlFor="product">Product or service</label>
              <input id="product" type="text" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Arena AI workflow platform" />
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label htmlFor="website">Brand website (optional)</label>
              <input
                id="website"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="e.g. https://gentledental.com"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                type="button"
                className="btn sm"
                disabled={lookingUp || uploading || brandName.trim().length < 2}
                onClick={() => void fillBrandWithAi(true)}
              >
                {lookingUp ? 'Looking up…' : 'Fill with AI'}
              </button>
            </div>
          </div>
          <p className="hint">Type a brand name and leave the field, or click Fill with AI. It finds the official site, then pulls the logo, brand colours, font files, hero creatives and any public brand-kit PDF into the fields below.</p>

          {isNew && (
            <div style={{ marginTop: 12 }}>
              <label htmlFor="profileName">New profile name</label>
              <input
                id="profileName"
                type="text"
                value={profileName}
                onChange={(e) => {
                  setProfileName(e.target.value);
                  setOverwrite(false);
                }}
                placeholder="e.g. Position2 – Arena"
              />
            </div>
          )}

          <div className="asset-grid">
            {FIELDS.map((field) => (
              <div key={field.key} className="asset-card">
                <h4>{field.title}</h4>
                <p className="hint">{field.sub}</p>
                <label className="drop">
                  {uploading ? (field.key === 'guidelines' ? 'Reading guidelines…' : 'Uploading…') : field.prompt}
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

          {isNew && (
            <div className="footer" style={{ marginTop: 14 }}>
              <button type="button" className="btn sm" onClick={() => void saveProfile()}>
                {overwrite ? 'Overwrite' : 'Save profile'}
              </button>
            </div>
          )}

          {status && <p className={`status-line ${statusKind}`}>{status}</p>}
        </div>

        {error && <div className="err" role="alert">{error}</div>}
        <div className="footer">
          <span />
          <button
            type="button"
            className="btn"
            disabled={saving || uploading || lookingUp}
            onClick={() => onContinue(draftPayload())}
          >
            {saving ? 'Saving…' : 'Next: platform'}
          </button>
        </div>
      </div>
    </div>
  );
}
