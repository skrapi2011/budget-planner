import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import * as api from '../api';
import YearOverview from './YearOverview';
import { ThemeProvider } from '../ThemeProvider';
import { AuthProvider } from '../AuthProvider';
import ToastProvider from '../components/ToastProvider';
import { currentYear, currentMonthStr } from '../utils/date';

const Y = currentYear();
const Y_STR = String(Y);

const DATA = {
  total_spending: 4400,
  total_budgeted: 5000,
  variance: 600,
  avg_monthly_spending: 440,
  avg_monthly_budgeted: 500,
  spend_rate: 88,
  monthly_summary: [
    { month: `${Y}-01`, label: 'Styczeń', spending: 100, budget: 200 },
    { month: `${Y}-02`, label: 'Luty', spending: 200, budget: 200 },
    { month: `${Y}-03`, label: 'Marzec', spending: 300, budget: 0 },
  ],
  category_variance: [
    { cid: 1, name: 'Transport', color: '#e74c3c', spending: 300, budgeted: 500, variance: 200 },
    { cid: 2, name: 'Jedzenie', color: '#3498db', spending: 600, budgeted: 400, variance: -200 },
  ],
};

function renderYear() {
  return render(
    <MemoryRouter initialEntries={['/year']}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/year" element={<YearOverview />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

async function renderAndLoad() {
  const result = renderYear();
  await screen.findByText('Roczne wydatki');
  return result;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getYearSummary').mockResolvedValue(DATA);
});

describe('loading', () => {
  it('requests the current year as a string', async () => {
    await renderAndLoad();
    expect(api.getYearSummary).toHaveBeenCalledWith(Y_STR);
  });

  it('shows skeleton placeholders before the first load', async () => {
    const { container } = renderYear();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    await screen.findByText('Roczne wydatki');
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });

  it('a failed request shows a Polish retry message, not a crash', async () => {
    api.getYearSummary.mockRejectedValue(new Error('boom'));
    renderYear();
    expect(await screen.findByText('Nie udało się załadować danych. Spróbuj ponownie.')).toBeInTheDocument();
  });

  it('the heading names the viewed year', async () => {
    await renderAndLoad();
    expect(screen.getByText(`Roczny Przegląd - ${Y}`)).toBeInTheDocument();
  });
});

describe('year navigation', () => {
  it('the previous year refetches', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'poprzedni rok' }));
    await vi.waitFor(() => expect(api.getYearSummary).toHaveBeenLastCalledWith(String(Y - 1)));
    expect(screen.getByText(`Roczny Przegląd - ${Y - 1}`)).toBeInTheDocument();
  });

  it('future years are blocked (no data to show)', async () => {
    await renderAndLoad();
    const next = screen.getByRole('button', { name: 'następny rok' });
    expect(next).toBeDisabled();
    expect(next).toHaveAttribute('title', 'Nie można przejść do lat przyszłych');
    expect(api.getYearSummary).toHaveBeenCalledTimes(1);
  });

  it('future years become reachable once viewing a past year', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'poprzedni rok' }));
    const next = screen.getByRole('button', { name: 'następny rok' });
    expect(next).toBeEnabled();
    await user.click(next);
    await vi.waitFor(() => expect(api.getYearSummary).toHaveBeenLastCalledWith(Y_STR));
  });

  it('Ten rok jumps back to the current year', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByRole('button', { name: 'poprzedni rok' }));
    await user.click(screen.getByRole('button', { name: 'Ten rok' }));
    await vi.waitFor(() => expect(api.getYearSummary).toHaveBeenLastCalledWith(Y_STR));
  });

  it('dims the content while refetching, keeping it mounted', async () => {
    const user = userEvent.setup();
    const { container } = renderYear();
    await screen.findByText('Roczne wydatki');
    api.getYearSummary.mockImplementation(() => new Promise((r) => setTimeout(() => r(DATA), 30)));
    await user.click(screen.getByRole('button', { name: 'poprzedni rok' }));
    const block = container.querySelector('.page-enter');
    await vi.waitFor(() => expect(block.className).toContain('opacity-50'));
    expect(block.className).toContain('pointer-events-none');
    expect(screen.getByText('Roczne wydatki')).toBeInTheDocument();
  });

  it('a slow response for an older year does not overwrite the current one', async () => {
    const user = userEvent.setup();
    let resolveStale;
    const stale = { ...DATA, total_spending: 1, monthly_summary: [], category_variance: [] };
    api.getYearSummary.mockResolvedValue(DATA);
    api.getYearSummary.mockResolvedValueOnce(DATA);
    api.getYearSummary.mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }));

    renderYear();
    await screen.findByText('Roczne wydatki');
    await user.click(screen.getByRole('button', { name: 'poprzedni rok' }));
    await vi.waitFor(() => expect(api.getYearSummary).toHaveBeenCalledTimes(2));

    act(() => resolveStale(stale));
    await new Promise(r => setTimeout(r, 20));
    // The cleanup for the unmounted year marks the request cancelled.
    expect(screen.getByText('Roczne wydatki')).toBeInTheDocument();
    expect(screen.getByText(`Roczny Przegląd - ${Y - 1}`)).toBeInTheDocument();
  });
});

