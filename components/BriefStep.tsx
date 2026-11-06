'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import HexColorField from '@/components/HexColorField';
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
  { key: 'logos', title: 'Logos', sub: 'Tick On ad for the one logo that goes on the final image (one only)', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', prompt: 'Click or drop logo files' },
  { key: 'fonts', title: 'Fonts', sub: 'Tick On ad for fonts that should guide the look', accept: '.ttf,.otf,.woff,.woff2', prompt: 'Click or drop font files' },
  { key: 'refs', title: 'Reference creatives', sub: 'Tick On ad for up to 3 creatives the image model should match', accept: 'image/png,image/jpeg,image/webp,image/gif,.pdf', prompt: 'Click or drop reference images' },
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
  renderAssetIds: string[];
}

/** Default "Use on ad" picks: one logo (Primary preferred), up to 3 refs, first 2 fonts. */
function defaultRenderIds(list: AssetDTO[]): string[] {
  const logos = list.filter((item) => item.kind === 'logos');
  const primary = logos.find((item) => item.name.startsWith('Primary -')) ?? logos[0];
  const refs = list.filter((item) => item.kind === 'refs').slice(0, 3);
  const fonts = list.filter((item) => item.kind === 'fonts').slice(0, 2);
  return [...(primary ? [primary.id] : []), ...fonts.map((item) => item.id), ...refs.map((item) => item.id)];
}

interface BriefStepProps {
  project: ProjectDTO | null;
  profiles: ProfileDTO[];
  saving: boolean;
  error: string | null;
  /** story = describe + goal (page 1). brand = profile, assets, colors (page 2). */
  part: 'story' | 'brand';
  onContinue: (data: BriefPayload) => void;
  onDraft: (data: BriefPayload | null) => void;
  onProfiles: (profiles: ProfileDTO[]) => void;
  onBack?: () => void;
  onGenerate?: () => void;
  children?: ReactNode;
}

type UploadResult = AssetDTO & { extracted?: AssetDTO[] };

function fmtSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** ai = type the company and everything fills itself; existing = a saved profile; manual = write it all by hand. */
type BrandMode = 'existing' | 'manual';

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

