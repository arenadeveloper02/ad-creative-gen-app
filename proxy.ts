import { type NextRequest, NextResponse } from 'next/server';
import { ARENA_EMAIL_COOKIE_NAME } from '@/lib/arena-email-constants';
import { parseEmail } from '@/lib/guard';

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const frameHeaders = { 'Content-Security-Policy': "frame-ancestors *" } as const;

  if (pathname === '/access-denied' || pathname.startsWith('/access-denied/')) {
    const response = NextResponse.next();
    response.headers.set('Content-Security-Policy', frameHeaders['Content-Security-Policy']);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  }

  const fromQuery = parseEmail(request.nextUrl.searchParams.get('emailId'));

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', frameHeaders['Content-Security-Policy']);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (fromQuery) {
    const https = request.nextUrl.protocol === 'https:';
    response.cookies.set(ARENA_EMAIL_COOKIE_NAME, fromQuery, {
      path: '/',
      httpOnly: true,
      secure: https,
      sameSite: https ? 'none' : 'lax',
    });
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
