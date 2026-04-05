import { notFound } from 'next/navigation';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ErrorBoundarySmokeProbe from './ErrorBoundarySmokeProbe';

export const dynamic = 'force-dynamic';

const probeStateDir = join(tmpdir(), 'secuai-web-error-boundary-smoke');

interface ErrorBoundarySmokePageProps {
  searchParams?: {
    probeId?: string;
    trigger?: string;
  };
}

export default function ErrorBoundarySmokePage({
  searchParams
}: ErrorBoundarySmokePageProps) {
  if (process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE !== '1') {
    notFound();
  }

  const probeId = searchParams?.probeId?.trim() || 'default-probe';
  const shouldTriggerError = searchParams?.trigger === '1';
  const probeStatePath = join(probeStateDir, `${probeId}.marker`);

  if (shouldTriggerError && !existsSync(probeStatePath)) {
    mkdirSync(probeStateDir, { recursive: true });
    writeFileSync(probeStatePath, 'handled', 'utf8');
    throw new Error('Global error boundary smoke trigger');
  }

  return <ErrorBoundarySmokeProbe probeId={probeId} />;
}
