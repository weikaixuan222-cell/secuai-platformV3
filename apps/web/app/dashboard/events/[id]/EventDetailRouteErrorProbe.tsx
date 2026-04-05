'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

interface EventDetailRouteErrorProbeProps {
  enabled: boolean;
}

export default function EventDetailRouteErrorProbe({
  enabled
}: EventDetailRouteErrorProbeProps) {
  const searchParams = useSearchParams();
  const shouldTrigger = searchParams.get('detailRouteErrorProbe') === '1';
  const probeId = searchParams.get('detailRouteErrorProbeId')?.trim() || '';
  const [probeError, setProbeError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !shouldTrigger || !probeId) {
      setProbeError(null);
      return;
    }

    const markerKey = `secuai:event-detail-route-error-probe:${probeId}`;

    try {
      if (window.sessionStorage.getItem(markerKey) === '1') {
        return;
      }

      window.sessionStorage.setItem(markerKey, '1');
      setProbeError(
        new Error(`Event detail route error smoke trigger: ${probeId}`)
      );
    } catch {
      setProbeError(null);
    }
  }, [enabled, probeId, shouldTrigger]);

  if (probeError) {
    throw probeError;
  }

  return null;
}
