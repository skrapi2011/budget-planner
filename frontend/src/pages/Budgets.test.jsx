import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api';
import Budgets from './Budgets';
import { renderWithProviders, settle } from '../test/renderPage';
import { currentMonthStr, monthLabel } from '../utils/date';
import * as dateUtils from '../utils/date';

// The page is the only writer of Budgets. What matters: the month filter drives the request,
// a slow response for an older month must not overwrite the newer one (audit P1-51), and the
// delete path added in audit P1-48 exists for every budget row.

const BUD = [
  { cat_id: 1, category_id: 1, category_name: 'Transport', id: 10, budzet: 500, wydatki: 200, saldo: 300, status: 'in_budget', color: '#e74c3c', icon: '🚗' },
  { cat_id: 2, category_id: 2, category_name: 'Jedzenie', id: 11, budzet: 100, wydatki: 90, saldo: 10, status: 'in_budget', color: '#2ecc71', icon: '🍔' },
  { cat_id: 3, category_id: 3, category_name: 'Media', id: 12, budzet: 100, wydatki: 150, saldo: -50, status: 'over_budget', color: '#3498db', icon: '💡' },
];
const CATS = [{ id: 1, name: 'Transport' }, { id: 2, name: 'Jedzenie' }, { id: 3, name: 'Media' }, { id: 4, name: 'Inne' }];

const monthHeading = () => screen.getByRole('heading', { level: 2 });

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getBudgetsViewByMonth').mockResolvedValue(BUD);
  vi.spyOn(api, 'getCategories').mockResolvedValue(CATS);
  vi.spyOn(api, 'updateBudget').mockResolvedValue({});
  vi.spyOn(api, 'createBudget').mockResolvedValue({});
  vi.spyOn(api, 'deleteBudget').mockResolvedValue({ deleted: true });
  vi.spyOn(dateUtils, 'currentMonthStr').mockImplementation(() => new Date().toISOString().slice(0, 7));
});

async function renderAndLoad() {
  renderWithProviders(<Budgets />);
  await screen.findByText('Transport');
}

// Animation assertions below run on fake timers; never leak them into the next case.
afterEach(() => vi.useRealTimers());

// Render + flush promises + all animation frames in one step (see test/renderPage.jsx).
function renderLoaded() {
  vi.useFakeTimers();
  renderWithProviders(<Budgets />);
  return settle();
}

describe('loading', () => {
  it('requests the current month on mount', async () => {
    await renderAndLoad();
    expect(api.getBudgetsViewByMonth).toHaveBeenCalledWith(currentMonthStr());
  });

  it('shows the Polish month heading', async () => {
    await renderAndLoad();
    expect(monthHeading()).toHaveTextContent(monthLabel(currentMonthStr()));
  });

  it('shows the Polish empty state when there are no budgets', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([]);
    renderWithProviders(<Budgets />);
    expect(await screen.findByText(/Brak budżetów na ten miesiąc/)).toBeInTheDocument();
  });

  it('survives a failed fetch without crashing', async () => {
    api.getBudgetsViewByMonth.mockRejectedValue(new Error('boom'));
    renderWithProviders(<Budgets />);
    expect(await screen.findByText(/Brak budżetów na ten miesiąc/)).toBeInTheDocument();
  });
});

describe('month navigation', () => {
  it('the next-month button moves forward one month and refetches', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const [y, m] = currentMonthStr().split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await waitFor(() => expect(api.getBudgetsViewByMonth).toHaveBeenCalledWith(next));
    expect(monthHeading()).toHaveTextContent(monthLabel(next));
  });

  it('the previous-month button moves back one month and refetches', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const [y, m] = currentMonthStr().split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await user.click(screen.getByRole('button', { name: 'poprzedni miesiąc' }));
    await waitFor(() => expect(api.getBudgetsViewByMonth).toHaveBeenCalledWith(prev));
    expect(monthHeading()).toHaveTextContent(monthLabel(prev));
  });

  it('stepping back from January lands on December of the previous year', async () => {
    const user = userEvent.setup();
    // Pin "today" to January so the year boundary is reachable from the initial month.
    vi.spyOn(dateUtils, 'currentMonthStr').mockReturnValue('2026-01');
    renderWithProviders(<Budgets />);
    await screen.findByText('Transport');
    expect(monthHeading()).toHaveTextContent('Styczeń 2026');
    await user.click(screen.getByRole('button', { name: 'poprzedni miesiąc' }));
    expect(monthHeading()).toHaveTextContent('Grudzień 2025');
    expect(api.getBudgetsViewByMonth).toHaveBeenLastCalledWith('2025-12');
  });

  it('Dziś returns to the current month', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await user.click(screen.getByRole('button', { name: 'Dziś' }));
    expect(monthHeading()).toHaveTextContent(monthLabel(currentMonthStr()));
    expect(api.getBudgetsViewByMonth).toHaveBeenLastCalledWith(currentMonthStr());
  });
});

