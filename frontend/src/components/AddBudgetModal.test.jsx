import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api';
import AddBudgetModal from './AddBudgetModal';

// The modal had a TDZ ReferenceError: `selectedCatId` was derived from `effectiveCats`
// above its declaration, so every render crashed with
// "Cannot access 'effectiveCats' before initialization". The first test is the regression net.

const CATS = [
  { id: 1, name: 'Transport', icon: '🚗', color: '#3498db' },
  { id: 2, name: 'Jedzenie', icon: '🍔', color: '#e74c3c' },
];

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  render(
    <AddBudgetModal
      monthStr="2026-05"
      categories={CATS}
      onClose={onClose}
      onAdded={onAdded}
      {...props}
    />,
  );
  return { onClose, onAdded };
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getCategories').mockResolvedValue(CATS);
  vi.spyOn(api, 'createBudget').mockResolvedValue({ id: 1 });
});

describe('render', () => {
  it('renders without crashing (TDZ regression)', () => {
    renderModal();
    expect(screen.getByRole('heading', { name: 'Nowy budżet' })).toBeInTheDocument();
  });

  it('lists every category passed in', () => {
    renderModal();
    expect(screen.getByTitle('Transport')).toBeInTheDocument();
    expect(screen.getByTitle('Jedzenie')).toBeInTheDocument();
  });

  it('shows the Polish empty-state when the user has no categories at all', async () => {
    api.getCategories.mockResolvedValue([]);
    renderModal({ categories: [] });
    expect(await screen.findByText(/Brak kategorii/)).toBeInTheDocument();
  });

  it('shows a spinner while the fallback fetch is in flight (no empty-state flash)', async () => {
    let resolve;
    api.getCategories.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderModal({ categories: [] });
    expect(screen.queryByText(/Brak kategorii/)).toBeNull();
    await act(async () => { resolve(CATS); });
    expect(await screen.findByTitle('Transport')).toBeInTheDocument();
  });

  it('fetches categories itself when the prop is empty (race guard)', async () => {
    renderModal({ categories: [] });
    await waitFor(() => expect(api.getCategories).toHaveBeenCalledWith(true));
    expect(await screen.findByTitle('Transport')).toBeInTheDocument();
  });

  it('does not refetch when categories are already provided', () => {
    renderModal();
    expect(api.getCategories).not.toHaveBeenCalled();
  });

  it('shows a Polish error when the category fetch fails', async () => {
    api.getCategories.mockRejectedValue(new Error('boom'));
    renderModal({ categories: [] });
    expect(await screen.findByText(/Nie udało się załadować kategorii/)).toBeInTheDocument();
  });

  it('preselects the first category (derived, not a setState in an effect)', () => {
    renderModal();
    expect(screen.getByTitle('Transport').className).toContain('bg-[#32a852]');
    expect(screen.getByTitle('Jedzenie').className).not.toContain('bg-[#32a852]');
  });

  it('the picked category wins over the default', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTitle('Jedzenie'));
    expect(screen.getByTitle('Jedzenie').className).toContain('bg-[#32a852]');
    expect(screen.getByTitle('Transport').className).not.toContain('bg-[#32a852]');
  });
});

describe('submit', () => {
  it('sends the API shape with the selected category and the modal month', async () => {
    const user = userEvent.setup();
    const { onAdded, onClose } = renderModal();
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '500');
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    await waitFor(() => expect(api.createBudget).toHaveBeenCalled());
    expect(api.createBudget).toHaveBeenCalledWith({
      category_id: 1, amount_monthly: 500, month_year: '2026-05',
    });
    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the picked category, not the first one', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByTitle('Jedzenie'));
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '300');
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    await waitFor(() => expect(api.createBudget).toHaveBeenCalled());
    expect(api.createBudget.mock.calls[0][0].category_id).toBe(2);
  });

  it('rejects zero with a Polish message and makes no request', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '0');
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    expect(await screen.findByText('Kwota musi być większa od 0')).toBeInTheDocument();
    expect(api.createBudget).not.toHaveBeenCalled();
  });

  it('rejects an empty amount', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    expect(await screen.findByText('Kwota musi być większa od 0')).toBeInTheDocument();
    expect(api.createBudget).not.toHaveBeenCalled();
  });

  it('accepts decimals', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '120.50');
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    await waitFor(() => expect(api.createBudget).toHaveBeenCalled());
    expect(api.createBudget.mock.calls[0][0].amount_monthly).toBe(120.5);
  });

  it('surfaces the backend error in Polish and stays open', async () => {
    api.createBudget.mockRejectedValue(new Error('Nie znaleziono kategorii'));
    const { onClose } = renderModal();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '500');
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    expect(await screen.findByText('Nie znaleziono kategorii')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('typing clears the previous error', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    await screen.findByText('Kwota musi być większa od 0');
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '50');
    expect(screen.queryByText('Kwota musi być większa od 0')).toBeNull();
  });

  it('disables the buttons while saving and shows a Polish progress label', async () => {
    let resolve;
    api.createBudget.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText('Kwota budżetu (PLN)'), '500');
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    expect(screen.getByRole('button', { name: 'Dodaję…' })).toBeDisabled();
    resolve({ id: 1 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodaj budżet' })).not.toBeDisabled());
  });
});

describe('dismissal', () => {
  it('Escape closes the modal', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Anuluj closes without saving', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.createBudget).not.toHaveBeenCalled();
  });

  it('the header X closes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes, clicking the panel does not', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.click(screen.getByRole('heading', { name: 'Nowy budżet' }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector('.backdrop-in').parentElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('removes its Escape listener on unmount (no leak across modals)', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<AddBudgetModal monthStr="2026-05" categories={CATS} onClose={vi.fn()} onAdded={vi.fn()} />);
    unmount();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

describe('Polish UI', () => {
  it('every visible label is Polish', () => {
    renderModal();
    const text = screen.getByRole('heading', { name: 'Nowy budżet' }).textContent;
    expect(text).toBe('Nowy budżet');
    expect(screen.getByLabelText('Kwota budżetu (PLN)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj budżet' })).toBeInTheDocument();
  });

  it('the amount input is a number with a zero floor', () => {
    renderModal();
    const input = screen.getByLabelText('Kwota budżetu (PLN)');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('step', '0.01');
  });
});
