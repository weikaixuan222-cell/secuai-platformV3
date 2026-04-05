import StateCard, { type StateCardProps } from './StateCard';

interface StatePanelCardProps extends StateCardProps {
  className: string;
  panelTestId?: string;
}

export default function StatePanelCard({
  className,
  panelTestId,
  ...stateCardProps
}: StatePanelCardProps) {
  return (
    <section
      className={`glass-panel ${className}`}
      data-testid={panelTestId}
      aria-busy={stateCardProps.tone === 'loading'}
    >
      <StateCard {...stateCardProps} />
    </section>
  );
}
