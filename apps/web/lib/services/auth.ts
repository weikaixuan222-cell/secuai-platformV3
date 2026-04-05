import { ApiError, fetchApi } from '@/lib/api';
import type { LoginRequest, LoginResponse } from '@/lib/contracts';

export function loginWithPassword(payload: LoginRequest): Promise<LoginResponse> {
  const email = payload.email.trim();
  const password = payload.password.trim();

  if (email.length < 5 || !email.includes('@')) {
    throw new ApiError('Please enter a valid email address.', 'VALIDATION_ERROR');
  }

  if (password.length < 8) {
    throw new ApiError('Password must be at least 8 characters.', 'VALIDATION_ERROR');
  }

  return fetchApi<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password
    })
  });
}
