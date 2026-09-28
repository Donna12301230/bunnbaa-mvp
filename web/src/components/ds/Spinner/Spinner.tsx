import { tr } from '@/lib/i18n';
import { LoaderCircle } from 'lucide-react';
import { cx } from '../_shared/cx';
import './Spinner.css';

export interface SpinnerProps {
  /** icon 尺寸（px），預設 20 */
  size?: 16 | 20 | 24;
  /** 螢幕閱讀器文字；傳 null 代表純裝飾（外層已有說明） */
  label?: string | null;
  className?: string;
}

export function Spinner({ size = 20, label = tr('載入中', 'Loading'), className }: SpinnerProps) {
  return (
    <span className={cx('bb-spinner-wrap', className)} role={label ? 'status' : undefined}>
      <LoaderCircle className="bb-spinner" size={size} aria-hidden="true" />
      {label && <span className="bb-sr-only">{label}</span>}
    </span>
  );
}
