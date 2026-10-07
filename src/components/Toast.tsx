'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';

type Kind = 'info' | 'success' | 'error';
type Toast = { id: number; msg: string; kind: Kind };

const ToastContext = createContext<{ push: (msg: string, kind?: Kind) => void }>({ push: () => {} });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((msg: string, kind: Kind = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
