import EventDetailPageClient from './EventDetailPageClient';
import EventDetailRouteErrorProbe from './EventDetailRouteErrorProbe';

export const dynamic = 'force-dynamic';

const eventDetailRouteErrorProbeEnabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.SECUAI_ENABLE_ERROR_BOUNDARY_SMOKE === '1';

export default function EventDetailPage() {
  return (
    <>
      <EventDetailRouteErrorProbe
        enabled={eventDetailRouteErrorProbeEnabled}
      />
      <EventDetailPageClient />
    </>
  );
}
