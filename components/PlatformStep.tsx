'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_IMAGE_RESOLUTION,
  IMAGE_MODELS,
  IMAGE_RESOLUTIONS,
  canonicalImageModel,
  canonicalImageResolution,
  resolutionsForModel,
  type ImageModel,
  type ImageResolution,
} from '@/lib/fal-models';
import { PLATFORMS, TONES, VISUAL_STYLES } from '@/lib/platforms';
import type { ProjectDTO } from '@/lib/types';

export interface PlatformPayload {
  platform: string;
  format: string;
  audience: string;
  tone: string;
  visualStyle: string;
  cta: string;
  copySource: 'ai' | 'manual';
  headline: string;
  subline: string;
  avoid: string;
  copyPrompt: string;
  imageModel: ImageModel;
  imageResolution: ImageResolution;
  approvedCopy?: { headline: string; sub: string; primary: string }[];
}

interface PlatformStepProps {
  project: ProjectDTO;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onGenerate: (data: PlatformPayload) => void;
  onDraft: (data: PlatformPayload) => void;
  onPreview: (data: PlatformPayload) => Promise<{ ok: true; versions: { headline: string; sub: string; primary: string }[] } | { ok: false; error: string }>;
}

export default function PlatformStep({ project, saving, error, onBack, onGenerate, onDraft, onPreview }: PlatformStepProps) {
  const [platform, setPlatform] = useState(project.platform);
  const formats = PLATFORMS[platform] ?? PLATFORMS['Meta (Facebook/Instagram)'];
  const [format, setFormat] = useState(formats.includes(project.format) ? project.format : formats[0]);
  const [audience, setAudience] = useState(project.audience);
  const [tone, setTone] = useState(project.tone);
  const [visualStyle, setVisualStyle] = useState(project.visualStyle);
  const [cta, setCta] = useState(project.cta || 'Get started');
  const [copySource, setCopySource] = useState<'ai' | 'manual'>(project.copySource);
  const [headline, setHeadline] = useState(project.headline);
  const [subline, setSubline] = useState(project.subline);
  const [avoid, setAvoid] = useState(project.avoid);
  const [copyPrompt, setCopyPrompt] = useState(project.copyPrompt);
  const [imageModel, setImageModel] = useState<ImageModel>(canonicalImageModel(project.imageModel || DEFAULT_IMAGE_MODEL));
  const [imageResolution, setImageResolution] = useState<ImageResolution>(
    canonicalImageResolution(project.imageResolution || DEFAULT_IMAGE_RESOLUTION),
  );
  const resolutionChoices = resolutionsForModel(imageModel);
  const [preview, setPreview] = useState<{ headline: string; sub: string; primary: string }[] | null>(null);
  const [approved, setApproved] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const skipClear = useRef(true);

  function currentPayload(): PlatformPayload {
    const resolution = resolutionChoices.includes(imageResolution) ? imageResolution : (resolutionChoices[resolutionChoices.length - 1] ?? DEFAULT_IMAGE_RESOLUTION);
    return { platform, format, audience, tone, visualStyle, cta, copySource, headline, subline, avoid, copyPrompt, imageModel, imageResolution: resolution };
  }

  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => {
    onDraftRef.current(currentPayload());
    // currentPayload reads the fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, format, audience, tone, visualStyle, cta, copySource, headline, subline, avoid, copyPrompt, imageModel, imageResolution]);

  useEffect(() => {
    if (!resolutionChoices.includes(imageResolution)) {
      setImageResolution(resolutionChoices[resolutionChoices.length - 1] ?? DEFAULT_IMAGE_RESOLUTION);
    }
  }, [imageModel, imageResolution, resolutionChoices]);

  useEffect(() => {
    if (skipClear.current) {
      skipClear.current = false;
      return;
    }
    setPreview(null);
    setApproved(false);
  }, [copyPrompt, avoid, audience, tone, cta, platform, format, copySource]);

  async function writeCopy() {
    setWriting(true);
    setWriteError(null);
    setApproved(false);
    const result = await onPreview(currentPayload());
    setWriting(false);
    if (!result.ok) {
      setWriteError(result.error);
      return;
    }
    setPreview(result.versions);
  }

  function pickPlatform(next: string) {
    setPlatform(next);
    const nextFormats = PLATFORMS[next] ?? [];
    setFormat(nextFormats[0] ?? 'Feed 1:1');
  }

  return (
    <div className="wide-single">
      <div className="card">
        <h3>Where will this ad run?</h3>
        <p className="sub">Platform drives size, text limits, and visual style.</p>

        <label>Platform</label>
        <div className="chips">
          {Object.keys(PLATFORMS).map((item) => (
            <button key={item} type="button" className={`chip${platform === item ? ' on' : ''}`} onClick={() => pickPlatform(item)}>
              {item}
            </button>
          ))}
        </div>

        <label>Format / placement</label>
        <div className="chips">
          {formats.map((item) => (
            <button key={item} type="button" className={`chip${format === item ? ' on' : ''}`} onClick={() => setFormat(item)}>
              {item}
            </button>
          ))}
        </div>

        <div className="row">
          <div>
            <label htmlFor="imageModel">Image model</label>
            <select id="imageModel" value={imageModel} onChange={(e) => setImageModel(canonicalImageModel(e.target.value))}>
              {IMAGE_MODELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="hint">{IMAGE_MODELS.find((item) => item.value === imageModel)?.hint}</p>
          </div>
          <div>
            <label htmlFor="imageResolution">Resolution</label>
            <select
              id="imageResolution"
              value={resolutionChoices.includes(imageResolution) ? imageResolution : (resolutionChoices[resolutionChoices.length - 1] ?? DEFAULT_IMAGE_RESOLUTION)}
              onChange={(e) => setImageResolution(canonicalImageResolution(e.target.value))}
              disabled={resolutionChoices.length <= 1}
            >
              {(resolutionChoices.length > 1 ? IMAGE_RESOLUTIONS.filter((item) => resolutionChoices.includes(item.value)) : [{ value: '1K' as const, label: 'Fixed by model' }]).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="hint">Default is Nano Banana Pro at 4K. Change either only when you need to.</p>
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="audience">Target audience</label>
            <input id="audience" type="text" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. B2B marketing leaders, US, 30-50" />
          </div>
          <div>
            <label htmlFor="tone">Tone</label>
            <select id="tone" value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div>
            <label htmlFor="style">Visual style</label>
            <select id="style" value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)}>
              {VISUAL_STYLES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cta">Call to action</label>
            <input id="cta" type="text" value={cta} onChange={(e) => setCta(e.target.value)} />
          </div>
        </div>

        <label>Ad copy source</label>
        <div className="chips">
          <button type="button" className={`chip${copySource === 'ai' ? ' on' : ''}`} onClick={() => setCopySource('ai')}>
            Let AI write the copy
          </button>
          <button type="button" className={`chip${copySource === 'manual' ? ' on' : ''}`} onClick={() => setCopySource('manual')}>
            I&apos;ll write it myself
          </button>
        </div>
        <p className="hint">
          {copySource === 'ai'
            ? 'Type what the ad should say, then write a preview. Generate ad stays off until you approve that copy.'
            : 'Write your own headline and supporting line. A blank field is filled on the server.'}
        </p>
        {copySource === 'ai' && (
          <>
            <label htmlFor="copyPrompt">What should the copy say?</label>
            <textarea
              id="copyPrompt"
              value={copyPrompt}
              onChange={(e) => setCopyPrompt(e.target.value)}
              placeholder="e.g. Get marketing leaders to book a 15-minute demo this week. Sound professional. Do not name competitors."
            />
            <div className="footer" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="btn ghost sm" disabled={writing || saving} onClick={() => void writeCopy()}>
                {writing ? 'Writing…' : preview ? 'Write again' : 'Write the copy'}
              </button>
              <button type="button" className="btn sm" disabled={!preview || writing || approved} onClick={() => setApproved(true)}>
                {approved ? 'Copy approved' : 'Use this copy'}
              </button>
            </div>
            {writeError && <div className="err" role="alert">{writeError}</div>}
            {preview && (
              <div className="copy-preview">
                {preview.map((line, index) => (
                  <article key={`${line.headline}-${index}`} className={approved ? 'on' : ''}>
                    <strong>Version {String.fromCharCode(65 + index)}</strong>
                    <p>{line.headline}</p>
                    <p className="hint">{line.sub}</p>
                    <p>{line.primary}</p>
                  </article>
                ))}
              </div>
            )}
            {approved && <p className="hint">This copy is approved. Generate ad will use these lines and will not write new ones.</p>}
          </>
        )}
        {copySource === 'manual' && (
          <>
            <label htmlFor="headline">Headline</label>
            <input id="headline" type="text" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Ship AI workflows in days" />
            <label htmlFor="sub">Supporting line</label>
            <input id="sub" type="text" value={subline} onChange={(e) => setSubline(e.target.value)} placeholder="e.g. No code. No bottlenecks." />
          </>
        )}

        <label htmlFor="avoid">Anything to avoid</label>
        <textarea id="avoid" className="short" value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="e.g. no competitor names, no medical claims" />

        {error && <div className="err" role="alert">{error}</div>}
        <div className="footer">
          <button type="button" className="btn ghost" onClick={onBack}>
            Back
          </button>
          <button
            type="button"
            className="btn"
            disabled={saving || writing || (copySource === 'ai' && !approved)}
            onClick={() => onGenerate({ ...currentPayload(), approvedCopy: copySource === 'ai' && preview ? preview : undefined })}
          >
            {saving ? 'Generating…' : 'Generate ad'}
          </button>
        </div>
      </div>
    </div>
  );
}
