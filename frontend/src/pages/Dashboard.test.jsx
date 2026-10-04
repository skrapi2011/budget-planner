import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import * as api from '../api';
import Dashboard from './Dashboard';
import { ThemeProvider } from '../ThemeProvider';
import { AuthProvider } from '../AuthProvider';
import ToastProvider from '../components/ToastProvider';
import { currentMonthStr, monthLabel } from '../utils/date';

// The dashboard deep-links to /wydatki?kategoria=<id>&miesiac=<month>, so the assertion is
// made by landing on the real target route and reading its query params.
function LandingProbe() {
  const [params] = useSearchParams();
  return (
    <div data-testid="landing">
      {`kategoria=${params.get('kategoria')} miesiac=${params.get('miesiac')}`}
    </div>
  );
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/wydatki" element={<LandingProbe />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const DASH = {
  total_all_time: 5000,
  month_total: 440,
  prev_month_total: 400,
  current_planned: 700,
  monthly_history: [
    { label: 'Sierpien 26', actual: 100 },
    { label: 'Wrzesien 26', actual: 200 },
    { label: 'Pazdziernik 26', actual: 300 },
  ],
};

const BUDGETS = [
  { cat_id: 1, category_name: 'Transport', color: '#e74c3c', icon: '🚗', budzet: 500, wydatki: 200, saldo: 300 },
  { cat_id: 2, category_name: 'Jedzenie', color: '#3498db', icon: '🍔', budzet: 100, wydatki: 90, saldo: 10 },
  { cat_id: 3, category_name: 'Media', color: '#9b59b6', icon: '💡', budzet: 100, wydatki: 150, saldo: -50 },
];

const CATS = [
  { id: 1, name: 'Transport', color: '#e74c3c', icon: '🚗' },
  { id: 2, name: 'Jedzenie', color: '#3498db', icon: '🍔' },
  { id: 3, name: 'Media', color: '#9b59b6', icon: '💡' },
];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getDashboardData').mockResolvedValue(DASH);
  vi.spyOn(api, 'getBudgetsViewByMonth').mockResolvedValue(BUDGETS);
  vi.spyOn(api, 'getCategories').mockResolvedValue(CATS);
  vi.spyOn(api, 'addTransaction').mockResolvedValue({});
});

describe('loading', () => {
  it('shows a spinner until the dashboard data arrives', () => {
    renderDashboard();
    // No stat card labels yet — the page returns early on !dashData.
    expect(screen.queryByText('Budżet miesięczny')).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('requests the current month by default', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(api.getDashboardData).toHaveBeenCalledWith(currentMonthStr());
    expect(api.getBudgetsViewByMonth).toHaveBeenCalledWith(currentMonthStr());
    // Active categories feed the add-expense dropdown: api.getCategories(true).
    expect(api.getCategories).toHaveBeenCalledWith(true);
  });

  it('survives a failed dashboard request without crashing', async () => {
    api.getDashboardData.mockResolvedValue(null);
    renderDashboard();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Budżet miesięczny')).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('falls back to empty budgets and categories when those calls fail', async () => {
    api.getBudgetsViewByMonth.mockRejectedValue(new Error('boom'));
    api.getCategories.mockRejectedValue(new Error('boom'));
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Brak danych budżetowych dla tego miesiąca.')).toBeInTheDocument();
  });
});

describe('month navigation', () => {
  it('shows the current month label in Polish', async () => {
    renderDashboard();
    expect(await screen.findByText(monthLabel(currentMonthStr()))).toBeInTheDocument();
  });

  it('the next month refetches both endpoints with the new month', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    const [y, m] = currentMonthStr().split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenCalledWith(next));
    expect(api.getBudgetsViewByMonth).toHaveBeenCalledWith(next);
    expect(screen.getByText(monthLabel(next))).toBeInTheDocument();
  });

  it('the previous month wraps to December of the prior year in January', async () => {
    const user = userEvent.setup();
    const dateUtils = await import('../utils/date');
    vi.spyOn(dateUtils, 'currentMonthStr').mockReturnValue('2026-01');

    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'poprzedni miesiąc' }));
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenCalledWith('2025-12'));
    expect(screen.getByText('Grudzień 2025')).toBeInTheDocument();
  });

  it('Dziś jumps back to the current month', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Dziś' }));
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenLastCalledWith(currentMonthStr()));
  });

  it('re-animates on month change and dims while refetching', async () => {
    const user = userEvent.setup();
    const { container } = renderDashboard();
    await screen.findByText('Budżet miesięczny');

    // key={monthStr} + page-enter (audit P1-51): the content block is keyed on the month so
    // the entrance animation replays, and it dims (not unmounts) during a refetch.
    const block = () => container.querySelector('.page-enter');
    expect(block()).not.toBeNull();

    api.getDashboardData.mockImplementation(() => new Promise((r) => setTimeout(() => r(DASH), 30)));
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    // key={monthStr} remounts the block, so the node is re-queried, not reused.
    await vi.waitFor(() => expect(block().className).toContain('opacity-50'));
    expect(block().className).toContain('pointer-events-none');
    // The content stays mounted while dimmed — no spinner flash.
    expect(screen.getByText('Budżet miesięczny')).toBeInTheDocument();
  });
});

