import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as api from '../api';
import ExpensesView from './ExpensesView';
import { ThemeProvider } from '../ThemeProvider';
import { AuthProvider } from '../AuthProvider';
import ToastProvider from '../components/ToastProvider';
import { currentMonthStr, monthLabel } from '../utils/date';

const CATS = [
  { id: 1, name: 'Transport', color: '#e74c3c', icon: '🚗' },
  { id: 2, name: 'Jedzenie', color: '#3498db', icon: '🍔' },
];

const TX = [
  { id: 10, category_id: 1, category_name: 'Transport', category_color: '#e74c3c', category_icon: '🚗', type: 'wydatek', amount: 120, date: '2026-03-05', description: 'Bilet', tags: ['podróż'] },
  { id: 11, category_id: 1, category_name: 'Transport', category_color: '#e74c3c', category_icon: '🚗', type: 'wydatek', amount: 40, date: '2026-03-11', description: 'Parking', tags: [] },
  { id: 12, category_id: 2, category_name: 'Jedzenie', category_color: '#3498db', category_icon: '🍔', type: 'Przychod', amount: 900, date: '2026-03-02', description: 'Wypłata', tags: [] },
];

// The page reads its deep-link params from the router, so the harness mounts it on its
// real route with the query string the Dashboard produces.
function renderExpenses(initialEntry = '/wydatki') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/wydatki" element={<ExpensesView />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

// Pages load asynchronously. Groups start collapsed, so the reliable "loaded" signal is the
// summary card, which is rendered from the transaction list itself.
async function renderAndLoad(initialEntry = '/wydatki') {
  renderExpenses(initialEntry);
  await screen.findByText('160,00 zł');
}

// Rows are only in the DOM when their category section is expanded.
async function expand(user, name = /Transport/) {
  await user.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getCategories').mockResolvedValue(CATS);
  vi.spyOn(api, 'getTransactions').mockResolvedValue(TX);
  vi.spyOn(api, 'getAllTags').mockResolvedValue(['podróż']);
  vi.spyOn(api, 'addTransaction').mockResolvedValue({});
  vi.spyOn(api, 'updateTransaction').mockResolvedValue({});
  vi.spyOn(api, 'deleteTransaction').mockResolvedValue({});
});

