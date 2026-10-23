import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import userEvent from '@testing-library/user-event';
import ToastProvider from './ToastProvider';
import { useToast } from './ToastContext';

// AGENTS.md §7.5: every user notification goes through useToast() — no native alert/confirm.
// The hook lives in ToastContext.js (no JSX) and the provider in ToastProvider.jsx; the split
// is what keeps the react-refresh lint rule satisfied, so both are exercised together here.

function Probe() {
  const { success, error, confirm } = useToast();
  return (
    <div>
      <button type="button" onClick={() => success('Zapisano')}>ok</button>
      <button type="button" onClick={() => error('Błąd')}>fail</button>
      <button type="button" onClick={() => confirm('Usunąć?', { confirmLabel: 'Usuń' })}>ask</button>
      <button type="button" onClick={() => confirm('Przenieść?', { danger: false, confirmLabel: 'Tak' })}>ask-safe</button>
    </div>
  );
}

const btn = (n) => screen.getByRole('button', { name: n });

// Real timers by default: userEvent and findBy* poll with real timers. The auto-dismiss
// case installs fake timers locally so the 3.5 s window can be advanced without waiting.
beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts', () => {
  it('success renders the message with role=status (announced to screen readers)', async () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => btn('ok').click());
    expect(await screen.findByRole('status')).toHaveTextContent('Zapisano');
  });

  it('error renders the message', async () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => btn('fail').click());
    expect(await screen.findByRole('status')).toHaveTextContent('Błąd');
  });

  it('auto-dismisses after 3.5 s + 200 ms exit', async () => {
    vi.useFakeTimers();
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => btn('ok').click());
    act(() => { vi.runAllTimers(); });   // 3.5 s dismiss + 200 ms exit
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the manual close button dismisses immediately', async () => {
    vi.useFakeTimers();
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => btn('ok').click());
    const toast = screen.getByRole('status');
    act(() => toast.querySelector('button').click());
    act(() => { vi.runAllTimers(); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stacks at most 4 toasts (max 4, per §7.5)', async () => {
    function Many() {
      const { success } = useToast();
      return <button type="button" onClick={() => ['a', 'b', 'c', 'd', 'e'].forEach(success)}>push</button>;
    }
    render(<ToastProvider><Many /></ToastProvider>);
    act(() => btn('push').click());
    expect(screen.getAllByRole('status')).toHaveLength(4);
  });

  it('the newest toast wins the stack', async () => {
    function Many() {
      const { success } = useToast();
      return <button type="button" onClick={() => ['a', 'b', 'c', 'd', 'e'].forEach(success)}>push</button>;
    }
    render(<ToastProvider><Many /></ToastProvider>);
    act(() => btn('push').click());
    const texts = screen.getAllByRole('status').map((t) => t.textContent);
    expect(texts[texts.length - 1]).toContain('e');
    expect(texts).not.toContain('a');
  });

  it('Polish text is rendered verbatim (no escaping of diacritics)', async () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => btn('ok').click());
    expect(await screen.findByRole('status')).toHaveTextContent('Zapisano');
  });
});

describe('confirm', () => {
  it('resolves true on the confirm button', async () => {
    const user = userEvent.setup();
    let result = null;
    function Ask() {
      const { confirm } = useToast();
      return <button type="button" onClick={() => confirm('Usunąć?').then((v) => { result = v; })}>ask</button>;
    }
    render(<ToastProvider><Ask /></ToastProvider>);
    await user.click(btn('ask'));
    await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => expect(result).toBe(true));
  });

  it('resolves false on cancel', async () => {
    const user = userEvent.setup();
    let result = null;
    function Ask() {
      const { confirm } = useToast();
      return <button type="button" onClick={() => confirm('Usunąć?').then((v) => { result = v; })}>ask</button>;
    }
    render(<ToastProvider><Ask /></ToastProvider>);
    await user.click(btn('ask'));
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => expect(result).toBe(false));
  });

  it('resolves false on Escape', async () => {
    const user = userEvent.setup();
    let result = null;
    function Ask() {
      const { confirm } = useToast();
      return <button type="button" onClick={() => confirm('Usunąć?').then((v) => { result = v; })}>ask</button>;
    }
    render(<ToastProvider><Ask /></ToastProvider>);
    await user.click(btn('ask'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(result).toBe(false));
  });

  it('resolves false when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    let result = null;
    function Ask() {
      const { confirm } = useToast();
      return <button type="button" onClick={() => confirm('Usunąć?').then((v) => { result = v; })}>ask</button>;
    }
    render(<ToastProvider><Ask /></ToastProvider>);
    await user.click(btn('ask'));
    const backdrop = document.querySelector('.backdrop-in');
    await user.click(backdrop);
    await waitFor(() => expect(result).toBe(false));
  });

  it('uses the caller labels', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Probe /></ToastProvider>);
    await user.click(btn('ask'));
    expect(screen.getByRole('button', { name: 'Usuń' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
  });

  it('is dangerous by default (red button)', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Probe /></ToastProvider>);
    await user.click(btn('ask'));
    expect(screen.getByRole('button', { name: 'Usuń' }).className).toContain('bg-red-600');
  });

  it('is green when danger is explicitly off', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Probe /></ToastProvider>);
    await user.click(btn('ask-safe'));
    expect(screen.getByRole('button', { name: 'Tak' }).className).toContain('bg-[#32a852]');
  });

  it('focuses the cancel button when it opens (safe default)', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Probe /></ToastProvider>);
    await user.click(btn('ask'));
    expect(screen.getByRole('button', { name: 'Anuluj' })).toHaveFocus();
  });

  it('removes the Escape listener after closing (no leak across dialogs)', async () => {
    const user = userEvent.setup();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<ToastProvider><Probe /></ToastProvider>);
    await user.click(btn('ask'));
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('the dialog is dismissed from the DOM after answering', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><Probe /></ToastProvider>);
    await user.click(btn('ask'));
    expect(screen.getByText('Usunąć?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Usuń' }));
    await waitFor(() => expect(screen.queryByText('Usunąć?')).toBeNull());
  });
});

describe('useToast', () => {
  it('throws outside the provider', () => {
    const spy = console.error;
    console.error = () => {};
    function Probe2() { useToast(); return null; }
    expect(() => render(<Probe2 />)).toThrow('useToast must be used within ToastProvider');
    console.error = spy;
  });

  it('exposes exactly success, error and confirm', () => {
    let value;
    function Probe3() {
      const v = useToast();
      // Recording during render is a side effect (react-hooks/globals); an effect is the
      // sanctioned place, and it runs before the assertions below.
      useEffect(() => { value = v; }, [v]);
      return null;
    }
    render(<ToastProvider><Probe3 /></ToastProvider>);
    expect(Object.keys(value).sort()).toEqual(['confirm', 'error', 'success']);
  });
});
