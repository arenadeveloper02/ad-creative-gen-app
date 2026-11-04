'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import AgentCrumb from '@/components/AgentCrumb';
import { readJson } from '@/lib/read-response';
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

export default function ProjectsHome({ projects }: { projects: ProjectListItem[] }) {
  const [items, setItems] = useState(projects);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState('');

  const visible = useMemo(() => {
    if (dateFilter === '') return items;
    return items.filter((item) => dayKey(item.updatedAt) === dateFilter);
  }, [items, dateFilter]);

  async function remove(id: string) {
    if (!window.confirm('Delete this ad?')) return;
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    const parsed = await readJson(res);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
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
            New ad
          </Link>
        </div>
      </div>

      {items.length > 0 && (
        <div className="proj-toolbar">
          <label htmlFor="proj-date" className="proj-date-label">
            Filter by date
          </label>
          <div className="proj-date-row">
            <input
              id="proj-date"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filter ads by date"
            />
            {dateFilter !== '' && (
              <button type="button" className="btn ghost sm" onClick={() => setDateFilter('')}>
                Clear
              </button>
            )}
          </div>
          <p className="hint proj-date-hint">
            {dateFilter === ''
              ? `${items.length} ad${items.length === 1 ? '' : 's'}`
              : `${visible.length} ad${visible.length === 1 ? '' : 's'} on ${formatDay(`${dateFilter}T12:00:00`)}`}
          </p>
        </div>
      )}

      {error && <div className="errbox">{error}</div>}
      {items.length === 0 ? (
        <div className="card">
          <h3>No ads yet</h3>
          <p className="sub">Start with a product, a goal, and the brand files you want the ad to follow.</p>
          <Link href="/project/new" className="btn">
            Create an ad
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <h3>No ads on this date</h3>
          <p className="sub">Pick another day, or clear the filter to see every ad.</p>
          <button type="button" className="btn ghost sm" onClick={() => setDateFilter('')}>
            Clear date filter
          </button>
        </div>
      ) : (
        <div className="projgrid">
          {visible.map((item) => (
            <article key={item.id} className="card proj-card">
              <div className="proj-thumb">
                {item.previewImageUrl ? (
                  <img src={item.previewImageUrl} alt="" loading="lazy" />
                ) : (
                  <div className="proj-thumb-empty" aria-hidden="true">
                    <span>{item.status === 'draft' ? 'Draft' : 'No image'}</span>
                  </div>
                )}
              </div>
              <div className="proj-card-body">
                <p className="eyebrow">{item.platform || 'New ad'}</p>
                <h3>{item.name}</h3>
                <p className="hint">
                  {item.status === 'draft'
                    ? `Draft · left on ${item.step <= 1 ? 'Brief' : item.step === 2 ? 'Platform' : 'Generate'}`
                    : `Ready · ${item.platform}`}
                </p>
                <p className="hint proj-card-date">Updated {formatDay(item.updatedAt)}</p>
                <div className="footer">
                  <Link href={`/project/${item.id}`} className="btn sm">
                    {item.status === 'draft' ? 'Continue' : 'Open'}
                  </Link>
                  <button type="button" className="btn ghost sm" onClick={() => void remove(item.id)}>
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
