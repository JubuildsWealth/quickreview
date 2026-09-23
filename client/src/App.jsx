import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Subscribe from './pages/Subscribe'
import Rating from './pages/Rating'
import Invoices from './pages/Invoices'
import Settings from './pages/Settings'
import Automations from './pages/Automations'
import Feedback from './pages/Feedback'
import Navbar from './components/Navbar'

export default function App() {
  const location = useLocation()

  // Customer rating pages are fully public and should never depend on
  // the Arova dashboard authentication state.
  const isPublicRatingRoute = location.pathname.startsWith('/rate/')

  const [session, setSession] = useState(undefined)
  const [business, setBusiness] = useState(null)
  const [loadingBusiness, setLoadingBusiness] = useState(true)

  useEffect(() => {
    // The public rating flow does not need dashboard authentication.
    if (isPublicRatingRoute) {
      setLoadingBusiness(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)

      if (session) {
        fetchBusiness(session)
      } else {
        setLoadingBusiness(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)

      if (nextSession) {
        fetchBusiness(nextSession)
      } else {
        setBusiness(null)
        setLoadingBusiness(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [isPublicRatingRoute])

  const fetchBusiness = async (currentSession) => {
    setLoadingBusiness(true)

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/business`,
        {
          headers: {
            Authorization: `Bearer ${currentSession.access_token}`,
          },
        }
      )

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

  // Public customer review flow.
  // Render this before any dashboard auth/loading logic.
  if (isPublicRatingRoute) {
    return (
      <Routes>
        <Route path="/rate/:slug" element={<Rating />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (session === undefined || loadingBusiness) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      {session && business && <Navbar business={business} />}

      <Routes>
        <Route
          path="/login"
          element={
            !session ? <Login /> : <Navigate to="/dashboard" replace />
          }
        />

        <Route
          path="/onboarding"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : business ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Onboarding onComplete={setBusiness} />
            )
          }
        />

        <Route
          path="/subscribe"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <Subscribe business={business} />
            )
          }
        />

        <Route
          path="/dashboard"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Dashboard business={business} />
            )
          }
        />

        <Route
          path="/customers"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Customers business={business} />
            )
          }
        />

        <Route
          path="/invoices"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Invoices business={business} />
            )
          }
        />

        <Route
          path="/automations"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Automations business={business} />
            )
          }
        />

        <Route
          path="/feedback"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Feedback business={business} />
            )
          }
        />

        <Route
          path="/settings"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Settings
                business={business}
                onUpdate={setBusiness}
              />
            )
          }
        />

        <Route
          path="*"
          element={
            !session ? (
              <Navigate to="/login" replace />
            ) : !business ? (
              <Navigate to="/onboarding" replace />
            ) : business.subscription_status !== 'active' ? (
              <Navigate to="/subscribe" replace />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
      </Routes>
    </>
  )
}
