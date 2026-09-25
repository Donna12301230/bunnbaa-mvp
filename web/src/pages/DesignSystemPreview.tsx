import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  Coffee,
  CalendarCheck,
  ChevronRight,
  Gift,
  Heart,
  Lock,
  Mail,
  Moon,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  Ticket,
  Trash2,
  Utensils,
  Wallet,
} from 'lucide-react';
import {
  AnimatedNumber,
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  Checkbox,
  Divider,
  EmptyState,
  FeatureCard,
  IconBox,
  Input,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Switch,
  Tabs,
  Tag,
  Textarea,
  ThemeRoot,
  Toast,
  ToastProvider,
  Tooltip,
  useToast,
  type BadgeTone,
  type BbLook,
  type BbTheme,
  type ButtonVariant,
} from '@/components/ds';
import { DEFAULT_SITE_LOOK, useSiteLook } from '@/lib/siteLook';
import './DesignSystemPreview.css';

/* ══════════════════════════════════════════════════════════════════════════
   資料
   ══════════════════════════════════════════════════════════════════════════ */

const SECTIONS = [
  { id: 'showcase', label: '版面範例' },
  { id: 'colors', label: '色彩' },
  { id: 'contrast', label: '對比檢查' },
  { id: 'typography', label: '字體' },
  { id: 'spacing', label: '間距' },
  { id: 'radius', label: '圓角' },
  { id: 'shadow', label: '陰影' },
  { id: 'motion', label: '動態' },
  { id: 'icon', label: 'Icon' },
  { id: 'breakpoints', label: '斷點' },
  { id: 'button', label: 'Button' },
  { id: 'input', label: 'Input' },
  { id: 'form', label: '表單控制項' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'card', label: 'Card' },
  { id: 'badge', label: 'Badge / Tag' },
  { id: 'avatar', label: 'Avatar' },
  { id: 'overlay', label: 'Modal / Sheet' },
  { id: 'toast', label: 'Toast' },
  { id: 'tooltip', label: 'Tooltip' },
  { id: 'empty', label: 'EmptyState' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'divider', label: 'Divider' },
];

interface SwatchDef {
  token: string;
  note: string;
}

const COLOR_GROUPS: { title: string; description?: string; swatches: SwatchDef[] }[] = [
  {
    title: '品牌色',
    swatches: [
      { token: '--brand-brown', note: '標題、Logo「Bunn」（僅大字）' },
      { token: '--brand-brown-dark', note: 'hover、強調文字' },
      { token: '--brand-orange', note: 'Logo「Baa」、icon、裝飾' },
      { token: '--brand-orange-dark', note: '裝飾 hover' },
      { token: '--brand-orange-soft', note: 'icon 底、選取背景、標籤底' },
      { token: '--brand-orange-tint', note: '大面積淡色區塊' },
    ],
  },
  {
    title: '無障礙衍生色',
    description: '白字在 #F29E0C 上只有 2.17:1。互動元件的底色與橘色文字改用以下加深色，皆 ≥ 4.5:1。',
    swatches: [
      { token: '--brand-orange-strong', note: '主要按鈕底、選取狀態、focus ring' },
      { token: '--brand-orange-strong-hover', note: '主要按鈕 hover / active' },
      { token: '--brand-orange-text', note: '橘色文字、連結' },
      { token: '--danger-strong', note: '危險按鈕底' },
    ],
  },
  {
    title: '中性色',
    swatches: [
      { token: '--bg', note: '頁面底色' },
      { token: '--surface', note: '卡片、彈窗' },
      { token: '--surface-muted', note: '輸入框底、分頁容器' },
      { token: '--border', note: '分隔線、卡片框' },
      { token: '--border-strong', note: 'hover 框線' },
      { token: '--border-control', note: '核取框、開關外框（≥3:1）' },
      { token: '--text', note: '主要文字' },
      { token: '--text-secondary', note: '次要文字' },
      { token: '--text-muted', note: '輔助說明、placeholder' },
    ],
  },
  {
    title: '描邊與色帶',
    description: '色帶是整段滿版的區塊（品牌故事、促銷跑馬燈）。classic 與 cafe 風格各有一組值。',
    swatches: [
      { token: '--border-ink', note: '卡片、按鈕、標籤描邊（cafe）' },
      { token: '--surface-inverse', note: '深色色帶底' },
      { token: '--text-on-inverse', note: '深色色帶上的文字' },
      { token: '--surface-accent', note: '強調色帶、secondary 按鈕底' },
      { token: '--text-on-accent', note: '強調色帶上的文字' },
    ],
  },
  {
    title: '狀態色',
    description: '實色用於 icon、圓點、框線；文字請用 *-text，底色用 *-soft。',
    swatches: [
      { token: '--success', note: 'icon / 點' },
      { token: '--success-soft', note: '淡底' },
      { token: '--success-text', note: '文字' },
      { token: '--warning', note: 'icon / 點' },
      { token: '--warning-soft', note: '淡底' },
      { token: '--warning-text', note: '文字' },
      { token: '--danger', note: 'icon / 點' },
      { token: '--danger-soft', note: '淡底' },
      { token: '--danger-text', note: '文字' },
      { token: '--info', note: 'icon / 點' },
      { token: '--info-soft', note: '淡底' },
      { token: '--info-text', note: '文字' },
    ],
  },
];

const CONTRAST_PAIRS: { fg: string; bg: string; usage: string; large?: boolean; nonText?: boolean }[] = [
  { fg: '--text-on-brand', bg: '--brand-orange', usage: '（原規格）白字 on 品牌橘 — 不採用' },
  { fg: '--text-on-brand', bg: '--brand-orange-strong', usage: '主要按鈕' },
  { fg: '--text-on-brand', bg: '--brand-orange-strong-hover', usage: '主要按鈕 hover' },
  { fg: '--brand-orange-text', bg: '--bg', usage: '連結 on 頁面底' },
  { fg: '--brand-orange-text', bg: '--brand-orange-soft', usage: '次要按鈕、品牌標籤' },
  { fg: '--text-on-danger', bg: '--danger-strong', usage: '危險按鈕' },
  { fg: '--text', bg: '--bg', usage: '內文' },
  { fg: '--text-on-inverse', bg: '--surface-inverse', usage: '深色色帶文字' },
  { fg: '--text-on-accent', bg: '--surface-accent', usage: '強調色帶、secondary 按鈕' },
  { fg: '--text-secondary', bg: '--surface', usage: '次要文字 on 卡片' },
  { fg: '--text-muted', bg: '--bg', usage: '輔助說明 on 頁面底' },
  { fg: '--text-muted', bg: '--surface-muted', usage: 'placeholder on 輸入框' },
  { fg: '--brand-brown', bg: '--bg', usage: '品牌標題（display / h1 大字）', large: true },
  { fg: '--brand-brown-dark', bg: '--bg', usage: '品牌色小標題' },
  { fg: '--success-text', bg: '--success-soft', usage: '成功標籤' },
  { fg: '--warning-text', bg: '--warning-soft', usage: '警示標籤' },
  { fg: '--danger-text', bg: '--danger-soft', usage: '危險標籤' },
  { fg: '--info-text', bg: '--info-soft', usage: '資訊標籤' },
  { fg: '--focus-ring-color', bg: '--bg', usage: 'focus ring（非文字 ≥3:1）', nonText: true },
  { fg: '--border-control', bg: '--surface', usage: '核取框外框（非文字 ≥3:1）', nonText: true },
];

