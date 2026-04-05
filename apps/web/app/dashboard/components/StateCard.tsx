import Link from 'next/link';
import styles from './state-card.module.css';

type StateCardTone = 'loading' | 'empty' | 'error';

export interface StateCardProps {
  tone: StateCardTone;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  testId?: string;
  actionTestId?: string;
  onAction?: () => void;
}

function InfoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 8H12.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 8.5V13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12 16H12.01"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M10.3 4.5C11.1 3.1 12.9 3.1 13.7 4.5L21 17.4C21.8 18.8 20.9 20.5 19.3 20.5H4.7C3.1 20.5 2.2 18.8 3 17.4L10.3 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12A9 9 0 1 1 12 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function StateCard({
  tone,
  title,
  description,
  actionLabel,
  actionHref,
  testId,
  actionTestId,
  onAction
}: StateCardProps) {
  const iconClassName =
    tone === 'error'
      ? styles.errorIcon
      : tone === 'loading'
        ? styles.loadingIcon
        : styles.emptyIcon;

  const icon =
    tone === 'error' ? (
      <AlertIcon />
    ) : tone === 'loading' ? (
      <LoadingIcon />
    ) : (
      <InfoIcon />
    );

  const actionNode = actionLabel
    ? actionHref
      ? (
        <Link
          href={actionHref}
          className={styles.actionButton}
          data-testid={actionTestId}
        >
          {actionLabel}
        </Link>
      )
      : (
        <button
          type="button"
          onClick={onAction}
          className={styles.actionButton}
          data-testid={actionTestId}
        >
          {actionLabel}
        </button>
      )
    : null;

  return (
    <div
      className={styles.card}
      data-testid={testId}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-busy={tone === 'loading'}
    >
      <div className={`${styles.iconWrap} ${iconClassName}`}>{icon}</div>
      <div className={styles.title}>{title}</div>
      <p className={styles.description}>{description}</p>
      {actionNode}
    </div>
  );
}
