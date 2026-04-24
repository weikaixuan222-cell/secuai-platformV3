import { ApiError, fetchApi } from '@/lib/api';
import type { LoginRequest, LoginResponse, RegisterRequest, RegisterResponse } from '@/lib/contracts';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): void {
  if (email.length < 5 || !email.includes('@')) {
    throw new ApiError('Please enter a valid email address.', 'VALIDATION_ERROR');
  }
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new ApiError('Password must be at least 8 characters.', 'VALIDATION_ERROR');
  }
}

function validateDisplayName(displayName: string): void {
  if (displayName.length < 2) {
    throw new ApiError('Display name must be at least 2 characters.', 'VALIDATION_ERROR');
  }
}

export function registerWithPassword(payload: RegisterRequest): Promise<RegisterResponse> {
  const email = normalizeEmail(payload.email);
  const password = payload.password.trim();
  const displayName = payload.displayName.trim();

  validateDisplayName(displayName);
  validateEmail(email);
  validatePassword(password);

  return fetchApi<RegisterResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      displayName
    })
  });
}

export function loginWithPassword(payload: LoginRequest): Promise<LoginResponse> {
  const email = normalizeEmail(payload.email);
  const password = payload.password.trim();

  validateEmail(email);
  validatePassword(password);

  return fetchApi<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password
    })
  });
}
