import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { Account } from './pages/Account'
import { Home } from './pages/Home'
import { ImageEdit } from './pages/ImageEdit'
import { Video } from './pages/Video'

function AuthRoute({ session, children }: { session: Session | null; children: JSX.Element }) {
  if (!session) return <Navigate to='/' replace />
  return children
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    const supabaseClient = supabase
    let isCancelled = false

    const applyHashSession = async () => {
      if (typeof window === 'undefined') return
      const rawHash = window.location.hash
      if (!rawHash || !rawHash.includes('access_token=')) return

      const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash)
      const accessToken = hashParams.get('access_token')
      const refreshToken = hashParams.get('refresh_token')
      if (!accessToken || !refreshToken) return

      const { data, error } = await supabaseClient.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (error || isCancelled) return

      setSession(data.session ?? null)
      const url = new URL(window.location.href)
      url.hash = ''
      window.history.replaceState({}, document.title, url.toString())
    }

    void applyHashSession()

    supabaseClient.auth.getSession().then(({ data }) => {
      if (isCancelled) return
      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      isCancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (!authReady) return null

  return (
    <Routes>
      <Route path='/' element={session ? <Video /> : <Home />} />
      <Route path='/video' element={<Navigate to='/' replace />} />
      <Route path='/image-edit' element={<AuthRoute session={session}><ImageEdit /></AuthRoute>} />
      <Route path='/account' element={<AuthRoute session={session}><Account /></AuthRoute>} />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  )
}
