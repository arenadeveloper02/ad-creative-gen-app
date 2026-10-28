'use client';

import { useEffect, useState } from 'react';
import AgentCrumb from '@/components/AgentCrumb';
import { readJson } from '@/lib/read-response';
import type { UsageRow } from '@/lib/types';

function money(n: number): string {
  return n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

export default function SettingsClient() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/usage');
      const parsed = await readJson(res);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const data = parsed.data as { totalUsd?: number; events?: UsageRow[] };
      setTotal(typeof data.totalUsd === 'number' ? data.totalUsd : 0);
      setRows(Array.isArray(data.events) ? data.events : []);
    })();
  }, []);

  return (
    <>
      <AgentCrumb backHref="/" />
      <div className="hero">
        <div>
          <p className="eyebrow">Usage</p>
          <h1 className="hero-title">Ad generation cost</h1>
          <p className="hero-sub">Each version written for your account is logged here. These are the on-screen estimates. A finished Fal job is billed separately when Arena usage is configured.</p>
        </div>
      </div>
      {error && <div className="errbox">{error}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>{money(total)}</h3>
        <p className="sub">{rows.length} events on this account</p>
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="hint">No generations yet.</p>
        ) : (
          <ul className="filelist">
            {rows.map((row) => (
              <li key={row.id}>
                <span className="nm">{row.kind} · {row.provider}/{row.model}</span>
                <span className="sz">{money(row.estimatedUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
