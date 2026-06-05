import { supabase } from './supabaseClient'

const REFRESH_WINDOW_MS = 60_000

const refreshAccessToken = async () => {
  if (!supabase) return ''

  try {
    const { data } = await supabase.auth.refreshSession()
    return data.session?.access_token ?? ''
  } catch {
    return ''
  }
}

export const getFreshAccessToken = async () => {
  if (!supabase) return ''

  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    const token = session?.access_token ?? ''
    if (!token) return await refreshAccessToken()

    const expiresAtMs = Number(session?.expires_at ?? 0) * 1000
    if (expiresAtMs && expiresAtMs - Date.now() < REFRESH_WINDOW_MS) {
      return (await refreshAccessToken()) || token
    }

    return token
  } catch {
    return await refreshAccessToken()
  }
}

const withAuthHeader = async (headersInit?: HeadersInit, forceRefresh = false) => {
  const headers = new Headers(headersInit)
  headers.delete('Authorization')
  const token = forceRefresh ? await refreshAccessToken() : await getFreshAccessToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return headers
}

export const fetchWithAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const firstHeaders = await withAuthHeader(init.headers)
  if (!firstHeaders.has('Authorization')) {
    return new Response(JSON.stringify({ error: 'ログインが必要です。' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const first = await fetch(input, {
    ...init,
    headers: firstHeaders,
  })

  if (first.status !== 401) {
    return first
  }

  const retryHeaders = await withAuthHeader(init.headers, true)
  if (!retryHeaders.has('Authorization')) {
    return first
  }

  return fetch(input, {
    ...init,
    headers: retryHeaders,
  })
}