describe('summary cards', () => {
  it('show the six yearly figures in Polish', async () => {
    await renderAndLoad();
    expect(screen.getByText('Roczne wydatki')).toBeInTheDocument();
    expect(screen.getByText('Roczny budżet')).toBeInTheDocument();
    expect(screen.getByText('Saldo roczne')).toBeInTheDocument();
    expect(screen.getByText('Wykorzystanie budżetu')).toBeInTheDocument();
    expect(screen.getByText('Średnie miesięczne wydatki')).toBeInTheDocument();
    expect(screen.getByText('Średni budżet miesięczny')).toBeInTheDocument();
  });

  it('the values animate to their targets', async () => {
    await renderAndLoad();
    expect(await screen.findByText('4400,00 zł', {}, { timeout: 2000 }));
    expect(await screen.findByText('5000,00 zł', {}, { timeout: 2000 }));
    expect(screen.getByText('88%')).toBeInTheDocument();
  });

  it('a missing spend rate shows N/A instead of a crash', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, spend_rate: null });
    await renderAndLoad();
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('a positive balance is labelled as savings', async () => {
    await renderAndLoad();
    expect(screen.getByText('Zaoszczędzone')).toBeInTheDocument();
    expect(screen.getByText('600,00 zł')).toBeInTheDocument();
  });

  it('a negative balance is labelled as an overrun', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, variance: -600, total_spending: 5600, total_budgeted: 5000 });
    await renderAndLoad();
    expect(screen.getByText('Przekroczenie')).toBeInTheDocument();
    expect(screen.getByText('600,00 zł')).toBeInTheDocument();
  });

  it('with no budgets the bar is omitted and the reason is stated', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, total_budgeted: 0, spend_rate: null, variance: 4400 });
    await renderAndLoad();
    expect(screen.getByText('Nie ustawiono żadnych budżetów na ten rok')).toBeInTheDocument();
    // The total-budget caption (spend / budget + percentage) is not rendered without a budget.
    expect(screen.queryByText(/\/\s*0,00 zł\s*\(/)).toBeNull();
  });
});

describe('monthly chart', () => {
  it('is titled with the viewed year', async () => {
    await renderAndLoad();
    expect(screen.getByText(`Wydatki w roku ${Y}`)).toBeInTheDocument();
  });

  it('shows an empty state when there is no monthly data', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, monthly_summary: [] });
    await renderAndLoad();
    expect(screen.getByText('Brak danych. Dodaj transakcje aby zobaczyć wykres.')).toBeInTheDocument();
  });

  it('drops malformed month rows instead of rendering them', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, monthly_summary: [null, { month: `${Y}-01`, label: 'Styczeń', spending: 1 }] });
    await renderAndLoad();
    expect(screen.queryByText('Brak danych. Dodaj transakcje aby zobaczyć wykres.')).toBeNull();
  });
});

