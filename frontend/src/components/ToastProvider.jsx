import { useCallback, useEffect, useRef, useState } from 'react';
import { ToastContext } from './ToastContext';

let nextToastId = 1;

/**
 * Global toast + confirm provider (see useToast in ./ToastContext).
 *
 * Toasts stack top-right (max 4), auto-dismiss after 3.5 s, slide down on
 * enter / up on exit. `confirm` renders a small modal and resolves with a
 * boolean; Escape resolves false. All strings are rendered as-is — callers
 * pass Polish UI text.
 */
export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const cancelRef = useRef(null);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 200);
  }, []);

  const push = useCallback((type, message) => {
    const id = nextToastId;
    nextToastId += 1;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  const success = useCallback((message) => push('success', message), [push]);
  const error = useCallback((message) => push('error', message), [push]);

  const confirm = useCallback((message, options = {}) => new Promise((resolve) => {
    setConfirmState({
      message,
      title: options.title || 'Potwierdź',
      confirmLabel: options.confirmLabel || 'Potwierdź',
      cancelLabel: options.cancelLabel || 'Anuluj',
      danger: options.danger !== false,
      resolve,
    });
  }), []);

  const closeConfirm = useCallback((value) => {
    setConfirmState((state) => {
      if (state) state.resolve(value);
      return null;
    });
  }, []);

  // Escape cancels the confirm dialog.
  useEffect(() => {
    if (!confirmState) return undefined;
    const handler = (e) => { if (e.key === 'Escape') closeConfirm(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [confirmState, closeConfirm]);

  // Focus the cancel button when the confirm dialog opens (safe default).
  useEffect(() => {
    if (confirmState) cancelRef.current?.focus();
  }, [confirmState]);

  return (
    <ToastContext.Provider value={{ success, error, confirm }}>
      {children}

      {/* Toast stack */}
      <div className="fixed top-4 right-4 z-[300] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-lg bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 ${
              t.leaving ? 'toast-exit' : 'toast-enter'
            }`}
          >
            {t.type === 'success' ? (
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-[#32a852]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <p className="flex-1 text-sm font-medium text-gray-800 dark:text-slate-200">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
              aria-label="Zamknij powiadomienie"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Confirm dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm backdrop-in" onClick={() => closeConfirm(false)} />
          <div className="modal-panel-in relative w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 shadow-2xl p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">{confirmState.title}</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{confirmState.message}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => closeConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-200 transition-colors"
              >
                {confirmState.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => closeConfirm(true)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white shadow-md transition-colors ${
                  confirmState.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[#32a852] hover:bg-[#1f8c42]'
                }`}
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