describe('loading', () => {
  it('requests the selected month explicitly, not the backend default', async () => {
    await renderAndLoad();
    // ⚠️ without ?month= the backend returns the current month, so switching months
    // would silently show stale data.
    expect(api.getTransactions).toHaveBeenCalledWith(currentMonthStr());
    expect(api.getCategories).toHaveBeenCalledWith(true);
  });

  it('shows skeleton placeholders before the first load and keeps the list on refetches', async () => {
    const { container } = renderExpenses();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    await screen.findByText('160,00 zł');
    // Placeholders are fully gone once the data renders.
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('survives failed requests with empty lists', async () => {
    api.getTransactions.mockRejectedValue(new Error('boom'));
    api.getCategories.mockRejectedValue(new Error('boom'));
    renderExpenses();
    expect(await screen.findByText('Brak transakcji')).toBeInTheDocument();
  });

  it('the month label is Polish', async () => {
    await renderAndLoad();
    expect(screen.getByText(monthLabel(currentMonthStr()))).toBeInTheDocument();
  });
});

describe('deep links (audit P0-23 / Dashboard donut)', () => {
  it('?miesiac sets the month that is loaded', async () => {
    await renderAndLoad('/wydatki?miesiac=2026-03');
    expect(api.getTransactions).toHaveBeenCalledWith('2026-03');
    expect(screen.getByText('Marzec 2026')).toBeInTheDocument();
  });

  it('an invalid ?miesiac falls back to the current month', async () => {
    await renderAndLoad('/wydatki?miesiac=not-a-month');
    expect(api.getTransactions).toHaveBeenCalledWith(currentMonthStr());
  });

  it('?kategoria pre-selects that category and shows only its transactions', async () => {
    const user = userEvent.setup();
    await renderAndLoad('/wydatki?kategoria=1');
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('1');
    // The filter is applied to the group list: only Transport has a section, and its rows
    // appear once expanded. Income in Jedzenie is filtered out entirely.
    await expand(user);
    expect(screen.getByText('Bilet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Jedzenie/ })).toBeNull();
  });

  it('an unknown ?kategoria id falls back to all categories', async () => {
    const user = userEvent.setup();
    await renderAndLoad('/wydatki?kategoria=999');
    expect(screen.getByRole('combobox')).toHaveValue('all');
    await expand(user);
    await expand(user, /Jedzenie/);
    expect(screen.getByText('Bilet')).toBeInTheDocument();
    expect(screen.getByText('Wypłata')).toBeInTheDocument();
  });

  it('the user’s dropdown choice wins over the deep-link param', async () => {
    const user = userEvent.setup();
    await renderAndLoad('/wydatki?kategoria=1');
    await user.selectOptions(screen.getByRole('combobox'), 'all');
    await expand(user, /Jedzenie/);
    expect(screen.getByText('Wypłata')).toBeInTheDocument();
  });

  it('the deep-linked month is carried into the month navigation', async () => {
    const user = userEvent.setup();
    await renderAndLoad('/wydatki?miesiac=2026-03');
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getTransactions).toHaveBeenCalledWith('2026-04'));
  });

  it('Dziś returns to the current month', async () => {
    const user = userEvent.setup();
    await renderAndLoad('/wydatki?miesiac=2026-03');
    await user.click(screen.getByRole('button', { name: 'Dziś' }));
    await vi.waitFor(() => expect(api.getTransactions).toHaveBeenLastCalledWith(currentMonthStr()));
  });
});

describe('monthly summary', () => {
  it('totals the whole month, not the filtered view', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    // Expenses exclude Przychod; income and balance are kept separate.
    expect(screen.getByText('160,00 zł')).toBeInTheDocument();   // 120 + 40
    expect(screen.getByText('900,00 zł')).toBeInTheDocument();   // income
    expect(screen.getByText('740,00 zł')).toBeInTheDocument();    // balance: 900 income − 160 spend
    expect(screen.getByText('3')).toBeInTheDocument();           // transaction count

    // Filtering the list must not change the summary.
    await user.selectOptions(screen.getByRole('combobox'), '1');
    expect(screen.getByText('160,00 zł')).toBeInTheDocument();
    expect(screen.getByText('900,00 zł')).toBeInTheDocument();
  });

  it('labels the four summary cards in Polish', async () => {
    await renderAndLoad();
    // "Wydatki" is also a nav link, so the card labels are matched on their <p>.
    const card = (t) => screen.getByText(t, { selector: 'p' });
    expect(card('Wydatki')).toBeInTheDocument();
    expect(card('Przychody')).toBeInTheDocument();
    expect(card('Bilans')).toBeInTheDocument();
    expect(card('Transakcje')).toBeInTheDocument();
  });
});

describe('search', () => {
  it('matches descriptions case-insensitively', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.type(screen.getByPlaceholderText('Szukaj...'), 'par');
    expect(screen.getByText('Parking')).toBeInTheDocument();
    expect(screen.queryByText('Bilet')).toBeNull();
  });

  it('matches category names', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user, /Jedzenie/);
    await user.type(screen.getByPlaceholderText('Szukaj...'), 'jedzenie');
    expect(screen.getByText('Wypłata')).toBeInTheDocument();
    expect(screen.queryByText('Bilet')).toBeNull();
  });

  it('an empty search shows everything', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await expand(user, /Jedzenie/);
    await user.type(screen.getByPlaceholderText('Szukaj...'), 'nie ma takiego');
    expect(screen.getByText('Brak transakcji')).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText('Szukaj...'));
    expect(screen.getByText('Bilet')).toBeInTheDocument();
  });
});

