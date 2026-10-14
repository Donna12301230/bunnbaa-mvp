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
/** Visual style: classic (default) or cafe (dark cocoa brown + butter yellow, serif headings, outlines instead of shadows). */
export type BbLook = 'classic' | 'cafe';

const ThemeContext = createContext<BbTheme>('light');
const LookContext = createContext<BbLook>('classic');

/** The current design-system theme. */
export function useBbTheme(): BbTheme {
  return useContext(ThemeContext);
}

export interface ThemeRootProps extends HTMLAttributes<HTMLDivElement> {
  /** 'light' (default) or 'dark'; dark mode only overrides neutral colors, brand colors stay the same. */
  theme?: BbTheme;
  /** 'classic' (default) or 'cafe'; combines freely with theme. */
  look?: BbLook;
  children?: ReactNode;
}

/**
 * Design-system root container: applies tokens and global typography (.bb-theme).
 * Every ds component must be inside a <ThemeRoot>.
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
 * Renders content into document.body with .bb-theme and the current theme,
 * so overlays like Modal / Toast also get the tokens.
 */
export function Portal({ children }: { children: ReactNode }) {
  const theme = useBbTheme();
  const look = useContext(LookContext);
  // Create the container synchronously so children have a DOM node on first render (so Modal can focus immediately when opened)
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
