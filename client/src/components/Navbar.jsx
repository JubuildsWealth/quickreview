import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { LayoutDashboard, Users, Star, LogOut, CreditCard } from 'lucide-react'

export default function Navbar({ business }) {
  const location = useLocation()

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
  ]

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="flex items-center gap-2 font-bold text-lg text-blue-600">
            <Star className="w-5 h-5 fill-current" />
            QuickReview
          </Link>
          <div className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location.pathname === to
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 hidden sm:block">{business?.name}</span>
          <button
            onClick={handleManageBilling}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            title="Manage billing"
          >
            <CreditCard className="w-4 h-4" />
            <span className="hidden sm:inline">Billing</span>
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
