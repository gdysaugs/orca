import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isAuthConfigured, supabase } from '../lib/supabaseClient'
import { saveGeneratedAsset } from '../lib/downloadMedia'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './video-studio.css'

type VideoModel = 'akuma'
type VideoModelConfig = {
  id: VideoModel
  label: 'Akuma'
  endpoint: string
}

type VideoLengthSeconds = (typeof VIDEO_LENGTH_OPTIONS)[number]['seconds']

type SubmitVideoResult =
  | { videos: string[]; jobId?: never }
  | { videos?: never; jobId: string }

type PollVideoResult = {
  status: 'done' | 'cancelled'
  videos: string[]
}

type CapturableVideoElement = HTMLVideoElement & {
  captureStream?: (frameRate?: number) => MediaStream
  webkitCaptureStream?: (frameRate?: number) => MediaStream
}

type CapturableCanvasElement = HTMLCanvasElement & {
  captureStream?: (frameRate?: number) => MediaStream
}

const captureVideoElementStream = (el: CapturableVideoElement, frameRate?: number) => {
  if (typeof el.captureStream === 'function') return el.captureStream(frameRate)
  if (typeof el.webkitCaptureStream === 'function') return el.webkitCaptureStream(frameRate)
  return null
}

const VIDEO_MODELS: Record<VideoModel, VideoModelConfig> = {
  akuma: {
    id: 'akuma',
    label: 'Akuma',
    endpoint: '/api/wan-lora-pack',
  },
}
const DEFAULT_VIDEO_MODEL: VideoModel = 'akuma'
const parseVideoModel = (value: string | null): VideoModel => {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'v6' || normalized === 'akuma') return 'akuma'
  return DEFAULT_VIDEO_MODEL
}


const FIXED_STEPS = 4
const FIXED_CFG = 1
const FIXED_FPS = 10
const MAX_SFX_PROMPT_LENGTH = 500
const CHAT_AVATAR_ICON = '/apple-touch-icon.png'
const MIX_EXPORT_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const
const VIDEO_LENGTH_OPTIONS = [
  { seconds: 5, frames: 53, ticketCost: 1, label: '5秒 (1ポイント)' },
  { seconds: 7, frames: 73, ticketCost: 2, label: '7秒 (2ポイント)' },
  { seconds: 10, frames: 101, ticketCost: 3, label: '10秒 (3ポイント)' },
] as const
const DEFAULT_VIDEO_LENGTH_SECONDS = VIDEO_LENGTH_OPTIONS[0].seconds
const resolveVideoLengthOption = (seconds: number) =>
  VIDEO_LENGTH_OPTIONS.find((option) => option.seconds === seconds) ?? VIDEO_LENGTH_OPTIONS[0]
const AKUMA_LOADING_IMAGE = '/media/loading/akuma-loading.jpg'
const OAUTH_REDIRECT_URL =
  import.meta.env.VITE_SUPABASE_REDIRECT_URL ?? (typeof window !== 'undefined' ? window.location.origin : undefined)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string) =>
  new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(errorMessage))
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })

const makePipelineUsageId = () => {
  const timestamp = Date.now()
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  const normalized = randomPart.replace(/[^A-Za-z0-9-]/g, '')
  return `media:${timestamp}:${normalized}`
}

const toBase64 = (dataUrl: string) => {
  const parts = dataUrl.split(',')
  return parts.length > 1 ? parts[1] : dataUrl
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('データ変換に失敗しました。'))
    reader.readAsDataURL(blob)
  })

const sourceToDataUrl = async (source: string) => {
  if (source.startsWith('data:')) return source
  const response = await fetch(source)
  if (!response.ok) {
    throw new Error('生成動画の取得に失敗しました。')
  }
  const blob = await response.blob()
  return blobToDataUrl(blob)
}

const sourceToBase64 = async (source: string) => {
  const dataUrl = await sourceToDataUrl(source)
  return toBase64(dataUrl)
}

const inferVideoExt = (source: string) => {
  if (source.startsWith('data:video/webm')) return '.webm'
  if (source.startsWith('data:video/quicktime')) return '.mov'
  if (source.startsWith('data:video/x-matroska')) return '.mkv'
  if (source.startsWith('data:video/x-msvideo')) return '.avi'

  try {
    const url = new URL(source)
    const path = url.pathname.toLowerCase()
    if (path.endsWith('.webm')) return '.webm'
    if (path.endsWith('.mov')) return '.mov'
    if (path.endsWith('.mkv')) return '.mkv'
    if (path.endsWith('.avi')) return '.avi'
  } catch {
    // no-op
  }
  return '.mp4'
}

const normalizeVideo = (value: unknown, filename?: string) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:') || value.startsWith('http')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'webm' ? 'video/webm' : ext === 'gif' ? 'image/gif' : ext === 'mp4' ? 'video/mp4' : 'video/mp4'
  return `data:${mime};base64,${value}`
}

const isVideoLike = (value: unknown, filename?: string) => {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (ext && ['mp4', 'webm', 'gif'].includes(ext)) return true
  if (typeof value !== 'string') return false
  return value.startsWith('data:video/') || value.startsWith('data:image/gif')
}

const extractVideoList = (payload: any) => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output
  const listCandidates = [
    output?.videos,
    output?.outputs,
    output?.output_videos,
    output?.gifs,
    output?.images,
    payload?.videos,
    payload?.gifs,
    payload?.images,
    nested?.videos,
    nested?.outputs,
    nested?.output_videos,
    nested?.gifs,
    nested?.images,
    nested?.data,
  ]

  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue
    const normalized = candidate
      .map((item: any) => {
        const raw = item?.video ?? item?.data ?? item?.url ?? item
        const name = item?.filename
        if (!isVideoLike(raw, name)) return null
        return normalizeVideo(raw, name)
      })
      .filter(Boolean) as string[]
    if (normalized.length) return normalized
  }

  return []
}

