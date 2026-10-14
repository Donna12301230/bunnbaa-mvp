import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import { IconBox, type IconBoxTone } from '../IconBox';
import './Card.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** elevated: white with soft shadow (default) / outlined: thin border, no shadow / tinted: light orange */
  variant?: 'elevated' | 'outlined' | 'tinted';
  /** Padding: none 0 / sm 12 / md 16 (default) / lg 24 */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** lg cards use --radius-xl; small cards use --radius-lg (default md = radius-lg) */
  radius?: 'md' | 'lg';
  /** Interactive: lift 2px on hover, deeper shadow */
  interactive?: boolean;
  /** Element to render; clickable cards should use 'button' or 'a' */
  as?: 'div' | 'article' | 'section' | 'li' | 'button' | 'a';
  href?: string;
  /** Disables it when as="button"; other elements get aria-disabled instead */
  disabled?: boolean;
  /** Loading: lowers opacity and sets aria-busy (pair the content with Skeleton) */
  loading?: boolean;
  /** Only for forcing states on the preview page */
  forceState?: 'hover' | 'active' | 'focus';
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    variant = 'elevated',
    padding = 'md',
    radius = 'md',
    interactive = false,
    as: Tag = 'div',
    loading = false,
    disabled,
    className,
    forceState,
    children,
    ...rest
  },
  ref,
) {
  const isInteractive = interactive || Tag === 'button' || Tag === 'a';
  const disabledProps =
    Tag === 'button' ? { disabled: disabled || loading } : disabled ? { 'aria-disabled': true } : {};
  return (
    <Tag
      // TS can't infer the ref type of a polymorphic element, so treat it as HTMLElement here
      ref={ref as never}
      type={Tag === 'button' ? 'button' : undefined}
      aria-busy={loading || undefined}
      {...disabledProps}
      className={cx(
        'bb-card',
        `bb-card--${variant}`,
        `bb-card--pad-${padding}`,
        `bb-card--radius-${radius}`,
        isInteractive && 'bb-card--interactive',
        loading && 'is-loading',
        forceState && `is-${forceState}`,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export interface FeatureCardProps extends Omit<CardProps, 'title' | 'children'> {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  iconTone?: IconBoxTone;
  /** vertical: icon on top (four-up feature intro); horizontal: icon on the left (lists) */
  layout?: 'vertical' | 'horizontal';
}

/** Icon box + title + description (the style of the login page's four-up feature intro) */
export function FeatureCard({
  icon,
  title,
  description,
  iconTone = 'brand',
  layout = 'vertical',
  className,
  ...cardProps
}: FeatureCardProps) {
  return (
    <Card {...cardProps} className={cx('bb-feature', `bb-feature--${layout}`, className)}>
      <IconBox tone={iconTone}>{icon}</IconBox>
      <div className="bb-feature__body">
        <h3 className="bb-feature__title">{title}</h3>
        {description && <p className="bb-feature__desc">{description}</p>}
      </div>
    </Card>
  );
}