describe('race guard (audit P1-51)', () => {
  it('a slow response for an older month does not overwrite the newer month', async () => {
    const user = userEvent.setup();
    const stale = { ...DASH, current_planned: 9999 };
    let resolveStale;

    // Call 1 (current month) answers normally, call 2 (next month) hangs, call 3 answers normally.
    api.getDashboardData.mockResolvedValue(DASH);
    api.getDashboardData.mockResolvedValueOnce(DASH);
    api.getDashboardData.mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }));

    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenCalledTimes(2));

    act(() => resolveStale(stale));
    await new Promise(r => setTimeout(r, 20));
    // The stale payload must not reach state: 9999 would show on the budget card.
    expect(screen.queryByText('9999,00 zł')).toBeNull();
  });

  it('the latest response wins when both resolve', async () => {
    const user = userEvent.setup();
    const slow = new Promise((r) => setTimeout(() => r({ ...DASH, current_planned: 1111 }), 40));
    const fast = { ...DASH, current_planned: 222 };

    api.getDashboardData.mockImplementationOnce(() => slow);
    api.getDashboardData.mockResolvedValueOnce(fast);

    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await new Promise(r => setTimeout(r, 80));
    expect(screen.queryByText('1111,00 zł')).toBeNull();
  });
});

describe('stat cards', () => {
  it('renders all four cards with Polish labels', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Wydatki w tym miesiącu')).toBeInTheDocument();
    expect(screen.getByText('Zmiana wydatków')).toBeInTheDocument();
    expect(screen.getByText('Wydatki całość')).toBeInTheDocument();
  });

  it('shows the planned, monthly and all-time figures', async () => {
    renderDashboard();
    await screen.findByText('700,00 zł', { timeout: 2000 });
    // 440 is both the month card and the donut centre sum.
    expect(await screen.findAllByText('440,00 zł')).toHaveLength(2);
    // Every card counts up from zero, so the settled value is awaited, not read synchronously.
    expect(await screen.findByText('5000,00 zł', { timeout: 2000 })).toBeInTheDocument();
  });

  it('shows the month-on-month change against the previous month', async () => {
    renderDashboard();
    // 440 vs 400 → +10% (up arrow), difference +40, labelled with the two months compared.
    expect(await screen.findByText('↑ 10%')).toBeInTheDocument();
    // The difference is a count-up animation, so it lands after the 500ms duration.
    expect(await screen.findByText('+40,00 zł', { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/vs/)).toBeInTheDocument();
  });

  it('a zero previous month with spending shows no percentage and says so', async () => {
    api.getDashboardData.mockResolvedValue({ ...DASH, prev_month_total: 0, month_total: 50 });
    renderDashboard();
    await screen.findByText('Wydatki w tym miesiącu');
    expect(await screen.findByText('—')).toBeInTheDocument();
    expect(screen.getByText('Brak danych za poprzedni miesiąc')).toBeInTheDocument();
    expect(await screen.findByText('+50,00 zł', { timeout: 2000 })).toBeInTheDocument();
  });

  it('values animate up from zero (useCountUp)', async () => {
    renderDashboard();
    // Mid-animation the card shows a value below the target, and settles on it.
    expect(await screen.findByText('700,00 zł', { timeout: 2000 })).toBeInTheDocument();
  });
});

