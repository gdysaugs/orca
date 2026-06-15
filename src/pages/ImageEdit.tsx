import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Session } from '@supabase/supabase-js'
import { TopNav } from '../components/TopNav'
import { fetchWithAuth } from '../lib/authFetch'
import { saveGeneratedAsset } from '../lib/downloadMedia'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import './camera.css'
import './video-studio.css'

type SubmitImageEditResult =
  | { images: string[]; jobId?: never; usageId?: never }
  | { images?: never; jobId: string; usageId: string }

type AnglePreset = {
  id: string
  label: string
}

const ANGLE_PRESETS: AnglePreset[] = [
  { id: 'none', label: 'None' },
  { id: 'front', label: 'Front' },
  { id: 'left', label: 'Left Side' },
  { id: 'right', label: 'Right Side' },
  { id: 'back', label: 'Back' },
  { id: 'three_quarter_left', label: '3/4 Left' },
  { id: 'three_quarter_right', label: '3/4 Right' },
  { id: 'low', label: 'Low Angle' },
  { id: 'high', label: 'High Angle' },
  { id: 'closeup', label: 'Close-up' },
  { id: 'full_body', label: 'Full Body' },
]

const MAX_PROMPT_LENGTH = 1000
const MAX_NEGATIVE_PROMPT_LENGTH = 1000
const TICKET_COST = 1
const OAUTH_REDIRECT_URL = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeImage = (value: unknown, filename?: string) => {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  if (raw.startsWith('data:image/') || raw.startsWith('http') || raw.startsWith('blob:')) return raw
  if (raw.length < 128) return null
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : 'image/png'
  return `data:${mime};base64,${raw}`
}

const extractImageFromItem = (item: any) => {
  if (typeof item === 'string') return normalizeImage(item)
  if (!item || typeof item !== 'object') return null
  const raw =
    item.image ??
    item.data ??
    item.base64 ??
    item.content ??
    item.b64 ??
    item.image_base64 ??
    item.output_image_base64 ??
    item.url ??
    item.image_url ??
    item.file_url ??
    item.download_url ??
    item.output
  const filename = item.filename ?? item.name ?? item.file_name ?? item.path
  return normalizeImage(raw, filename)
}

const extractImageList = (payload: any) => {
  const roots = [
    payload,
    payload?.output,
    payload?.result,
    payload?.output?.output,
    payload?.result?.output,
    payload?.output?.result,
    payload?.result?.result,
    payload?.output?.data,
    payload?.result?.data,
    payload?.upstream,
    payload?.upstream?.output,
  ]

  for (const root of roots) {
    if (Array.isArray(root)) {
      const images = root.map(extractImageFromItem).filter(Boolean) as string[]
      if (images.length) return images
      continue
    }
    if (typeof root === 'string') {
      const image = normalizeImage(root)
      if (image) return [image]
      continue
    }
    if (!root || typeof root !== 'object') continue
    const listCandidates = [
      root.images,
      root.outputs,
      root.output_images,
      root.data,
      root.files,
      root.urls,
      root.image_urls,
      root.output_urls,
      root.artifacts,
      root.results,
    ]
    for (const candidate of listCandidates) {
      if (!Array.isArray(candidate)) continue
      const images = candidate.map(extractImageFromItem).filter(Boolean) as string[]
      if (images.length) return images
    }

    const direct =
      root.image ??
      root.image_base64 ??
      root.base64 ??
      root.output_image ??
      root.output_image_base64 ??
      root.output_base64 ??
      root.url ??
      root.image_url ??
      root.file_url ??
      root.download_url
    const image = normalizeImage(direct, root.filename ?? root.name)
    if (image) return [image]
  }

  return []
}

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id || payload?.result?.id

const extractUsageId = (payload: any) => payload?.usage_id || payload?.usageId || payload?.output?.usage_id || ''

