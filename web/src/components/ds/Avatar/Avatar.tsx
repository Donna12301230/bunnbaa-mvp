import { tr } from '@/lib/i18n';
import { useState, type HTMLAttributes } from 'react';
import { cx } from '../_shared/cx';
import './Avatar.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  src?: string;
  /** 使用者名稱：作為 alt，圖片失效時取字做縮寫 */
  name: string;
  /** xs 24 / sm 32 / md 40（預設）/ lg 56 / xl 72 */
  size?: AvatarSize;
  /** 右下角狀態點 */
  status?: 'online' | 'busy' | 'offline';
  /** 載入中顯示骨架 */
  loading?: boolean;
}

const statusLabel = (status: 'online' | 'busy' | 'offline') =>
  ({ online: tr('在線', 'Online'), busy: tr('忙碌', 'Busy'), offline: tr('離線', 'Offline') })[status];

/** 中文名取最後兩字（「王小明」→「小明」），英文取前兩個單字字首。 */
export function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (/[㐀-鿿]/.test(trimmed)) {
    const chars = Array.from(trimmed.replace(/\s/g, ''));
    return chars.length >= 3 ? chars.slice(-2).join('') : chars.slice(0, 2).join('');
  }
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function Avatar({ src, name, size = 'md', status, loading = false, className, ...rest }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;

  return (
    <span
      role="img"
      aria-label={status ? `${name}（${statusLabel(status)}）` : name}
      aria-busy={loading || undefined}
      {...rest}
      className={cx('bb-avatar', `bb-avatar--${size}`, loading && 'is-loading', className)}
    >
      {!loading &&
        (showImage ? (
          <img className="bb-avatar__img" src={src} alt="" onError={() => setFailed(true)} />
        ) : (
          <span className="bb-avatar__initials" aria-hidden="true">
            {getInitials(name)}
          </span>
        ))}
      {status && !loading && <span className={cx('bb-avatar__status', `bb-avatar__status--${status}`)} />}
    </span>
  );
}
