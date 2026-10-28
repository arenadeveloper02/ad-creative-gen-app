'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface AgentCrumbProps {
  backHref?: string;
}

/** Same breadcrumb line as the video agent, named for this ad agent. */
export default function AgentCrumb({ backHref }: AgentCrumbProps) {
  const router = useRouter();
  const arrow = (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
  return (
    <nav className="agent-crumb" aria-label="Breadcrumb">
      {backHref ? (
        <Link href={backHref} className="agent-back" aria-label="Back">
          {arrow}
        </Link>
      ) : (
        <button type="button" className="agent-back" aria-label="Back" onClick={() => router.back()}>
          {arrow}
        </button>
      )}
      <span>
        Agents <span aria-hidden="true">/</span> Ads <span aria-hidden="true">/</span> <strong>Ad Creative Generator</strong>
      </span>
    </nav>
  );
}
