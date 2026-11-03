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

/** ai = type the company and everything fills itself; existing = a saved profile; manual = write it all by hand. */
type BrandMode = 'ai' | 'existing' | 'manual';

const VARIANT_RE = /^(Primary|Reverse \(white\)|Icon|Stacked|Mono|Alternate) - (.+)$/;

/** Logo files pulled by the brand hunt are named "<Variant> - <file>"; show the variant as a tag. */
function splitVariant(name: string): { variant: string | null; name: string } {
  const m = name.match(VARIANT_RE);
  return m ? { variant: m[1], name: m[2] } : { variant: null, name };
}

function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`;
}

/** Inline preview: image thumbnail, live font sample, or a doc badge. Click opens the file. */
function AssetThumb({ file, dark = false }: { file: AssetDTO; dark?: boolean }) {
  const url = assetUrl(file.id);
  if (file.mimeType.startsWith('image/')) {
    return (
      <a className={`thumb img${dark ? ' dark' : ''}`} href={url} target="_blank" rel="noreferrer" title={`Open ${file.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={file.name} loading="lazy" />
      </a>
    );
  }
  if (file.kind === 'fonts') {
    const family = `asset-${file.id}`;
    return (
      <a className="thumb font" href={url} target="_blank" rel="noreferrer" title={`Open ${file.name}`}>
        <style>{`@font-face{font-family:"${family}";src:url("${url}");font-display:block;}`}</style>
        <span style={{ fontFamily: `"${family}", sans-serif` }}>Aa</span>
      </a>
    );
  }
  const ext = file.name.split('.').pop()?.toUpperCase().slice(0, 4) || 'DOC';
  return (
    <a className="thumb doc" href={url} target="_blank" rel="noreferrer" title={`Open ${file.name}`}>
      {ext}
    </a>
  );
}

