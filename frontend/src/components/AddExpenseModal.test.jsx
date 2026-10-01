import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api';
import AddExpenseModal from './AddExpenseModal';
import ToastProvider from './ToastProvider';

// The modal is the only writer of Transactions. The contract that matters:
// type is exactly 'wydatek' / 'Przychod' (AGENTS.md §5), date is local "YYYY-MM-DD",
// tags are an array, and the payload key is camelCase `categoryId` (api.js accepts both).

const CATS = [
  { id: 1, name: 'Transport' },
  { id: 2, name: 'Jedzenie' },
];

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  const { unmount } = render(
    <ToastProvider>
      <AddExpenseModal isOpen activeCategories={CATS} onClose={onClose} onSubmit={onSubmit} {...props} />
    </ToastProvider>,
  );
  return { onClose, onSubmit, unmount };
}

const field = (label) => screen.getByLabelText(label);
const submitBtn = () => screen.getByRole('button', { name: 'Dodaj' });

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getAllTags').mockResolvedValue(['dom', 'zakupy']);
});

describe('open / closed', () => {
  it('renders nothing when closed', () => {
    const { unmount } = render(<ToastProvider><AddExpenseModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} /></ToastProvider>);
    expect(screen.queryByRole('button', { name: 'Dodaj' })).toBeNull();
    unmount();
  });

  it('has a Polish title in create mode', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'Dodaj wydatek' })).toBeInTheDocument();
  });

  it('has the edit title when an initial row is supplied', () => {
    renderModal({ initial: { id: 5, type: 'wydatek', amount: 10, date: '2026-05-10', category_id: 1, description: 'x', tags: [] } });
    expect(screen.getByRole('heading', { name: 'Edytuj transakcję' })).toBeInTheDocument();
  });

  it('prefills every field from the row being edited', () => {
    const initial = { id: 5, type: 'Przychod', amount: 900, date: '2026-05-10', category_id: 2, description: 'wypłata', tags: ['praca'] };
    renderModal({ initial });
    expect(field('Typ')).toHaveValue('Przychod');
    expect(field('Kwota')).toHaveValue(900);  // number input: toHaveValue parses to a number
    expect(field('Data')).toHaveValue('2026-05-10');
    expect(field('Opis')).toHaveValue('wypłata');
    expect(field(/Tagi/)).toHaveValue('praca');
    expect(field('Kategoria')).toHaveValue('2');
  });

  it('defaults the date to today (local), not the UTC date', () => {
    renderModal();
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(field('Data')).toHaveValue(expected);
  });

  it('defaults the type to wydatek', () => {
    renderModal();
    expect(field('Typ')).toHaveValue('wydatek');
  });
});

describe('tag suggestions', () => {
  it('fetches known tags when the modal opens (audit P0-22)', async () => {
    renderModal();
    await waitFor(() => expect(api.getAllTags).toHaveBeenCalled());
    const list = document.getElementById('known-tags');
    expect(list).toBeInTheDocument();
    expect(list.querySelectorAll('option')).toHaveLength(2);
  });

  it('does not fetch while closed', () => {
    render(<ToastProvider><AddExpenseModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} /></ToastProvider>);
    expect(api.getAllTags).not.toHaveBeenCalled();
  });

  it('a failed tag fetch leaves the field usable', async () => {
    api.getAllTags.mockRejectedValue(new Error('boom'));
    renderModal();
    await waitFor(() => expect(api.getAllTags).toHaveBeenCalled());
    expect(document.getElementById('known-tags')).toBeNull();
    expect(field(/Tagi/)).toHaveValue('');
  });
});

describe('submit', () => {
  async function fillAndSubmit(overrides = {}) {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderModal();
    await user.selectOptions(field('Kategoria'), '1');
    await user.type(field('Kwota'), overrides.amount ?? '42.5');
    if (overrides.tags) await user.type(field(/Tagi/), overrides.tags);
    await user.click(submitBtn());
    return { onSubmit, onClose };
  }

  it('sends the payload the parent expects', async () => {
    const { onSubmit } = await fillAndSubmit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toEqual({
      type: 'wydatek', amount: 42.5, description: null,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      categoryId: '1', tags: [],
    });
  });

  it('closes after a successful submit', async () => {
    const { onClose } = await fillAndSubmit();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the capital-P Przychod exactly (CHECK constraint)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.selectOptions(field('Kategoria'), '1');
    await user.selectOptions(field('Typ'), 'Przychod');
    await user.type(field('Kwota'), '900');
    await user.click(submitBtn());
    expect(onSubmit.mock.calls[0][0].type).toBe('Przychod');
  });

  it('splits the comma-separated tag field into an array', async () => {
    const { onSubmit } = await fillAndSubmit({ tags: 'dom, zakupy' });
    expect(onSubmit.mock.calls[0][0].tags).toEqual(['dom', 'zakupy']);
  });

  it('drops empty tags from a sloppy tag string', async () => {
    const { onSubmit } = await fillAndSubmit({ tags: 'dom,, zakupy, ' });
    expect(onSubmit.mock.calls[0][0].tags).toEqual(['dom', 'zakupy']);
  });

  it('trims the description and sends null when blank', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.selectOptions(field('Kategoria'), '1');
    await user.type(field('Kwota'), '10');
    await user.type(field('Opis'), '   ');
    await user.click(submitBtn());
    expect(onSubmit.mock.calls[0][0].description).toBeNull();
  });
});

