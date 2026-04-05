import EventDetailPageClient from './EventDetailPageClient';
import EventDetailRouteErrorProbe from './EventDetailRouteErrorProbe';

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
