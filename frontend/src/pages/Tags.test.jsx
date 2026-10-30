import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api';
import Tags from './Tags';
import { renderWithProviders } from '../test/renderPage';

// Audit P1-52 (AGENTS.md §9.10): the tag row used to be a <button> containing the
// rename/delete <button>s. Nested buttons are invalid HTML. The first test is the net.

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigateMock,
}));

// The page loads asynchronously, so tests that act on the list must wait for it first.
async function renderAndLoad() {
  renderWithProviders(<Tags />);
  await screen.findByText('dom');
}

const TX = [
  { id: 1, date: '2026-05-10', amount: 40, type: 'wydatek', category_name: 'Transport', tags: ['dom', 'zakupy'] },
  { id: 2, date: '2026-05-11', amount: 900, type: 'Przychod', category_name: 'Transport', tags: ['dom'] },
  { id: 3, date: '2019-03-15', amount: 10, type: 'wydatek', category_name: 'Transport', tags: ['stary'] },
];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getTransactionsAll').mockResolvedValue(TX);
  vi.spyOn(api, 'getTransactions').mockResolvedValue(TX);
  vi.spyOn(api, 'getAllTags').mockResolvedValue(['dom', 'zakupy', 'stary']);
  vi.spyOn(api, 'deleteTag').mockResolvedValue({ removed_from: 2 });
  vi.spyOn(api, 'updateTagName').mockResolvedValue({ renamed_in: 1 });
});

describe('loading', () => {
  it('asks for the whole history, not the current month (audit P0-23)', async () => {
    renderWithProviders(<Tags />);
    await waitFor(() => expect(api.getTransactionsAll).toHaveBeenCalled());
    expect(api.getTransactions).not.toHaveBeenCalled();
  });

  it('shows skeleton placeholders before the first load', async () => {
    const { container } = renderWithProviders(<Tags />);
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    // Six tag-row avatars stand in for the list, plus the detail-card plate.
    expect(container.querySelectorAll('.skeleton.rounded-full')).toHaveLength(6);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    await screen.findByText('dom');
    expect(container.querySelector('.skeleton')).toBeNull();
  });

  it('shows a past-month tag, proving the list spans history', async () => {
    renderWithProviders(<Tags />);
    expect(await screen.findByText('stary')).toBeInTheDocument();
  });

  it('shows the Polish empty state when there are no tags', async () => {
    api.getAllTags.mockResolvedValue([]);
    api.getTransactionsAll.mockResolvedValue([]);
    renderWithProviders(<Tags />);
    expect(await screen.findByText(/Brak tagów/)).toBeInTheDocument();
  });

  it('survives a failed load without an unhandled crash', async () => {
    api.getTransactionsAll.mockRejectedValue(new Error('boom'));
    api.getAllTags.mockRejectedValue(new Error('boom'));
    renderWithProviders(<Tags />);
    expect(await screen.findByText(/Brak tagów/)).toBeInTheDocument();
  });
});

describe('markup (audit P1-52)', () => {
  it('no button is nested inside another button', async () => {
    renderWithProviders(<Tags />);
    await screen.findByText('dom');
    expect(document.querySelectorAll('button button')).toHaveLength(0);
  });

  it('the tag label and the actions are separate buttons in the same row', async () => {
    renderWithProviders(<Tags />);
    const label = await screen.findByRole('button', { name: 'Pokaż transakcje z tagiem dom' });
    const del = screen.getAllByRole('button', { name: 'Usuń tag' })[0];
    // Neither is inside the other (the old markup made the row a <button> containing both).
    expect(label.contains(del)).toBe(false);
    expect(del.contains(label)).toBe(false);
    // They live in the same row, and that row is a <div> — the old markup made the row a
    // <button>, which is what React warned about.
    const row = label.parentElement;
    expect(row.tagName).toBe('DIV');
    expect(row).toContainElement(del);
  });

  it('every action button has a Polish accessible name', async () => {
    renderWithProviders(<Tags />);
    await screen.findByText('dom');
    expect(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Usuń tag' }).length).toBeGreaterThan(0);
  });
});

describe('selecting a tag', () => {
  it('shows the tagged transactions with their date and category', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tags />);
    await user.click(await screen.findByRole('button', { name: 'Pokaż transakcje z tagiem dom' }));
    expect(screen.getByText('Oznaczone tagiem: dom')).toBeInTheDocument();
    expect(screen.getByText('2026-05-10')).toBeInTheDocument();
    expect(screen.getByText('2026-05-11')).toBeInTheDocument();
    expect(screen.queryByText('2019-03-15')).toBeNull();
  });

  it('the count badge matches the number of tagged rows', async () => {
    renderWithProviders(<Tags />);
    const row = (await screen.findByText('dom')).closest('div');
    expect(row.querySelector('span')).toHaveTextContent('2');
  });

  it('the placeholder panel is shown before a tag is picked', async () => {
    renderWithProviders(<Tags />);
    expect(await screen.findByText(/Wybierz tag z lewej/)).toBeInTheDocument();
  });

  it('income rows are rendered with the income colour', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Tags />);
    await user.click(await screen.findByRole('button', { name: 'Pokaż transakcje z tagiem dom' }));
    const income = screen.getByText('900,00 zł');
    expect(income.className).toContain('text-[#32a852]');
    expect(screen.getByText('40,00 zł').className).toContain('text-red-500');
  });

  it('matching is case-insensitive on the tag name', async () => {
    api.getAllTags.mockResolvedValue(['DOM']);
    renderWithProviders(<Tags />);
    const label = await screen.findByRole('button', { name: 'Pokaż transakcje z tagiem DOM' });
    await userEvent.click(label);
    expect(screen.getByText('Oznaczone tagiem: DOM')).toBeInTheDocument();
    expect(screen.getByText('2026-05-10')).toBeInTheDocument();
  });
});

