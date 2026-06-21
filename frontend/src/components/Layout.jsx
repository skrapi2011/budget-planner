import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { useTheme } from '../ThemeContext'

const navItems = [
  { to: '/dashboard', label: 'Panel' },
  { to: '/wydatki', label: 'Wydatki' },
  { to: '/kategorie', label: 'Kategorie' },
  { to: '/budzety', label: 'Budżety' },
  { to:'/tags', label: 'Tagi' },
]

export default function Layout({ children, username }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { isDark, toggleTheme } = useTheme()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-950">
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50 dark:bg-slate-900 dark:border-slate-700 dark:shadow-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <span className="text-xl font-bold text-[#32a852]">
                Planowanie Wydatków
              </span>

              <button
                type="button"
                className="md:hidden p-2 rounded-md text-gray-600 hover:text-[#32a852] hover:bg-gray-100 dark:hover:bg-slate-700 dark:text-slate-400"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={menuOpen ? 'Zamknij menu' : 'Otwórz menu'}
              >
                {menuOpen ? (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>

              <div className="hidden md:flex items-center gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === item.to
                        ? 'text-[#32a852] bg-green-50 dark:bg-emerald-950/40'
                        : 'text-gray-600 hover:text-[#32a852] hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-md text-gray-400 hover:text-[#32a852] hover:bg-gray-100 transition-colors dark:hover:bg-slate-700 dark:text-slate-400"
                aria-label={isDark ? 'Tryb jasny' : 'Tryb ciemny'}
              >
                {isDark ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                  </svg>
                )}
              </button>

              {username && (
                <span className="text-sm font-medium text-gray-700 hidden sm:inline dark:text-slate-300">{username}</span>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-white bg-[#32a852] hover:bg-[#1f8c42] transition-colors"
              >
                Wyloguj się
              </button>
            </div>
          </div>

          {menuOpen && (
            <div className="md:hidden pb-4">
              <div className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      location.pathname === item.to
                        ? 'text-[#32a852] bg-green-50 dark:bg-emerald-950/40'
                        : 'text-gray-600 hover:text-[#32a852] hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
