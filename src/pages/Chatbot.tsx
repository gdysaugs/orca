import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { TopNav } from '../components/TopNav'
import { fetchWithAuth } from '../lib/authFetch'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import './camera.css'
import './video-studio.css'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    title: string
    url: string
    snippet?: string
  }>
}

const MAX_MESSAGE_LENGTH = 1000
const MAX_HISTORY_MESSAGES = 8
const TICKET_COST = 1
const OAUTH_REDIRECT_URL =
  typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

const extractError = (payload: any) =>
  String(
    payload?.error ||
      payload?.message ||
      payload?.detail ||
      payload?.output?.error ||
      payload?.result?.error ||
      payload?.output?.output?.error ||
      '',
  )

export function Chatbot() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [enableSearch, setEnableSearch] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null)
  const runIdRef = useRef(0)
  const sendLockRef = useRef(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  const canSend = Boolean(session && message.trim() && !isRunning)

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session ?? null)
      setAuthReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

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

  const fetchTickets = useCallback(async () => {
    const res = await fetchWithAuth('/api/tickets')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return null
    const next = Number(data?.tickets ?? 0)
    setTicketCount(Number.isFinite(next) ? next : 0)
    return Number.isFinite(next) ? next : 0
  }, [])

  useEffect(() => {
    if (!session) {
      setTicketCount(null)
      return
    }
    void fetchTickets()
  }, [fetchTickets, session])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, statusMessage])

  const handleGoogleSignIn = useCallback(async () => {
    if (isRunning) return
    if (!supabase || !isAuthConfigured) {
      setStatusMessage('認証設定が未完了です。')
      return
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: OAUTH_REDIRECT_URL,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) {
      setStatusMessage(error.message)
      return
    }
    if (data?.url) window.location.assign(data.url)
  }, [isRunning])

  const handleSend = useCallback(async () => {
    const text = message.trim()
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }
    if (!text || isRunning || sendLockRef.current) return
    sendLockRef.current = true
    if (text.length > MAX_MESSAGE_LENGTH) {
      sendLockRef.current = false
      setErrorModalMessage(`メッセージは${MAX_MESSAGE_LENGTH}文字以内で入力してください。`)
      return
    }

    try {
      const latest = await fetchTickets()
      if (latest !== null && latest < TICKET_COST) {
        sendLockRef.current = false
        setShowTicketModal(true)
        return
      }
    } catch {
      sendLockRef.current = false
      setErrorModalMessage('クレジット確認に失敗しました。もう一度試して。')
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    const history = messages.slice(-MAX_HISTORY_MESSAGES)
    const userMessage: ChatMessage = { role: 'user', content: text }
    setMessages((current) => [...current, userMessage])
    setMessage('')
    setIsRunning(true)
    setStatusMessage('返信を生成しています')
    setErrorModalMessage(null)

    try {
      const res = await fetchWithAuth('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            message: text,
            history,
            enable_search: enableSearch,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) setTicketCount(nextTickets)
      if (!res.ok) {
        if (res.status === 402) setShowTicketModal(true)
        throw new Error(extractError(data) || '送信に失敗しました。')
      }

      const reply = typeof data?.reply === 'string' ? data.reply.trim() : ''
      if (!reply) throw new Error('返答を取得できませんでした。')
      const sources = Array.isArray(data?.sources) ? data.sources : []
      if (runIdRef.current !== runId) return
      setMessages((current) => [...current, { role: 'assistant', content: reply, sources }])
      setStatusMessage('')
      await fetchTickets()
    } catch (error) {
      if (runIdRef.current === runId) {
        setErrorModalMessage(error instanceof Error ? error.message : '送信に失敗しました。')
        setStatusMessage('')
      }
    } finally {
      sendLockRef.current = false
      if (runIdRef.current === runId) setIsRunning(false)
    }
  }, [enableSearch, fetchTickets, isRunning, message, messages, session])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void handleSend()
    },
    [handleSend],
  )

  const handleMessageKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      void handleSend()
    },
    [handleSend],
  )

  if (!authReady) {
    return (
      <div className="studio-page">
        <TopNav />
        <div className="studio-loader">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="studio-page situation-chat-root">
      <TopNav />
      <main className="situation-chat-page">
        <section className="situation-chat-shell" aria-label="チャット">
          <header className="situation-chat-header">
            <div className="situation-chat-avatar" aria-hidden="true">
              <img src="/chat-character.png" alt="" />
            </div>
            <div className="situation-chat-title">
              <p>
                <span>NGなしでなんでも</span>
                <span>答えるわよ</span>
              </p>
            </div>
            <div className="situation-chat-credit" aria-label="クレジット">
              <span>残り</span>
              <strong>{session ? ticketCount ?? 0 : '--'}</strong>
              <span>枚</span>
              <small>{TICKET_COST}枚/送信</small>
            </div>
          </header>

          {!session && (
            <div className="situation-chat-login">
              <p>チャットを使うにはGoogleログインが必要です。</p>
              <button type="button" className="studio-btn studio-btn--primary" onClick={handleGoogleSignIn} disabled={!isAuthConfigured}>
                Googleでログイン
              </button>
            </div>
          )}

          <div className="situation-chat-thread" ref={logRef}>
            {!messages.length && !isRunning && (
              <div className="situation-chat-empty">
                <strong>メッセージを送信してください</strong>
                <span>Web検索をオンにすると検索結果を参考に返答します。</span>
              </div>
            )}

            {messages.map((item, index) => (
              <article key={`${item.role}-${index}`} className={`situation-chat-message situation-chat-message--${item.role}`}>
                <div className="situation-chat-bubble">
                  <p>{item.content}</p>
                  {Boolean(item.sources?.length) && (
                    <div className="situation-chat-sources">
                      <strong>検索結果</strong>
                      {item.sources?.map((source, sourceIndex) => (
                        <a key={`${source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer">
                          {source.title || source.url}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}

            {isRunning && (
              <article className="situation-chat-message situation-chat-message--assistant">
                <div className="situation-chat-bubble situation-chat-bubble--typing" role="status" aria-live="polite">
                  <span className="situation-chat-dot" />
                  <span className="situation-chat-dot" />
                  <span className="situation-chat-dot" />
                  <span className="situation-chat-typing-label">ちょっと待ちなさいよ。今考えてるんだから</span>
                </div>
              </article>
            )}
          </div>

          <form className="situation-chat-composer" onSubmit={handleSubmit}>
            <div className="situation-chat-composer-meta">
              <label className="situation-chat-search">
                <input
                  type="checkbox"
                  checked={enableSearch}
                  onChange={(event) => setEnableSearch(event.target.checked)}
                  disabled={isRunning}
                />
                <span>Web検索</span>
              </label>
              <span>{message.length}/{MAX_MESSAGE_LENGTH}</span>
            </div>

            <div className="situation-chat-input-row">
              <textarea
                rows={1}
                maxLength={MAX_MESSAGE_LENGTH}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                placeholder={session ? 'メッセージを入力' : 'ログインすると入力できます'}
                disabled={!session || isRunning}
              />
              <button type="submit" className="situation-chat-send" disabled={!canSend} aria-label="送信">
                ↑
              </button>
            </div>

            {statusMessage && !isRunning && <p className="situation-chat-status">{statusMessage}</p>}
          </form>
        </section>
      </main>

      {showTicketModal && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>クレジットが不足しています</h3>
            <p>チャットにはクレジットが必要です。購入ページから追加してください。</p>
            <div className="studio-modal-actions">
              <button type="button" onClick={() => setShowTicketModal(false)}>閉じる</button>
              <a href="/purchase">購入する</a>
            </div>
          </div>
        </div>
      )}

      {errorModalMessage && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>送信できませんでした</h3>
            <p>{errorModalMessage}</p>
            <div className="studio-modal-actions">
              <button type="button" onClick={() => setErrorModalMessage(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
