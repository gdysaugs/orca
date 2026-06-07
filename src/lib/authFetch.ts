import { supabase } from './supabaseClient'

const REFRESH_WINDOW_MS = 60_000
const TOKEN_RETRY_DELAY_MS = 350

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

const withRetriedAuthHeader = async (headersInit?: HeadersInit) => {
  let headers = await withAuthHeader(headersInit, true)
  if (headers.has('Authorization')) return headers

  await wait(TOKEN_RETRY_DELAY_MS)
  headers = await withAuthHeader(headersInit, true)
  return headers
}

const unauthenticatedResponse = () =>
  new Response(JSON.stringify({ error: 'ログインが必要です。' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })

export const fetchWithAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const firstHeaders = await withAuthHeader(init.headers)
  if (!firstHeaders.has('Authorization')) {
    const retryHeaders = await withRetriedAuthHeader(init.headers)
    if (!retryHeaders.has('Authorization')) return unauthenticatedResponse()

    return fetch(input, {
      ...init,
      headers: retryHeaders,
    })
  }

  const first = await fetch(input, {
    ...init,
    headers: firstHeaders,
  })

  if (first.status !== 401) {
    return first
  }

  const retryHeaders = await withRetriedAuthHeader(init.headers)
  if (!retryHeaders.has('Authorization')) {
    return first
  }

  const retry = await fetch(input, {
    ...init,
    headers: retryHeaders,
  })

  if (retry.status !== 401) return retry

  await wait(TOKEN_RETRY_DELAY_MS)
  const finalHeaders = await withRetriedAuthHeader(init.headers)
  if (!finalHeaders.has('Authorization')) return retry

  return fetch(input, {
    ...init,
    headers: finalHeaders,
  })
}