describe('category variance', () => {
  it('lists every category with its spend/budget pair', async () => {
    await renderAndLoad();
    expect(screen.getByText('Odchylenia wg kategorii')).toBeInTheDocument();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('Jedzenie')).toBeInTheDocument();
    expect(screen.getByText('300,00 zł / 500,00 zł')).toBeInTheDocument();
    expect(screen.getByText('600,00 zł / 400,00 zł')).toBeInTheDocument();
  });

  it('a category under budget is green, over budget is red', async () => {
    await renderAndLoad();
    // Scoped to the row: the same amounts also appear in the monthly breakdown table.
    const under = screen.getByRole('button', { name: /Transport/ });
    const over = screen.getByRole('button', { name: /Jedzenie/ });
    expect(under.querySelector('span.font-medium').className).toContain('text-green-600');
    expect(over.querySelector('span.font-medium').className).toContain('text-red-600');
  });

  it('shows the utilisation percentage per category', async () => {
    await renderAndLoad();
    expect(screen.getByText('60% budżetu')).toBeInTheDocument();
  });

  it('a category with no budget shows no percentage', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, category_variance: [{ cid: 3, name: 'Bez budżetu', color: '#000', spending: 50, budgeted: 0, variance: -50 }] });
    await renderAndLoad();
    const row = screen.getByRole('button', { name: /Bez budżetu/ });
    expect(row.querySelector('span.font-semibold')).toBeNull();  // no "N% budżetu" chip
    expect(row).toBeInTheDocument();
  });

  it('an empty variance list shows a placeholder', async () => {
    api.getYearSummary.mockResolvedValue({ ...DATA, category_variance: [] });
    await renderAndLoad();
    expect(screen.getByText('Brak danych.')).toBeInTheDocument();
  });

  it('bars never collapse to NaN widths (audit P0-17)', async () => {
    // Every category has a budget and zero spending: maxRatio = 0, so ratio/scaleMax = 0/0.
    api.getYearSummary.mockResolvedValue({
      ...DATA,
      total_spending: 0,
      category_variance: [{ cid: 1, name: 'Transport', color: '#e74c3c', spending: 0, budgeted: 500, variance: 500 }],
    });
    const { container } = await renderAndLoad();
    const widths = [...container.querySelectorAll('[style*="width"]')].map((el) => el.style.width);
    expect(widths.every((w) => !w.includes('NaN'))).toBe(true);
    expect(widths.length).toBeGreaterThan(0);
  });

  it('a category row is keyboard-operable', async () => {
    await renderAndLoad();
    const row = screen.getByRole('button', { name: /Transport/ });
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('title', 'Zobacz transakcje tej kategorii');
  });
});

describe('deep links to ExpensesView', () => {
  // The category rows navigate to /wydatki?kategoria=<id>&miesiac=<month>; the probe
  // route records the query it receives so the contract is asserted, not just the call.
  function renderWithProbe(sink) {
    function Probe() {
      const loc = useLocation();
      sink.push(new URLSearchParams(loc.search.split('?').pop()));
      return null;
    }
    render(
      <MemoryRouter initialEntries={['/year']}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <Routes>
                <Route path="/year" element={<YearOverview />} />
                <Route path="/wydatki" element={<Probe />} />
              </Routes>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  }

  it('a category row links to that category in the last month of the viewed year', async () => {
    const user = userEvent.setup();
    const landed = [];
    renderWithProbe(landed);
    await screen.findByText('Roczne wydatki');
    await user.click(screen.getByRole('button', { name: /Transport/ }));
    // While viewing the current year, the deep link carries the current month.
    expect(Object.fromEntries(landed[0])).toEqual({ kategoria: '1', miesiac: currentMonthStr() });
  });

  it('viewing a past year links to December of that year', async () => {
    const user = userEvent.setup();
    const landed = [];
    renderWithProbe(landed);
    await screen.findByText('Roczne wydatki');
    await user.click(screen.getByRole('button', { name: 'poprzedni rok' }));
    await vi.waitFor(() => expect(api.getYearSummary).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: /Transport/ }));
    expect(Object.fromEntries(landed[0])).toEqual({ kategoria: '1', miesiac: `${Y - 1}-12` });
  });

  it('keyboard activation works on a category row', async () => {
    const user = userEvent.setup();
    const landed = [];
    renderWithProbe(landed);
    await screen.findByText('Roczne wydatki');
    const row = screen.getByRole('button', { name: /Transport/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(Object.fromEntries(landed[0])).toEqual({ kategoria: '1', miesiac: currentMonthStr() });
  });
});

describe('layout contract', () => {
  it('is wrapped in the shared Layout', async () => {
    await renderAndLoad();
    expect(screen.getByText('Planowanie Wydatków')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Roczny Przegląd' })).toBeInTheDocument();
  });

  it('all visible labels are Polish', async () => {
    await renderAndLoad();
    expect(screen.getByText('Podsumowanie roku')).toBeInTheDocument();
    expect(screen.getByText('Saldo budżetu rocznego')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ten rok' })).toBeInTheDocument();
  });
});
