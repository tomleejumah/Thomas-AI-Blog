"use client";

import { useEffect, useState } from "react";

export type ToastKind = "ok" | "err";

type ToastItem = {
  id: number;
  kind: ToastKind;
  text: string;
};

type Listener = (item: ToastItem) => void;

const listeners = new Set<Listener>();
let seq = 0;

export function toast(kind: ToastKind, text: string) {
  const item: ToastItem = { id: ++seq, kind, text: text.trim() || "Done" };
  listeners.forEach((fn) => fn(item));
}

export function toastOk(text: string) {
  toast("ok", text);
}

export function toastErr(text: string) {
  toast("err", text);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast: Listener = (item) => {
      setItems((prev) => [...prev.slice(-4), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== item.id));
      }, 5600);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toast-host" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <p>{t.text}</p>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
