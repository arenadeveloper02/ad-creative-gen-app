'use client';

import Link from 'next/link';
import { useState } from 'react';
import AgentCrumb from '@/components/AgentCrumb';
import { readJson } from '@/lib/read-response';
import type { ProjectListItem } from '@/lib/types';

export default function ProjectsHome({ projects }: { projects: ProjectListItem[] }) {
  const [items, setItems] = useState(projects);
  const [error, setError] = useState<string | null>(null);

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
      {error && <div className="errbox">{error}</div>}
      {items.length === 0 ? (
        <div className="card">
          <h3>No ads yet</h3>
          <p className="sub">Start with a product, a goal, and the brand files you want the ad to follow.</p>
          <Link href="/project/new" className="btn">
            Create an ad
          </Link>
        </div>
      ) : (
        <div className="projgrid">
          {items.map((item) => (
            <article key={item.id} className="card">
              <p className="eyebrow">{item.platform}</p>
              <h3>{item.name}</h3>
              <p className="hint">Step {item.step} · {item.status}</p>
              <div className="footer">
                <Link href={`/project/${item.id}`} className="btn sm">
                  Open
                </Link>
                <button type="button" className="btn ghost sm" onClick={() => void remove(item.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
