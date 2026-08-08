import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type ToastTone = "ok" | "err" | "info";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

let pushToastExternal: ((message: string, tone?: ToastTone) => void) | null =
  null;

/** Call from any component — shows a floating toast (mobile-safe). */
export function showToast(message: string, tone: ToastTone = "ok") {
  if (pushToastExternal) pushToastExternal(message, tone);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "ok") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  useEffect(() => {
    pushToastExternal = push;
    return () => {
      pushToastExternal = null;
    };
  }, [push]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="toast-host" aria-live="polite" aria-relevant="additions">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role="status">
          <span className="toast-icon" aria-hidden>
            {t.tone === "ok" ? "✓" : t.tone === "err" ? "!" : "i"}
          </span>
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}