describe('race guard (audit P1-51)', () => {
  it('a slow response for an older month does not overwrite the newer month', async () => {
    const user = userEvent.setup();
    let resolveStale;
    // Month A answers empty (so the nav renders), month B hangs, month C answers empty.
    // The default is set first so the third call (Dziś) is also empty, not the beforeEach BUD.
    api.getBudgetsViewByMonth.mockResolvedValue([]);
    api.getBudgetsViewByMonth.mockResolvedValueOnce([]);
    api.getBudgetsViewByMonth.mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }));
    renderWithProviders(<Budgets />);
    await screen.findByText(/Brak budżetów/);

    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));  // hangs
    await user.click(screen.getByRole('button', { name: 'Dziś' }));              // answers now
    expect(screen.getByText(/Brak budżetów/)).toBeInTheDocument();

    // The response for the month the user left arrives last and must be dropped.
    act(() => resolveStale(BUD));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Transport')).toBeNull();
    expect(screen.getByText(/Brak budżetów/)).toBeInTheDocument();
  });

  it('the latest response wins when both resolve', async () => {
    const user = userEvent.setup();
    const late = [{ ...BUD[0], category_name: 'Nowy miesiąc' }];
    api.getBudgetsViewByMonth.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(BUD), 30)));
    api.getBudgetsViewByMonth.mockResolvedValueOnce(late);

    renderWithProviders(<Budgets />);
    await screen.findByText('Transport');           // first (slow) response lands
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    expect(await screen.findByText('Nowy miesiąc'));  // second response lands immediately
    // The slower request for the first month lands afterwards and must not resurrect its data.
    await new Promise(r => setTimeout(r, 60));
    expect(screen.queryByText('Transport')).toBeNull();
  });
});

describe('summary cards', () => {
  it('totals the budgets and the spending', async () => {
    // The card figures are count-up animated (useCountUp, 500 ms). Fake timers settle the
    // animation exactly, so the assertion does not depend on runner speed.
    await renderLoaded();
    expect(screen.getByText('Całkowity budżet')).toBeInTheDocument();
    // 500+100+100 = 700 budgeted, 200+90+150 = 440 spent, 260 left.
    expect(screen.getByText('700,00 zł')).toBeInTheDocument();
    expect(screen.getByText('440,00 zł')).toBeInTheDocument();
    expect(screen.getByText('260,00 zł')).toBeInTheDocument();
    expect(screen.getByText('Pozostało')).toBeInTheDocument();
  });

  it('shows the utilisation percentage', async () => {
    await renderLoaded();
    // 440/700 = 62.857 → "62.9%": the progress card shows the bare figure, the spent card
    // appends "wykorzystane" in the same text node, so they are two distinct nodes.
    expect(screen.getByText('62.9%')).toBeInTheDocument();
    expect(screen.getByText('62.9% wykorzystane')).toBeInTheDocument();
  });

  it('a negative remainder is shown as a Polish overrun message', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([{ cat_id: 1, category_id: 1, category_name: 'Transport', id: 10, budzet: 100, wydatki: 150, saldo: -50, status: 'over_budget' }]);
    await renderLoaded();
    expect(screen.getByText(/Przekroczono budżet o 50,00 zł/)).toBeInTheDocument();
  });
});

describe('per-category status', () => {
  it('labels an over-budget category as Przekroczony', async () => {
    await renderAndLoad();
    const media = screen.getByText('Media');
    expect(media.closest('div').parentElement).toHaveTextContent('Przekroczony');
  });

  it('labels a category at >=80% as Uwaga', async () => {
    await renderAndLoad();
    const jedzenie = screen.getByText('Jedzenie');
    expect(jedzenie.closest('div').parentElement).toHaveTextContent('Uwaga');
  });

  it('labels a healthy category as OK', async () => {
    await renderAndLoad();
    const transport = screen.getByText('Transport');
    expect(transport.closest('div').parentElement).toHaveTextContent('OK');
  });

  it('shows spent and percentage per row', async () => {
    await renderAndLoad();
    expect(screen.getByText('200,00 zł wydane')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });
});

describe('inline budget edit', () => {
  it('typing a new amount reveals the save button', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeInTheDocument();
  });

  it('Zapisz sends the parsed amount to the budget id', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(api.updateBudget).toHaveBeenCalledWith(10, { amount_monthly: 600 }));
  });

  it('Enter saves', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.updateBudget).toHaveBeenCalled());
  });

  it('reloads the budgets after saving and confirms in Polish', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Budżet zapisany')).toBeInTheDocument();
    expect(api.getBudgetsViewByMonth).toHaveBeenCalledTimes(2);
  });

  it('Anuluj restores the original value without a request', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(input).toHaveValue('500');
    expect(api.updateBudget).not.toHaveBeenCalled();
  });

  it('strips anything that is not a digit or a dot from the input', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '12ab34');
    expect(input).toHaveValue('1234');
  });

  it('an empty amount is refused with a Polish toast (audit P0-16: NaN used to reach the API)', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Podaj poprawną kwotę')).toBeInTheDocument();
    expect(api.updateBudget).not.toHaveBeenCalled();
  });

  it('a minus sign never reaches the field, so a negative budget cannot be typed', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '-5');
    // The onChange filter keeps only digits and dots, so the guard below is defence in depth.
    expect(input).toHaveValue('5');
    expect(api.updateBudget).not.toHaveBeenCalled();
  });

  it('surfaces a backend failure in Polish', async () => {
    api.updateBudget.mockRejectedValue(new Error('Nie udało się zapisać budżetu'));
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Nie udało się zapisać budżetu')).toBeInTheDocument();
  });

  it('the save button is disabled while saving and shows Zapisuję…', async () => {
    let resolveSave;
    api.updateBudget.mockImplementation(() => new Promise((r) => { resolveSave = r; }));
    const user = userEvent.setup();
    await renderAndLoad();
    const input = screen.getByDisplayValue('500');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    const btn = screen.getByRole('button', { name: 'Zapisuję…' });
    expect(btn).toBeDisabled();
    act(() => resolveSave({}));
  });
});

