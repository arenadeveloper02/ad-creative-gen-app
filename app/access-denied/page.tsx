import { ARENA_ACCESS_DENIED_MESSAGE } from '@/lib/arena-email-constants';

export default function AccessDeniedPage() {
  return (
    <main className="wrap wrap-fill">
      <section className="card" style={{ maxWidth: 440, margin: '12vh auto' }}>
        <p className="eyebrow">Arena</p>
        <h3>{ARENA_ACCESS_DENIED_MESSAGE}</h3>
        <p className="sub">This agent opens from an Arena link that includes your email. Ask for a new link if this page is all you see.</p>
      </section>
    </main>
  );
}