export default function BriefStep({ project, profiles, saving, error, part, onContinue, onDraft, onProfiles, onBack, onGenerate, children }: BriefStepProps) {
  const [description, setDescription] = useState(project?.description ?? '');
  const [sceneNote, setSceneNote] = useState(project?.sceneNote ?? '');
  const [goal, setGoal] = useState(project?.goal ?? 'Awareness');
  const [profileId, setProfileId] = useState(project?.profileId ?? '');
  const [brandMode, setBrandMode] = useState<BrandMode>(
    project?.profileId && profiles.some((item) => item.id === project.profileId) ? 'existing' : 'manual',
  );
  const [brandName, setBrandName] = useState(project?.brandName ?? '');
  const [website, setWebsite] = useState('');
  const [product, setProduct] = useState(project?.product ?? '');
  const [c1, setC1] = useState(project?.c1 ?? '#1B365D');
  const [c2, setC2] = useState(project?.c2 ?? '#2E6DA4');
  const [c3, setC3] = useState(project?.c3 ?? '#FFFFFF');
  const [assets, setAssets] = useState<AssetDTO[]>(project?.assets ?? []);
  const [renderAssetIds, setRenderAssetIds] = useState<string[]>(
    project?.renderAssetIds?.length ? project.renderAssetIds : defaultRenderIds(project?.assets ?? []),
  );
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

  // Saved profiles are only linked under Use existing.
  const linked = brandMode === 'existing' ? (profiles.find((item) => item.id === profileId) ?? null) : null;
  const selected = linked;
  const isNew = brandMode === 'manual';

  /** Unsaved Write manually state, kept while the user looks at Use existing. */
  interface ModeDraft {
    brandName: string;
    website: string;
    product: string;
    profileName: string;
    c1: string;
    c2: string;
    c3: string;
    assets: AssetDTO[];
    renderAssetIds: string[];
    profileId: string;
    lookupKey: string;
    aiIds: string[];
    productTouched: boolean;
  }
  const drafts = useRef<{ manual: ModeDraft | null; existingId: string }>({ manual: null, existingId: '' });

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
      renderAssetIds,
      profileId,
      lookupKey: lastLookupKey.current,
      aiIds: [...aiAssetIds.current],
      productTouched: productTouched.current,
    };
  }

  /** Remembers Write manually before switching to Use existing. */
  function stashDraft() {
    if (brandMode === 'manual') drafts.current.manual = snapshotDraft();
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
    setRenderAssetIds(draft.renderAssetIds);
    setProfileId(draft.profileId);
    lastLookupKey.current = draft.lookupKey;
    aiAssetIds.current = new Set(draft.aiIds);
    productTouched.current = draft.productTouched;
  }

  function chooseManual() {
    if (brandMode === 'manual') return;
    stashDraft();
    setBrandMode('manual');
    setOverwrite(false);
    setStatusKind('');
    const draft = drafts.current.manual;
    if (draft) {
      restoreDraft(draft);
      setStatus('Your brand profile is back as you left it.');
      return;
    }
    setStatus('Enter the brand name, then Fill with AI — or upload files yourself. Save the profile to reuse it.');
    setProfileId('__new__');
    setAssets([]);
    setRenderAssetIds([]);
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
      setStatus('No saved profiles yet. Write one manually first.');
      setStatusKind('err');
      return;
    }
    if (brandMode === 'existing') return;
    stashDraft();
    setBrandMode('existing');
    setOverwrite(false);
    setStatus('');
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
    setRenderAssetIds(defaultRenderIds(next.assets));
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
    // Do not clear assets here. Clearing queued a draft with an empty file list that deleted
    // the new logos from the DB before Save profile could attach them.
    // Cancel any draft already scheduled so it cannot race the new files.
    onDraft(null);

    const res = await fetch('/api/brand-guidelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandName: name,
        website: website.trim(),
        // Leave files unassigned; linking to the project here raced with draft sync and deleted them.
        projectId: undefined,
        profileId: undefined,
      }),
    });
    const parsed = await readJson(res);
    if (ticket !== lookupAbort.current) return;
    if (!parsed.ok) {
      setLookingUp(false);
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
    const found = Array.isArray(data.assets) ? data.assets.filter((item) => item && typeof item.id === 'string') : [];
    // Replace the previous company's files only after the new ones arrived.
    const nextAssets = found;
    aiAssetIds.current = new Set(found.map((item) => item.id));

    const counts = data.counts ?? {};
    const bits: string[] = [];
    if (counts.logos) bits.push(`${counts.logos} logo${counts.logos === 1 ? '' : 's'}`);
    if (counts.fonts) bits.push(`${counts.fonts} font file${counts.fonts === 1 ? '' : 's'}`);
    if (counts.refs) bits.push(`${counts.refs} creative${counts.refs === 1 ? '' : 's'}`);
    if (counts.guidelines) bits.push(`${counts.guidelines} brand kit doc${counts.guidelines === 1 ? '' : 's'}`);
    const fontNote = typeof data.headlineFont === 'string' && data.headlineFont.trim() !== '' ? ` Headline font: ${data.headlineFont.trim()}.` : '';
    const summary = typeof data.summary === 'string' && data.summary.trim() !== '' ? ` ${data.summary.trim()}` : '';
    const filled = bits.length ? ` Pulled ${bits.join(', ')} from the brand site — everything stays editable.` : ' No logo, fonts or creatives were reachable online — upload them below if you have them.';

    const nextWebsite = typeof data.website === 'string' && data.website.trim() !== '' ? data.website.trim() : website;
    const nextProfileName = profileName.trim() || nextBrand.trim();

    // Save while drafts are paused (lookingUp), then show the new files — stay on Write manually.
    const saved = await persistProfile({
      name: nextProfileName,
      brandName: nextBrand,
      product: nextProduct,
      c1: nextC1,
      c2: nextC2,
      c3: nextC3,
      assetIds: nextAssets.map((item) => item.id),
      overwrite: true,
      stayOnManual: true,
    });
    if (ticket !== lookupAbort.current) {
      // A newer Fill with AI owns lookingUp; do not clear it.
      return;
    }
    setBrandName(nextBrand);
    setProduct(nextProduct);
    setWebsite(nextWebsite);
    setProfileName(nextProfileName);
    setC1(nextC1);
    setC2(nextC2);
    setC3(nextC3);
    setAssets(saved ? saved.assets : nextAssets);
    setRenderAssetIds(defaultRenderIds(saved ? saved.assets : nextAssets));
    setLookingUp(false);
    if (saved) {
      setStatus(`Filled with AI and saved as "${saved.name}".${filled}${fontNote}${summary}`);
      setStatusKind('ok');
      return;
    }
    setStatus(`Brand filled with AI.${filled}${fontNote}${summary}`);
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
    if (added.length) {
      setAssets((current) => {
        const next = [...current, ...added];
        setRenderAssetIds((picked) => {
          const merged = [...picked];
          for (const item of added) {
            if (item.kind === 'guidelines') continue;
            if (merged.includes(item.id)) continue;
            if (item.kind === 'logos' && merged.some((id) => next.some((a) => a.id === id && a.kind === 'logos'))) continue;
            if (item.kind === 'refs' && merged.filter((id) => next.some((a) => a.id === id && a.kind === 'refs')).length >= 3) continue;
            merged.push(item.id);
          }
          return merged;
        });
        return next;
      });
    }
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
    setRenderAssetIds((current) => current.filter((item) => item !== id));
  }

  function toggleRenderAsset(file: AssetDTO) {
    setRenderAssetIds((current) => {
      const on = current.includes(file.id);
      if (file.kind === 'logos') {
        // Only one logo on the final ad.
        const withoutLogos = current.filter((id) => !assets.some((item) => item.id === id && item.kind === 'logos'));
        return on ? withoutLogos : [...withoutLogos, file.id];
      }
      if (file.kind === 'refs') {
        if (on) return current.filter((id) => id !== file.id);
        const refIds = current.filter((id) => assets.some((item) => item.id === id && item.kind === 'refs'));
        if (refIds.length >= 3) return [...current.filter((id) => !refIds.includes(id) || id === refIds[0] || id === refIds[1]), file.id];
        return [...current, file.id];
      }
      if (on) return current.filter((id) => id !== file.id);
      return [...current, file.id];
    });
  }

  function draftPayload(): BriefPayload {
    // Exact keep set for this brand so the server can drop leftover files from a previous company.
    return payload(assets.map((item) => item.id));
  }

  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    // While Fill with AI is running, skip drafts so we never save an empty or half-replaced file list.
    if (lookingUp) return;
    onDraftRef.current(draftPayload());
    // draftPayload reads the fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, sceneNote, goal, brandName, product, profileId, c1, c2, c3, assets, renderAssetIds, lookingUp]);

  function payload(ids: string[]): BriefPayload {
    const attachedProfile =
      brandMode === 'existing'
        ? linked
        : profileId !== '' && profileId !== '__new__'
          ? profiles.find((item) => item.id === profileId) ?? null
          : null;
    return {
      description: description.trim(),
      sceneNote: sceneNote.trim(),
      goal,
      brandName: brandName.trim(),
      product: product.trim(),
      guidelineUrl: '',
      profileId: attachedProfile?.id ?? null,
      c1,
      c2,
      c3,
      assetIds: ids,
      renderAssetIds: renderAssetIds.filter((id) => ids.includes(id) || assets.some((item) => item.id === id)),
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
    stayOnManual?: boolean;
  }): Promise<ProfileDTO | null> {
    if (input.name === '') {
      setStatus('Enter a name for the profile.');
      setStatusKind('err');
      return null;
    }
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, stayOnManual: undefined, guidelineUrl: '' }),
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
    if (!input.stayOnManual) setBrandMode('existing');
    setProfileId(saved.id);
    setAssets(saved.assets);
    aiAssetIds.current = new Set(saved.assets.map((item) => item.id));
    setOverwrite(false);
    return saved;
  }

  async function saveProfile() {
    const saved = await persistProfile({
      name: profileName.trim() || brandName.trim(),
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
      setBrandMode('manual');
      setProfileId('__new__');
      setAssets([]);
      setRenderAssetIds([]);
    } else {
      applyProfile(rest[0].id);
    }
    setStatus(`Deleted "${selected.name}".`);
    setStatusKind('ok');
  }

  const brandFields = (
            <div className="brand-panel">
              <label>Brand profile</label>
              <p className="hint">Write manually, Fill with AI, or use a saved profile.</p>
              <div className="chips brand-mode-chips" role="group" aria-label="Brand profile choice">
                <button type="button" className={`chip${brandMode === 'manual' ? ' on' : ''}`} onClick={chooseManual}>
                  Write manually
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
              </div>
              {profiles.length === 0 && (
                <p className="hint">No saved profiles yet — write one or Fill with AI.</p>
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
                <div className="footer" style={{ marginTop: 8 }}>
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isNew) {
                        e.preventDefault();
                        if (brandName.trim().length >= 2 && !lookingUp && !uploading) void fillBrandWithAi(true);
                      }
                    }}
                    placeholder="e.g. Gentle Dental"
                    disabled={lookingUp}
                  />
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
                    disabled={lookingUp}
                  />
                </div>
              </div>

              {isNew && (
                <div className="brand-fill-row">
                  <button
                    type="button"
                    className="btn sm"
                    disabled={lookingUp || uploading || brandName.trim().length < 2}
                    onClick={() => void fillBrandWithAi(true)}
                  >
                    {lookingUp ? 'Filling…' : 'Fill with AI'}
                  </button>
                </div>
              )}

              <div className="row">
                <div>
                  <label htmlFor="website">Brand website (optional)</label>
                  <input
                    id="website"
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="e.g. https://gentledental.com"
                    disabled={lookingUp}
                  />
                </div>
                <div>
                  <label htmlFor="profileName">{isNew ? 'Profile name (optional)' : 'Profile name'}</label>
                  <input
                    id="profileName"
                    type="text"
                    value={isNew ? profileName : (selected?.name ?? '')}
                    onChange={(e) => {
                      if (!isNew) return;
                      setProfileName(e.target.value);
                      setOverwrite(false);
                    }}
                    placeholder={brandName.trim() || 'e.g. Gentle Dental – Q3'}
                    disabled={!isNew || lookingUp}
                    readOnly={!isNew}
                  />
                </div>
              </div>
              {lookingUp && (
                <p className="status-line">Finding the brand site and pulling assets…</p>
              )}

              {isNew && (
                <div className="footer brand-save-row">
                  <button type="button" className="btn sm" onClick={() => void saveProfile()}>
                    {overwrite ? 'Overwrite' : 'Save profile'}
                  </button>
                </div>
              )}

              {status && <p className={`status-line ${statusKind}`}>{status}</p>}
            </div>
  );

  const assetFields = (
            <div className="brand-assets-scroll">
            <h4>Brand assets &amp; colors</h4>
            <p className="hint">Guidelines, logos, fonts, reference creatives, and hex colors.</p>
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
                    {(grouped[field.key] ?? []).map((file) => {
                      const split = splitVariant(file.name);
                      const onAd = renderAssetIds.includes(file.id);
                      const pickable = field.key === 'logos' || field.key === 'fonts' || field.key === 'refs';
                      return (
                        <li key={file.id}>
                          <AssetThumb file={file} dark={split.variant === 'Reverse (white)'} />
                          {split.variant && <span className={`variant v-${split.variant.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{split.variant}</span>}
                          <span className="nm">{split.name}</span>
                          {pickable && (
                            <label className={`use-on-ad${onAd ? ' on' : ''}`} title="Use this file on the final ad">
                              <input type="checkbox" checked={onAd} onChange={() => toggleRenderAsset(file)} />
                              On ad
                            </label>
                          )}
                          <span className="sz">{fmtSize(file.size)}</span>
                          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => void removeAsset(file.id)}>
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <div className="asset-card">
                <h4>Brand colors</h4>
                <p className="hint">Primary, secondary and accent — hex</p>
                <div className="color-fields">
                  <HexColorField id="brief-c1" label="C1" value={c1} onChange={setC1} />
                  <HexColorField id="brief-c2" label="C2" value={c2} onChange={setC2} />
                  <HexColorField id="brief-c3" label="C3" value={c3} onChange={setC3} />
                </div>
              </div>
            </div>
            </div>
  );

  if (part === 'story') {
    return (
      <div className="wide-single">
        <div className="card">
          <h3>Tell us about the ad</h3>
          <p className="sub">Describe it, set the goal, then choose where it runs.</p>
          <label htmlFor="desc">Describe the ad you want</label>
          <textarea
            id="desc"
            className="short"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Two founders in a glass office reviewing a sales dashboard. Clean daylight, no clutter."
          />
          <p className="hint">Describe the picture — colors and scene the image should follow.</p>
          <label htmlFor="goal">What should this ad achieve?</label>
          <select id="goal" value={goal} onChange={(e) => setGoal(e.target.value)}>
            {GOALS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          {children}
          {error && <div className="err" role="alert">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="wide-single">
      <div className="card">
        <h3>Brand profile</h3>
        <p className="sub">Profile, then assets and colors. Scroll the assets if the list is long.</p>
        {brandFields}
        {assetFields}
        {error && <div className="err" role="alert">{error}</div>}
        <div className="footer">
          <button type="button" className="btn ghost" onClick={onBack} disabled={saving || uploading || lookingUp}>
            Back
          </button>
          <button
            type="button"
            className="btn platform-generate"
            disabled={saving || uploading || lookingUp}
            onClick={() => onGenerate?.()}
          >
            {saving ? 'Generating…' : 'Generate Ad'}
          </button>
        </div>
      </div>
    </div>
  );
}