export default function BriefStep({ project, profiles, saving, error, onContinue, onDraft, onProfiles }: BriefStepProps) {
  const [description, setDescription] = useState(project?.description ?? '');
  const [sceneNote, setSceneNote] = useState(project?.sceneNote ?? '');
  const [goal, setGoal] = useState(project?.goal ?? 'Awareness');
  const [profileId, setProfileId] = useState(project?.profileId ?? '');
  const [brandMode, setBrandMode] = useState<BrandMode>(
    project?.profileId && profiles.some((item) => item.id === project.profileId) ? 'existing' : 'ai',
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
  /** True once the user types the product themselves; AI then leaves it alone. */
  const productTouched = useRef(project?.product ? true : false);
  /** Files the last AI fill added, so a new company replaces them instead of piling up. */
  const aiAssetIds = useRef<Set<string>>(new Set());

  // The profile the project will point at: the picked one under Use existing, or the one AI just saved.
  const linked = brandMode !== 'manual' ? (profiles.find((item) => item.id === profileId) ?? null) : null;
  // Saved profiles are only shown and editable under Use existing; AI mode never displays old profile files.
  const selected = brandMode === 'existing' ? linked : null;
  const isNew = brandMode !== 'existing';
  const isAi = brandMode === 'ai';

  /** Everything typed or AI-filled in one tab, kept while the user looks at another tab. */
  interface ModeDraft {
    brandName: string;
    website: string;
    product: string;
    profileName: string;
    c1: string;
    c2: string;
    c3: string;
    assets: AssetDTO[];
    profileId: string;
    lookupKey: string;
    aiIds: string[];
    productTouched: boolean;
  }
  const drafts = useRef<{ ai: ModeDraft | null; manual: ModeDraft | null; existingId: string }>({ ai: null, manual: null, existingId: '' });

  function snapshotDraft(): ModeDraft {
    return {
      brandName,
      website,
      product,
      profileName,
      c1,
      c2,
      c3,
      assets,
      profileId,
      lookupKey: lastLookupKey.current,
      aiIds: [...aiAssetIds.current],
      productTouched: productTouched.current,
    };
  }

  /** Remembers the current tab's unsaved state before leaving it. */
  function stashDraft() {
    if (brandMode === 'ai') drafts.current.ai = snapshotDraft();
    else if (brandMode === 'manual') drafts.current.manual = snapshotDraft();
    else drafts.current.existingId = profileId;
  }

  function restoreDraft(draft: ModeDraft) {
    setBrandName(draft.brandName);
    setWebsite(draft.website);
    setProduct(draft.product);
    setProfileName(draft.profileName);
    setC1(draft.c1);
    setC2(draft.c2);
    setC3(draft.c3);
    setAssets(draft.assets);
    setProfileId(draft.profileId);
    lastLookupKey.current = draft.lookupKey;
    aiAssetIds.current = new Set(draft.aiIds);
    productTouched.current = draft.productTouched;
  }

  function chooseNewProfile(mode: 'ai' | 'manual') {
    if (mode === brandMode) return;
    stashDraft();
    setBrandMode(mode);
    setOverwrite(false);
    setStatusKind('');
    const draft = mode === 'ai' ? drafts.current.ai : drafts.current.manual;
    if (draft) {
      // Coming back: pick up exactly where this tab was left, saved or not.
      restoreDraft(draft);
      setStatus(mode === 'ai' ? 'Your AI-filled brand is back as you left it.' : 'Your manual profile is back as you left it.');
      return;
    }
    setStatus(mode === 'ai' ? 'Type the company name and leave the field — logo, colours, fonts and creatives fill in and the profile is saved for you.' : 'Fill the brand in yourself and upload your own files. Save the profile to reuse it.');
    // A fresh tab starts empty: nothing from a previous company or saved profile carries over.
    setProfileId('__new__');
    setAssets([]);
    aiAssetIds.current = new Set();
    lastLookupKey.current = '';
    setBrandName('');
    setWebsite('');
    setProduct('');
    setProfileName('');
    productTouched.current = false;
  }

  function chooseExisting() {
    if (profiles.length === 0) {
      setStatus('No saved profiles yet. Create a new one first.');
      setStatusKind('err');
      return;
    }
    if (brandMode === 'existing') return;
    stashDraft();
    setBrandMode('existing');
    setOverwrite(false);
    setStatus('');
    // Prefer the profile last viewed under Use existing, then the one AI just saved, then the first.
    const wanted = profiles.find((item) => item.id === drafts.current.existingId) ?? profiles.find((item) => item.id === profileId) ?? profiles[0];
    applyProfile(wanted.id);
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
    setStatus('');
    setStatusKind('');

    const res = await fetch('/api/brand-guidelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName: name,
        website: website.trim(),
        projectId: project?.id ?? undefined,
        profileId: undefined,
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
    const nextBrand = typeof data.brandName === 'string' && data.brandName.trim() !== '' ? data.brandName : name;
    const aiProduct = typeof data.product === 'string' && data.product.trim() !== '' ? data.product : '';
    // Replace the product line unless the user wrote it themselves.
    const nextProduct = aiProduct && (!productTouched.current || product.trim() === '') ? aiProduct : product;
    if (aiProduct && nextProduct === aiProduct) productTouched.current = false;
    const nextC1 = typeof data.c1 === 'string' ? data.c1 : c1;
    const nextC2 = typeof data.c2 === 'string' ? data.c2 : c2;
    const nextC3 = typeof data.c3 === 'string' ? data.c3 : c3;
    setBrandName(nextBrand);
    setProduct(nextProduct);
    if (typeof data.website === 'string' && data.website.trim() !== '' && website.trim() === '') setWebsite(data.website);
    setC1(nextC1);
    setC2(nextC2);
    setC3(nextC3);
    const found = Array.isArray(data.assets) ? data.assets.filter((item) => item && typeof item.id === 'string') : [];
    // Logos, fonts and creatives belong to this company only: everything from before is replaced.
    const nextAssets = found;
    aiAssetIds.current = new Set(found.map((item) => item.id));
    setAssets(nextAssets);

    const counts = data.counts ?? {};
    const bits: string[] = [];
    if (counts.logos) bits.push(`${counts.logos} logo${counts.logos === 1 ? '' : 's'}`);
    if (counts.fonts) bits.push(`${counts.fonts} font file${counts.fonts === 1 ? '' : 's'}`);
    if (counts.refs) bits.push(`${counts.refs} creative${counts.refs === 1 ? '' : 's'}`);
    if (counts.guidelines) bits.push(`${counts.guidelines} brand kit doc${counts.guidelines === 1 ? '' : 's'}`);
    const fontNote = typeof data.headlineFont === 'string' && data.headlineFont.trim() !== '' ? ` Headline font: ${data.headlineFont.trim()}.` : '';
    const summary = typeof data.summary === 'string' && data.summary.trim() !== '' ? ` ${data.summary.trim()}` : '';
    const filled = bits.length ? ` Pulled ${bits.join(', ')} from the brand site — everything stays editable.` : ' No logo, fonts or creatives were reachable online — upload them below if you have them.';

    // Save it as a profile straight away so it shows under Use existing next time.
    if (brandMode === 'ai') {
      const saved = await persistProfile({
        name: profileName.trim() || nextBrand.trim(),
        brandName: nextBrand,
        product: nextProduct,
        c1: nextC1,
        c2: nextC2,
        c3: nextC3,
        assetIds: nextAssets.map((item) => item.id),
        overwrite: true,
        stayInAiMode: true,
      });
      if (saved) {
        setStatus(`Brand filled with AI and saved as profile "${saved.name}".${filled}${fontNote}${summary}`);
        setStatusKind('ok');
        return;
      }
    }
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
      else if (linked) form.set('profileId', linked.id);
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
    const ids = assets.filter((item) => !linked?.assets.some((owned) => owned.id === item.id)).map((item) => item.id);
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
      profileId: linked ? linked.id : null,
      c1,
      c2,
      c3,
      assetIds: ids,
    };
  }

  /** Creates or overwrites a profile and switches the panel to it. Returns the saved profile, or null after showing the error. */
  async function persistProfile(input: {
    name: string;
    brandName: string;
    product: string;
    c1: string;
    c2: string;
    c3: string;
    assetIds: string[];
    overwrite: boolean;
    stayInAiMode?: boolean;
  }): Promise<ProfileDTO | null> {
    if (input.name === '') {
      setStatus('Enter a name for the profile.');
      setStatusKind('err');
      return null;
    }
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, stayInAiMode: undefined, guidelineUrl: '' }),
    });
    const parsed = await readJson(res);
    if (!parsed.ok) {
      if (res.status === 409) setOverwrite(true);
      setStatus(parsed.error);
      setStatusKind('err');
      return null;
    }
    const saved = parsed.data as ProfileDTO;
    const next = [...profiles.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
    onProfiles(next);
    if (!input.stayInAiMode) setBrandMode('existing');
    setProfileId(saved.id);
    setAssets(saved.assets);
    aiAssetIds.current = new Set(saved.assets.map((item) => item.id));
    setOverwrite(false);
    return saved;
  }

  async function saveProfile() {
    const saved = await persistProfile({
      name: profileName.trim() || (isAi ? brandName.trim() : ''),
      brandName,
      product,
      c1,
      c2,
      c3,
      assetIds: assets.map((item) => item.id),
      overwrite,
    });
    if (!saved) return;
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
      setBrandMode('ai');
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
        <p className="hint">Type the company name and AI fills the logo, colours, fonts and creatives and saves the profile. Or pick a saved profile, or write one by hand.</p>

        <div className="brand-panel">
          <label>Brand profile</label>
          <div className="chips brand-mode-chips" role="group" aria-label="Brand profile choice">
            <button type="button" className={`chip${brandMode === 'ai' ? ' on' : ''}`} onClick={() => chooseNewProfile('ai')}>
              Auto-fill with AI
            </button>
            <span className="brand-or" aria-hidden="true">OR</span>
            <button
              type="button"
              className={`chip${brandMode === 'existing' ? ' on' : ''}`}
              disabled={profiles.length === 0}
              onClick={chooseExisting}
            >
              Use existing{profiles.length > 0 ? ` (${profiles.length})` : ''}
            </button>
            <span className="brand-or" aria-hidden="true">OR</span>
            <button type="button" className={`chip${brandMode === 'manual' ? ' on' : ''}`} onClick={() => chooseNewProfile('manual')}>
              Write manually
            </button>
          </div>
          {profiles.length === 0 && (
            <p className="hint">No saved profiles yet. Auto-fill one with AI or write one manually — it will appear under Use existing.</p>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                <input
                  id="brand"
                  type="text"
                  style={{ flex: 1, minWidth: 0 }}
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  onBlur={() => {
                    if (isAi && brandName.trim().length >= 2 && !lookingUp && !uploading) void fillBrandWithAi(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  }}
                  placeholder="e.g. Gentle Dental"
                  disabled={lookingUp}
                />
                {isAi && (
                  <button
                    type="button"
                    className="btn sm"
                    style={{ whiteSpace: 'nowrap', alignSelf: 'center' }}
                    disabled={lookingUp || uploading || brandName.trim().length < 2}
                    onClick={() => void fillBrandWithAi(true)}
                  >
                    {lookingUp ? 'Filling…' : 'Fill with AI'}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label htmlFor="product">Product or service</label>
              <input
                id="product"
                type="text"
                value={product}
                onChange={(e) => {
                  productTouched.current = true;
                  setProduct(e.target.value);
                }}
                placeholder="e.g. Arena AI workflow platform"
              />
            </div>
          </div>

          {isAi && (
            <>
              <div className="row" style={{ marginTop: 12 }}>
                <div>
                  <label htmlFor="website">Brand website (optional, helps the AI find the right company)</label>
                  <input
                    id="website"
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    onBlur={() => {
                      if (brandName.trim().length >= 2 && !lookingUp && !uploading) void fillBrandWithAi(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    }}
                    placeholder="e.g. https://gentledental.com"
                    disabled={lookingUp}
                  />
                </div>
                <div>
                  <label htmlFor="profileName">Profile name (optional, defaults to the brand)</label>
                  <input
                    id="profileName"
                    type="text"
                    value={profileName}
                    onChange={(e) => {
                      setProfileName(e.target.value);
                      setOverwrite(false);
                    }}
                    placeholder={brandName.trim() || 'e.g. Gentle Dental – Q3'}
                  />
                </div>
              </div>
              {lookingUp && <p className="status-line">Finding the brand site and pulling logo, colours, fonts and creatives with AI…</p>}
            </>
          )}

          {brandMode === 'manual' && (
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
                      {(() => {
                        const split = splitVariant(file.name);
                        return (
                          <>
                            <AssetThumb file={file} dark={split.variant === 'Reverse (white)'} />
                            {split.variant && <span className={`variant v-${split.variant.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{split.variant}</span>}
                            <span className="nm">{split.name}</span>
                          </>
                        );
                      })()}
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
