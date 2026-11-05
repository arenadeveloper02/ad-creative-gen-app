'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import AgentCrumb from '@/components/AgentCrumb';
import type { ProjectListItem } from '@/lib/types';

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Canva-like: unfinished work is Draft; ads that finished Generate are Created. */
function isCreated(item: ProjectListItem): boolean {
  return item.status !== 'draft' || Boolean(item.previewImageUrl);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export default function ProjectsHome({ projects }: { projects: ProjectListItem[] }) {
  const [items] = useState(projects);
  const [dateFilter, setDateFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'draft' | 'created'>('all');
  const [platformFilter, setPlatformFilter] = useState('');
  const [formatFilter, setFormatFilter] = useState('');
  const [resolutionFilter, setResolutionFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');

  const platforms = useMemo(() => uniqueSorted(items.map((item) => item.platform)), [items]);
  const formats = useMemo(() => uniqueSorted(items.map((item) => item.format)), [items]);
  const resolutions = useMemo(() => uniqueSorted(items.map((item) => item.imageResolution)), [items]);
  const sizes = useMemo(() => uniqueSorted(items.map((item) => item.size ?? '')), [items]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (dateFilter !== '' && dayKey(item.updatedAt) !== dateFilter) return false;
      if (stateFilter === 'draft' && isCreated(item)) return false;
      if (stateFilter === 'created' && !isCreated(item)) return false;
      if (platformFilter !== '' && item.platform !== platformFilter) return false;
      if (formatFilter !== '' && item.format !== formatFilter) return false;
      if (resolutionFilter !== '' && item.imageResolution !== resolutionFilter) return false;
      if (sizeFilter !== '' && item.size !== sizeFilter) return false;
      return true;
    });
  }, [items, dateFilter, stateFilter, platformFilter, formatFilter, resolutionFilter, sizeFilter]);

  const filtersActive =
    dateFilter !== ''
    || stateFilter !== 'all'
    || platformFilter !== ''
    || formatFilter !== ''
    || resolutionFilter !== ''
    || sizeFilter !== '';

  function clearFilters() {
    setDateFilter('');
    setStateFilter('all');
    setPlatformFilter('');
    setFormatFilter('');
    setResolutionFilter('');
    setSizeFilter('');
  }

  return (
    <>
      <AgentCrumb />
      <div className="hero">
        <div>
          <p className="eyebrow">Ad creative</p>
          <h1 className="hero-title">
            Ads that follow <span className="aurora-title-accent">your brand</span>
          </h1>
          <p className="hero-sub">Brief, platform, then a generated ad you can refine and download. Each ad stays on your Arena account.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/settings" className="btn ghost">
            Usage
          </Link>
          <Link href="/project/new" className="btn">
            Create Ad
          </Link>
        </div>
      </div>

      {items.length > 0 && (
        <div className="proj-toolbar">
          <div className="proj-filters">
            <div className="proj-filter">
              <label htmlFor="proj-state">State</label>
              <select id="proj-state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as 'all' | 'draft' | 'created')}>
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="created">Created</option>
              </select>
            </div>
            <div className="proj-filter">
              <label htmlFor="proj-platform">Platform</label>
              <select id="proj-platform" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
                <option value="">All platforms</option>
                {platforms.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="proj-filter">
              <label htmlFor="proj-format">Format</label>
              <select id="proj-format" value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}>
                <option value="">All formats</option>
                {formats.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="proj-filter">
              <label htmlFor="proj-resolution">Resolution</label>
              <select id="proj-resolution" value={resolutionFilter} onChange={(e) => setResolutionFilter(e.target.value)}>
                <option value="">All resolutions</option>
                {resolutions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="proj-filter">
              <label htmlFor="proj-size">Size</label>
              <select id="proj-size" value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)}>
                <option value="">All sizes</option>
                {sizes.map((value) => (
                  <option key={value} value={value}>{value.replace('x', ' × ')}</option>
                ))}
              </select>
            </div>
            <div className="proj-filter">
              <label htmlFor="proj-date">Date</label>
              <div className="proj-date-row">
                <input
                  id="proj-date"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  aria-label="Filter ads by date"
                />
              </div>
            </div>
          </div>
          <p className="hint proj-date-hint">
            {filtersActive
              ? `${visible.length} of ${items.length} ad${items.length === 1 ? '' : 's'}`
              : `${items.length} ad${items.length === 1 ? '' : 's'}`}
            {dateFilter !== '' ? ` · ${formatDay(`${dateFilter}T12:00:00`)}` : ''}
            {filtersActive && (
              <>
                {' · '}
                <button type="button" className="linkish" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card">
          <h3>No ads yet</h3>
          <p className="sub">Start with a product, a goal, and the brand files you want the ad to follow.</p>
          <Link href="/project/new" className="btn">
            Create Ad
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <h3>No ads match these filters</h3>
          <p className="sub">Try another platform, format, or clear the filters.</p>
          <button type="button" className="btn ghost sm" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="projgrid">
          {visible.map((item) => {
            const created = isCreated(item);
            return (
              <article key={item.id} className="card proj-card">
                <div className="proj-thumb">
                  {item.previewImageUrl ? (
                    <img src={item.previewImageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="proj-thumb-empty" aria-hidden="true">
                      <span>{created ? 'Created' : 'Draft'}</span>
                    </div>
                  )}
                  <span className={`proj-state${created ? ' created' : ' draft'}`}>
                    {created ? 'Created' : 'Draft'}
                  </span>
                </div>
                <div className="proj-card-body">
                  <p className="eyebrow">{item.platform || 'Ad'}</p>
                  <h3>{item.name}</h3>
                  <p className="hint">
                    {created
                      ? `${item.platform}${item.format ? ` · ${item.format}` : ''}${item.size ? ` · ${item.size.replace('x', '×')}` : ''}`
                      : `Draft · left on ${item.step <= 1 ? 'Brief' : item.step === 2 ? 'Platform' : 'Generate'}`}
                  </p>
                  <p className="hint proj-card-date">Updated {formatDay(item.updatedAt)}</p>
                  <div className="footer">
                    <Link href={`/project/${item.id}`} className="btn sm">
                      {created ? 'Open' : 'Continue'}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
