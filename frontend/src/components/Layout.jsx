import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

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

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <span className="text-xl font-bold text-[#32a852]">
                Planowanie Wydatków
              </span>

              <button
                type="button"
                className="md:hidden p-2 rounded-md text-gray-600 hover:text-[#32a852] hover:bg-gray-100"
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
? 'text-[#32a852] bg-green-50'
: 'text-gray-600 hover:text-[#32a852] hover:bg-gray-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              {username && (
                <span className="text-sm font-medium text-gray-700 hidden sm:inline">{username}</span>
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
? 'text-[#32a852] bg-green-50'
: 'text-gray-600 hover:text-[#32a852] hover:bg-gray-100'
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