const extractStatus = (payload: any) =>
  String(
    payload?.status ||
      payload?.state ||
      payload?.output?.status ||
      payload?.result?.status ||
      payload?.output?.output?.status ||
      payload?.result?.output?.status ||
      '',
  )

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.detail ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'リクエストに失敗しました。'
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe.error ?? maybe.message ?? maybe.detail
    if (typeof picked === 'string' && picked) return picked
  }
  const raw = String(value).trim()
  const lowered = raw.toLowerCase()
  if (lowered.includes('out of memory') || lowered.includes('cuda') || lowered.includes('oom')) {
    return 'GPUメモリ不足です。時間を置いて再試行してください。'
  }
  if (lowered.includes('not enough tickets') || lowered.includes('credit')) return 'クレジットが不足しています。'
  return raw || 'リクエストに失敗しました。'
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const isRetryableStatusCheck = (status: number) => {
  if (status === 0 || status === 408 || status === 409 || status === 425 || status === 429) return true
  return status >= 500
}

const makeObjectUrl = (file: File | null) => (file ? URL.createObjectURL(file) : '')

export function ImageEdit() {
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [referenceFile, setReferenceFile] = useState<File | null>(null)
  const [sourcePreview, setSourcePreview] = useState('')
  const [referencePreview, setReferencePreview] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [anglePreset, setAnglePreset] = useState('none')
  const [cfg, setCfg] = useState(1)
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isSavingResult, setIsSavingResult] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [isPremiumMember, setIsPremiumMember] = useState(false)
  const runIdRef = useRef(0)

  const accessToken = session?.access_token ?? ''
  const trimmedPrompt = prompt.trim()
  const trimmedNegativePrompt = negativePrompt.trim()
  const hasAnglePreset = anglePreset !== 'none'
  const hasEditInstruction = Boolean(trimmedPrompt || hasAnglePreset)
  const canGenerate = Boolean(
    sourceFile &&
      hasEditInstruction &&
      (!hasAnglePreset || isPremiumMember) &&
      trimmedPrompt.length <= MAX_PROMPT_LENGTH &&
      trimmedNegativePrompt.length <= MAX_NEGATIVE_PROMPT_LENGTH &&
      session &&
      !isRunning,
  )
  const viewerStyle = useMemo(
    () =>
      ({
        '--studio-aspect': '1 / 1',
      }) as CSSProperties,
    [],
  )

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

  useEffect(() => {
    return () => {
      if (sourcePreview) URL.revokeObjectURL(sourcePreview)
    }
  }, [sourcePreview])

  useEffect(() => {
    return () => {
      if (referencePreview) URL.revokeObjectURL(referencePreview)
    }
  }, [referencePreview])

  const fetchTickets = useCallback(async () => {
    setTicketStatus('loading')
    setTicketMessage('')

    try {
      const res = await fetchWithAuth('/api/tickets')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTicketStatus('error')
        setTicketMessage(data?.error || 'クレジット情報の取得に失敗しました。')
        setTicketCount(null)
        setIsPremiumMember(false)
        return null
      }

      const nextCount = Number(data?.tickets ?? 0)
      setTicketStatus('idle')
      setTicketMessage('')
      setTicketCount(nextCount)
      setIsPremiumMember(Boolean(data?.premium_member ?? data?.premiumMember))
      return nextCount
    } catch {
      setTicketStatus('error')
      setTicketMessage('クレジット情報の取得に失敗しました。')
      setTicketCount(null)
      setIsPremiumMember(false)
      return null
    }
  }, [])

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      setIsPremiumMember(false)
      return
    }
    void fetchTickets()
  }, [accessToken, fetchTickets, session])

  const handleAnglePresetChange = useCallback(
    (id: string) => {
      if (isRunning) return
      if (id !== 'none' && !isPremiumMember) {
        setStatusMessage('角度変更はPremiumメンバー限定です。')
        return
      }
      setAnglePreset(id)
    },
    [isPremiumMember, isRunning],
  )

  const handleGoogleSignIn = useCallback(async () => {
    if (isRunning) return
    if (!supabase || !isAuthConfigured) {
      setStatusMessage('認証設定が未完了です。')
      return
    }

    setStatusMessage('Googleログインへ移動します…')
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

  const setSource = useCallback((file: File | null) => {
    setSourceFile(file)
    setSourcePreview(makeObjectUrl(file))
  }, [])

  const setReference = useCallback((file: File | null) => {
    setReferenceFile(file)
    setReferencePreview(makeObjectUrl(file))
  }, [])

  const submitImageEdit = useCallback(async (): Promise<SubmitImageEditResult> => {
    if (!sourceFile) throw new Error('元画像を選択してください。')

    const body = new FormData()
    body.set('image', sourceFile)
    if (referenceFile) body.append('reference_images', referenceFile)
    body.set('prompt', trimmedPrompt)
    body.set('negative_prompt', trimmedNegativePrompt)
    body.set('angle_prompt', anglePreset)
    body.set('cfg', String(cfg))

    const res = await fetchWithAuth('/api/image-edit', {
      method: 'POST',
      body,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(normalizeErrorMessage(extractErrorMessage(data) || '画像編集に失敗しました。'))
    }

    const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
    if (Number.isFinite(nextTickets)) setTicketCount(nextTickets)

    const images = extractImageList(data)
    if (images.length) return { images }

    const jobId = extractJobId(data)
    const usageId = extractUsageId(data)
    if (!jobId || !usageId) throw new Error('ジョブIDを取得できませんでした。')
    return { jobId: String(jobId), usageId: String(usageId) }
  }, [anglePreset, cfg, referenceFile, sourceFile, trimmedNegativePrompt, trimmedPrompt])

  const pollJob = useCallback(async (jobId: string, usageId: string, runId: number) => {
    let statusCheckFailures = 0
    let completedWithoutImage = 0
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return null

      const params = new URLSearchParams({
        id: jobId,
        usage_id: usageId,
      })

      let res: Response
      let data: any = {}
      try {
        res = await fetchWithAuth(`/api/image-edit?${params.toString()}`)
        data = await res.json().catch(() => ({}))
      } catch {
        statusCheckFailures += 1
        if (statusCheckFailures < 30) {
          setStatusMessage('ステータス確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error('ステータス確認に失敗しました。')
      }

      if (!res.ok) {
        const message = normalizeErrorMessage(extractErrorMessage(data) || 'ステータス確認に失敗しました。')
        if (isRetryableStatusCheck(res.status) && statusCheckFailures < 30) {
          statusCheckFailures += 1
          setStatusMessage('ステータス確認を再試行中です…')
          await wait(2500 + i * 50)
          continue
        }
        throw new Error(message)
      }
      statusCheckFailures = 0

      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) setTicketCount(nextTickets)

      const status = extractStatus(data).toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '画像編集に失敗しました。'))
      }

      const images = extractImageList(data)
      if (images.length) return images[0]
      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        completedWithoutImage += 1
        setStatusMessage('結果画像を取得中です…')
        if (completedWithoutImage >= 8) {
          throw new Error('画像編集は完了しましたが、結果画像を取得できませんでした。')
        }
      } else {
        completedWithoutImage = 0
      }

      await wait(2000 + i * 50)
    }

    throw new Error('画像編集がタイムアウトしました。')
  }, [])

  const startGeneration = useCallback(async () => {
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }
    if (!sourceFile) {
      setStatusMessage('元画像を選択してください。')
      return
    }
    if (!hasEditInstruction) {
      setStatusMessage('編集内容を入力するか、角度プリセットを選択してください。')
      return
    }
    if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
      setStatusMessage('編集内容は1000文字以内で入力してください。')
      return
    }
    if (trimmedNegativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
      setStatusMessage('ネガティブプロンプトは1000文字以内で入力してください。')
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setResultImage(null)
    setStatusMessage('画像を編集しています…')

    try {
      const submitted = await submitImageEdit()
      if (runIdRef.current !== runId) return

      if ('images' in submitted && submitted.images?.length) {
        setResultImage(submitted.images[0])
        setStatusMessage('画像編集が完了しました。')
        if (accessToken) void fetchTickets()
        return
      }

      if (!submitted.jobId || !submitted.usageId) throw new Error('ジョブIDを取得できませんでした。')
      const image = await pollJob(submitted.jobId, submitted.usageId, runId)
      if (!image || runIdRef.current !== runId) return
      setResultImage(image)
      setStatusMessage('画像編集が完了しました。')
      if (accessToken) void fetchTickets()
    } catch (error) {
      if (runIdRef.current !== runId) return
      setStatusMessage(normalizeErrorMessage(error))
    } finally {
      if (runIdRef.current === runId) setIsRunning(false)
    }
  }, [
    accessToken,
    fetchTickets,
    hasEditInstruction,
    pollJob,
    session,
    sourceFile,
    submitImageEdit,
    trimmedNegativePrompt,
    trimmedPrompt.length,
  ])

  const clearResult = useCallback(() => {
    setResultImage(null)
    setStatusMessage('')
  }, [])

  const saveResult = useCallback(async () => {
    if (!resultImage || isSavingResult) return
    setIsSavingResult(true)
    try {
      await saveGeneratedAsset({
        source: resultImage,
        filenamePrefix: 'orca-image-edit',
        fallbackExtension: 'png',
      })
    } finally {
      setIsSavingResult(false)
    }
  }, [isSavingResult, resultImage])

  if (!authReady) {
    return (
      <div className="studio-page">
        <TopNav />
        <main className="studio-loader">読み込み中...</main>
      </div>
    )
  }

  return (
    <div className="studio-page">
      <TopNav />
      <main className="studio-wrap">
        <section className="studio-panel studio-panel--controls">
          <header className="studio-heading">
            <h1>画像編集</h1>
            <p>元画像をアップロードし、編集内容や角度プリセットを指定して画像を作り直します。</p>
          </header>

          {session ? (
            <>
              <div className="studio-ticket-row">
                <span className="studio-ticket-label">保有クレジット</span>
                <span className="studio-ticket-value">{ticketStatus === 'loading' ? '確認中' : ticketCount ?? '-'}</span>
                <span className="studio-ticket-cost">消費 {TICKET_COST} クレジット</span>
              </div>
              {ticketMessage ? <p className="studio-inline-error">{ticketMessage}</p> : null}

              <label className="studio-upload">
                <input
                  type="file"
                  accept="image/*"
                  disabled={isRunning}
                  onChange={(event) => setSource(event.target.files?.[0] ?? null)}
                />
                <div className="studio-upload-inner">
                  <strong>{sourceFile?.name || '元画像を選択'}</strong>
                  <span>JPG / PNG / WebPに対応</span>
                </div>
              </label>
              {sourcePreview ? (
                <div className="studio-thumb-wrap">
                  <img src={sourcePreview} alt="元画像プレビュー" className="studio-thumb" />
                  <button type="button" className="studio-thumb-remove" disabled={isRunning} onClick={() => setSource(null)}>
                    削除
                  </button>
                </div>
              ) : null}

              <label className="studio-upload">
                <input
                  type="file"
                  accept="image/*"
                  disabled={isRunning}
                  onChange={(event) => setReference(event.target.files?.[0] ?? null)}
                />
                <div className="studio-upload-inner">
                  <strong>{referenceFile?.name || '参考画像を選択（任意）'}</strong>
                  <span>構図や質感の参照に使います</span>
                </div>
              </label>
              {referencePreview ? (
                <div className="studio-thumb-wrap">
                  <img src={referencePreview} alt="参考画像プレビュー" className="studio-thumb" />
                  <button type="button" className="studio-thumb-remove" disabled={isRunning} onClick={() => setReference(null)}>
                    削除
                  </button>
                </div>
              ) : null}

              <label className="studio-field">
                <span>編集内容（1000文字まで）</span>
                <textarea
                  value={prompt}
                  maxLength={MAX_PROMPT_LENGTH}
                  placeholder="Example: keep the same person and outfit, change the camera angle and improve the lighting"
                  disabled={isRunning}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <p className="studio-status">{prompt.length}/{MAX_PROMPT_LENGTH}</p>

              <div className="studio-duration-row">
                <span>角度プリセット</span>
                <div className="studio-duration-options" role="radiogroup" aria-label="角度プリセット">
                  {ANGLE_PRESETS.map((option) => {
                    const isLocked = option.id !== 'none' && !isPremiumMember
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={anglePreset === option.id}
                        className={`studio-duration-option${anglePreset === option.id ? ' is-active' : ''}${
                          isLocked ? ' is-locked' : ''
                        }`}
                        onClick={() => handleAnglePresetChange(option.id)}
                        disabled={isRunning || isLocked}
                      >
                        <span>{option.label}</span>
                        {option.id !== 'none' ? <small>Premium</small> : null}
                      </button>
                    )
                  })}
                </div>
                <p className="studio-field-note">角度変更はPremiumメンバー限定です。</p>
              </div>

              <label className="studio-field">
                <span>ネガティブプロンプト（任意、1000文字まで）</span>
                <textarea
                  value={negativePrompt}
                  maxLength={MAX_NEGATIVE_PROMPT_LENGTH}
                  placeholder="避けたい要素を入力"
                  disabled={isRunning}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                />
              </label>
              <p className="studio-status">{negativePrompt.length}/{MAX_NEGATIVE_PROMPT_LENGTH}</p>

              <div className="studio-cfg-row">
                <span>CFG</span>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="0.1"
                  value={cfg}
                  disabled={isRunning}
                  onChange={(event) => setCfg(Number(event.target.value))}
                />
                <output>{cfg.toFixed(1)}</output>
              </div>

              <div className="studio-actions">
                <button className="studio-btn studio-btn--primary" type="button" disabled={!canGenerate} onClick={startGeneration}>
                  {isRunning ? '編集中...' : '編集する'}
                </button>
                <button className="studio-btn studio-btn--ghost" type="button" disabled={isRunning && !resultImage} onClick={clearResult}>
                  クリア
                </button>
              </div>
            </>
          ) : (
            <div className="studio-login-cta studio-login-cta--panel">
              <strong>ログインが必要です</strong>
              <p>Googleログイン後に画像編集を利用できます。</p>
              <div className="studio-actions">
                <button className="studio-btn studio-btn--primary" type="button" onClick={handleGoogleSignIn}>
                  Googleでログイン
                </button>
              </div>
            </div>
          )}

          {statusMessage ? <p className="studio-status">{statusMessage}</p> : null}
        </section>

        <section className="studio-panel studio-panel--preview">
          <div className="studio-preview-head">
            <h2>編集結果</h2>
            <span>{resultImage ? '完了' : isRunning ? '編集中' : '待機中'}</span>
          </div>

          <div className="studio-canvas" style={viewerStyle}>
            {resultImage ? (
              <>
                <img className="studio-result-media" src={resultImage} alt="編集画像" />
                <button className="studio-save-btn" type="button" disabled={isSavingResult} onClick={saveResult}>
                  {isSavingResult ? '保存中' : '保存'}
                </button>
              </>
            ) : isRunning ? (
              <div className="studio-loading">
                <div className="studio-loading-cube-scene" aria-hidden="true">
                  <div className="studio-loading-cube">
                    <span className="studio-loading-cube__face studio-loading-cube__face--front" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--back" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--right" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--left" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--top" />
                    <span className="studio-loading-cube__face studio-loading-cube__face--bottom" />
                  </div>
                  <span className="studio-loading-cube-orbit studio-loading-cube-orbit--one" />
                  <span className="studio-loading-cube-orbit studio-loading-cube-orbit--two" />
                </div>
                <p className="studio-loading__title">画像を編集中です。</p>
                <p className="studio-loading__subtitle">角度と質感を調整しています。</p>
              </div>
            ) : (
              <div className="studio-preview-idle">
                <p>編集後の画像がここに表示されます。</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
