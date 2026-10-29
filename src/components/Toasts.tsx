import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Undo2, X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  undo?: () => Promise<void> | void;
}

interface ToastOptions {
  undo?: () => Promise<void> | void;
  kind?: 'info' | 'error';
}

type ToastFn = (message: string, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());
  const nextId = useRef(1);
  const listRef = useRef(toasts);
  listRef.current = toasts;

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, window.setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const ms = opts.undo ? 7000 : opts.kind === 'error' ? 6000 : 2500;
      // Repeated plain messages (e.g. "Saved" while typing) refresh instead of stacking.
      const same = !opts.undo && listRef.current.find((t) => t.message === message && !t.undo);
      if (same) return schedule(same.id, ms);
      const id = nextId.current++;
      schedule(id, ms);
      setToasts((list) => [...list.slice(-3), { id, message, kind: opts.kind ?? 'info', undo: opts.undo }]);
    },
    [schedule],
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}>
            <span>{t.message}</span>
            {t.undo && (
              <button
                className="toast-undo"
                onClick={async () => {
                  dismiss(t.id);
                  await t.undo!();
                  toast('Undone');
                }}
              >
                <Undo2 size={14} /> Undo
              </button>
            )}
            <button className="icon-btn toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
