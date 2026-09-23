import {
  createContext,
  forwardRef,
  useContext,
  useLayoutEffect,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import '@/styles/tokens.css';
import '@/styles/global.css';
import { cx } from '../_shared/cx';
import './ThemeRoot.css';

export type BbTheme = 'light' | 'dark';

const ThemeContext = createContext<BbTheme>('light');

/** 目前所在的設計系統主題。 */
export function useBbTheme(): BbTheme {
  return useContext(ThemeContext);
}

export interface ThemeRootProps extends HTMLAttributes<HTMLDivElement> {
  /** 'light'（預設）或 'dark'；深色模式只覆寫中性色，品牌色不變。 */
  theme?: BbTheme;
  children?: ReactNode;
}

/**
 * 設計系統根容器：套用 tokens 與全域排版（.bb-theme）。
 * 所有 ds 元件都必須放在 <ThemeRoot> 之內。
 */
export const ThemeRoot = forwardRef<HTMLDivElement, ThemeRootProps>(function ThemeRoot(
  { theme = 'light', className, children, ...rest },
  ref,
) {
  return (
    <ThemeContext.Provider value={theme}>
      <div ref={ref} {...rest} className={cx('bb-theme', className)} data-theme={theme}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
});

/**
 * 把內容渲染到 document.body，並帶上 .bb-theme 與目前主題，
 * 讓 Modal / Toast 等浮層也吃得到 tokens。
 */
export function Portal({ children }: { children: ReactNode }) {
  const theme = useBbTheme();
  // 同步建立容器，讓子元件第一次 render 就有 DOM（Modal 開啟時才能立即聚焦）
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.className = 'bb-theme bb-portal';
    return el;
  });

  useLayoutEffect(() => {
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host]);

  useLayoutEffect(() => {
    host.setAttribute('data-theme', theme);
  }, [host, theme]);

  return createPortal(children, host);
}
