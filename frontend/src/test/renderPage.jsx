import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../AuthProvider';
import { ThemeProvider } from '../ThemeProvider';
import ToastProvider from '../components/ToastProvider';

// App.jsx wraps the routes in: ThemeProvider > AuthProvider > ToastProvider > Router.
// Rendering a page in isolation needs the same stack, so it is centralised here.
export function renderWithProviders(ui, { route = '/', ...rest } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
    rest,
  );
}
