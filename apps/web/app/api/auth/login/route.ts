import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/authPaths';

type ApiLoginPayload = {
  success?: boolean;
  data?: {
    token?: string;
    expiresAt?: string;
  };
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

function getBackendLoginUrl(): string {
  const backendUrl = process.env.API_URL || 'http://127.0.0.1:3201';
  return new URL('/api/v1/auth/login', backendUrl).toString();
}

function parseCookieExpires(expiresAt: string | undefined): Date | undefined {
  if (!expiresAt) {
    return undefined;
  }

  const expires = new Date(expiresAt);
  return Number.isNaN(expires.getTime()) ? undefined : expires;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: '登录请求格式无效。'
        }
      },
      { status: 400 }
    );
  }

  let backendResponse: Response;

  try {
    backendResponse = await fetch(getBackendLoginUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'AUTH_BACKEND_UNAVAILABLE',
          message: '登录服务暂时不可用，请稍后重试。'
        }
      },
      { status: 502 }
    );
  }

  let payload: ApiLoginPayload;

  try {
    payload = await backendResponse.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'AUTH_BACKEND_INVALID_RESPONSE',
          message: '登录服务返回格式无效。'
        }
      },
      { status: 502 }
    );
  }

  const response = NextResponse.json(payload, {
    status: backendResponse.status
  });
  const token = payload.success !== false ? payload.data?.token : undefined;

  if (backendResponse.ok && token) {
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      expires: parseCookieExpires(payload.data?.expiresAt)
    });
  }

  return response;
}