describe('rename', () => {
  it('opens an editor prefilled with the current name', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' })[0]);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('dom');
    expect(input).toHaveFocus();
  });

  it('Enter saves and calls the backend once with the right pair', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' })[0]);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'house');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.updateTagName).toHaveBeenCalledWith('dom', 'house'));
  });

  it('Zapisz saves and closes the editor', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' })[0]);
    await user.type(screen.getByRole('textbox'), 'house');
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(api.updateTagName).toHaveBeenCalled());
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Anuluj closes without a request', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' })[0]);
    await user.type(screen.getByRole('textbox'), 'house');
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(api.updateTagName).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('reloads the list after a rename', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' })[0]);
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(api.getTransactionsAll).toHaveBeenCalledTimes(2));
  });

  it('surfaces a backend failure in Polish and keeps the editor open', async () => {
    api.updateTagName.mockRejectedValue(new Error('Nie udało się zmienić nazwy tagu'));
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Zmień nazwę tagu' })[0]);
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Nie udało się zmienić nazwy tagu')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('delete', () => {
  it('asks for confirmation before touching anything', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Usuń tag' })[0]);
    expect(await screen.findByText(/Usunąć tag „dom” ze wszystkich transakcji\?/)).toBeInTheDocument();
    expect(api.deleteTag).not.toHaveBeenCalled();
  });

  it('cancelling deletes nothing', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Usuń tag' })[0]);
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(api.deleteTag).not.toHaveBeenCalled();
    expect(screen.getByText('dom')).toBeInTheDocument();
  });

  it('confirming deletes and reloads', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Usuń tag' })[0]);
    await user.click(screen.getByRole('button', { name: 'Usuń' }));
    await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith('dom'));
    await waitFor(() => expect(api.getTransactionsAll).toHaveBeenCalledTimes(2));
  });

  it('shows a success toast in Polish', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Usuń tag' })[0]);
    await user.click(screen.getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Tag usunięty')).toBeInTheDocument();
  });

  it('surfaces a backend failure in Polish', async () => {
    api.deleteTag.mockRejectedValue(new Error('Błąd serwera'));
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Usuń tag' })[0]);
    await user.click(screen.getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Błąd serwera')).toBeInTheDocument();
  });

  it('the confirm dialog is a red danger dialog (destructive action)', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getAllByRole('button', { name: 'Usuń tag' })[0]);
    expect(screen.getByRole('button', { name: 'Usuń' }).className).toContain('bg-red-600');
  });
});

describe('Polish UI', () => {
  it('the page title and subtitle are Polish', async () => {
    renderWithProviders(<Tags />);
    expect(screen.getByRole('heading', { name: 'Tagi' })).toBeInTheDocument();
    expect(screen.getByText(/zarządzaj transakcjami według tagów/)).toBeInTheDocument();
  });

  it('the empty-state and placeholder copy is Polish', async () => {
    api.getAllTags.mockResolvedValue([]);
    api.getTransactionsAll.mockResolvedValue([]);
    renderWithProviders(<Tags />);
    expect(await screen.findByText(/Brak tagów/)).toBeInTheDocument();
  });

  it('row jump carries the transaction month, so the target page shows it', async () => {
    await renderAndLoad();
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż transakcje z tagiem dom' }));
    // First row of tag "dom" is tx 1 (2026-05-10).
    fireEvent.click(screen.getAllByLabelText('Przejdź do wydatków')[0]);
    expect(navigateMock).toHaveBeenCalledWith('/wydatki?miesiac=2026-05');
  });
});
