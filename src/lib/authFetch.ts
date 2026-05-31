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
    if (!token) return ''

    const expiresAtMs = Number(session?.expires_at ?? 0) * 1000
    if (expiresAtMs && expiresAtMs - Date.now() < REFRESH_WINDOW_MS) {
      return (await refreshAccessToken()) || token
    }

    return token
  } catch {
    return ''
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
  const first = await fetch(input, {
    ...init,
    headers: await withAuthHeader(init.headers),
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
