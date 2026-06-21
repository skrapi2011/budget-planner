import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login(username, password);
    } catch (err) {
      setError(err.message || 'Nieprawidłowa nazwa użytkownika lub hasło');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 dark:from-slate-900 dark:to-slate-800">
      <div className="w-full max-w-sm p-8 m-auto bg-white rounded-lg shadow-md dark:bg-slate-800">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Planowanie Wydatków</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Zaloguj się do konta</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md dark:bg-red-950/40 dark:border-red-800/60">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-300">
              Nazwa użytkownika
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852] dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-300">
              Hasło
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-[#32a852] focus:border-[#32a852] dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 text-sm font-medium rounded-md shadow-sm text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Logowanie...' : 'Zaloguj się'}
          </button>
        </form>

        <p className="mt-4 text-xs text-center text-gray-400 dark:text-slate-500">
           Nie masz konta?{' '}
           <button onClick={() => navigate('/rejestracja')} className="text-[#32a852] hover:underline font-medium">
             Zarejestruj się
           </button>
         </p>
      </div>
    </div>
  );
}
