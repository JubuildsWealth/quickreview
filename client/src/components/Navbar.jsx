import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { LayoutDashboard, Users, Star, LogOut, CreditCard, FileText, Settings, Zap, MessageSquare, ClipboardList, Menu, X } from 'lucide-react'

export default function Navbar({ business }) {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const handleManageBilling = async () => {
    try {
      const { data } = await api.post('/stripe/portal')
      window.location.href = data.url
    } catch {
      toast.error('Could not open billing portal')
    }
  }

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/customers', label: 'Customers', icon: Users },
    { to: '/estimates', label: 'Estimates', icon: ClipboardList },
    { to: '/invoices', label: 'Invoices', icon: FileText },
    { to: '/feedback', label: 'Feedback', icon: MessageSquare },
    { to: '/automations', label: 'Automations', icon: Zap },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  const closeMobile = () => setMobileOpen(false)

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Left: Logo + desktop nav items */}
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="font-semibold text-lg text-brand-600" onClick={closeMobile}>
            Arova
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  location.pathname === to
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Right: Business name + Billing + Sign out (desktop) */}
        <div className="hidden md:flex items-center gap-2">
          <span className="text-sm text-gray-500 hidden sm:block">{business?.name}</span>
          <button
            onClick={handleManageBilling}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title="Manage billing"
          >
            <CreditCard className="w-4 h-4" />
            <span className="hidden sm:inline">Billing</span>
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>

        {/* Right: Hamburger (mobile only) */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
            {business?.name && (
              <div className="px-3 py-2 text-sm text-gray-500 border-b border-gray-100 mb-2">
                {business.name}
              </div>
            )}
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={closeMobile}
                className={`flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                  location.pathname === to
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
            <button
              onClick={() => { closeMobile(); handleManageBilling(); }}
              className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors text-left"
            >
              <CreditCard className="w-4 h-4" />
              Billing
            </button>
            <button
              onClick={() => { closeMobile(); handleSignOut(); }}
              className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