const TYPE_SCALE = [
  { cls: 'bb-display', name: 'display', spec: '32 / 700 / 1.3', sample: '今天也要吃飽飽' },
  { cls: 'bb-h1', name: 'h1', spec: '24 / 700 / 1.35', sample: '本週推薦便當' },
  { cls: 'bb-h2', name: 'h2', spec: '20 / 600 / 1.4', sample: '我的預約' },
  { cls: 'bb-h3', name: 'h3', spec: '17 / 600 / 1.4', sample: '阿嬤滷肉飯・中午取餐' },
  { cls: 'bb-body', name: 'body', spec: '15 / 400 / 1.6', sample: '提前預約可享早鳥價，當天 10:30 前都能免費取消。' },
  { cls: 'bb-body-sm', name: 'body-sm', spec: '13 / 400 / 1.5', sample: '距離你 350 公尺・台大正門旁' },
  { cls: 'bb-caption', name: 'caption', spec: '12 / 400 / 1.5', sample: '最後更新 09:24' },
];

const SPACING = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const RADII = [
  { token: '--radius-sm', use: '標籤' },
  { token: '--radius-md', use: '按鈕、輸入框' },
  { token: '--radius-lg', use: '小卡片、icon 方塊' },
  { token: '--radius-xl', use: '大卡片、彈窗' },
  { token: '--radius-2xl', use: '頁面大區塊' },
  { token: '--radius-full', use: '膠囊、頭像' },
];
const SHADOWS = [
  { token: '--shadow-sm', use: '卡片靜止' },
  { token: '--shadow-md', use: '卡片 hover、Toast、Tooltip' },
  { token: '--shadow-lg', use: 'Modal、BottomSheet' },
];
const BREAKPOINTS = [
  { name: 'sm', px: 375, use: '手機（設計基準）' },
  { name: 'md', px: 768, use: '平板：Toast 移到右下、Sheet 置中' },
  { name: 'lg', px: 1024, use: '筆電：多欄版面' },
  { name: 'xl', px: 1280, use: '桌機：內容最大寬' },
];

const BUTTON_VARIANTS: { variant: ButtonVariant; label: string }[] = [
  { variant: 'primary', label: '立即預約' },
  { variant: 'secondary', label: '加入收藏' },
  { variant: 'outline', label: '查看菜單' },
  { variant: 'text', label: '了解更多' },
  { variant: 'danger', label: '取消預約' },
];

const STATES = ['default', 'hover', 'active', 'focus', 'disabled', 'loading'] as const;
type PreviewState = (typeof STATES)[number];

const BADGE_TONES: { tone: BadgeTone; label: string }[] = [
  { tone: 'neutral', label: '已結束' },
  { tone: 'brand', label: '早鳥價' },
  { tone: 'success', label: '已取餐' },
  { tone: 'warning', label: '即將截止' },
  { tone: 'danger', label: '已取消' },
  { tone: 'info', label: '可轉讓' },
];

/* ══════════════════════════════════════════════════════════════════════════
   小工具
   ══════════════════════════════════════════════════════════════════════════ */

function luminance(hex: string) {
  const m = hex.trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 讀取目前主題下 token 的實際值（切換深色模式時會重讀） */
function useTokenReader(theme: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  useEffect(() => force((n) => n + 1), [theme]);
  const read = (token: string) =>
    ref.current ? getComputedStyle(ref.current).getPropertyValue(token).trim().toUpperCase() : '';
  return { ref, read };
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="dsp-section" aria-labelledby={`${id}-title`}>
      <header className="dsp-section__head">
        <h2 id={`${id}-title`} className="bb-h1 bb-text-brand">
          {title}
        </h2>
        {lead && <p className="dsp-lead">{lead}</p>}
      </header>
      {children}
    </section>
  );
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dsp-sub">
      <h3 className="bb-h3">{title}</h3>
      {children}
    </div>
  );
}

