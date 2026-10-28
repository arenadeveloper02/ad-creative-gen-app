'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { ARENA_ACCESS_DENIED_MESSAGE } from '@/lib/arena-email-constants';

const ArenaEmailContext = createContext<string | null>(null);

export function ArenaEmailProvider({ emailId, children }: { emailId: string | null; children: ReactNode }) {
  return <ArenaEmailContext.Provider value={emailId}>{children}</ArenaEmailContext.Provider>;
}

export function useOptionalArenaEmailId(): string | null {
  return useContext(ArenaEmailContext);
}

export function useArenaEmailId(): string {
  const emailId = useContext(ArenaEmailContext);
  if (!emailId) throw new Error(ARENA_ACCESS_DENIED_MESSAGE);
  return emailId;
}
