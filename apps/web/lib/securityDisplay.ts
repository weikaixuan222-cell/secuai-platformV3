import type {
  AttackEventStatus,
  AttackSeverity,
  BlockedEntitySource,
  BlockedEntityType,
  ProtectionAction,
  ProtectionReasonCode,
  RiskLevel,
  SecurityPolicyMode
} from '@/lib/contracts';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '暂无数据';
  }

  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

export function formatProtectionAction(action: ProtectionAction): string {
  switch (action) {
    case 'allow':
      return '允许放行';
    case 'monitor':
      return '监控放行';
    case 'block':
      return '执行拦截';
    default:
      return action;
  }
}

export function formatProtectionReason(reason: ProtectionReasonCode): string {
  switch (reason) {
    case 'blocked_ip':
      return '命中已封禁 IP';
    case 'blocked_sql_injection':
      return '命中 SQL 注入特征';
    case 'blocked_xss':
      return '命中 XSS 特征';
    case 'blocked_suspicious_user_agent':
      return '命中可疑 User-Agent 特征';
    case 'blocked_rate_limit':
      return '命中速率限制阈值';
    default:
      return reason;
  }
}

export function formatEventType(eventType: string): string {
  switch (eventType) {
    case 'sql_injection':
      return 'SQL 注入';
    case 'xss_payload':
    case 'xss_attempt':
      return 'XSS 攻击载荷';
    case 'high_frequency_access':
      return '高频访问';
    case 'suspicious_user_agent':
      return '可疑 User-Agent';
    default:
      return eventType;
  }
}

export function formatSeverity(severity: AttackSeverity): string {
  switch (severity) {
    case 'critical':
      return '严重';
    case 'high':
      return '高危';
    case 'medium':
      return '中危';
    case 'low':
      return '低危';
    default:
      return severity;
  }
}

export function formatStatus(status: AttackEventStatus): string {
  switch (status) {
    case 'open':
      return '待处理';
    case 'reviewed':
      return '已复核';
    case 'resolved':
      return '已处理';
    default:
      return status;
  }
}

export function formatRiskLevel(riskLevel: RiskLevel): string {
  switch (riskLevel) {
    case 'critical':
      return '严重风险';
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    default:
      return riskLevel;
  }
}

export function getRiskColor(level?: AttackSeverity | RiskLevel): string {
  switch (level) {
    case 'critical':
      return 'var(--severity-critical)';
    case 'high':
      return 'var(--severity-high)';
    case 'medium':
      return 'var(--severity-medium)';
    case 'low':
      return 'var(--severity-low)';
    default:
      return 'var(--text-secondary)';
  }
}

export function formatPolicyMode(mode: SecurityPolicyMode): string {
  switch (mode) {
    case 'monitor':
      return '监控模式';
    case 'protect':
      return '防护模式';
    default:
      return mode;
  }
}

export function formatSwitchState(enabled: boolean): string {
  return enabled ? '已启用' : '未启用';
}

export function formatBlockedEntityType(entityType: BlockedEntityType): string {
  switch (entityType) {
    case 'ip':
      return 'IP 地址';
    default:
      return entityType;
  }
}

export function formatBlockedEntitySource(source: BlockedEntitySource): string {
  switch (source) {
    case 'manual':
      return '手动添加';
    case 'automatic':
      return '自动生成';
    default:
      return source;
  }
}