describe('validation', () => {
  it('refuses a missing category with a Polish toast and no submit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.type(field('Kwota'), '10');
    await user.click(submitBtn());
    expect(await screen.findByText('Wybierz kategorię')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses zero with a Polish toast (P0-16: NaN used to reach the backend)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.selectOptions(field('Kategoria'), '1');
    await user.type(field('Kwota'), '0');
    await user.click(submitBtn());
    expect(await screen.findByText(/Podaj poprawną kwotę/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a negative amount is blocked by native validation (min=0) before the JS guard', async () => {
    // jsdom implements constraint validation like a browser: the form does not submit, so
    // the toast path is unreachable for negatives. Pin the guard that does the work.
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.selectOptions(field('Kategoria'), '1');
    await user.type(field('Kwota'), '-5');
    const input = field('Kwota');
    expect(input.value).toBe('-5');
    // jsdom exposes ValidityState.valid (the flags themselves are not enumerable), which is
    // what blocks the submit: -5 is under min="0".
    expect(input.validity.valid).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('the JS guard still fires when the form is submitted programmatically', () => {
    // fireEvent.submit bypasses constraint validation, which is what a browser extension
    // or a scripted submit does; the toast is the second line of defence.
    const { onSubmit } = renderModal();
    fireEvent.change(field('Kategoria'), { target: { value: '1' } });
    fireEvent.change(field('Kwota'), { target: { value: '-5' } });
    fireEvent.submit(submitBtn());
    expect(screen.getByText(/Podaj poprawną kwotę/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts decimals', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    await user.selectOptions(field('Kategoria'), '1');
    await user.type(field('Kwota'), '120.50');
    await user.click(submitBtn());
    expect(onSubmit.mock.calls[0][0].amount).toBe(120.5);
  });
});

describe('cancel and escape', () => {
  it('Anuluj resets the form and closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.type(field('Opis'), 'tekst');
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(onClose).toHaveBeenCalled();
    // Remounting (the parent keys the modal) must not resurrect the typed text.
    expect(field('Opis')).toHaveValue('');
    expect(field('Typ')).toHaveValue('wydatek');
    expect(field('Kwota').value).toBe('');
    expect(field('Kategoria')).toHaveValue('');
  });

  it('Escape closes', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape does nothing while closed', () => {
    const onClose = vi.fn();
    render(<ToastProvider><AddExpenseModal isOpen={false} onClose={onClose} onSubmit={vi.fn()} /></ToastProvider>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking the backdrop closes, clicking the panel does not', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole('heading', { name: 'Dodaj wydatek' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(field('Opis'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector('.fixed.inset-0.z-50') ?? screen.getByRole('heading').closest('div'));
    expect(onClose).toHaveBeenCalled();
  });

  it('the header X closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Polish UI', () => {
  it('every field label is Polish', () => {
    renderModal();
    for (const label of ['Typ', 'Opis', 'Kwota', 'Data', 'Kategoria']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('(po przecinku)')).toBeInTheDocument();
  });

  it('the category dropdown has a Polish placeholder option', () => {
    renderModal();
    expect(screen.getByRole('option', { name: '-- Wybierz kategorię --' })).toBeInTheDocument();
  });

  it('type options are Polish with the exact backend values', () => {
    renderModal();
    expect(screen.getByRole('option', { name: 'Wydatek' })).toHaveValue('wydatek');
    expect(screen.getByRole('option', { name: 'Przychod' })).toHaveValue('Przychod');
  });

  it('the amount input floors at zero with cent precision', () => {
    renderModal();
    const input = field('Kwota');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('step', '0.01');
    expect(input).toHaveAttribute('required');
  });
});