const extractVideo = (payload: any) => {
  if (!payload || typeof payload !== 'object') return null

  if (typeof payload.video === 'string' && payload.video) {
    if (payload.video.startsWith('data:video/')) return payload.video
    return `data:video/mp4;base64,${payload.video}`
  }

  const roots = [
    payload,
    payload?.output,
    payload?.result,
    payload?.output?.output,
    payload?.result?.output,
    payload?.upstream,
    payload?.upstream?.output,
  ]

  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    const direct =
      root.output_base64 ||
      root.video_base64 ||
      root.output?.output_base64 ||
      root.output?.video_base64
    if (typeof direct === 'string' && direct) {
      return direct.startsWith('data:video/') ? direct : `data:video/mp4;base64,${direct}`
    }
  }

  return null
}

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'リクエストに失敗しました。'

  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe?.error ?? maybe?.message ?? maybe?.detail
    if (typeof picked === 'string' && picked) return picked
    if (value instanceof Error && value.message) return value.message
  }

  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value)
  const lowered = raw.toLowerCase()
  if (
    lowered.includes('out of memory') ||
    lowered.includes('would exceed allowed memory') ||
    lowered.includes('allocation on device') ||
    lowered.includes('cuda') ||
    lowered.includes('oom')
  ) {
    return 'GPUメモリ不足です。画像サイズを小さくして再試行してください。'
  }

  const trimmed = raw.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed)
      const message = parsed?.error || parsed?.message || parsed?.detail
      if (typeof message === 'string' && message) return message
    } catch {
      // ignore parse errors
    }
  }

  return raw
}

const isTicketShortage = (status: number, message: string) => {
  if (status === 402) return true
  const lowered = message.toLowerCase()
  return (
    lowered.includes('no ticket') ||
    lowered.includes('no tickets') ||
    lowered.includes('insufficient_tickets') ||
    lowered.includes('insufficient tickets') ||
    lowered.includes('token') ||
    lowered.includes('credit')
  )
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const alignTo16 = (value: number) => Math.max(16, Math.round(value / 16) * 16)
const PORTRAIT_MAX = { width: 576, height: 832 }
const LANDSCAPE_MAX = { width: 832, height: 576 }

const fitWithinBounds = (width: number, height: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  const aspect = width / height

  if (aspect >= 1) {
    const targetWidth = Math.min(maxWidth, alignTo16(scaledWidth))
    const targetHeight = Math.min(maxHeight, alignTo16(targetWidth / aspect))
    return { width: targetWidth, height: targetHeight }
  }

  const targetHeight = Math.min(maxHeight, alignTo16(scaledHeight))
  const targetWidth = Math.min(maxWidth, alignTo16(targetHeight * aspect))
  return { width: targetWidth, height: targetHeight }
}

const getTargetSize = (width: number, height: number) => {
  const isPortrait = height >= width
  const bounds = isPortrait ? PORTRAIT_MAX : LANDSCAPE_MAX
  return fitWithinBounds(width, height, bounds.width, bounds.height)
}

const buildPaddedDataUrl = (img: HTMLImageElement, targetWidth: number, targetHeight: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Keep full source frame by fitting with letterbox instead of stretching/cropping.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, targetWidth, targetHeight)
  const scale = Math.min(targetWidth / img.naturalWidth, targetHeight / img.naturalHeight)
  const drawWidth = Math.max(1, Math.round(img.naturalWidth * scale))
  const drawHeight = Math.max(1, Math.round(img.naturalHeight * scale))
  const offsetX = Math.floor((targetWidth - drawWidth) / 2)
  const offsetY = Math.floor((targetHeight - drawHeight) / 2)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight)
  return canvas.toDataURL('image/png')
}

const waitForVideoMetadata = (
  el: HTMLVideoElement,
  src: string,
  errorMessage: string,
  timeoutMs = 15_000,
) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: number | null = null

    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('error', onError)
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }

    const finalizeResolve = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const finalizeReject = (message: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }

    const onLoaded = () => finalizeResolve()
    const onError = () => finalizeReject(errorMessage)

    // Register listeners before assigning src so very small files do not miss the event.
    el.addEventListener('loadedmetadata', onLoaded, { once: true })
    el.addEventListener('error', onError, { once: true })
    el.src = src

    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      finalizeResolve()
      return
    }

    el.load()
    timer = window.setTimeout(() => finalizeReject(errorMessage), timeoutMs)
  })

const startMediaElementPlayback = async (el: HTMLMediaElement, timeoutMs = 2_000) => {
  try {
    const playResult = el.play()
    if (playResult && typeof (playResult as Promise<void>).then === 'function') {
      await Promise.race([playResult, wait(timeoutMs)])
    }
  } catch {
    // Autoplay restrictions or transient playback failures should not block final mux.
  }
}

type SyncedVideoPlayerProps = {
  videoSrc: string
  audioSrc: string
}