describe('delete (audit P1-48)', () => {
  it('every budget row exposes a delete button with a Polish accessible name', async () => {
    await renderAndLoad();
    expect(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Transport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Media' })).toBeInTheDocument();
  });

  it('a zero-limit budget row is deletable too (setting to 0 is not removing)', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([{ cat_id: 1, category_id: 1, category_name: 'Transport', id: 10, budzet: 0, wydatki: 0, saldo: 0, status: 'in_budget' }]);
    renderWithProviders(<Budgets />);
    await screen.findByText('Transport');
    expect(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Transport' })).toBeInTheDocument();
    expect(screen.getByText('Ustaw budżet dla tej kategorii')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Transport' }));
    expect(await screen.findByText(/Usuń budżet dla kategorii „Transport”\? Transakcje pozostaną nienaruszone\./)).toBeInTheDocument();
    expect(api.deleteBudget).not.toHaveBeenCalled();
  });

  it('cancelling deletes nothing', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Transport' }));
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(api.deleteBudget).not.toHaveBeenCalled();
    expect(screen.getByText('Transport')).toBeInTheDocument();
  });

  it('confirming deletes the budget id and reloads', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Transport' }));
    await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
    await waitFor(() => expect(api.deleteBudget).toHaveBeenCalledWith(10));
    expect(await screen.findByText('Budżet usunięty')).toBeInTheDocument();
    expect(api.getBudgetsViewByMonth).toHaveBeenCalledTimes(2);
  });

  it('surfaces a backend failure in Polish', async () => {
    api.deleteBudget.mockRejectedValue(new Error('Nie udało się usunąć budżetu'));
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Usuń budżet dla kategorii Transport' }));
    await user.click(screen.getByRole('button', { name: 'Potwierdź' }));
    expect(await screen.findByText('Nie udało się usunąć budżetu')).toBeInTheDocument();
  });

  it('a row without a budget id has no delete button (nothing to delete)', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([{ cat_id: 1, category_id: 1, category_name: 'Transport', id: null, budzet: 500, wydatki: 0, saldo: 500, status: 'in_budget' }]);
    renderWithProviders(<Budgets />);
    await screen.findByText('Transport');
    expect(screen.queryByRole('button', { name: /Usuń budżet/ })).toBeNull();
  });
});

describe('add-budget modal', () => {
  it('the header button opens the modal when a category has no budget', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    expect(await screen.findByRole('heading', { name: 'Nowy budżet' })).toBeInTheDocument();
  });

  it('the modal only offers categories that are missing a budget', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    await screen.findByRole('heading', { name: 'Nowy budżet' });
    // The picker is a button grid (not a <select>). Budgets exist for cats 1-3, so only
    // category 4 ("Inne") is offered — the page filters the modal's categories prop.
    const grid = document.querySelector('.grid.grid-cols-2');
    expect(grid).not.toBeNull();
    expect(Array.from(grid.querySelectorAll('button')).map(b => b.textContent.trim())).toEqual(['Inne']);
  });

  it('the empty state offers the first budget', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<Budgets />);
    await user.click(await screen.findByRole('button', { name: 'Dodaj pierwszy budżet' }));
    expect(await screen.findByRole('heading', { name: 'Nowy budżet' })).toBeInTheDocument();
  });

  it('the modal is mounted with the month currently being viewed', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await user.click(screen.getByRole('button', { name: 'Dodaj budżet' }));
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).not.toContain(monthLabel(currentMonthStr()));
    expect(heading).toBeInTheDocument();
  });
});

describe('Polish UI', () => {
  it('the section heading and card labels are Polish', async () => {
    await renderAndLoad();
    expect(screen.getByRole('heading', { name: 'Budżety kategorii' })).toBeInTheDocument();
    for (const label of ['Całkowity budżet', 'Wydane łącznie', 'Pozostało', 'Wykorzystanie budżetu']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('the month nav buttons have Polish accessible names', async () => {
    await renderAndLoad();
    expect(screen.getByRole('button', { name: 'poprzedni miesiąc' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'następny miesiąc' })).toBeInTheDocument();
  });
});
