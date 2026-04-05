import type { SiteFilterOption } from '@/lib/siteFilters';

interface SiteFilterSelectProps {
  value: string;
  options: SiteFilterOption[];
  labelClassName: string;
  fieldClassName: string;
  selectClassName: string;
  allSitesLabel?: string;
  disabled?: boolean;
  selectId?: string;
  testId?: string;
  onChange: (siteId: string) => void;
}

export default function SiteFilterSelect({
  value,
  options,
  labelClassName,
  fieldClassName,
  selectClassName,
  allSitesLabel = '全部站点',
  disabled = false,
  selectId = 'site-filter-select',
  testId,
  onChange
}: SiteFilterSelectProps) {
  return (
    <label className={fieldClassName} htmlFor={selectId}>
      <span className={labelClassName}>站点范围</span>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        aria-disabled={disabled}
        aria-busy={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        className={selectClassName}
      >
        <option value="">{allSitesLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} / {option.meta}
          </option>
        ))}
      </select>
    </label>
  );
}