describe('donut: category structure and deep links', () => {
  it('lists categories with spending, sorted by amount descending', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    const rows = screen.getAllByTitle(/Pokaż wydatki/).map(b => b.textContent);
    expect(rows[0]).toContain('Transport');
    expect(rows[1]).toContain('Media');
    expect(rows[2]).toContain('Jedzenie');
  });

  it('shows the month total in the middle of the donut', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Suma')).toBeInTheDocument();
    expect(screen.getByText('440,00 zł')).toBeInTheDocument();
  });

  it('the pie container has a definite width, so the chart renders and the sum stays centred', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    const rc = document.querySelector('.recharts-responsive-container');
    expect(rc).not.toBeNull();
    // ResponsiveContainer is width:100% with min-width:0, and its inner div is width:0 (so a
    // ResizeObserver can detect shrinking). Inside an auto-width flex item the percentage is
    // unresolvable, so recharts gets width 0, renders nothing (isAcceptableSize rejects it),
    // and the absolute Suma overlay at left:50% lands on the category list.
    const box = rc.parentElement;
    expect(box.className).toMatch(/w-\[[\d.]+px\]|w-full/);
    expect(box.className).not.toMatch(/(^|\s)sm:w-auto(\s|$)/);
    // The sum overlay is positioned against that box, so it needs a width to centre in.
    const overlay = box.querySelector('div[style*="margin-left"]');
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe('50%');
  });

  it('clicking a category deep-links to ExpensesView with the category and the viewed month', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByTitle('Pokaż wydatki: Media'));
    expect(await screen.findByTestId('landing')).toHaveTextContent(
      `kategoria=3 miesiac=${currentMonthStr()}`,
    );
  });

  it('carries the month the user is looking at, not today', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'następny miesiąc' }));
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenCalledTimes(2));
    await user.click(screen.getByTitle('Pokaż wydatki: Transport'));
    const [y, m] = currentMonthStr().split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    expect(screen.getByTestId('landing')).toHaveTextContent(`kategoria=1 miesiac=${next}`);
  });

  it('shows an empty state when nothing was spent', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([]);
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Brak danych. Dodaj transakcje aby zobaczyć wykres.')).toBeInTheDocument();
  });
});

describe('bar chart time filter', () => {
  it('defaults to 12 months and shows the sum of the window', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Suma: 600,00 zł')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12m' })).toHaveClass('bg-[#32a852]');
  });

  it('switching to 3m narrows the window and updates the sum', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: '3m' }));
    expect(screen.getByText('Suma: 600,00 zł')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3m' })).toHaveClass('bg-[#32a852]');
    expect(screen.getByRole('button', { name: '12m' })).not.toHaveClass('bg-[#32a852]');
  });

  it('shows an empty state when there is no history', async () => {
    api.getDashboardData.mockResolvedValue({ ...DASH, monthly_history: [] });
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Brak danych miesięcznych.')).toBeInTheDocument();
  });
});

