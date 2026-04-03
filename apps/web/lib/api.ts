export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  public code: string;
  public details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('secuai_token');
}

export function setAuthData(token: string, tenantId: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('secuai_token', token);
    localStorage.setItem('secuai_tenant_id', tenantId);
  }
}

export function getTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('secuai_tenant_id');
}

export function clearAuthData() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('secuai_token');
    localStorage.removeItem('secuai_tenant_id');
  }
}

export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAuthData();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  const data = await response.json();

  if (!response.ok || data.success === false) {
    const errData = data as ApiErrorResponse;
    throw new ApiError(
      errData.error?.message || '接口请求失败',
      errData.error?.code || 'UNKNOWN_ERROR',
      errData.error?.details
    );
  }

  return data.data;
}
