import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || password.length < 4) {
      setError('Wymagana nazwa użytkownika i hasło min. 4 znaki.'); return; }
    if (password !== confirmPassword) {
      setError("Hasła nie są identyczne."); return; }

    setLoading(true);
    try {
      await api.register(username, password, confirmPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Rejestracja się nie powiodła.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <div className="w-full max-w-sm p-8 m-auto bg-white rounded-lg shadow-md text-center">
          <svg className="mx-auto mb-4 w-16 h-16 text-[#32a852]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>

          <h1 className="text-xl font-bold text-gray-900 mb-2">Rejestracja udana!</h1>
          <p className="text-sm text-gray-600 mb-4">Twoje konto zostało utworzone pomyślnie.</p>
          <button onClick={() => navigate('/login')} className="px-4 py-2 text-sm font-medium rounded-md text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors w-full">Przejdź do logowania</button>
        </div>
      </div>
    ); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-900 dark:to-slate-800">
      <div className="w-full max-w-sm p-8 m-auto bg-white rounded-lg shadow-md dark:bg-slate-800">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Planowanie Wydatków</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Utwórz nowe konto</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-950/40 dark:border-red-800/60">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reg-username" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-300">Nazwa użytkownika</label>
            <input id="reg-username" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852] dark:bg-slate-700 dark:border-slate-600 dark:text-white" required />
          </div>

          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-300">Hasło</label>
            <input id="reg-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852] dark:bg-slate-700 dark:border-slate-600 dark:text-white" required />
          </div>

          <div>
            <label htmlFor="reg-confirm-password" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-300">Powtórz hasło</label>
            <input id="reg-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852] dark:bg-slate-700 dark:border-slate-600 dark:text-white" required />
          </div>

          <button type="submit" disabled={loading} className="w-full px-4 py-2 text-sm font-medium rounded-md shadow-sm text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Zarejestruj się</button>
        </form>

        <p className="mt-4 text-xs text-center text-gray-400 dark:text-slate-500">Masz już konto?{' '}<button onClick={() => navigate('/login')} className="text-[#32a852] hover:underline font-medium">Zaloguj się</button></p>
      </div>
    </div>
  ); }