function Guidelines({ dos, donts }: { dos: string[]; donts?: string[] }) {
  return (
    <div className="dsp-guide">
      <div>
        <p className="dsp-guide__title dsp-guide__title--do">建議</p>
        <ul>
          {dos.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
      {donts && (
        <div>
          <p className="dsp-guide__title dsp-guide__title--dont">避免</p>
          <ul>
            {donts.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 狀態矩陣：每列一種變體，每欄一種狀態 */
function StateMatrix({
  rows,
  states = STATES,
  render,
}: {
  rows: { key: string; label: string }[];
  states?: readonly PreviewState[];
  render: (row: string, state: PreviewState) => ReactNode;
}) {
  return (
    <div className="dsp-matrix-wrap">
      <table className="dsp-matrix">
        <thead>
          <tr>
            <th scope="col" className="bb-sr-only">
              變體
            </th>
            {states.map((s) => (
              <th key={s} scope="col">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {states.map((s) => (
                <td key={s}>{render(r.key, s)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const forced = (s: PreviewState) => (s === 'hover' || s === 'active' || s === 'focus' ? `is-${s}` : undefined);
const forcedField = (s: PreviewState) => (s === 'hover' || s === 'focus' ? s : undefined);

/* ══════════════════════════════════════════════════════════════════════════
   區塊
   ══════════════════════════════════════════════════════════════════════════ */

function ColorSection({ read }: { read: (t: string) => string }) {
  return (
    <Section id="colors" title="色彩" lead="奶油底色 + 棕橘品牌色；避免冷色調與純黑。色碼會隨深色模式即時更新。">
      {COLOR_GROUPS.map((g) => (
        <Sub key={g.title} title={g.title}>
          {g.description && <p className="dsp-note">{g.description}</p>}
          <div className="dsp-swatches">
            {g.swatches.map((s) => (
              <div key={s.token} className="dsp-swatch">
                <span className="dsp-swatch__chip" style={{ background: `var(${s.token})` }} />
                <div className="dsp-swatch__meta">
                  <code>{s.token}</code>
                  <span className="dsp-swatch__hex bb-num">{read(s.token)}</span>
                  <span className="dsp-swatch__note">{s.note}</span>
                </div>
              </div>
            ))}
          </div>
        </Sub>
      ))}
    </Section>
  );
}

function ContrastSection({ read }: { read: (t: string) => string }) {
  return (
    <Section
      id="contrast"
      title="無障礙對比檢查"
      lead="文字 ≥ 4.5:1；大字（≥24px，或 ≥18.66px 粗體）與非文字元素 ≥ 3:1。數值依目前主題即時計算。"
    >
      <div className="dsp-matrix-wrap">
        <table className="dsp-contrast">
          <thead>
            <tr>
              <th scope="col">範例</th>
              <th scope="col">前景 / 背景</th>
              <th scope="col">用途</th>
              <th scope="col">對比</th>
            </tr>
          </thead>
          <tbody>
            {CONTRAST_PAIRS.map((p) => {
              const fg = read(p.fg);
              const bg = read(p.bg);
              const ratio = fg && bg ? contrastRatio(fg, bg) : 0;
              const need = p.large || p.nonText ? 3 : 4.5;
              const pass = ratio >= need;
              return (
                <tr key={`${p.fg}${p.bg}`}>
                  <td>
                    <span
                      className="dsp-contrast__sample"
                      style={
                        p.nonText
                          ? { background: `var(${p.bg})`, boxShadow: `inset 0 0 0 2px var(${p.fg})` }
                          : { background: `var(${p.bg})`, color: `var(${p.fg})` }
                      }
                    >
                      {p.nonText ? '' : '飯飽 Aa'}
                    </span>
                  </td>
                  <td>
                    <code>{p.fg}</code>
                    <br />
                    <code>{p.bg}</code>
                  </td>
                  <td>{p.usage}</td>
                  <td>
                    <Badge tone={pass ? 'success' : 'danger'} className="bb-num">
                      {ratio.toFixed(2)}:1 {pass ? '通過' : '不足'}
                    </Badge>
                    <span className="dsp-contrast__need">門檻 {need}:1</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function TypographySection() {
  return (
    <Section
      id="typography"
      title="字體"
      lead="Noto Sans TC → PingFang TC → 微軟正黑體。價格、倒數一律加 .bb-num（tabular-nums），數字寬度固定不跳動。"
    >
      <div className="dsp-type">
        {TYPE_SCALE.map((t) => (
          <div key={t.name} className="dsp-type__row">
            <div className="dsp-type__meta">
              <code>.{t.cls}</code>
              <span className="bb-caption bb-text-muted">{t.spec}</span>
            </div>
            <p className={t.cls}>{t.sample}</p>
          </div>
        ))}
      </div>
      <Sub title="數字">
        <div className="dsp-row">
          <div className="dsp-num-demo">
            <span className="bb-caption bb-text-muted">預設（比例寬度）</span>
            <span className="bb-h2">NT$ 1,111 / 8,888</span>
          </div>
          <div className="dsp-num-demo">
            <span className="bb-caption bb-text-muted">.bb-num（等寬）</span>
            <span className="bb-h2 bb-num">NT$ 1,111 / 8,888</span>
          </div>
        </div>
      </Sub>
    </Section>
  );
}

function SpacingSection() {
  return (
    <Section id="spacing" title="間距" lead="4px 基準。元件內距多用 8 / 12 / 16，區塊之間用 24 / 32 / 48。">
      <div className="dsp-spacing">
        {SPACING.map((n) => (
          <div key={n} className="dsp-spacing__row">
            <code>--space-{n}</code>
            <span className="bb-num dsp-spacing__px">{n * 4}px</span>
            <span className="dsp-spacing__bar" style={{ width: `var(--space-${n})` }} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function RadiusSection({ read }: { read: (t: string) => string }) {
  return (
    <Section id="radius" title="圓角" lead="大圓角是親切感的來源；同一張卡片內，內層圓角要小於外層。">
      <div className="dsp-grid dsp-grid--6">
        {RADII.map((r) => (
          <div key={r.token} className="dsp-token-tile">
            <span className="dsp-radius-box" style={{ borderRadius: `var(${r.token})` }} />
            <code>{r.token}</code>
            <span className="bb-caption bb-text-muted">
              {read(r.token).toLowerCase()}・{r.use}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ShadowSection() {
  return (
    <Section id="shadow" title="陰影" lead="暖棕色調 rgba(120, 80, 40)，不用純黑；層級越高陰影越大越淡。">
      <div className="dsp-grid dsp-grid--3">
        {SHADOWS.map((s) => (
          <div key={s.token} className="dsp-shadow-box" style={{ boxShadow: `var(${s.token})` }}>
            <code>{s.token}</code>
            <span className="bb-caption bb-text-muted">{s.use}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function MotionSection() {
  const [price, setPrice] = useState(189);
  const [discount, setDiscount] = useState(15);
  const [countdown, setCountdown] = useState(90);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setCountdown((c) => (c <= 0 ? 90 : c - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const mm = String(Math.floor(countdown / 60)).padStart(2, '0');
  const ss = String(countdown % 60).padStart(2, '0');

  return (
    <Section
      id="motion"
      title="動態"
      lead="曲線統一 cubic-bezier(0.2, 0.8, 0.2, 1)。開啟系統「減少動態效果」時，時長降為 0、關閉位移與掃光，只保留必要的 loading 旋轉。"
    >
      <div className="dsp-grid dsp-grid--3">
        {[
          { token: '--duration-fast', ms: 120, use: 'hover、按下、顏色變化' },
          { token: '--duration-base', ms: 200, use: 'Modal、Tooltip、卡片上浮' },
          { token: '--duration-slow', ms: 320, use: 'BottomSheet、分頁滑塊、Toast 進場' },
        ].map((d) => (
          <div key={d.token} className="dsp-motion-tile">
            <div className="dsp-motion-track">
              <span
                className={playing ? 'dsp-motion-dot is-playing' : 'dsp-motion-dot'}
                style={{ transitionDuration: `var(${d.token})` }}
              />
            </div>
            <code>{d.token}</code>
            <span className="bb-caption bb-text-muted">
              {d.ms}ms・{d.use}
            </span>
          </div>
        ))}
      </div>
      <div className="dsp-row">
        <Button variant="secondary" size="sm" onClick={() => setPlaying((p) => !p)}>
          播放時長比較
        </Button>
      </div>

      <Sub title="數字變化">
        <div className="dsp-grid dsp-grid--3">
          <Card>
            <p className="bb-caption bb-text-muted">價格（roll 滾動）</p>
            <p className="bb-display bb-text-brand-strong">
              <AnimatedNumber value={price} prefix="NT$ " />
            </p>
            <div className="dsp-row">
              <Button size="sm" variant="outline" onClick={() => setPrice((p) => Math.max(0, p - 40))}>
                −40
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPrice((p) => p + 65)}>
                +65
              </Button>
            </div>
          </Card>
          <Card>
            <p className="bb-caption bb-text-muted">折扣（fade 淡入）</p>
            <p className="bb-display" style={{ color: 'var(--danger-text)' }}>
              <AnimatedNumber value={discount} animation="fade" suffix="% OFF" />
            </p>
            <div className="dsp-row">
              <Button size="sm" variant="outline" onClick={() => setDiscount((d) => (d >= 50 ? 10 : d + 5))}>
                換一個折扣
              </Button>
            </div>
          </Card>
          <Card>
            <p className="bb-caption bb-text-muted">倒數（tabular-nums，不跳動）</p>
            <p className="bb-display bb-num">
              {mm}:{ss}
            </p>
            <p className="bb-body-sm bb-text-secondary">距離預約截止</p>
          </Card>
        </div>
      </Sub>
      <Guidelines
        dos={['按鈕 hover 只加深顏色，按下縮放 0.98', '可點的卡片 hover 上浮 2px 並加深陰影', '數字變化用 AnimatedNumber']}
        donts={['彈跳、旋轉等誇張動畫', '超過 400ms 的轉場', '只靠動畫傳達資訊']}
      />
    </Section>
  );
}

function IconSection() {
  return (
    <Section
      id="icon"
      title="Icon"
      lead="lucide-react，線寬 1.75（.lucide 已統一設定），尺寸 16 / 20 / 24。功能 icon 放在 IconBox：40×40、--radius-lg、淡橘底、橘色 icon。"
    >
      <div className="dsp-row dsp-row--center">
        {[16, 20, 24].map((s) => (
          <div key={s} className="dsp-icon-size">
            <Utensils size={s} />
            <span className="bb-caption bb-text-muted bb-num">{s}px</span>
          </div>
        ))}
        <Divider orientation="vertical" decorative />
        {[Utensils, CalendarCheck, Ticket, Wallet, Gift, Store, Bell, Heart].map((I, i) => (
          <I key={i} size={20} className="dsp-icon-sample" />
        ))}
      </div>
      <Sub title="IconBox">
        <div className="dsp-row dsp-row--center">
          <IconBox size="sm">
            <Utensils />
          </IconBox>
          <IconBox>
            <Utensils />
          </IconBox>
          <IconBox size="lg">
            <Utensils />
          </IconBox>
          <Divider orientation="vertical" decorative />
          <IconBox tone="neutral">
            <Store />
          </IconBox>
          <IconBox tone="success">
            <CalendarCheck />
          </IconBox>
          <IconBox tone="warning">
            <Bell />
          </IconBox>
          <IconBox tone="danger">
            <Heart />
          </IconBox>
          <IconBox tone="info">
            <Ticket />
          </IconBox>
        </div>
      </Sub>
      <Guidelines
        dos={['icon 搭配文字；只有 icon 的按鈕要給 aria-label', 'icon 顏色跟隨文字（currentColor）']}
        donts={['混用實心 icon 或其他 icon 庫', '把 icon 放大超過 24px 當插圖用']}
      />
    </Section>
  );
}

function BreakpointSection() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const active = [...BREAKPOINTS].reverse().find((b) => width >= b.px)?.name ?? '< sm';

  return (
    <Section
      id="breakpoints"
      title="響應式斷點"
      lead={
        <>
          行動優先（min-width）。目前視窗寬 <strong className="bb-num">{width}px</strong>，落在{' '}
          <Badge tone="brand">{active}</Badge>
        </>
      }
    >
      <div className="dsp-bps">
        {BREAKPOINTS.map((b) => (
          <div key={b.name} className={b.name === active ? 'dsp-bp is-active' : 'dsp-bp'}>
            <span className="dsp-bp__bar" style={{ width: `${(b.px / 1280) * 100}%` }} />
            <div className="dsp-bp__meta">
              <code>
                {b.name}・{b.px}px
              </code>
              <span className="bb-caption bb-text-muted">{b.use}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ButtonSection() {
  return (
    <Section
      id="button"
      title="Button"
      lead="hover 加深、按下縮放 0.98、鍵盤 focus 顯示 2px ring + 2px offset。sm 視覺 36px，但點擊區仍為 44px。"
    >
      <StateMatrix
        rows={BUTTON_VARIANTS.map((b) => ({ key: b.variant, label: b.variant }))}
        render={(variant, s) => {
          const def = BUTTON_VARIANTS.find((b) => b.variant === variant)!;
          return (
            <Button
              variant={def.variant}
              className={forced(s)}
              disabled={s === 'disabled'}
              loading={s === 'loading'}
              tabIndex={-1}
            >
              {def.label}
            </Button>
          );
        }}
      />
      <Sub title="尺寸與 icon">
        <div className="dsp-row dsp-row--center">
          <Button size="sm" leftIcon={<Plus size={16} />}>
            sm 加入
          </Button>
          <Button size="md" leftIcon={<ShoppingBag size={20} />}>
            md 購物車
          </Button>
          <Button size="lg" rightIcon={<ChevronRight size={20} />}>
            lg 下一步
          </Button>
          <Button variant="outline" iconOnly aria-label="搜尋">
            <Search size={20} />
          </Button>
          <Button variant="secondary" iconOnly size="sm" aria-label="收藏">
            <Heart size={16} />
          </Button>
          <Button variant="danger" leftIcon={<Trash2 size={20} />}>
            刪除
          </Button>
        </div>
      </Sub>
      <Sub title="Full width">
        <div className="dsp-narrow">
          <Button fullWidth size="lg">
            確認付款 NT$ 189
          </Button>
          <Button fullWidth variant="text">
            稍後再說
          </Button>
        </div>
      </Sub>
      <Guidelines
        dos={['一個畫面只放一個 primary', '按鈕文字用動詞：「立即預約」「加入購物車」', '送出後立即切 loading，避免重複點擊']}
        donts={['用 primary 做破壞性操作（改用 danger）', '同一列放兩個以上 primary', '按鈕文字超過 8 個字']}
      />
    </Section>
  );
}

function InputSection() {
  return (
    <Section id="input" title="Input" lead="淡灰底無框，hover 出現細框，focus 轉白底 + 品牌橘 ring；錯誤訊息取代說明文字並以 aria-describedby 串接。">
      <StateMatrix
        rows={[{ key: 'text', label: 'text' }]}
        render={(_, s) => (
          <Input
            aria-label={`手機號碼（${s}）`}
            placeholder="0912-345-678"
            leftIcon={<Mail size={20} />}
            forceState={forcedField(s)}
            disabled={s === 'disabled'}
            loading={s === 'loading'}
            defaultValue={s === 'active' ? '0912-345' : undefined}
            tabIndex={-1}
          />
        )}
      />
      <div className="dsp-grid dsp-grid--2">
        <Input label="Email" placeholder="you@example.com" helperText="用來接收預約通知" leftIcon={<Mail size={20} />} required />
        <Input label="Email" defaultValue="hello@bunnbaa" error="Email 格式不正確，請再確認一次" leftIcon={<Mail size={20} />} />
        <Input label="密碼" type="password" placeholder="至少 8 個字元" helperText="點右側眼睛可顯示密碼" />
        <Input label="預算" type="number" placeholder="150" rightSlot="元 / 餐" inputMode="numeric" />
        <Input label="搜尋" placeholder="找店家或餐點" leftIcon={<Search size={20} />} size="lg" />
        <Input label="推薦碼" defaultValue="BUNN2026" loading helperText="驗證中…" />
      </div>
      <Guidelines
        dos={['label 一律顯示，不以 placeholder 取代', '錯誤訊息說明「怎麼修正」', '數字欄位加 inputMode 叫出數字鍵盤']}
        donts={['只用紅框表示錯誤（要有文字）', '在輸入過程中即時跳錯誤，應於 blur 或送出時']}
      />
    </Section>
  );
}

function FormControlsSection() {
  const [notify, setNotify] = useState(true);
  const [pickup, setPickup] = useState('noon');
  return (
    <Section id="form" title="Select・Textarea・Checkbox・Radio・Switch">
      <Sub title="Select">
        <StateMatrix
          rows={[{ key: 'select', label: 'select' }]}
          render={(_, s) => (
            <Select
              aria-label={`取餐時段（${s}）`}
              placeholder="選擇時段"
              options={[
                { value: 'noon', label: '11:30 – 12:30' },
                { value: 'late', label: '12:30 – 13:30' },
              ]}
              forceState={forcedField(s)}
              disabled={s === 'disabled'}
              loading={s === 'loading'}
              tabIndex={-1}
            />
          )}
        />
        <div className="dsp-grid dsp-grid--2">
          <Select
            label="取餐地點"
            placeholder="請選擇"
            helperText="可在訂單成立前更改"
            options={[
              { value: 'ntu', label: '台大正門' },
              { value: 'gongguan', label: '公館捷運站 2 號出口' },
              { value: 'closed', label: '師大路（暫停）', disabled: true },
            ]}
          />
          <Select label="取餐地點" placeholder="請選擇" error="請選擇取餐地點" options={[{ value: 'ntu', label: '台大正門' }]} />
        </div>
      </Sub>

      <Sub title="Textarea">
        <div className="dsp-grid dsp-grid--2">
          <Textarea label="給店家的備註" placeholder="例：不要香菜、飯少一點" maxLength={100} showCount helperText="店家會在出餐前看到" />
          <Textarea label="評論" defaultValue="好" error="至少寫 10 個字，幫助其他同學參考" forceState="focus" />
          <Textarea label="備註（停用）" placeholder="訂單已完成，無法修改" disabled />
          <Textarea label="自動儲存" defaultValue="滷肉飯很香，但湯有點鹹。" loading />
        </div>
      </Sub>

      <Sub title="Checkbox / Radio / Switch 狀態">
        <StateMatrix
          rows={[
            { key: 'checkbox', label: 'checkbox' },
            { key: 'checkbox-on', label: 'checked' },
            { key: 'radio', label: 'radio' },
            { key: 'switch', label: 'switch' },
          ]}
          render={(row, s) => {
            if (s === 'loading' && row !== 'switch') return <span className="dsp-na">不適用</span>;
            const disabled = s === 'disabled';
            const fs = s === 'hover' || s === 'focus' ? s : undefined;
            const press = s === 'active' ? 'dsp-press' : undefined;
            if (row === 'checkbox')
              return <Checkbox aria-label="範例" forceState={fs} disabled={disabled} tabIndex={-1} className={press} />;
            if (row === 'checkbox-on')
              return <Checkbox aria-label="範例" defaultChecked forceState={fs} disabled={disabled} tabIndex={-1} className={press} />;
            if (row === 'radio')
              return <Radio aria-label="範例" value="a" defaultChecked name={`radio-demo-${s}`} forceState={fs} disabled={disabled} tabIndex={-1} className={press} />;
            return (
              <Switch
                aria-label="範例"
                defaultChecked
                forceState={s === 'hover' || s === 'focus' || s === 'active' ? s : undefined}
                disabled={disabled}
                loading={s === 'loading'}
                tabIndex={-1}
              />
            );
          }}
        />
        <div className="dsp-grid dsp-grid--3">
          <div className="dsp-stack">
            <Checkbox label="我已閱讀並同意服務條款" defaultChecked />
            <Checkbox label="全選今日餐點" indeterminate description="已選 2 / 5 項" />
            <Checkbox label="必須同意才能繼續" invalid />
          </div>
          <RadioGroup label="取餐時段" value={pickup} onValueChange={setPickup}>
            <Radio value="noon" label="中午 11:30 – 12:30" />
            <Radio value="late" label="午後 12:30 – 13:30" description="人少、等候較短" />
            <Radio value="dinner" label="晚餐（尚未開放）" disabled />
          </RadioGroup>
          <div className="dsp-stack">
            <Switch label="預約提醒" description="取餐前 30 分鐘推播通知" checked={notify} onCheckedChange={setNotify} />
            <Switch label="自動續訂" labelPosition="start" />
            <Switch label="儲存中" defaultChecked loading />
          </div>
        </div>
      </Sub>
      <Guidelines
        dos={['選項 ≤ 5 個用 Radio，更多用 Select', 'Switch 用於「立即生效」的設定', 'Checkbox 用於需要按「送出」才生效的選項']}
        donts={['用 Switch 表示同意條款', '選項文字用否定句（「不要通知我」）']}
      />
    </Section>
  );
}

function TabsSection() {
  const [tab, setTab] = useState('login');
  return (
    <Section id="tabs" title="Tabs" lead="膠囊式分段控制：淡灰容器 + 白色選中塊，選中塊以 320ms 滑動。← → 鍵切換。">
      <div className="dsp-narrow">
        <Tabs
          aria-label="登入或註冊"
          fullWidth
          value={tab}
          onValueChange={setTab}
          idPrefix="dsp-auth"
          items={[
            { value: 'login', label: '登入' },
            { value: 'signup', label: '註冊' },
          ]}
        />
        <div
          role="tabpanel"
          id={`dsp-auth-panel-${tab}`}
          aria-labelledby={`dsp-auth-tab-${tab}`}
          className="dsp-tabpanel bb-body-sm bb-text-secondary"
        >
          {tab === 'login' ? '登入面板內容' : '註冊面板內容'}
        </div>
      </div>
      <div className="dsp-stack">
        <Tabs
          aria-label="訂單篩選"
          defaultValue="upcoming"
          items={[
            { value: 'upcoming', label: '即將取餐', icon: <CalendarCheck size={16} /> },
            { value: 'done', label: '已完成' },
            { value: 'transfer', label: '轉讓中' },
            { value: 'cancelled', label: '已取消', disabled: true },
          ]}
        />
        <Tabs aria-label="hover 範例" defaultValue="a" forceState={{ value: 'b', state: 'hover' }} items={[{ value: 'a', label: 'default' }, { value: 'b', label: 'hover' }, { value: 'c', label: '其他' }]} />
        <Tabs aria-label="focus 範例" defaultValue="a" forceState={{ value: 'a', state: 'focus' }} items={[{ value: 'a', label: 'focus' }, { value: 'b', label: '其他' }]} />
        <Tabs aria-label="停用範例" defaultValue="a" disabled items={[{ value: 'a', label: 'disabled' }, { value: 'b', label: '整組停用' }]} />
        <Tabs aria-label="大尺寸" size="lg" defaultValue="a" items={[{ value: 'a', label: '大尺寸 lg' }, { value: 'b', label: '44px 高' }]} />
      </div>
      <Guidelines dos={['2–4 個選項', '切換的是同一區塊的不同檢視']} donts={['當成頁面導覽列使用', '選項文字長短差太多']} />
    </Section>
  );
}

function CardSection() {
  return (
    <Section id="card" title="Card" lead="白底、細框、柔和陰影。可點的卡片 hover 上浮 2px、陰影加深。">
      <div className="dsp-grid dsp-grid--3">
        <Card>
          <p className="bb-h3">elevated（預設）</p>
          <p className="bb-body-sm bb-text-secondary">白底 + --shadow-sm</p>
        </Card>
        <Card variant="outlined">
          <p className="bb-h3">outlined</p>
          <p className="bb-body-sm bb-text-secondary">細框、無陰影，用於列表</p>
        </Card>
        <Card variant="tinted">
          <p className="bb-h3">tinted</p>
          <p className="bb-body-sm bb-text-secondary">淡橘底，用於提示、推廣</p>
        </Card>
      </div>
      <Sub title="可互動卡片狀態">
        <div className="dsp-grid dsp-grid--3">
          {(['default', 'hover', 'active', 'focus', 'disabled', 'loading'] as const).map((s) => (
            <Card
              key={s}
              as="button"
              tabIndex={-1}
              forceState={s === 'hover' || s === 'active' || s === 'focus' ? s : undefined}
              disabled={s === 'disabled'}
              loading={s === 'loading'}
            >
              {s === 'loading' ? (
                <>
                  <Skeleton width="50%" />
                  <Skeleton lines={2} />
                </>
              ) : (
                <>
                  <p className="bb-h3">{s}</p>
                  <p className="bb-body-sm bb-text-secondary">阿嬤滷肉飯・NT$ 95</p>
                </>
              )}
            </Card>
          ))}
        </div>
      </Sub>
      <Sub title="FeatureCard（登入頁四格）">
        <div className="dsp-grid dsp-grid--4">
          <FeatureCard icon={<CalendarCheck />} title="提前預約" description="前一天先訂，隔天不用排隊" />
          <FeatureCard icon={<Wallet />} title="早鳥優惠" description="越早預約越便宜" />
          <FeatureCard icon={<Ticket />} title="彈性轉讓" description="臨時不能去，轉給同學" />
          <FeatureCard icon={<Sparkles />} title="成長獎勵" description="累積預約抽好禮" />
        </div>
        <div className="dsp-grid dsp-grid--2">
          <FeatureCard layout="horizontal" interactive icon={<Store />} title="橫式 + 可互動" description="用於設定頁、功能列表" />
          <FeatureCard layout="horizontal" variant="tinted" iconTone="success" icon={<Lock />} title="tinted + success 色" description="用於狀態說明區塊" />
        </div>
      </Sub>
      <Guidelines dos={['大卡片（頁面主區塊）用 radius="lg"', '整張卡片可點時 as="button" 或 as="a"']} donts={['卡片裡再放有陰影的卡片', '在同一張卡片放多個主要按鈕']} />
    </Section>
  );
}

function BadgeSection() {
  const [selected, setSelected] = useState<string[]>(['便當']);
  const toggle = (t: string) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  return (
    <Section id="badge" title="Badge / Tag" lead="Badge 是唯讀標記（--radius-sm）；Tag 是可點的膠囊（篩選、已選條件）。">
      <Sub title="Badge：soft（預設）">
        <div className="dsp-row">
          {BADGE_TONES.map((b) => (
            <Badge key={b.tone} tone={b.tone}>
              {b.label}
            </Badge>
          ))}
        </div>
        <div className="dsp-row">
          {BADGE_TONES.map((b) => (
            <Badge key={b.tone} tone={b.tone} dot shape="pill" size="sm">
              {b.tone}
            </Badge>
          ))}
        </div>
      </Sub>
      <Sub title="Badge：solid">
        <div className="dsp-row">
          {BADGE_TONES.map((b) => (
            <Badge key={b.tone} tone={b.tone} variant="solid" icon={b.tone === 'brand' ? <Sparkles /> : undefined}>
              {b.label}
            </Badge>
          ))}
        </div>
      </Sub>
      <Sub title="Tag 狀態">
        <StateMatrix
          rows={[
            { key: 'off', label: '未選' },
            { key: 'on', label: '已選' },
          ]}
          states={['default', 'hover', 'active', 'focus', 'disabled']}
          render={(row, s) => (
            <Tag
              selected={row === 'on'}
              forceState={s === 'hover' || s === 'active' || s === 'focus' ? s : undefined}
              disabled={s === 'disabled'}
              tabIndex={-1}
            >
              素食
            </Tag>
          )}
        />
        <div className="dsp-row">
          {['便當', '麵食', '素食', '飲料', '甜點'].map((t) => (
            <Tag key={t} selected={selected.includes(t)} onClick={() => toggle(t)}>
              {t}
            </Tag>
          ))}
          <Tag icon={<Store />} onRemove={() => undefined}>
            公館商圈
          </Tag>
        </div>
      </Sub>
    </Section>
  );
}

function AvatarSection() {
  return (
    <Section id="avatar" title="Avatar" lead="圓形；圖片失效時顯示名字縮寫（中文取名字兩字）。">
      <div className="dsp-row dsp-row--center">
        <Avatar name="王小明" size="xs" />
        <Avatar name="王小明" size="sm" />
        <Avatar name="王小明" size="md" status="online" />
        <Avatar name="Amy Chen" size="lg" status="busy" />
        <Avatar name="陳小美" size="xl" status="offline" />
        <Avatar name="圖片失效" src="/not-found.png" size="lg" />
        <Avatar name="載入中" size="lg" loading />
      </div>
    </Section>
  );
}

function OverlaySection() {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fakeSubmit = () => {
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      setConfirm(false);
    }, 1500);
  };

  return (
    <Section id="overlay" title="Modal / BottomSheet" lead="Esc 關閉、焦點鎖在面板內、關閉後焦點回到觸發按鈕。手機上長內容與選單優先用 BottomSheet。">
      <div className="dsp-row">
        <Button onClick={() => setModal(true)}>開啟 Modal</Button>
        <Button variant="danger" onClick={() => setConfirm(true)}>
          危險確認（含 loading）
        </Button>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          開啟 BottomSheet
        </Button>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="預約成功！"
        description="我們會在取餐前 30 分鐘提醒你。"
        footer={
          <>
            <Button variant="outline" onClick={() => setModal(false)}>
              查看訂單
            </Button>
            <Button onClick={() => setModal(false)} data-autofocus>
              好的
            </Button>
          </>
        }
      >
        <Card variant="tinted" padding="md">
          <p className="bb-h3">阿嬤滷肉飯 × 1</p>
          <p className="bb-body-sm bb-text-secondary">明天 11:30 – 12:30・台大正門</p>
        </Card>
      </Modal>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="確定要取消預約嗎？"
        description="取消後早鳥優惠將失效，且無法復原。"
        closeOnOverlay={false}
        loading={submitting}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={submitting}>
              再想想
            </Button>
            <Button variant="danger" onClick={fakeSubmit} loading={submitting}>
              確定取消
            </Button>
          </>
        }
      />

      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="選擇取餐時段"
        description="拖曳上方把手往下可關閉"
        footer={
          <Button fullWidth size="lg" onClick={() => setSheet(false)}>
            確認
          </Button>
        }
      >
        <RadioGroup defaultValue="noon">
          <Radio value="noon" label="11:30 – 12:30" description="剩 12 份" />
          <Radio value="late" label="12:30 – 13:30" description="剩 30 份" />
          <Radio value="full" label="13:30 – 14:00" description="已額滿" disabled />
        </RadioGroup>
      </BottomSheet>

      <Sub title="靜態外觀">
        <div className="dsp-overlay-static">
          <div className="bb-modal__panel bb-modal__panel--sm dsp-static-panel">
            <div className="bb-modal__header">
              <div className="bb-modal__titles">
                <p className="bb-modal__title">Modal</p>
                <p className="bb-modal__desc">--radius-xl・--shadow-lg・最大寬 400 / 520 / 720</p>
              </div>
            </div>
            <div className="bb-modal__footer">
              <Button variant="outline" size="sm" tabIndex={-1}>
                取消
              </Button>
              <Button size="sm" tabIndex={-1}>
                確認
              </Button>
            </div>
          </div>
          <div className="bb-sheet__panel dsp-static-panel dsp-static-sheet">
            <div className="bb-sheet__handle-area">
              <span className="bb-sheet__handle" />
            </div>
            <div className="bb-sheet__header">
              <div className="bb-sheet__titles">
                <p className="bb-sheet__title">BottomSheet</p>
                <p className="bb-sheet__desc">上方圓角・把手可下拉關閉</p>
              </div>
            </div>
          </div>
        </div>
      </Sub>
      <Guidelines
        dos={['標題直接說結果或問題', '危險操作的確認鈕寫清楚動作（「確定取消」而非「確定」）', '送出中鎖住關閉，避免重複操作']}
        donts={['Modal 裡再開 Modal', '用 Modal 顯示可以放在頁面上的資訊']}
      />
    </Section>
  );
}

function ToastSection() {
  const { toast } = useToast();
  return (
    <Section id="toast" title="Toast" lead="手機從上方出現、≥768px 在右下。預設 4 秒自動消失（錯誤 6 秒），滑鼠停留時暫停。錯誤使用 role=alert。">
      <div className="dsp-row">
        <Button variant="outline" onClick={() => toast({ tone: 'success', title: '已加入購物車', description: '阿嬤滷肉飯 × 1' })}>
          成功
        </Button>
        <Button variant="outline" onClick={() => toast({ tone: 'error', title: '付款失敗', description: 'LINE Pay 連線逾時，請再試一次' })}>
          錯誤
        </Button>
        <Button variant="outline" onClick={() => toast({ tone: 'info', title: '已取消收藏', action: { label: '復原', onClick: () => undefined } })}>
          資訊 + 行動
        </Button>
        <Button variant="outline" onClick={() => toast({ tone: 'warning', title: '剩 3 份', description: '要預約的話請盡快' })}>
          警示
        </Button>
      </div>
      <div className="dsp-grid dsp-grid--2">
        <Toast tone="success" title="預約成功" description="明天 11:30 取餐" onClose={() => undefined} />
        <Toast tone="error" title="付款失敗" description="請確認卡片額度或改用其他付款方式" onClose={() => undefined} />
        <Toast tone="info" title="已取消收藏" action={{ label: '復原', onClick: () => undefined }} onClose={() => undefined} />
        <Toast tone="warning" title="即將截止" description="預約將於 10 分鐘後截止" />
      </div>
    </Section>
  );
}

function TooltipSection() {
  return (
    <Section id="tooltip" title="Tooltip" lead="hover 300ms 後出現、鍵盤 focus 立即出現、Esc 關閉。手機沒有 hover，重要資訊不能只放在 Tooltip。">
      <div className="dsp-row dsp-row--tooltip">
        <Tooltip content="早鳥價於前一天 20:00 截止" open placement="top">
          <Button variant="outline" size="sm" tabIndex={-1}>
            top
          </Button>
        </Tooltip>
        <Tooltip content="加入收藏" open placement="bottom">
          <Button variant="secondary" size="sm" iconOnly aria-label="收藏" tabIndex={-1}>
            <Heart size={16} />
          </Button>
        </Tooltip>
        <Tooltip content="轉讓給同學" open placement="right">
          <Button variant="outline" size="sm" tabIndex={-1}>
            right
          </Button>
        </Tooltip>
        <Tooltip content="移到這裡看看（hover / focus）">
          <Button variant="text">互動範例</Button>
        </Tooltip>
      </div>
    </Section>
  );
}

function EmptySection() {
  return (
    <Section id="empty" title="EmptyState" lead="插圖位置 + 標題 + 說明 + 行動按鈕；語氣溫暖，告訴使用者下一步。">
      <div className="dsp-grid dsp-grid--2">
        <Card radius="lg">
          <EmptyState
            icon={<ShoppingBag size={32} />}
            title="購物車還是空的"
            description="逛逛附近店家，把明天的午餐先訂起來吧！"
            action={<Button leftIcon={<Store size={20} />}>探索店家</Button>}
          />
        </Card>
        <Card radius="lg">
          <EmptyState
            size="compact"
            icon={<CalendarCheck size={24} />}
            title="還沒有預約紀錄"
            description="完成第一筆預約就會出現在這裡"
            action={<Button size="sm">去預約</Button>}
            secondaryAction={<Button size="sm" variant="text">了解預約流程</Button>}
          />
        </Card>
      </div>
    </Section>
  );
}

function SkeletonSection() {
  return (
    <Section id="skeleton" title="Skeleton" lead="形狀貼近真實內容。容器加 aria-busy，並放一段 .bb-sr-only 的「載入中」。">
      <div className="dsp-grid dsp-grid--3">
        {[0, 1, 2].map((i) => (
          <Card key={i} padding="none" aria-busy="true">
            <span className="bb-sr-only">店家資料載入中</span>
            <Skeleton variant="rect" height={120} radius="sm" style={{ borderRadius: 0 }} />
            <div className="dsp-skel-body">
              <div className="dsp-row dsp-row--center">
                <Skeleton variant="circle" width={32} />
                <Skeleton width="60%" />
              </div>
              <Skeleton lines={2} />
              <Skeleton width={80} height={32} radius="md" variant="rect" />
            </div>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function DividerSection() {
  return (
    <Section id="divider" title="Divider" lead="1px --border；區隔內容用，不當裝飾框線。">
      <Card>
        <p className="bb-body-sm">上方內容</p>
        <Divider />
        <p className="bb-body-sm">solid（預設）</p>
        <Divider variant="dashed" />
        <p className="bb-body-sm">dashed：收據、票券撕線感</p>
        <Divider label="或" />
        <div className="dsp-row dsp-row--center" style={{ height: 24 }}>
          <span className="bb-body-sm">店家</span>
          <Divider orientation="vertical" spacing="sm" />
          <span className="bb-body-sm">菜單</span>
          <Divider orientation="vertical" spacing="sm" />
          <span className="bb-body-sm">評價</span>
        </div>
      </Card>
    </Section>
  );
}

const MENU = [
  { name: '阿嬤滷肉飯', desc: '慢火滷足 6 小時，肥瘦剛好', price: 95, badge: '早鳥價' },
  { name: '日式豬排便當', desc: '現炸厚切豬排，附三樣配菜', price: 135 },
  { name: '番茄牛肉麵', desc: '牛骨湯頭加整顆番茄燉煮', price: 150, badge: '剩 3 份' },
  { name: '蔬食咖哩飯', desc: '根莖蔬菜與椰奶，微辣', price: 110 },
];

function ShowcaseSection() {
  return (
    <Section
      id="showcase"
      title="版面範例"
      lead="滿版色帶、菜單列表、統計數字。切換上方「風格」比較 classic 與 cafe。"
    >
      <div className="dsp-band dsp-band--inverse">
        <Coffee size={24} aria-hidden="true" />
        <p className="bb-h1 dsp-band__statement">
          前一天先訂好，隔天不用排隊，<br />
          把午休留給<span className="dsp-band__chip">好好吃飯</span>這件事。
        </p>
        <p className="bb-body-sm">BunnBaa 飯飽從一個念頭開始：讓每個人都能準時吃到一頓熱騰騰的午餐。</p>
      </div>
      <div className="dsp-band dsp-band--accent" aria-hidden="true">
        <span>早鳥優惠中</span>・<span>明天 10:30 前免費取消</span>・<span>轉讓給同學也可以</span>・<span>早鳥優惠中</span>
      </div>

      <div className="dsp-menu">
        <div className="dsp-menu__head">
          <IconBox>
            <Utensils />
          </IconBox>
          <p className="bb-h1">本週最受歡迎</p>
          <div className="dsp-row">
            {['便當', '麵食', '素食', '飲料'].map((t, i) => (
              <Tag key={t} selected={i === 0}>
                {t}
              </Tag>
            ))}
          </div>
        </div>
        <ul className="dsp-menu__list">
          {MENU.map((m) => (
            <li key={m.name} className="dsp-menu__item">
              <span className="dsp-menu__photo" aria-hidden="true">
                <Utensils size={24} />
                {m.badge && (
                  <Badge tone="brand" size="sm" className="dsp-menu__badge">
                    {m.badge}
                  </Badge>
                )}
              </span>
              <div className="dsp-menu__text">
                <p className="bb-h3">{m.name}</p>
                <p className="bb-body-sm bb-text-secondary">{m.desc}</p>
              </div>
              <span className="bb-h3 bb-num">NT$ {m.price}</span>
            </li>
          ))}
        </ul>
        <div className="dsp-row dsp-row--center dsp-menu__foot">
          <Button variant="secondary">看完整菜單</Button>
          <Button>立即預約</Button>
        </div>
      </div>

      <div className="dsp-stats">
        {[
          ['12K', '份午餐已送達'],
          ['38', '家合作店家'],
          ['4.9', '平均評分'],
        ].map(([n, l]) => (
          <div key={l} className="dsp-stats__item">
            <span className="bb-display bb-num">{n}</span>
            <span className="bb-body-sm bb-text-secondary">{l}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   頁面
   ══════════════════════════════════════════════════════════════════════════ */

export default function DesignSystemPreview() {
  const [theme, setTheme] = useState<BbTheme>(() => {
    try {
      return (localStorage.getItem('bb-ds-theme') as BbTheme) || 'light';
    } catch {
      return 'light';
    }
  });
  // 風格切換的是整站狀態（外層 SiteThemeRoot 與 <html>），離開本頁時還原預設
  const { look, setLook } = useSiteLook();
  useEffect(() => () => setLook(DEFAULT_SITE_LOOK), [setLook]);
  const { ref, read } = useTokenReader(`${theme}-${look}`);

  useEffect(() => {
    try {
      localStorage.setItem('bb-ds-theme', theme);
    } catch {
      /* 無痕模式等情況，忽略 */
    }
  }, [theme]);

  useEffect(() => {
    document.title = 'BunnBaa 設計系統';
  }, []);

  return (
    <ThemeRoot theme={theme} look={look} className="dsp" ref={ref}>
      <ToastProvider>
        <header className="dsp-top">
          <div className="dsp-top__inner">
            <div className="dsp-brand">
              <span className="dsp-logo" aria-label="BunnBaa">
                <span className="dsp-logo__bunn">Bunn</span>
                <span className="dsp-logo__baa">Baa</span>
              </span>
              <span className="dsp-brand__sub">飯飽 Design System</span>
            </div>
            <div className="dsp-top__switches">
            <Tabs
              aria-label="風格"
              value={look}
              onValueChange={(v) => setLook(v as BbLook)}
              items={[
                { value: 'classic', label: 'Classic' },
                { value: 'cafe', label: 'Cafe', icon: <Coffee size={16} /> },
              ]}
            />
            <Tabs
              aria-label="主題"
              value={theme}
              onValueChange={(v) => setTheme(v as BbTheme)}
              items={[
                { value: 'light', label: '淺色', icon: <Sun size={16} /> },
                { value: 'dark', label: '深色', icon: <Moon size={16} /> },
              ]}
            />
            </div>
          </div>
          <nav className="dsp-nav" aria-label="章節">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#/design-system`} onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}>
                {s.label}
              </a>
            ))}
          </nav>
        </header>

        <main className="dsp-main">
          <div className="dsp-hero">
            <p className="bb-display bb-text-brand">溫暖、療癒、親切</p>
            <p className="bb-body bb-text-secondary">
              奶油底色 + 棕橘品牌色、大圓角、柔和暖色陰影、線條 icon、充足留白。所有元件從{' '}
              <code>@/components/ds</code> 匯入，並放在 <code>&lt;ThemeRoot&gt;</code> 之內。
            </p>
          </div>

          <ShowcaseSection />
          <ColorSection read={read} />
          <ContrastSection read={read} />
          <TypographySection />
          <SpacingSection />
          <RadiusSection read={read} />
          <ShadowSection />
          <MotionSection />
          <IconSection />
          <BreakpointSection />
          <ButtonSection />
          <InputSection />
          <FormControlsSection />
          <TabsSection />
          <CardSection />
          <BadgeSection />
          <AvatarSection />
          <OverlaySection />
          <ToastSection />
          <TooltipSection />
          <EmptySection />
          <SkeletonSection />
          <DividerSection />
        </main>
      </ToastProvider>
    </ThemeRoot>
  );
}
