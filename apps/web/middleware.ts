import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
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
  matcher: ['/error-boundary-smoke']
};
