import { useEffect } from 'react';

// Small auto-dismissing popup shown on the login page after an expired token
// forced a redirect here (see api.js → setSessionExpiredHandler → App.jsx).
export default function SessionExpiredToast({ open, onDismiss }) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-sm flex items-start gap-3 p-4 bg-white border border-amber-200 shadow-lg rounded-lg dark:bg-slate-800 dark:border-amber-500/30"
    >
      <div className="shrink-0 w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center dark:bg-amber-950/60">
        <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Sesja wygasła</p>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-slate-400">Zaloguj się ponownie, aby kontynuować.</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Zamknij"
        className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
