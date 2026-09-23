import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import { IconBox, type IconBoxTone } from '../IconBox';
import './Card.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** elevated 白底柔和陰影（預設）/ outlined 細框無陰影 / tinted 淡橘底 */
  variant?: 'elevated' | 'outlined' | 'tinted';
  /** 內距：none 0 / sm 12 / md 16（預設）/ lg 24 */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** lg 卡片用 --radius-xl；小卡片用 --radius-lg（預設 md = radius-lg） */
  radius?: 'md' | 'lg';
  /** 可互動：hover 上浮 2px、陰影加深 */
  interactive?: boolean;
  /** 渲染的元素；可點擊的卡片請用 'button' 或 'a' */
  as?: 'div' | 'article' | 'section' | 'li' | 'button' | 'a';
  href?: string;
  /** as="button" 時停用；其他元素會改設 aria-disabled */
  disabled?: boolean;
  /** 載入中：降低透明度並設 aria-busy（內容請搭配 Skeleton） */
  loading?: boolean;
  /** 僅供預覽頁強制呈現狀態 */
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
      // 多型元素的 ref 型別無法由 TS 推導，這裡統一以 HTMLElement 處理
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
  /** vertical：icon 在上（四格功能介紹）；horizontal：icon 在左（列表） */
  layout?: 'vertical' | 'horizontal';
}

/** icon 方塊 + 標題 + 說明（登入頁四格功能介紹的樣式） */
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
