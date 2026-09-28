import { createContext, useContext } from 'react';

// Kept separate from ToastProvider so the provider file exports only a
// component (react-refresh rule).
export const ToastContext = createContext(null);

/**
 * Access the global toast/confirm API:
 *   const { success, error, confirm } = useToast();
 *   success('Zapisano');
 *   error('Nie udało się zapisać.');
 *   if (await confirm('Usunąć tę kategorię?', { confirmLabel: 'Usuń' })) { ... }
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
