import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { TopNav } from '../components/TopNav'
import { fetchWithAuth } from '../lib/authFetch'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import './camera.css'
import './video-studio.css'

type SubmitResult =
  | { prompt: string; jobId?: never; usageId?: string; ticketsLeft?: number }
  | { prompt?: never; jobId: string; usageId: string; ticketsLeft?: number }

const MAX_SOURCE_PROMPT_LENGTH = 500
const MAX_POLL_ATTEMPTS = 90
const OAUTH_REDIRECT_URL =
  typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const extractErrorMessage = (payload: any) =>
  payload?.error || payload?.message || payload?.detail || payload?.output?.error || payload?.result?.error

const normalizeErrorMessage = (value: unknown) => {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'object' && value) {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe.error ?? maybe.message ?? maybe.detail
    if (typeof picked === 'string' && picked) return picked
  }
  const raw = String(value ?? '').trim()
  return raw || 'プロンプト生成に失敗しました。'
}

export function PromptHelper() {
  const [sourcePrompt, setSourcePrompt] = useState('')
  const [resultPrompt, setResultPrompt] = useState('')
  const [ticketBalance, setTicketBalance] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const runIdRef = useRef(0)

  const trimmedPrompt = sourcePrompt.trim()
  const canGenerate = Boolean(trimmedPrompt && trimmedPrompt.length <= MAX_SOURCE_PROMPT_LENGTH && session && !isRunning)

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setTicketBalance(null)
      return
    }

    let active = true
    fetchWithAuth('/api/tickets')
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (!active) return
        const tickets = Number(data?.tickets)
        setTicketBalance(Number.isFinite(tickets) ? tickets : null)
      })
      .catch(() => {
        if (active) setTicketBalance(null)
      })

    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    if (!supabase || typeof window === 'undefined') return
    const hasCode = window.location.search.includes('code=')
    const hasState = window.location.search.includes('state=')
    if (!hasCode || !hasState) return

    supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
      if (error) {
        setStatusMessage(error.message)
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      window.history.replaceState({}, document.title, url.toString())
    })
  }, [])

  const handleGoogleSignIn = useCallback(async () => {
    if (isRunning) return
    if (!supabase || !isAuthConfigured) {
      setStatusMessage('認証設定が未完了です。')
      return
    }

    setStatusMessage('Googleログインへ移動します...')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    })
    if (error) {
      setStatusMessage(error.message)
      return
    }
    if (data?.url) {
      window.location.assign(data.url)
      return
    }
    setStatusMessage('認証URLの取得に失敗しました。')
  }, [isRunning])

  const submitPrompt = useCallback(async (): Promise<SubmitResult> => {
    const res = await fetchWithAuth('/api/prompt-helper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: trimmedPrompt }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(normalizeErrorMessage(extractErrorMessage(data)))

    const ticketsLeft = Number(data?.ticketsLeft ?? data?.tickets_left)
    const nextTicketsLeft = Number.isFinite(ticketsLeft) ? ticketsLeft : undefined
    const usageId = String(data?.usage_id ?? data?.usageId ?? '').trim()

    const prompt = typeof data?.prompt === 'string' ? data.prompt.trim() : ''
    if (prompt) return { prompt, usageId: usageId || undefined, ticketsLeft: nextTicketsLeft }

    const jobId = data?.jobId || data?.id || data?.job_id
    if (!jobId) throw new Error('ジョブIDを取得できませんでした。')
    if (!usageId) throw new Error('usage_idを取得できませんでした。')
    return { jobId: String(jobId), usageId, ticketsLeft: nextTicketsLeft }
  }, [trimmedPrompt])

  const pollJob = useCallback(async (jobId: string, usageId: string, runId: number) => {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i += 1) {
      if (runIdRef.current !== runId) return ''

      const res = await fetchWithAuth(
        `/api/prompt-helper?id=${encodeURIComponent(jobId)}&usage_id=${encodeURIComponent(usageId)}`,
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(normalizeErrorMessage(extractErrorMessage(data)))

      const ticketsLeft = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(ticketsLeft)) setTicketBalance(ticketsLeft)

      const prompt = typeof data?.prompt === 'string' ? data.prompt.trim() : ''
      if (prompt) return prompt

      setStatusMessage('英語プロンプトを生成中です...')
      await wait(2000 + i * 50)
    }

    throw new Error('プロンプト生成がタイムアウトしました。')
  }, [])

  const startGeneration = useCallback(async () => {
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }
    if (!trimmedPrompt) {
      setStatusMessage('元のプロンプトを入力してください。')
      return
    }
    if (trimmedPrompt.length > MAX_SOURCE_PROMPT_LENGTH) {
      setStatusMessage(`元のプロンプトは${MAX_SOURCE_PROMPT_LENGTH}文字以内で入力してください。`)
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setIsCopied(false)
    setResultPrompt('')
    setStatusMessage('英語プロンプトを生成中です...')

    try {
      const submitted = await submitPrompt()
      if (runIdRef.current !== runId) return
      if (Number.isFinite(Number(submitted.ticketsLeft))) {
        setTicketBalance(Number(submitted.ticketsLeft))
      }

      const nextPrompt = 'prompt' in submitted ? submitted.prompt : await pollJob(submitted.jobId, submitted.usageId, runId)
      if (!nextPrompt || runIdRef.current !== runId) return

      setResultPrompt(nextPrompt)
      setStatusMessage('プロンプト生成が完了しました。')
    } catch (error) {
      if (runIdRef.current !== runId) return
      setStatusMessage(normalizeErrorMessage(error))
    } finally {
      if (runIdRef.current === runId) setIsRunning(false)
    }
  }, [pollJob, session, submitPrompt, trimmedPrompt])

  const copyResult = useCallback(async () => {
    if (!resultPrompt) return
    try {
      await navigator.clipboard.writeText(resultPrompt)
      setIsCopied(true)
      setStatusMessage('コピーしました。動画生成画面に貼り付けて使えます。')
    } catch {
      setStatusMessage('コピーに失敗しました。手動で選択してコピーしてください。')
    }
  }, [resultPrompt])

  if (!authReady) {
    return (
      <div className="studio-page">
        <TopNav />
        <div className="studio-loader">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="studio-page">
      <TopNav />
      <main className="studio-wrap studio-wrap--single">
        <section className="studio-panel studio-panel--controls studio-panel--chat-only">
          <header className="studio-heading">
            <h1>動画プロンプト作成</h1>
            <p>日本語やメモから、動画生成に最適な英語プロンプトへ拡張し整えます。動画がうまく動かない、英語プロンプトが複雑、そんな悩みを解決します。ここで作成したプロンプトはコピーしてほかのサイトでも使えます。</p>
          </header>

          {!session ? (
            <div className="studio-login-cta">
              <p>Googleログイン後に利用できます。</p>
              <button className="studio-btn studio-btn--primary" type="button" onClick={handleGoogleSignIn}>
                Googleでログイン
              </button>
            </div>
          ) : (
            <>
              <div className="studio-ticket-row">
                <span className="studio-ticket-label">保有枚数</span>
                <span className="studio-ticket-value">{ticketBalance === null ? '-' : ticketBalance}</span>
                <span className="studio-ticket-cost">1枚消費</span>
              </div>

              <label className="studio-field">
                <span>元のプロンプト ({sourcePrompt.length}/{MAX_SOURCE_PROMPT_LENGTH})</span>
                <textarea
                  value={sourcePrompt}
                  maxLength={MAX_SOURCE_PROMPT_LENGTH}
                  rows={7}
                  onChange={(event) => setSourcePrompt(event.target.value)}
                  placeholder="例: 女性が振り返って走る、素早い動き、強い光、足音"
                />
              </label>

              <div className="studio-generate-dock">
                <button className="studio-btn studio-btn--primary" type="button" disabled={!canGenerate} onClick={startGeneration}>
                  {isRunning ? '生成中...' : '英語プロンプトを生成'}
                </button>
                {statusMessage && <p className="studio-status">{statusMessage}</p>}
              </div>

              <label className="studio-field">
                <span>生成結果</span>
                <textarea value={resultPrompt} readOnly rows={10} placeholder="ここに動画生成向けの英語プロンプトが表示されます。" />
              </label>

              <div className="studio-actions">
                <button className="studio-btn studio-btn--ghost" type="button" disabled={!resultPrompt} onClick={copyResult}>
                  {isCopied ? 'コピー済み' : 'コピー'}
                </button>
                <a className="studio-btn studio-btn--ghost" href="/">
                  動画生成へ
                </a>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
