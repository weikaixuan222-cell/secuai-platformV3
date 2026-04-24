import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/authPaths';

export async function POST() {
  const response = NextResponse.json({
    success: true,
    data: {
      ok: true
    }
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(0)
  });

  return response;
}