const SyncedVideoPlayer = ({ videoSrc, audioSrc }: SyncedVideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    const audioEl = audioRef.current
    if (!videoEl || !audioEl) return

    let isSyncing = false

    const syncTime = () => {
      if (isSyncing) return
      if (!Number.isFinite(videoEl.currentTime) || !Number.isFinite(audioEl.currentTime)) return
      const drift = Math.abs(videoEl.currentTime - audioEl.currentTime)
      if (drift < 0.12) return
      isSyncing = true
      try {
        audioEl.currentTime = videoEl.currentTime
      } finally {
        isSyncing = false
      }
    }

    const syncPlaybackState = async () => {
      syncTime()
      audioEl.playbackRate = videoEl.playbackRate
      audioEl.volume = videoEl.volume
      audioEl.muted = videoEl.muted
      if (!videoEl.paused) {
        try {
          await audioEl.play()
        } catch {
          // Ignore autoplay/playback race failures; next user interaction will retry.
        }
      }
    }

    const handlePause = () => {
      audioEl.pause()
      syncTime()
    }

    const handleEnded = () => {
      audioEl.pause()
      audioEl.currentTime = 0
    }

    const handleVolumeChange = () => {
      audioEl.volume = videoEl.volume
      audioEl.muted = videoEl.muted
    }

    const handleRateChange = () => {
      audioEl.playbackRate = videoEl.playbackRate
    }

    const handleSeeked = () => {
      syncTime()
      if (!videoEl.paused) {
        void audioEl.play().catch(() => undefined)
      }
    }

    videoEl.addEventListener('play', syncPlaybackState)
    videoEl.addEventListener('playing', syncPlaybackState)
    videoEl.addEventListener('pause', handlePause)
    videoEl.addEventListener('seeking', syncTime)
    videoEl.addEventListener('seeked', handleSeeked)
    videoEl.addEventListener('timeupdate', syncTime)
    videoEl.addEventListener('ratechange', handleRateChange)
    videoEl.addEventListener('volumechange', handleVolumeChange)
    videoEl.addEventListener('ended', handleEnded)

    audioEl.preload = 'auto'
    audioEl.currentTime = 0
    audioEl.playbackRate = videoEl.playbackRate
    audioEl.volume = videoEl.volume
    audioEl.muted = videoEl.muted

    return () => {
      videoEl.removeEventListener('play', syncPlaybackState)
      videoEl.removeEventListener('playing', syncPlaybackState)
      videoEl.removeEventListener('pause', handlePause)
      videoEl.removeEventListener('seeking', syncTime)
      videoEl.removeEventListener('seeked', handleSeeked)
      videoEl.removeEventListener('timeupdate', syncTime)
      videoEl.removeEventListener('ratechange', handleRateChange)
      videoEl.removeEventListener('volumechange', handleVolumeChange)
      videoEl.removeEventListener('ended', handleEnded)
      audioEl.pause()
      audioEl.currentTime = 0
    }
  }, [audioSrc, videoSrc])

  return (
    <>
      <video ref={videoRef} controls controlsList="nodownload" src={videoSrc} />
      <audio ref={audioRef} src={audioSrc} />
    </>
  )
}

