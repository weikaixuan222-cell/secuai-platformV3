export type AuthUserStatus = 'active' | 'disabled';
export type TenantRecordStatus = 'active' | 'inactive';
export type TenantRole = 'owner' | 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  status: AuthUserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantRecordStatus;
}

export interface AuthTenantMembership {
  tenantId: string;
  role: TenantRole;
  tenant: AuthTenant;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface RegisterResponse {
  user: AuthUser;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
  memberships: AuthTenantMembership[];
}
