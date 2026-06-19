import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Subscribe from './pages/Subscribe'
import Navbar from './components/Navbar'

function PrivateRoute({ children, business }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [business, setBusiness] = useState(null)
  const [loadingBusiness, setLoadingBusiness] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchBusiness(session)
      else setLoadingBusiness(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s) fetchBusiness(s)
      else { setBusiness(null); setLoadingBusiness(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  const fetchBusiness = async (session) => {
    setLoadingBusiness(true)
    try {
      const res = await fetch('/api/business', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.ok) {
        const { business } = await res.json()
        setBusiness(business)
      }
    } catch (e) {
      console.error('Failed to fetch business', e)
    } finally {
      setLoadingBusiness(false)
    }
  }

  if (session === undefined || loadingBusiness) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      {session && business && <Navbar business={business} />}
      <Routes>
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/dashboard" />} />

        <Route
          path="/onboarding"
          element={
            !session ? <Navigate to="/login" /> :
            business ? <Navigate to="/dashboard" /> :
            <Onboarding onComplete={setBusiness} />
          }
        />

        <Route
          path="/subscribe"
          element={
            !session ? <Navigate to="/login" /> :
            !business ? <Navigate to="/onboarding" /> :
            <Subscribe business={business} />
          }
        />

        <Route
          path="/dashboard"
          element={
            !session ? <Navigate to="/login" /> :
            !business ? <Navigate to="/onboarding" /> :
            business.subscription_status !== 'active' ? <Navigate to="/subscribe" /> :
            <Dashboard business={business} />
          }
        />

        <Route
          path="/customers"
          element={
            !session ? <Navigate to="/login" /> :
            !business ? <Navigate to="/onboarding" /> :
            business.subscription_status !== 'active' ? <Navigate to="/subscribe" /> :
            <Customers business={business} />
          }
        />

        <Route path="*" element={
          !session ? <Navigate to="/login" /> :
          !business ? <Navigate to="/onboarding" /> :
          business.subscription_status !== 'active' ? <Navigate to="/subscribe" /> :
          <Navigate to="/dashboard" />
        } />
      </Routes>
    </>
  )
}
