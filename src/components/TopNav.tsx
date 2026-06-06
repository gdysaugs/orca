import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export function TopNav() {
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(!supabase)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    if (!supabase) {
      setIsAuthReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setIsAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsAuthReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || typeof window === 'undefined') return

    const rawHash = window.location.hash
    if (!rawHash || !rawHash.includes('access_token=')) return

    const hashParams = new URLSearchParams(rawHash.startsWith('#') ? rawHash.slice(1) : rawHash)
    const accessToken = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token')
    if (!accessToken || !refreshToken) return

    let isCancelled = false
    void supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error || isCancelled) return
        const url = new URL(window.location.href)
        url.hash = ''
        window.history.replaceState({}, document.title, url.toString())
      })
      .catch(() => {
        // no-op: onAuthStateChange/getSession already handles auth status display.
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const isLoggedIn = Boolean(session)
  const homePath = '/'

  useEffect(() => {
    setIsMenuOpen(false)
  }, [location.pathname])

  const closeMenu = () => setIsMenuOpen(false)

  return (
    <header className={`top-nav${isAuthReady && !isLoggedIn ? ' top-nav--guest' : ''}`}>
      <div className='top-nav__brand'>
        <img className='top-nav__logo' src='/apple-touch-icon.png' alt='' aria-hidden='true' />
        <NavLink className='top-nav__title' to={homePath}>
          AkumaAI
        </NavLink>
      </div>
      <button
        className='top-nav__menu-button'
        type='button'
        aria-label='メニュー'
        aria-expanded={isMenuOpen}
        aria-controls='top-nav-menu'
        onClick={() => setIsMenuOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      <div id='top-nav-menu' className={`top-nav__links${isMenuOpen ? ' is-open' : ''}`}>
        <NavLink className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} to='/' end onClick={closeMenu}>
          動画生成
        </NavLink>
        <NavLink className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} to='/image-generate' onClick={closeMenu}>
          画像生成
        </NavLink>
        <a className='top-nav__link' href='https://satanai.org/' target='_blank' rel='noopener noreferrer' onClick={closeMenu}>
          SatanAI
        </a>
        <a className='top-nav__link' href='https://devilai.win/' target='_blank' rel='noopener noreferrer' onClick={closeMenu}>
          DevilAI
        </a>
        <NavLink className={({ isActive }) => `top-nav__link${isActive ? ' is-active' : ''}`} to='/purchase' onClick={closeMenu}>
          ショップ
        </NavLink>
      </div>
    </header>
  )
}
