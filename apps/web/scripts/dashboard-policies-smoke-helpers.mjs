export function shouldDelayPolicyRequest(method, url) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedUrl = String(url || '');

  return (
    (
      normalizedMethod === 'PUT' &&
      normalizedUrl.includes('/api/v1/sites/') &&
      normalizedUrl.includes('/security-policy')
    ) ||
    (
      normalizedMethod === 'POST' &&
      normalizedUrl.includes('/api/v1/sites/') &&
      normalizedUrl.includes('/blocked-entities')
    ) ||
    (
      normalizedMethod === 'DELETE' &&
      normalizedUrl.includes('/api/v1/blocked-entities/')
    ) ||
    (
      normalizedMethod === 'POST' &&
      normalizedUrl.includes('/api/v1/protection/check')
    )
  );
}