export function Video() {
  const [sourcePreview, setSourcePreview] = useState<string | null>(null)
  const [sourcePayload, setSourcePayload] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [sfxPrompt, setSfxPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [videoLengthSeconds, setVideoLengthSeconds] = useState<VideoLengthSeconds>(DEFAULT_VIDEO_LENGTH_SECONDS as VideoLengthSeconds)
  const [width, setWidth] = useState(832)
  const [height, setHeight] = useState(576)
  const [displayVideo, setDisplayVideo] = useState<string | null>(null)
  const [displayAudioVideo, setDisplayAudioVideo] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null)
  const [isSavingResult, setIsSavingResult] = useState(false)
  const [chatStep, setChatStep] = useState(1)
  const [isPreviewMode, setIsPreviewMode] = useState(false)
  const runIdRef = useRef(0)
  const navigate = useNavigate()
  const location = useLocation()
  const [videoModel, setVideoModel] = useState<VideoModel>(DEFAULT_VIDEO_MODEL)

  const accessToken = session?.access_token ?? ''
  const selectedVideoModel = VIDEO_MODELS[videoModel] ?? VIDEO_MODELS[DEFAULT_VIDEO_MODEL]
  const selectedVideoLength = useMemo(() => resolveVideoLengthOption(videoLengthSeconds), [videoLengthSeconds])
  const hasSfxPrompt = sfxPrompt.trim().length > 0
  const audioPipelineCost = hasSfxPrompt ? 1 : 0
  const requiredPoints = selectedVideoLength.ticketCost + audioPipelineCost
  const requiredPointsForRun = requiredPoints
  const canGenerate = Boolean(sourcePayload && prompt.trim() && !isRunning && session)
  const isGif = displayVideo?.startsWith('data:image/gif')
  const loadingSubtitle = useMemo(() => {
    if (hasSfxPrompt) {
      return '動画生成 → 効果音生成を実行中です。'
    }
    return '動画生成を実行中です。'
  }, [hasSfxPrompt])

  const viewerStyle = useMemo(
    () =>
      ({
        '--studio-aspect': `${Math.max(1, width)} / ${Math.max(1, height)}`,
      }) as CSSProperties,
    [height, width],
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
    if (!supabase) return
    const hasCode = typeof window !== 'undefined' && window.location.search.includes('code=')
    const hasState = typeof window !== 'undefined' && window.location.search.includes('state=')
    if (!hasCode || !hasState) return

    supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
      if (error) {
        window.alert(error.message)
        return
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      url.searchParams.delete('state')
      window.history.replaceState({}, document.title, url.toString())
    })
  }, [])

  const fetchTickets = useCallback(async (token: string) => {
    if (!token) return null

    setTicketStatus('loading')
    setTicketMessage('')

    const res = await fetch('/api/tickets', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setTicketStatus('error')
      setTicketMessage(data?.error || 'ポイント情報の取得に失敗しました。')
      setTicketCount(null)
      return null
    }

    const nextCount = Number(data?.tickets ?? 0)
    setTicketStatus('idle')
    setTicketMessage('')
    setTicketCount(nextCount)
    return nextCount
  }, [])

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      return
    }
    void fetchTickets(accessToken)
  }, [accessToken, fetchTickets, session])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setVideoModel(parseVideoModel(params.get('model')))
  }, [location.search])

  const canProceedStep = useCallback(
    (step: number) => {
      if (step === 1) return Boolean(sourcePayload)
      if (step === 2) return Boolean(prompt.trim())
      return true
    },
    [prompt, sourcePayload],
  )

  const goToNextStep = useCallback(() => {
    setChatStep((prev) => {
      if (!canProceedStep(prev)) return prev
      return Math.min(prev + 1, 5)
    })
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) {
      const active = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null
      window.setTimeout(() => {
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          active.blur()
        }
      }, 0)
      window.requestAnimationFrame(() => {
        window.scrollTo(0, 0)
      })
      window.setTimeout(() => window.scrollTo(0, 0), 80)
    }
  }, [canProceedStep])

  const goToPrevStep = useCallback(() => {
    setChatStep((prev) => Math.max(prev - 1, 1))
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) {
      const active = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null
      window.setTimeout(() => {
        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
          active.blur()
        }
      }, 0)
      window.requestAnimationFrame(() => {
        window.scrollTo(0, 0)
      })
      window.setTimeout(() => window.scrollTo(0, 0), 80)
    }
  }, [])

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

  const submitVideo = useCallback(
    async (imagePayload: string, token: string): Promise<SubmitVideoResult> => {
      if (!imagePayload) throw new Error('画像が必要です。')

      const input: Record<string, unknown> = {
        mode: 'i2v',
        prompt,
        negative_prompt: negativePrompt,
        width,
        height,
        fps: FIXED_FPS,
        seconds: selectedVideoLength.seconds,
        num_frames: selectedVideoLength.frames,
        steps: FIXED_STEPS,
        cfg: FIXED_CFG,
        seed: 0,
        randomize_seed: true,
        worker_mode: 'comfyui',
        image_name: sourceName || 'input.png',
      }
      input.image_base64 = imagePayload

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const res = await fetch(selectedVideoModel.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || '生成に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('ポイントが不足しています。')
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }

      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }

      const videos = extractVideoList(data)
      if (videos.length) {
        return { videos }
      }

      const jobId = extractJobId(data)
      if (!jobId) throw new Error('ジョブIDを取得できませんでした。')
      return { jobId }
    },
    [
      height,
      negativePrompt,
      prompt,
      requiredPointsForRun,
      selectedVideoLength,
      selectedVideoModel,
      sourceName,
      width,
    ],
  )

  const pollJob = useCallback(async (jobId: string, runId: number, token?: string): Promise<PollVideoResult> => {
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return { status: 'cancelled' as const, videos: [] }

      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const params = new URLSearchParams({
        id: jobId,
        mode: 'i2v',
        seconds: String(selectedVideoLength.seconds),
      })
      const res = await fetch(`${selectedVideoModel.endpoint}?${params.toString()}`, { headers })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || 'ステータス確認に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('ポイントが不足しています。')
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }

      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }

      const status = String(data?.status || data?.state || '').toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '生成に失敗しました。'))
      }

      const videos = extractVideoList(data)
      if (videos.length) {
        return { status: 'done' as const, videos }
      }

      await wait(2000 + i * 50)
    }

    throw new Error('生成がタイムアウトしました。')
  }, [selectedVideoLength.seconds, selectedVideoModel])

  const runMMAudioPipeline = useCallback(async (videoSource: string, fxPrompt: string, runId: number, pipelineUsageId?: string) => {
    const videoBase64 = await sourceToBase64(videoSource)
    const videoExt = inferVideoExt(videoSource)
    const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (accessToken) {
      authHeaders.Authorization = `Bearer ${accessToken}`
    }
    const res = await fetch('/api/mmaudio', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        input: {
          text: fxPrompt,
          video_base64: videoBase64,
          video_ext: videoExt,
          pipeline_usage_id: pipelineUsageId || undefined,
        },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = normalizeErrorMessage(extractErrorMessage(data) || '効果音付き動画の生成開始に失敗しました。')
      if (isTicketShortage(res.status, message)) {
        setShowTicketModal(true)
        setStatusMessage('ポイントが不足しています。')
        throw new Error('TICKET_SHORTAGE')
      }
      throw new Error(message)
    }

    const immediateVideo = extractVideo(data)
    if (immediateVideo) return immediateVideo

    const jobId = extractJobId(data)
    if (!jobId) {
      throw new Error('効果音付き動画のジョブIDを取得できませんでした。')
    }

    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return null
      const pollRes = await fetch(`/api/mmaudio?id=${encodeURIComponent(String(jobId))}${pipelineUsageId ? `&pipeline_usage_id=${encodeURIComponent(pipelineUsageId)}` : ``}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      })
      const pollData = await pollRes.json().catch(() => ({}))
      if (!pollRes.ok) {
        const message = normalizeErrorMessage(extractErrorMessage(pollData) || '効果音付き動画の状態確認に失敗しました。')
        if (isTicketShortage(pollRes.status, message)) {
          setShowTicketModal(true)
          setStatusMessage('ポイントが不足しています。')
          throw new Error('TICKET_SHORTAGE')
        }
        throw new Error(message)
      }

      const maybeVideo = extractVideo(pollData)
      if (maybeVideo) return maybeVideo

      const status = String(pollData?.status || pollData?.state || '').toUpperCase()
      if (isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(extractErrorMessage(pollData) || `効果音付き動画の生成に失敗しました: ${status}`))
      }
      await wait(2500)
    }

    throw new Error('効果音付き動画の生成がタイムアウトしました。')
  }, [accessToken])

  const runMMAudioMuxPipeline = useCallback(
    async (baseVideoSource: string, audioVideoSource: string, pipelineUsageId: string) => {
      const baseVideoBase64 = await sourceToBase64(baseVideoSource)
      const audioVideoBase64 = await sourceToBase64(audioVideoSource)
      const baseVideoExt = inferVideoExt(baseVideoSource)
      const audioVideoExt = inferVideoExt(audioVideoSource)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`
      }

      const res = await fetch('/api/mmaudio', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: {
            mux_only: true,
            pipeline_usage_id: pipelineUsageId,
            base_video_base64: baseVideoBase64,
            base_video_ext: baseVideoExt,
            audio_video_base64: audioVideoBase64,
            audio_video_ext: audioVideoExt,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(normalizeErrorMessage(extractErrorMessage(data) || '動画と効果音の保存用結合に失敗しました。'))
      }

      const muxedVideo = extractVideo(data)
      if (!muxedVideo) {
        throw new Error('動画と効果音の結合結果を取得できませんでした。')
      }
      return muxedVideo
    },
    [accessToken],
  )

  const mixVideoWithAudioTracks = useCallback(
    async (
      videoSource: string,
      runId: number,
      options?: {
        fxAudioVideoSource?: string | null
        targetSeconds?: number
      },
    ) => {
      const fxAudioVideoSource = options?.fxAudioVideoSource ?? null
      const targetSeconds = options?.targetSeconds
      const videoDataUrl = await sourceToDataUrl(videoSource)
      const fxAudioVideoDataUrl =
        fxAudioVideoSource && fxAudioVideoSource !== videoSource ? await sourceToDataUrl(fxAudioVideoSource) : null
      if (runIdRef.current !== runId) return null

      const videoEl = document.createElement('video')
      videoEl.preload = 'auto'
      videoEl.muted = true
      videoEl.playsInline = true

      const fxAudioEl = fxAudioVideoDataUrl ? document.createElement('video') : null
      if (fxAudioEl) {
        fxAudioEl.preload = 'auto'
        fxAudioEl.muted = false
        fxAudioEl.playsInline = true
      }

      let sourceStream: MediaStream | null = null
      let mixedStream: MediaStream | null = null
      let audioContext: AudioContext | null = null
      let recorder: MediaRecorder | null = null
      let rafId = 0

      try {
        const metadataTasks: Promise<void>[] = [
          waitForVideoMetadata(videoEl, videoDataUrl, '動画メタデータの読み込みに失敗しました。'),
        ]
        if (fxAudioEl && fxAudioVideoDataUrl) {
          metadataTasks.push(
            waitForVideoMetadata(fxAudioEl, fxAudioVideoDataUrl, '効果音動画メタデータの読み込みに失敗しました。'),
          )
        }
        await withTimeout(
          Promise.all(metadataTasks),
          20_000,
          '動画メタデータの取得がタイムアウトしました。ブラウザを再読み込みして再試行してください。',
        )

        const sourceWidth = Math.max(2, Math.floor(videoEl.videoWidth || 0))
        const sourceHeight = Math.max(2, Math.floor(videoEl.videoHeight || 0))
        if (!sourceWidth || !sourceHeight) {
          throw new Error('動画サイズを取得できませんでした。')
        }

        const mixCanvas = document.createElement('canvas')
        mixCanvas.width = sourceWidth
        mixCanvas.height = sourceHeight
        const mixCtx = mixCanvas.getContext('2d')
        if (!mixCtx) {
          throw new Error('最終合成用のキャンバスを初期化できませんでした。')
        }

        const capturableCanvas = mixCanvas as CapturableCanvasElement
        const capturableVideoEl = videoEl as CapturableVideoElement
        sourceStream =
          (typeof capturableCanvas.captureStream === 'function'
            ? capturableCanvas.captureStream(FIXED_FPS)
            : captureVideoElementStream(capturableVideoEl, FIXED_FPS))
        if (!sourceStream) {
          throw new Error('このブラウザは最終合成に対応していません。')
        }
        const videoTrack = sourceStream.getVideoTracks()[0]
        if (!videoTrack) {
          throw new Error('動画トラックを取得できませんでした。')
        }

        const renderFrame = () => {
          if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            mixCtx.drawImage(videoEl, 0, 0, sourceWidth, sourceHeight)
          }
          rafId = window.requestAnimationFrame(renderFrame)
        }
        renderFrame()

        audioContext = new AudioContext()
        const destination = audioContext.createMediaStreamDestination()
        const videoSourceNode = audioContext.createMediaElementSource(videoEl)
        const videoGain = audioContext.createGain()
        videoGain.gain.value = fxAudioEl ? 0 : 1
        videoSourceNode.connect(videoGain).connect(destination)
        if (fxAudioEl) {
          const fxSourceNode = audioContext.createMediaElementSource(fxAudioEl)
          const fxGain = audioContext.createGain()
          fxGain.gain.value = 1
          fxSourceNode.connect(fxGain).connect(destination)
        }
        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => undefined)
        }

        mixedStream = new MediaStream()
        mixedStream.addTrack(videoTrack)
        const mixedAudioTrack = destination.stream.getAudioTracks()[0]
        if (mixedAudioTrack) {
          mixedStream.addTrack(mixedAudioTrack)
        }

        const mimeType = MIX_EXPORT_MIME_CANDIDATES.find((item) => MediaRecorder.isTypeSupported(item)) ?? 'video/webm'
        recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: 8_000_000 })
        const chunks: BlobPart[] = []

        const stopPromise = new Promise<void>((resolve, reject) => {
          recorder!.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data)
          }
          recorder!.onstop = () => resolve()
          recorder!.onerror = () => reject(new Error('最終動画の録画に失敗しました。'))
        })

        videoEl.currentTime = 0
        if (fxAudioEl) fxAudioEl.currentTime = 0
        recorder.start(1000)
        await withTimeout(startMediaElementPlayback(videoEl), 3_000, '動画再生の開始に失敗しました。')
        if (fxAudioEl) {
          await withTimeout(startMediaElementPlayback(fxAudioEl), 3_000, '効果音再生の開始に失敗しました。')
        }

        const requestedDurationMs =
          typeof targetSeconds === 'number' && Number.isFinite(targetSeconds) && targetSeconds > 0
            ? Math.floor(targetSeconds * 1000)
            : null
        const naturalDurationMs = Number.isFinite(videoEl.duration) ? Math.floor(videoEl.duration * 1000) : null
        const stopAfterMs = Math.max(1000, requestedDurationMs ?? naturalDurationMs ?? 15_000)

        await withTimeout(
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, stopAfterMs)
            videoEl.onended = () => {
              window.clearTimeout(timer)
              resolve()
            }
          }),
          stopAfterMs + 2_500,
          '最終合成の再生待機がタイムアウトしました。',
        )

        if (recorder.state !== 'inactive') recorder.stop()
        await withTimeout(stopPromise, 6_000, '最終動画の録画停止がタイムアウトしました。')

        const mixedBlob = new Blob(chunks, { type: mimeType })
        if (mixedBlob.size === 0) {
          throw new Error('最終動画のデータが空でした。')
        }
        return URL.createObjectURL(mixedBlob)
      } finally {
        if (rafId) window.cancelAnimationFrame(rafId)
        videoEl.pause()
        if (fxAudioEl) fxAudioEl.pause()
        videoEl.removeAttribute('src')
        videoEl.load()
        if (fxAudioEl) {
          fxAudioEl.removeAttribute('src')
          fxAudioEl.load()
        }
        if (recorder && recorder.state !== 'inactive') {
          try {
            recorder.stop()
          } catch {
            // no-op
          }
        }
        sourceStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        mixedStream?.getTracks().forEach((track: MediaStreamTrack) => track.stop())
        if (audioContext) {
          await audioContext.close().catch(() => undefined)
        }
      }
    },
    [],
  )

  const startGeneration = useCallback(
    async (imagePayload: string) => {
      if (!imagePayload) return
      if (!session) {
        setStatusMessage('先にGoogleログインしてください。')
        return
      }

      const runId = runIdRef.current + 1
      runIdRef.current = runId
      setIsRunning(true)
      setStatusMessage('動画を生成中です…')
      setDisplayVideo(null)
      setDisplayAudioVideo(null)
      let fallbackVideo: string | null = null

      try {
        const trimmedSfx = sfxPrompt.trim()
        const shouldRunSfx = trimmedSfx.length > 0
        const pipelineUsageId = shouldRunSfx ? makePipelineUsageId() : ''
        let baseVideo: string | null = null
        const submitted = await submitVideo(imagePayload, accessToken)
        if (runIdRef.current !== runId) return

        if ('videos' in submitted && Array.isArray(submitted.videos) && submitted.videos.length) {
          baseVideo = submitted.videos[0]
        } else if ('jobId' in submitted && typeof submitted.jobId === 'string' && submitted.jobId) {
          const polled = await pollJob(submitted.jobId, runId, accessToken)
          if (runIdRef.current !== runId) return
          if (polled.status === 'done' && polled.videos.length) {
            baseVideo = polled.videos[0]
          }
        }

        if (!baseVideo) {
          throw new Error('動画生成結果を取得できませんでした。')
        }
        fallbackVideo = baseVideo

        if (!shouldRunSfx) {
          setDisplayVideo(baseVideo)
          setDisplayAudioVideo(null)
          setStatusMessage('動画生成が完了しました。')
          if (accessToken) {
            await fetchTickets(accessToken)
          }
          return
        }

        let pipelineVideo = baseVideo
        if (shouldRunSfx) {
          setStatusMessage('効果音付き動画を生成中です…')
          const fxVideo = await runMMAudioPipeline(baseVideo, trimmedSfx, runId, pipelineUsageId)
          if (!fxVideo || runIdRef.current !== runId) return
          setStatusMessage('動画と効果音を保存用に結合中です…')
          try {
            const muxedVideo = await runMMAudioMuxPipeline(baseVideo, fxVideo, pipelineUsageId)
            if (runIdRef.current !== runId) return
            pipelineVideo = muxedVideo
            fallbackVideo = pipelineVideo
            setDisplayAudioVideo(null)
          } catch {
            if (runIdRef.current !== runId) return
            pipelineVideo = baseVideo
            fallbackVideo = pipelineVideo
            setDisplayAudioVideo(fxVideo)
          }
        }

        setDisplayVideo(pipelineVideo)
        setStatusMessage('動画生成が完了しました。')

        if (accessToken) {
          await fetchTickets(accessToken)
        }
      } catch (error) {
        if (runIdRef.current !== runId) return
        const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
        if (message !== 'TICKET_SHORTAGE') {
          if (fallbackVideo) {
            setDisplayVideo(fallbackVideo)
            setStatusMessage(`一部処理でエラーが発生したため、途中結果を表示しています。${message}`)
          } else {
            setStatusMessage(message)
          }
        }
      } finally {
        if (runIdRef.current === runId) {
          setIsRunning(false)
        }
      }
    },
    [
      accessToken,
      fetchTickets,
      pollJob,
      runMMAudioMuxPipeline,
      runMMAudioPipeline,
      session,
      sfxPrompt,
      submitVideo,
      selectedVideoLength.seconds,
    ],
  )

  const clearImage = useCallback(() => {
    setSourcePreview(null)
    setSourcePayload(null)
    setSourceName('')
    setDisplayVideo(null)
    setDisplayAudioVideo(null)
    setStatusMessage('')
    setIsPreviewMode(false)
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const img = new Image()
      img.onload = () => {
        const { width: targetWidth, height: targetHeight } = getTargetSize(img.naturalWidth, img.naturalHeight)
        const paddedDataUrl = buildPaddedDataUrl(img, targetWidth, targetHeight) ?? dataUrl
        setWidth(targetWidth)
        setHeight(targetHeight)
        setSourcePreview(paddedDataUrl)
        setSourcePayload(toBase64(paddedDataUrl))
        setSourceName(file.name)
        setStatusMessage(session ? '画像を読み込みました。プロンプトを入力して生成できます。' : '先にGoogleログインしてください。')
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (!sourcePayload || isRunning) return
    if (!session) {
      setStatusMessage('先にGoogleログインしてください。')
      return
    }
    if (!prompt.trim()) {
      setStatusMessage('プロンプトを入力してください。')
      return
    }

    if (ticketStatus === 'loading') {
      setStatusMessage('ポイントを確認中...')
      return
    }

    if (accessToken) {
      setStatusMessage('ポイントを確認中...')
      const latestCount = await fetchTickets(accessToken)
      if (latestCount !== null && latestCount < requiredPointsForRun) {
        setShowTicketModal(true)
        return
      }
    } else if (ticketCount === null) {
      setStatusMessage('ポイントを確認中...')
      return
    } else if (ticketCount < requiredPointsForRun) {
      setShowTicketModal(true)
      return
    }
    setIsPreviewMode(true)
    await startGeneration(sourcePayload)
  }

  const handleSaveResult = useCallback(async () => {
    if (!displayVideo || isSavingResult) return
    setIsSavingResult(true)
    let temporarySource: string | null = null
    try {
      const sourceToSave = displayAudioVideo
        ? await mixVideoWithAudioTracks(displayVideo, runIdRef.current, {
            fxAudioVideoSource: displayAudioVideo,
            targetSeconds: selectedVideoLength.seconds,
          })
        : displayVideo

      if (!sourceToSave) return
      temporarySource = displayAudioVideo && sourceToSave.startsWith('blob:') ? sourceToSave : null

      await saveGeneratedAsset({
        source: sourceToSave,
        filenamePrefix: 'akumaai-video',
        fallbackExtension: displayAudioVideo ? 'webm' : isGif ? 'gif' : 'mp4',
      })
    } finally {
      if (temporarySource) {
        URL.revokeObjectURL(temporarySource)
      }
      setIsSavingResult(false)
    }
  }, [displayAudioVideo, displayVideo, isGif, isSavingResult, mixVideoWithAudioTracks, selectedVideoLength.seconds])

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
        {!isPreviewMode ? (
          <section className="studio-panel studio-panel--controls studio-panel--chat-only">
          <header className="studio-heading">
            <h1>動画生成チャット</h1>
            <p>手順に沿って入力するだけで、動画生成を完了できます。</p>
          </header>

          <p className="studio-token-line">
            ポイント:
            <strong className="studio-token-value">
              {session ? ticketCount ?? 0 : '--'}
              <span className="studio-token-icon" aria-hidden="true">
                ♦
              </span>
            </strong>
          </p>
          <div className="studio-ticket-row">
            <span className="studio-ticket-label">必要ポイント</span>
            <strong className="studio-ticket-value">{requiredPoints}</strong>
            <span className="studio-ticket-cost">
              {selectedVideoLength.seconds + '秒 / ' + (audioPipelineCost > 0 ? '効果音(+' + audioPipelineCost + ')' : '動画のみ')}
            </span>
          </div>

          {ticketStatus === 'error' && ticketMessage && <p className="studio-inline-error">{ticketMessage}</p>}

          <section className="studio-chat-flow" aria-label="生成チャット">
            {chatStep === 1 && (
              <article className="studio-chat-step">
                <div className="studio-chat-row studio-chat-row--assistant">
                  <img className="studio-chat-avatar" src={CHAT_AVATAR_ICON} alt="" aria-hidden="true" />
                  <div className="studio-chat-bubble">
                    <strong>{session ? '1. 素材画像アップロード' : '無料登録してお試し生成'}</strong>
                    <p>{session ? 'まず素材画像を1枚選択してください。' : 'Googleアカウントによる登録で３回無料生成できます。'}</p>
                  </div>
                </div>
                <div className="studio-chat-row studio-chat-row--user">
                  <div className="studio-chat-bubble studio-chat-bubble--user">
                    {session ? (
                      <>
                        <label className="studio-upload">
                          <input type="file" accept="image/*" onChange={handleFileChange} />
                          <div className="studio-upload-inner">
                            <strong>{sourceName || '元画像をアップロード'}</strong>
                          </div>
                        </label>
                        {sourcePreview && (
                          <div className="studio-thumb-wrap">
                            <img src={sourcePreview} alt="元画像プレビュー" className="studio-thumb" />
                            <button type="button" className="studio-thumb-remove" onClick={clearImage} aria-label="画像を削除">
                              削除
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="studio-login-cta">
                        <button type="button" className="studio-btn studio-btn--primary" onClick={handleGoogleSignIn}>
                          Googleで登録 / ログイン
                        </button>
                        {!isAuthConfigured && <p className="studio-field-note">認証設定が未完了です。</p>}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )}

            {chatStep === 2 && (
              <article className="studio-chat-step">
                <div className="studio-chat-row studio-chat-row--assistant">
                  <img className="studio-chat-avatar" src={CHAT_AVATAR_ICON} alt="" aria-hidden="true" />
                  <div className="studio-chat-bubble">
                    <strong>2. モーション指示とネガティブ</strong>
                    <p>プロンプトは必須です。除外要素は任意です。</p>
                  </div>
                </div>
                <div className="studio-chat-row studio-chat-row--user">
                  <div className="studio-chat-bubble studio-chat-bubble--user">
                    <label className="studio-field">
                      <span>プロンプト</span>
                      <textarea
                        rows={4}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="例:女性のアップ。場面転換。男性が現れて握手"
                      />
                    </label>
                    <label className="studio-field">
                      <span>除外要素 (任意)</span>
                      <textarea
                        rows={3}
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="bad quality,low quality"
                      />
                    </label>
                  </div>
                </div>
              </article>
            )}

            {chatStep === 3 && (
              <article className="studio-chat-step">
                <div className="studio-chat-row studio-chat-row--assistant">
                  <img className="studio-chat-avatar" src={CHAT_AVATAR_ICON} alt="" aria-hidden="true" />
                  <div className="studio-chat-bubble">
                    <strong>3. 効果音</strong>
                    <p>任意です。空欄なら効果音生成をスキップします。</p>
                  </div>
                </div>
                <div className="studio-chat-row studio-chat-row--user">
                  <div className="studio-chat-bubble studio-chat-bubble--user">
                    <label className="studio-field">
                      <span>効果音プロンプト ({sfxPrompt.trim().length}/{MAX_SFX_PROMPT_LENGTH})</span>
                      <textarea
                        rows={3}
                        maxLength={MAX_SFX_PROMPT_LENGTH}
                        value={sfxPrompt}
                        onChange={(e) => setSfxPrompt(e.target.value)}
                        placeholder="例: footsteps on wet street, distant thunder, soft city ambience"
                      />
                    </label>
                  </div>
                </div>
              </article>
            )}

            {chatStep === 4 && (
              <article className="studio-chat-step">
                <div className="studio-chat-row studio-chat-row--assistant">
                  <img className="studio-chat-avatar" src={CHAT_AVATAR_ICON} alt="" aria-hidden="true" />
                  <div className="studio-chat-bubble">
                    <strong>4. 秒数選択</strong>
                    <p>5秒 / 7秒 / 10秒を選択してください。</p>
                  </div>
                </div>
                <div className="studio-chat-row studio-chat-row--user">
                  <div className="studio-chat-bubble studio-chat-bubble--user">
                    <div className="studio-duration-row">
                      <span>動画の長さ</span>
                      <div className="studio-duration-options" role="radiogroup" aria-label="動画の長さ">
                        {VIDEO_LENGTH_OPTIONS.map((option) => (
                          <button
                            key={option.seconds}
                            type="button"
                            role="radio"
                            aria-checked={videoLengthSeconds === option.seconds}
                            className={`studio-duration-option${videoLengthSeconds === option.seconds ? ' is-active' : ''}`}
                            onClick={() => setVideoLengthSeconds(option.seconds)}
                            disabled={isRunning}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            )}

            {chatStep === 5 && (
              <article className="studio-chat-step">
                <div className="studio-chat-row studio-chat-row--assistant">
                  <img className="studio-chat-avatar" src={CHAT_AVATAR_ICON} alt="" aria-hidden="true" />
                  <div className="studio-chat-bubble">
                    <strong>5. 設定確認</strong>
                    <p>内容を確認して生成を実行してください。</p>
                  </div>
                </div>
                <div className="studio-chat-row studio-chat-row--user">
                  <div className="studio-chat-bubble studio-chat-bubble--user">
                    <ul className="studio-confirm-list">
                      <li>{`素材画像: ${sourceName || '未設定'}`}</li>
                      <li>{`プロンプト: ${prompt.trim() || '未設定'}`}</li>
                      <li>{`効果音: ${hasSfxPrompt ? 'あり' : 'なし'}`}</li>
                      <li>{`動画秒数: ${selectedVideoLength.seconds}秒 (${selectedVideoLength.ticketCost}ポイント)`}</li>
                      <li>{`追加ポイント: ${audioPipelineCost}`}</li>
                      <li>{`合計必要ポイント: ${requiredPoints}`}</li>
                    </ul>
                    <p className="studio-field-note">
                      {hasSfxPrompt ? '効果音があるため +1 ポイント加算されます。' : '効果音が空欄なので、動画生成のみ実行します。'}
                    </p>
                    {!session && <p className="studio-field-note">生成にはGoogleログインが必要です。</p>}
                  </div>
                </div>
              </article>
            )}
          </section>

          <div className="studio-generate-dock">
            <div className="studio-chat-nav">
              <span className="studio-chat-progress">{`${chatStep} / 5`}</span>
              <div className="studio-actions">
                <button type="button" className="studio-btn studio-btn--ghost" onClick={goToPrevStep} disabled={chatStep === 1 || isRunning}>
                  戻る
                </button>
                {chatStep < 5 ? (
                  <button
                    type="button"
                    className="studio-btn studio-btn--primary"
                    onClick={goToNextStep}
                    disabled={!canProceedStep(chatStep) || isRunning}
                  >
                    次へ
                  </button>
                ) : (
                  <button type="button" className="studio-btn studio-btn--primary" onClick={handleGenerate} disabled={!canGenerate}>
                    {isRunning ? '生成中...' : '生成'}
                  </button>
                )}
              </div>
            </div>
            {statusMessage && <p className="studio-status">{statusMessage}</p>}
          </div>
          </section>
        ) : (
          <section className="studio-panel studio-panel--preview studio-panel--preview-only">
            <div className="studio-preview-head">
              <h2>プレビュー</h2>
              {!isRunning && (
                <button
                  type="button"
                  className="studio-btn studio-btn--ghost"
                  onClick={() => setIsPreviewMode(false)}
                >
                  入力に戻る
                </button>
              )}
            </div>

            <div className="studio-canvas" style={viewerStyle}>
              {isRunning ? (
                <div className="studio-loading studio-loading--video" role="status" aria-live="polite">
                  <div className="studio-loading-media" aria-hidden="true">
                    <img src={AKUMA_LOADING_IMAGE} alt="" loading="eager" />
                  </div>
                  <p className="studio-loading__title">生成中です</p>
                  <p className="studio-loading__subtitle">{loadingSubtitle}</p>
                  <div className="studio-loading-meter" aria-hidden="true">
                    <div className="studio-loading-meter__track">
                      <div className="studio-loading-meter__bar" />
                    </div>
                  </div>
                </div>
              ) : displayVideo ? (
                <div className="studio-result-media">
                  <button
                    type="button"
                    className="studio-save-btn"
                    onClick={handleSaveResult}
                    disabled={isSavingResult}
                  >
                    {isSavingResult ? 'Saving...' : 'Save'}
                  </button>
                  {isGif ? (
                    <img src={displayVideo} alt="Generated video" />
                  ) : displayAudioVideo ? (
                    <SyncedVideoPlayer videoSrc={displayVideo} audioSrc={displayAudioVideo} />
                  ) : (
                    <video controls controlsList="nodownload" src={displayVideo} />
                  )}
                </div>
              ) : (
                <div className="studio-preview-idle">
                  <p>{statusMessage || '結果を取得できませんでした。入力に戻って再試行してください。'}</p>
                  <button
                    type="button"
                    className="studio-btn studio-btn--ghost"
                    onClick={() => setIsPreviewMode(false)}
                  >
                    入力に戻る
                  </button>
                </div>
              )}
            </div>
            {statusMessage && <p className="studio-status studio-status--preview">{statusMessage}</p>}
          </section>
        )}

        <nav className="studio-legal-links" aria-label="リーガルリンク">
          <Link className="studio-legal-links__item" to="/terms">
            利用規約
          </Link>
          <Link className="studio-legal-links__item" to="/tokushoho">
            特商法
          </Link>
        </nav>
      </main>

      {showTicketModal && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>ポイント不足</h3>
            <p>{`この設定では${requiredPointsForRun}ポイントが必要です。購入ページで追加してください。`}</p>
            <div className="studio-modal-actions">
              <button type="button" className="studio-btn studio-btn--ghost" onClick={() => setShowTicketModal(false)}>
                閉じる
              </button>
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => navigate('/purchase')}>
                購入ページへ
              </button>
            </div>
          </div>
        </div>
      )}

      {errorModalMessage && (
        <div className="studio-modal-overlay" role="dialog" aria-modal="true">
          <div className="studio-modal-card">
            <h3>エラー</h3>
            <p>{errorModalMessage}</p>
            <div className="studio-modal-actions">
              <button type="button" className="studio-btn studio-btn--primary" onClick={() => setErrorModalMessage(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}





