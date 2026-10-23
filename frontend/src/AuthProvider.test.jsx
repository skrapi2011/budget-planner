import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import * as api from './api';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './AuthContext';

// The auth contract (AGENTS.md §4): login/register store the JWT in localStorage, the
// provider validates a stored token at startup, and clearSession() is the synchronous
// path the 401 handler uses. These tests mock api.js (the only HTTP layer) and assert the
// state machine, not the network.

function Probe() {
  const { user, token, login, logout, clearSession, adoptSession } = useAuth();
  return (
    <div>
      <span data-testid="user">{user ?? 'none'}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <button type="button" onClick={() => login('admin', 'admin123')}>login</button>
      <button type="button" onClick={() => logout()}>logout</button>
      <button type="button" onClick={clearSession}>clear</button>
      <button type="button" onClick={adoptSession}>adopt</button>
    </div>
  );
}

const byName = (n) => screen.getByRole('button', { name: n });

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, 'getAuthStatus').mockResolvedValue({ authenticated: true, username: 'admin' });
  vi.spyOn(api, 'login').mockImplementation(async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', 'admin');
    return { token: 'tok', username: 'admin' };
  });
  vi.spyOn(api, 'logout').mockResolvedValue({ success: true });
});

describe('startup validation', () => {
  it('calls /auth/status when a stored token exists', async () => {
    localStorage.setItem('token', 'stale');
    localStorage.setItem('user', 'admin');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(api.getAuthStatus).toHaveBeenCalled());
  });

  it('does not call the backend when there is no token', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(api.getAuthStatus).not.toHaveBeenCalled();
  });

  it('drops a token the server no longer accepts, before the first page renders', async () => {
    localStorage.setItem('token', 'stale');
    localStorage.setItem('user', 'admin');
    api.getAuthStatus.mockResolvedValue({ authenticated: false });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('keeps a valid session', async () => {
    localStorage.setItem('token', 'valid');
    localStorage.setItem('user', 'admin');
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(api.getAuthStatus).toHaveBeenCalled());
    expect(screen.getByTestId('user')).toHaveTextContent('admin');
    expect(screen.getByTestId('token')).toHaveTextContent('valid');
  });

  it('survives a backend that is down at startup (no crash, session kept)', async () => {
    localStorage.setItem('token', 'valid');
    localStorage.setItem('user', 'admin');
    api.getAuthStatus.mockRejectedValue(new Error('Unauthorized'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(api.getAuthStatus).toHaveBeenCalled());
    expect(screen.getByTestId('user')).toHaveTextContent('admin');
  });
});

describe('login / logout', () => {
  it('login puts the session in state and localStorage', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { byName('login').click(); });
    expect(screen.getByTestId('user')).toHaveTextContent('admin');
    expect(screen.getByTestId('token')).toHaveTextContent('tok');
    expect(localStorage.getItem('token')).toBe('tok');
  });

  it('logout clears state and storage', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', 'admin');
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { byName('logout').click(); });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.logout).toHaveBeenCalled();
  });

  it('logout clears the session even when the backend call fails (JWT is stateless)', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', 'admin');
    api.logout.mockRejectedValue(new Error('boom'));
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { byName('logout').click(); });
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clearSession is synchronous and needs no network', () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('user', 'admin');
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => byName('clear').click());
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
  });
});

describe('adoptSession', () => {
  it('picks up a session already in localStorage with no network call', () => {
    // Registration: api.register() stores the token, then RegisterPage adopts it.
    localStorage.setItem('token', 'rtok');
    localStorage.setItem('user', 'nowy');
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => byName('adopt').click());
    expect(screen.getByTestId('user')).toHaveTextContent('nowy');
    expect(screen.getByTestId('token')).toHaveTextContent('rtok');
    // No login call: registration already minted the token. The startup /auth/status
    // validation is a separate concern (covered above) and is expected to run.
    expect(api.login).not.toHaveBeenCalled();
  });

  it('does nothing when storage is empty', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => byName('adopt').click());
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });
});

describe('useAuth', () => {
  it('throws outside the provider', () => {
    const spy = console.error;
    console.error = () => {};
    expect(() => render(<Probe />)).toThrow('useAuth must be used within AuthProvider');
    console.error = spy;
  });

  it('exposes the documented surface', () => {
    let value;
    function Probe2() {
      const v = useAuth();
      // Recording during render is a side effect (react-hooks/globals); an effect is the
      // sanctioned place, and it runs before the assertions below.
      useEffect(() => { value = v; }, [v]);
      return null;
    }
    render(<AuthProvider><Probe2 /></AuthProvider>);
    expect(Object.keys(value).sort()).toEqual(
      ['adoptSession', 'clearSession', 'login', 'logout', 'token', 'user'],
    );
  });
});
