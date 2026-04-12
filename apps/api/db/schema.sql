CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenants_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(24) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT tenant_users_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  ingestion_key_hash TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sites_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT sites_domain_unique_per_tenant UNIQUE (tenant_id, domain)
);

CREATE TABLE IF NOT EXISTS security_policies (
  site_id UUID PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  mode VARCHAR(16) NOT NULL DEFAULT 'monitor',
  block_sql_injection BOOLEAN NOT NULL DEFAULT TRUE,
  block_xss BOOLEAN NOT NULL DEFAULT TRUE,
  block_suspicious_user_agent BOOLEAN NOT NULL DEFAULT TRUE,
  enable_rate_limit BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_threshold INTEGER NOT NULL DEFAULT 120,
  auto_block_high_risk BOOLEAN NOT NULL DEFAULT FALSE,
  high_risk_score_threshold NUMERIC(5,2) NOT NULL DEFAULT 90,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT security_policies_mode_check CHECK (mode IN ('monitor', 'protect')),
  CONSTRAINT security_policies_rate_limit_threshold_check CHECK (rate_limit_threshold >= 1),
  CONSTRAINT security_policies_high_risk_score_threshold_check CHECK (
    high_risk_score_threshold >= 0 AND high_risk_score_threshold <= 100
  )
);

CREATE TABLE IF NOT EXISTS blocked_entities (
  id BIGSERIAL PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  entity_type VARCHAR(16) NOT NULL,
  entity_value VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blocked_entities_entity_type_check CHECK (entity_type IN ('ip')),
  CONSTRAINT blocked_entities_source_check CHECK (source IN ('manual', 'automatic')),
  CONSTRAINT blocked_entities_expires_at_check CHECK (
    expires_at IS NULL OR expires_at > created_at
  )
);

CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  external_request_id VARCHAR(128),
  occurred_at TIMESTAMPTZ NOT NULL,
  method VARCHAR(16) NOT NULL,
  scheme VARCHAR(16) NOT NULL DEFAULT 'https',
  host VARCHAR(255) NOT NULL,
  path VARCHAR(2048) NOT NULL,
  query_string TEXT,
  status_code SMALLINT,
  client_ip INET,
  country_code VARCHAR(2),
  user_agent TEXT,
  referer TEXT,
  request_size_bytes INTEGER,
  response_size_bytes INTEGER,
  latency_ms INTEGER,
  headers JSONB,
  metadata JSONB,
  ingest_source VARCHAR(32) NOT NULL DEFAULT 'site_agent',
  processed_for_detection BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_logs_method_check CHECK (char_length(method) >= 3),
  CONSTRAINT request_logs_status_code_check CHECK (
    status_code IS NULL OR (status_code >= 100 AND status_code <= 599)
  ),
  CONSTRAINT request_logs_size_check CHECK (
    request_size_bytes IS NULL OR request_size_bytes >= 0
  ),
  CONSTRAINT request_logs_response_size_check CHECK (
    response_size_bytes IS NULL OR response_size_bytes >= 0
  ),
  CONSTRAINT request_logs_latency_check CHECK (
    latency_ms IS NULL OR latency_ms >= 0
  )
);

CREATE TABLE IF NOT EXISTS attack_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  request_log_id BIGINT NOT NULL REFERENCES request_logs(id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  rule_code VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attack_events_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT attack_events_status_check CHECK (status IN ('open', 'reviewed', 'resolved'))
);

CREATE TABLE IF NOT EXISTS ai_risk_results (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  request_log_id BIGINT REFERENCES request_logs(id) ON DELETE CASCADE,
  attack_event_id BIGINT REFERENCES attack_events(id) ON DELETE CASCADE,
  model_name VARCHAR(80) NOT NULL,
  model_version VARCHAR(40) NOT NULL,
  risk_score NUMERIC(5,2) NOT NULL,
  risk_level VARCHAR(16) NOT NULL,
  explanation TEXT,
  factors JSONB,
  raw_response JSONB,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_risk_results_target_check CHECK (
    request_log_id IS NOT NULL OR attack_event_id IS NOT NULL
  ),
  CONSTRAINT ai_risk_results_score_check CHECK (
    risk_score >= 0 AND risk_score <= 100
  ),
  CONSTRAINT ai_risk_results_level_check CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
  )
);

ALTER TABLE blocked_entities
  ADD COLUMN IF NOT EXISTS attack_event_id BIGINT REFERENCES attack_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id
  ON tenant_users (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
  ON user_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
  ON user_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_sites_tenant_id_status
  ON sites (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_blocked_entities_site_created_at_desc
  ON blocked_entities (site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blocked_entities_attack_event_id
  ON blocked_entities (attack_event_id)
  WHERE attack_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_blocked_entities_active_automatic_ip
  ON blocked_entities (site_id, entity_type, entity_value)
  WHERE source = 'automatic'
    AND entity_type = 'ip'
    AND expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_request_logs_site_occurred_at_desc
  ON request_logs (site_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_logs_tenant_occurred_at_desc
  ON request_logs (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_logs_detection_queue
  ON request_logs (processed_for_detection, occurred_at ASC)
  WHERE processed_for_detection = FALSE;

CREATE INDEX IF NOT EXISTS idx_request_logs_external_request_id
  ON request_logs (site_id, external_request_id)
  WHERE external_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attack_events_tenant_detected_at_desc
  ON attack_events (tenant_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_attack_events_site_status_detected_at_desc
  ON attack_events (site_id, status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_attack_events_request_log_id
  ON attack_events (request_log_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attack_events_request_log_rule
  ON attack_events (request_log_id, event_type, rule_code);

CREATE INDEX IF NOT EXISTS idx_ai_risk_results_request_log_analyzed_at_desc
  ON ai_risk_results (request_log_id, analyzed_at DESC)
  WHERE request_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_risk_results_attack_event_analyzed_at_desc
  ON ai_risk_results (attack_event_id, analyzed_at DESC)
  WHERE attack_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_risk_results_attack_event_model
  ON ai_risk_results (attack_event_id, model_name, model_version)
  WHERE attack_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_risk_results_tenant_score_desc
  ON ai_risk_results (tenant_id, risk_score DESC, analyzed_at DESC);
