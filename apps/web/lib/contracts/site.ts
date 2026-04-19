export type SiteStatus = 'active' | 'inactive';

export interface SiteItem {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  status: SiteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSiteInput {
  tenantId?: string;
  name: string;
  domain: string;
}

export interface UpdateSiteInput {
  name: string;
  domain: string;
  status: SiteStatus;
}

export interface SiteResponse {
  site: SiteItem;
}

export interface CreateSiteResponse extends SiteResponse {
  ingestionKey: string;
}

export interface DeleteSiteResponse extends SiteResponse {
  deleted: boolean;
}
