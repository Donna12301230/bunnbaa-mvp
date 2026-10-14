import { tr } from "@/lib/i18n";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Replaces the browser's native confirm(): the design system requires a Modal for destructive actions,
// with a title that states the question and a confirm button that names the action ("Delete" rather than "OK")
export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

// Replaces the browser's native prompt() (2026-10-09): same dialog plus a text field; Cancel returns null
export type PromptOptions = ConfirmOptions & { inputLabel: string; placeholder?: string; defaultValue?: string };
type PromptFn = (options: PromptOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);
const PromptContext = createContext<PromptFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<(ConfirmOptions & Partial<PromptOptions>) | null>(null);
  const [text, setText] = useState("");
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const prompt = useCallback<PromptFn>((opts) => {
    setText(opts.defaultValue ?? "");
    setOptions(opts);
    return new Promise<string | null>((resolve) => {
      resolver.current = (ok) => resolve(ok ? textRef.current : null);
    });
  }, []);
  const textRef = useRef("");
  textRef.current = text;

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
    <PromptContext.Provider value={prompt}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => { if (!open) close(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description && <DialogDescription>{options.description}</DialogDescription>}
          </DialogHeader>
          {options?.inputLabel !== undefined && (
            <Textarea aria-label={options.inputLabel} placeholder={options.placeholder ?? options.inputLabel} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={300} />
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => close(false)}>
              {options?.cancelLabel ?? tr("取消", "Cancel")}
            </Button>
            <Button variant={options?.destructive ? "destructive" : "default"} onClick={() => close(true)}>
              {options?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}

export function usePrompt(): PromptFn {
  const prompt = useContext(PromptContext);
  if (!prompt) throw new Error("usePrompt must be used inside <ConfirmProvider>");
  return prompt;
}
