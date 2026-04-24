export const AUTH_COOKIE_NAME = 'secuai_auth_token';
export const DEFAULT_DASHBOARD_PATH = '/dashboard/events';

const SAFE_ORIGIN = 'https://secuai.local';

export function isSafeDashboardReturnToPath(value: string | null | undefined): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed.startsWith('//') ||
    !(
      trimmed === '/dashboard' ||
      trimmed.startsWith('/dashboard/')
    )
  ) {
    return false;
  }

  try {
    const url = new URL(trimmed, SAFE_ORIGIN);
    return (
      url.origin === SAFE_ORIGIN &&
      (
        url.pathname === '/dashboard' ||
        url.pathname.startsWith('/dashboard/')
      )
    );
  } catch {
    return false;
  }
}

export function normalizeReturnToPath(value: string | null | undefined): string {
  if (!isSafeDashboardReturnToPath(value)) {
    return DEFAULT_DASHBOARD_PATH;
  }

  const url = new URL(value.trim(), SAFE_ORIGIN);
  return `${url.pathname}${url.search}` || DEFAULT_DASHBOARD_PATH;
}
