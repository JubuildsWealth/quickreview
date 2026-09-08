import { useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { Star } from 'lucide-react'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        toast.success('Account created! Check your email to verify.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-10 h-10 mx-auto mb-5 rounded-xl border border-gray-200 flex items-center justify-center">
            <span className="text-base font-semibold tracking-tight text-brand-700">
              A
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-gray-950">
            Arova
          </h1>

          <p className="text-sm text-gray-500 mt-2">
            Get more Google reviews for your trade business.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-7">
          <div className="mb-6">
            <h2 className="text-xl font-semibold tracking-[-0.025em] text-gray-950">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>

            <p className="text-sm leading-5 text-gray-500 mt-1.5">
              {mode === 'login'
                ? 'Log in to manage your customers and follow-ups.'
                : 'Start collecting more reviews from your customers.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 bg-gray-50 rounded-xl p-1 mb-6">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                  mode === m
                    ? 'bg-white text-gray-950 border border-gray-200'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Email
              </label>

              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 border border-gray-200 rounded-xl px-3.5 text-sm text-gray-950 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-2">
                Password
              </label>

              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 border border-gray-200 rounded-xl px-3.5 text-sm text-gray-950 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
                placeholder="Min 6 characters"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-brand-600 text-white rounded-xl text-sm font-semibold tracking-[-0.01em] hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Log in'
                  : 'Create account'}
            </button>
          </form>

          {mode === 'signup' && (
            <p className="text-xs text-gray-400 text-center mt-5">
              By signing up you agree to our Terms of Service.
            </p>
          )}
        </div>

        <p className="text-xs font-medium tracking-[-0.01em] text-gray-400 text-center mt-5">
          Built to help you get more customers.
        </p>
      </div>
    </div>
  )
}