describe('collapsible category groups', () => {
  it('starts collapsed, so no transaction rows are shown', async () => {
    await renderAndLoad();
    // The header is a button whose name is built from nested spans (name + total + count).
    const header = screen.getByRole('button', { name: /Transport/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header.textContent).toContain('160,00 zł');
    expect(screen.queryByText('Bilet')).toBeNull();
  });

  it('expanding a group reveals its rows', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    expect(screen.getByText('Bilet')).toBeInTheDocument();
    expect(screen.getByText('Parking')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Transport/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapsing again hides the rows', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.click(screen.getByRole('button', { name: /Transport/ }));
    expect(screen.queryByText('Bilet')).toBeNull();
    expect(screen.getByRole('button', { name: /Transport/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('expansion state survives a reload (add/delete/month change)', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    expect(screen.getByText('Bilet')).toBeInTheDocument();
    // A month change refetches; the expanded map is kept, so the section stays open.
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getTransactions).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /Transport/ })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('transaction rows', () => {
  it('show date, description and amount', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    expect(screen.getByText('Bilet')).toBeInTheDocument();
    expect(screen.getByText('2026-03-05')).toBeInTheDocument();  // raw ISO date in a <time> element
    expect(screen.getByText('120,00 zł')).toBeInTheDocument();
  });

  it('income rows are coloured differently from expenses', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await expand(user, /Jedzenie/);
    // 900,00 zł appears twice (summary card + row); the row span carries the income colour.
    const income = screen.getAllByText('900,00 zł').find((el) => el.tagName === 'SPAN');
    expect(income.className).toContain('text-[#32a852]');
    expect(screen.getByText('120,00 zł').className).toContain('text-red-500');
  });

  it('a transaction without a category name shows a placeholder', async () => {
    api.getTransactions.mockResolvedValue([{ id: 20, category_id: 9, type: 'wydatek', amount: 10, date: '2026-03-01', description: 'Bez kategorii' }]);
    const user = userEvent.setup();
    renderExpenses();
    // The group header carries the category-name fallback; rows appear once expanded.
    await screen.findByText('Nieznana');
    await expand(user, /Nieznana/);
    expect(screen.getByText('Bez kategorii')).toBeInTheDocument();
  });
});

describe('deleting (two-step confirm)', () => {
  it('the first click arms the row, the second confirms', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.click(screen.getAllByRole('button', { name: 'Usuń transakcję' })[0]);
    expect(api.deleteTransaction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Potwierdź usunięcie' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Potwierdź usunięcie' }));
    await vi.waitFor(() => expect(api.deleteTransaction).toHaveBeenCalledWith(10));
    expect(screen.getByText('Transakcja usunięta')).toBeInTheDocument();
  });

  it('cancel disarms the row without deleting', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.click(screen.getAllByRole('button', { name: 'Usuń transakcję' })[0]);
    await user.click(screen.getByRole('button', { name: 'Anuluj usuwanie' }));
    expect(api.deleteTransaction).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Potwierdź usunięcie' })).toBeNull();
  });

  it('reloading after a delete refreshes the list', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.click(screen.getAllByRole('button', { name: 'Usuń transakcję' })[0]);
    await user.click(screen.getByRole('button', { name: 'Potwierdź usunięcie' }));
    await vi.waitFor(() => expect(api.getTransactions).toHaveBeenCalledTimes(2));
  });

  it('a failed delete shows a Polish toast and keeps the row armed state clean', async () => {
    api.deleteTransaction.mockRejectedValue(new Error('Nie udało się usunąć transakcji'));
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.click(screen.getAllByRole('button', { name: 'Usuń transakcję' })[0]);
    await user.click(screen.getByRole('button', { name: 'Potwierdź usunięcie' }));
    expect(await screen.findByText('Nie udało się usunąć transakcji')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Potwierdź usunięcie' })).toBeNull();
  });

  it('only one row is armed at a time', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    const removes = screen.getAllByRole('button', { name: 'Usuń transakcję' });
    await user.click(removes[0]);
    expect(screen.getAllByRole('button', { name: 'Potwierdź usunięcie' })).toHaveLength(1);
    await user.click(removes[1]);
    expect(screen.getAllByRole('button', { name: 'Potwierdź usunięcie' })).toHaveLength(1);
  });
});

