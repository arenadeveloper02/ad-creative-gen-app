'use client';

import { useState } from 'react';
import { canonicalImageModel, IMAGE_MODELS, type ImageModel } from '@/lib/fal-models';
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
}

interface PlatformStepProps {
  project: ProjectDTO;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onGenerate: (data: PlatformPayload) => void;
}

export default function PlatformStep({ project, saving, error, onBack, onGenerate }: PlatformStepProps) {
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
  const [imageModel, setImageModel] = useState<ImageModel>(canonicalImageModel(project.imageModel));
  const modelHint = IMAGE_MODELS.find((m) => m.value === imageModel)?.hint ?? '';

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

        <label>Image model (fal.ai)</label>
        <div className="chips">
          {IMAGE_MODELS.map((item) => (
            <button key={item.value} type="button" className={`chip${imageModel === item.value ? ' on' : ''}`} onClick={() => setImageModel(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="hint">{modelHint}. Each version renders one image from your brief, brand colours, logo and reference creatives.</p>

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
            ? 'Type what the ad should say. Gemini writes a headline, supporting line, and primary text for each version.'
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
            disabled={saving}
            onClick={() => onGenerate({ platform, format, audience, tone, visualStyle, cta, copySource, headline, subline, avoid, copyPrompt, imageModel })}
          >
            {saving ? 'Generating…' : 'Generate ad'}
          </button>
        </div>
      </div>
    </div>
  );
}
