import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from '../api';
import CategoriesView from './CategoriesView';
import { renderWithProviders } from '../test/renderPage';

// The categories page: the skeleton placeholder before the first load, the table,
// the add flow (payload + refetch + Polish toast), the edit panel opened from a row,
// and the delete flow through the toast confirm dialog — no native confirm (§7.5).

const CATS = [
  { id: 1, name: 'Transport', color: '#e74c3c', icon: '🚗', active: 1, default_order: 1 },
  { id: 2, name: 'Jedzenie', color: '#3498db', icon: '🍔', active: 1, default_order: 2 },
  { id: 3, name: 'Media', color: '#9b59b6', icon: '💡', active: 0, default_order: 3 },
];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getCategories').mockResolvedValue(CATS);
  vi.spyOn(api, 'createCategory').mockResolvedValue({ id: 4 });
  vi.spyOn(api, 'updateCategory').mockResolvedValue({});
  vi.spyOn(api, 'deleteCategory').mockResolvedValue({});
});

async function renderAndLoad() {
  renderWithProviders(<CategoriesView />);
  await screen.findByText('Transport');
}

describe('loading', () => {
  it('shows the skeleton placeholder before the first data arrives', () => {
    api.getCategories.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CategoriesView />);
    // the list announces once (Polish sr-only), the plates are aria-hidden decoration
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText('Transport')).not.toBeInTheDocument();
  });

  it('replaces the placeholder with the table once data arrives', async () => {
    await renderAndLoad();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(document.querySelector('.skeleton')).toBeNull();
    expect(screen.getByText('Transport')).toBeInTheDocument();
  });

  it('shows the Polish empty state when there are no categories', async () => {
    api.getCategories.mockResolvedValue([]);
    renderWithProviders(<CategoriesView />);
    expect(await screen.findByText('Brak kategorii')).toBeInTheDocument();
  });
});

describe('the category table', () => {
  it('lists every category with its Polish status badge', async () => {
    await renderAndLoad();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('Jedzenie')).toBeInTheDocument();
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getAllByText('Aktywna')).toHaveLength(2);
    expect(screen.getByText('Nieaktywna')).toBeInTheDocument();
  });

  it('clicking a row opens the edit panel prefilled with the category', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByText('Transport'));
    expect(await screen.findByText('Edytuj kategorię')).toBeInTheDocument();
    expect(screen.getByLabelText('Nazwa')).toHaveValue('Transport');
  });
});

describe('add category', () => {
  it('submits the form, refetches, and toasts in Polish', async () => {
    const user = userEvent.setup();
    await renderAndLoad();

    await user.click(screen.getByText('Dodaj kategorię'));
    await user.type(screen.getByLabelText('Nazwa'), 'Prezenty');
    await user.click(screen.getByText('Dodaj'));

    expect(api.createCategory).toHaveBeenCalledWith({
      name: 'Prezenty',
      color: '#32a852',
      icon: '📁',
    });
    // The list is refetched after the create (initial load + reload).
    await vi.waitFor(() => expect(api.getCategories).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Kategoria dodana')).toBeInTheDocument();
  });

  it('the Dodaj button stays disabled while the name is empty', async () => {
    const user = userEvent.setup();
    await renderAndLoad();
    await user.click(screen.getByText('Dodaj kategorię'));
    expect(screen.getByText('Dodaj')).toBeDisabled();
  });
});

describe('edit panel', () => {
  it('renames through the panel and saves the payload', async () => {
    const user = userEvent.setup();
    await renderAndLoad();

    await user.click(screen.getByText('Jedzenie'));
    await screen.findByText('Edytuj kategorię');

    fireEvent.change(screen.getByLabelText('Nazwa'), { target: { value: 'Zakupy spożywcze' } });
    await user.click(screen.getByRole('button', { name: 'Zapisz' }));

    await vi.waitFor(() =>
      expect(api.updateCategory).toHaveBeenCalledWith(2, {
        name: 'Zakupy spożywcze',
        color: '#3498db',
        icon: '🍔',
        active: 1,
      }),
    );
    expect(await screen.findByText('Zapisano zmiany')).toBeInTheDocument();
  });

  it('deactivates the category from the panel', async () => {
    const user = userEvent.setup();
    await renderAndLoad();

    await user.click(screen.getByText('Transport'));
    await screen.findByText('Edytuj kategorię');

    await user.click(screen.getByRole('button', { name: 'Dezaktywuj kategorię' }));
    await vi.waitFor(() => expect(api.updateCategory).toHaveBeenCalledWith(1, { active: 0 }));
  });
});

describe('delete category', () => {
  const dialog = () => screen.getByRole('heading', { name: 'Usuń kategorię' }).closest('.modal-panel-in');

  const openDelete = async (name) => {
    fireEvent.click(screen.getByText(name)); // row click opens the edit panel
    fireEvent.click(await screen.findByRole('button', { name: 'Usuń kategorię' }));
    return screen.findByRole('heading', { name: 'Usuń kategorię' });
  };

  it('opens a Polish confirm dialog naming the category', async () => {
    await renderAndLoad();
    const title = await openDelete('Transport');
    expect(title).toBeInTheDocument();
    expect(within(dialog()).getByText(/Usunąć kategorię „Transport”/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Anuluj' })).toBeInTheDocument();
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it('canceling keeps the category', async () => {
    await renderAndLoad();
    await openDelete('Transport');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Anuluj' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Usuń kategorię' })).toBeNull(),
    );
    expect(api.deleteCategory).not.toHaveBeenCalled();
    expect(screen.getByText('Transport')).toBeInTheDocument();
  });

  it('confirming deletes, refetches, and toasts in Polish', async () => {
    await renderAndLoad();
    await openDelete('Media');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Usuń' }));

    await vi.waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith(3));
    await vi.waitFor(() => expect(api.getCategories).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Kategoria usunięta')).toBeInTheDocument();
  });

  it('surfaces the backend Polish error when the delete fails', async () => {
    api.deleteCategory.mockRejectedValueOnce(new Error('Nie udało się usunąć'));
    await renderAndLoad();
    await openDelete('Media');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Nie udało się usunąć')).toBeInTheDocument();
  });
});