describe('adding and editing', () => {
  it('the add button opens an empty modal', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Dodaj transakcję' }));
    expect(await screen.findByRole('heading', { name: 'Dodaj wydatek' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kwota')).toHaveValue(null);  // empty number input
  });

  it('saving posts the transaction, toasts, and reloads', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Dodaj transakcję' }));
    await user.type(screen.getByLabelText('Kwota'), '50');
    await user.selectOptions(screen.getByLabelText('Kategoria'), '1');
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    await vi.waitFor(() => expect(api.addTransaction).toHaveBeenCalled());
    expect(api.addTransaction.mock.calls[0][0].amount).toBe(50);
    expect(await screen.findByText('Wydatek dodany')).toBeInTheDocument();
    await vi.waitFor(() => expect(api.getTransactions).toHaveBeenCalledTimes(2));
  });

  it('income is toasted with the income wording', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Dodaj transakcję' }));
    await user.type(screen.getByLabelText('Kwota'), '100');
    await user.selectOptions(screen.getByLabelText('Kategoria'), '1');
    await user.selectOptions(screen.getByLabelText('Typ'), 'Przychod');
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(await screen.findByText('Przychod dodany')).toBeInTheDocument();
  });

  it('the edit button prefills the modal from the row and saves with PUT', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await expand(user);
    await user.click(screen.getAllByRole('button', { name: 'Edytuj transakcję' })[0]);
    expect(await screen.findByRole('heading', { name: 'Edytuj transakcję' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kwota')).toHaveValue(120);
    expect(screen.getByLabelText('Opis')).toHaveValue('Bilet');
    await user.clear(screen.getByLabelText('Kwota'));
    await user.type(screen.getByLabelText('Kwota'), '150');
    // The submit button is labelled "Dodaj" in both modes (the heading changes, the button does not).
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    await vi.waitFor(() => expect(api.updateTransaction).toHaveBeenCalledWith(10, expect.objectContaining({ amount: 150 })));
    expect(await screen.findByText('Zapisano zmiany')).toBeInTheDocument();
  });

  it('a failed save shows the backend message and does not reload', async () => {
    api.addTransaction.mockRejectedValue(new Error('Nie udało się zapisać'));
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'Dodaj transakcję' }));
    await user.type(screen.getByLabelText('Kwota'), '50');
    await user.selectOptions(screen.getByLabelText('Kategoria'), '1');
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(await screen.findByText('Nie udało się zapisać')).toBeInTheDocument();
    expect(api.getTransactions).toHaveBeenCalledTimes(1);
  });
});

describe('race guard (audit P1-51)', () => {
  it('a slow response for an older month does not overwrite the newer month', async () => {
    const user = userEvent.setup();
    let resolveStale;
    api.getTransactions.mockResolvedValue([]);
    api.getTransactions.mockResolvedValueOnce([]);
    api.getTransactions.mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }));

    renderExpenses();
    await screen.findByText('Brak transakcji');
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getTransactions).toHaveBeenCalledTimes(2));

    act(() => resolveStale(TX));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Bilet')).toBeNull();
  });

  it('the latest response wins when both resolve', async () => {
    const user = userEvent.setup();
    const slow = new Promise((r) => setTimeout(() => r(TX), 40));
    const fast = [{ id: 30, category_id: 2, category_name: 'Jedzenie', type: 'wydatek', amount: 7, date: '2026-04-01', description: 'Nowy miesiąc' }];

    api.getTransactions.mockImplementationOnce(() => slow);
    api.getTransactions.mockResolvedValueOnce(fast);

    renderExpenses();
    await screen.findByText('160,00 zł');   // first (slow) response landed
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    // The fast response (7,00 zł) wins; the slow one (160,00 zł) is dropped when it lands.
    expect(await screen.findByText('7,00 zł'));
    await new Promise(r => setTimeout(r, 80));
    expect(screen.queryByText('160,00 zł')).toBeNull();
  });
});

describe('layout contract', () => {
  it('dims the list while refetching instead of unmounting it', async () => {
    const user = userEvent.setup();
    const { container } = renderExpenses();
    await screen.findByText('160,00 zł');
    api.getTransactions.mockImplementation(() => new Promise((r) => setTimeout(() => r(TX), 30)));
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    const block = container.querySelector('.page-enter');
    await vi.waitFor(() => expect(block.className).toContain('opacity-50'));
    expect(block.className).toContain('pointer-events-none');
    // Content stays mounted (no spinner flash) while dimmed.
    expect(screen.getByText('160,00 zł')).toBeInTheDocument();
  });

  it('the page is wrapped in the shared Layout', async () => {
    await renderAndLoad();
    expect(screen.getByText('Planowanie Wydatków')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wydatki' })).toBeInTheDocument();
  });

  it('all visible labels are Polish', async () => {
    await renderAndLoad();
    expect(screen.getByPlaceholderText('Szukaj...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj transakcję' })).toBeInTheDocument();
    expect(screen.getByText('Wszystkie kategorie')).toBeInTheDocument();
  });
});
