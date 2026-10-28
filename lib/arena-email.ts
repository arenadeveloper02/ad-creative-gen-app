import { cookies } from 'next/headers';
import { ARENA_ACCESS_DENIED_MESSAGE, ARENA_EMAIL_COOKIE_NAME } from '@/lib/arena-email-constants';
import { parseEmail } from '@/lib/guard';

export { ARENA_ACCESS_DENIED_MESSAGE, ARENA_EMAIL_COOKIE_NAME } from '@/lib/arena-email-constants';

/** Used when the app is opened directly, with no Arena email on the link. */
export const OPEN_OWNER_EMAIL = 'open@local';

/** Arena email from the httpOnly cookie set by proxy.ts. Invalid values are ignored. */
export async function getArenaEmailId(): Promise<string | null> {
  const jar = await cookies();
  return parseEmail(jar.get(ARENA_EMAIL_COOKIE_NAME)?.value);
}

/** Arena email when the link has one, otherwise the open owner so the app still runs. */
export async function currentOwnerEmail(): Promise<string> {
  return (await getArenaEmailId()) ?? OPEN_OWNER_EMAIL;
}

export async function requireArenaEmailId(): Promise<string> {
  const emailId = await getArenaEmailId();
  if (!emailId) throw new Error(ARENA_ACCESS_DENIED_MESSAGE);
  return emailId;
}