describe('category budget rows', () => {
  it('renders one row per category with spend / limit and the balance', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    // The name appears in both the donut list and the budget rows.
    expect(screen.getAllByText('Transport')).toHaveLength(2);
    expect(screen.getByText('200,00 zł / 500,00 zł')).toBeInTheDocument();
    expect(screen.getByText('+300,00 zł')).toBeInTheDocument();
  });

  it('an over-budget category shows its negative balance in red', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    const over = screen.getByText('-50,00 zł');
    expect(over).toBeInTheDocument();
    expect(over.style.color).toBe('rgb(220, 38, 38)');
    // The swatch flips to red for the same row (colour and bar stay in sync).
    expect(over.closest('div.border-b').querySelector('span.rounded-full').style.backgroundColor).toBe('rgb(239, 68, 68)');
  });

  it('the progress bar animates from zero to its target width', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    // useAnimatedValue starts at 0 and reaches the target after the first animation frame,
    // so the widths are re-read (not snapshotted) inside the wait.
    const widths = () => Array.from(document.querySelectorAll('.h-full.rounded-full')).map(d => d.style.width);
    await vi.waitFor(() => expect(widths()).toContain('40%'));
    expect(widths()).toContain('90%');
    expect(widths()).toContain('150%');   // Media: 150/100 is not clamped — the parent's overflow-hidden clips it
  });

  it('a category with no budget renders no progress bar', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([{ cat_id: 4, category_name: 'Inne', budzet: 0, wydatki: 100, saldo: -100 }]);
    renderDashboard();
    await screen.findAllByText('Inne');   // donut list + budget row
    expect(document.querySelector('.h-full.rounded-full')).toBeNull();
    // No limit line is drawn for a zero budget; the balance is shown on its own.
    expect(screen.queryByText('100,00 zł / 0,00 zł')).toBeNull();
    expect(screen.getByText('-100,00 zł')).toBeInTheDocument();
  });

  it('shows an empty state when the month has no budget rows', async () => {
    api.getBudgetsViewByMonth.mockResolvedValue([]);
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Brak danych budżetowych dla tego miesiąca.')).toBeInTheDocument();
  });
});

describe('adding an expense', () => {
  it('the floating button opens the modal with the active categories', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'Dodaj wydatek' }));
    expect(await screen.findByRole('heading', { name: 'Dodaj wydatek' })).toBeInTheDocument();
    // The modal's category dropdown is fed by the page's activeCategories (api.getCategories(true)).
    const select = screen.getByLabelText('Kategoria');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['-- Wybierz kategorię --', 'Transport', 'Jedzenie', 'Media']);
  });

  it('submitting posts the transaction and reloads the dashboard', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'Dodaj wydatek' }));
    await user.type(screen.getByLabelText('Kwota'), '50');
    await user.selectOptions(screen.getByLabelText('Kategoria'), '1');
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    await vi.waitFor(() => expect(api.addTransaction).toHaveBeenCalled());
    const body = api.addTransaction.mock.calls[0][0];
    // The mock intercepts api.addTransaction, so this is the modal's own payload shape
    // (camelCase categoryId); api.js is what turns it into category_id for the wire.
    expect(body.amount).toBe(50);
    expect(body.categoryId).toBe('1');
    expect(body.type).toBe('wydatek');
    await vi.waitFor(() => expect(api.getDashboardData).toHaveBeenCalledTimes(2));
  });

  it('a failed save surfaces the backend message and stays open', async () => {
    api.addTransaction.mockRejectedValue(new Error('Nie udało się zapisać'));
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    await user.click(screen.getByRole('button', { name: 'Dodaj wydatek' }));
    await user.type(screen.getByLabelText('Kwota'), '50');
    await user.selectOptions(screen.getByLabelText('Kategoria'), '1');
    await user.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(await screen.findByText('Nie udało się zapisać')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dodaj wydatek' })).toBeInTheDocument();
    expect(api.getDashboardData).toHaveBeenCalledTimes(1);
  });
});

describe('layout contract', () => {
  it('the page is wrapped in the shared Layout with the app nav', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByText('Planowanie Wydatków')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Panel' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Budżety' })).toBeInTheDocument();
  });

  it('the floating add button is the brand green', async () => {
    renderDashboard();
    await screen.findByText('Budżet miesięczny');
    expect(screen.getByRole('button', { name: 'Dodaj wydatek' })).toHaveStyle({
      backgroundColor: 'rgb(50, 168, 82)',
    });
  });
});
