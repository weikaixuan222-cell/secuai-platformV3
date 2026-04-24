import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/authPaths';

function buildLoginRedirect(request: NextRequest): NextResponse {
  const loginUrl = new URL('/login', request.url);
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  loginUrl.searchParams.set('returnTo', returnTo);

  return NextResponse.redirect(loginUrl);
}

export function middleware(request: NextRequest) {
  if (
    (
      request.nextUrl.pathname === '/dashboard' ||
      request.nextUrl.pathname.startsWith('/dashboard/')
    ) &&
    !request.cookies.get(AUTH_COOKIE_NAME)?.value
  ) {
    return buildLoginRedirect(request);
  }

  if (
    request.nextUrl.pathname === '/error-boundary-smoke' &&
    process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE !== '1'
  ) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8'
      }
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/error-boundary-smoke']
};
