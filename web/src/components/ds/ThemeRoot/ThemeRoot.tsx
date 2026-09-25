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
import '@/styles/look-cafe.css';
import { cx } from '../_shared/cx';
import './ThemeRoot.css';

export type BbTheme = 'light' | 'dark';
/** 視覺風格：classic（預設）或 cafe（深可可棕 + 奶油黃、襯線標題、描邊取代陰影）。 */
export type BbLook = 'classic' | 'cafe';

const ThemeContext = createContext<BbTheme>('light');
const LookContext = createContext<BbLook>('classic');

/** 目前所在的設計系統主題。 */
export function useBbTheme(): BbTheme {
  return useContext(ThemeContext);
}

export interface ThemeRootProps extends HTMLAttributes<HTMLDivElement> {
  /** 'light'（預設）或 'dark'；深色模式只覆寫中性色，品牌色不變。 */
  theme?: BbTheme;
  /** 'classic'（預設）或 'cafe'；與 theme 可自由組合。 */
  look?: BbLook;
  children?: ReactNode;
}

/**
 * 設計系統根容器：套用 tokens 與全域排版（.bb-theme）。
 * 所有 ds 元件都必須放在 <ThemeRoot> 之內。
 */
export const ThemeRoot = forwardRef<HTMLDivElement, ThemeRootProps>(function ThemeRoot(
  { theme = 'light', look = 'classic', className, children, ...rest },
  ref,
) {
  return (
    <ThemeContext.Provider value={theme}>
      <LookContext.Provider value={look}>
        <div ref={ref} {...rest} className={cx('bb-theme', className)} data-theme={theme} data-look={look}>
          {children}
        </div>
      </LookContext.Provider>
    </ThemeContext.Provider>
  );
});

/**
 * 把內容渲染到 document.body，並帶上 .bb-theme 與目前主題，
 * 讓 Modal / Toast 等浮層也吃得到 tokens。
 */
export function Portal({ children }: { children: ReactNode }) {
  const theme = useBbTheme();
  const look = useContext(LookContext);
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
    host.setAttribute('data-look', look);
  }, [host, theme, look]);

  return createPortal(children, host);
}
