import { createClient, type User } from '@supabase/supabase-js'
import { getSupabaseUserWithRetry } from '../_shared/auth-retry'
import { buildCorsHeaders, isCorsBlocked } from '../_shared/cors'
import { hasActivePremiumMembership } from '../_shared/premium'

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => any
type SupabaseAdmin = any

type Env = {
  RUNPOD_API_KEY?: string
  RUNPOD_SUPER_IMAGE_EDIT_API_KEY?: string
  RUNPOD_SUPER_IMAGE_EDIT_ENDPOINT_URL?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  CORS_ALLOWED_ORIGINS?: string
}

type AuthResult = { admin: SupabaseAdmin; user: User } | { response: Response }

type TicketEventRow = {
  usage_id: string
  user_id: string | null
  email: string | null
  delta: number | null
  metadata: Record<string, unknown> | null
}

const corsMethods = 'POST, GET, OPTIONS'
const SIGNUP_TICKET_GRANT = 3
const TICKET_COST = 1
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_REFERENCE_IMAGES = 1
const MAX_PROMPT_LENGTH = 1000
const MAX_NEGATIVE_PROMPT_LENGTH = 1000
const DEFAULT_ENDPOINT = 'https://api.runpod.ai/v2/waeacog3y0gk1e'
const DEFAULT_CFG = 1
const FIXED_STEPS = 4
const FIXED_MEGAPIXELS = 1
const DEFAULT_SAMPLER = 'euler'
const FILENAME_PREFIX = 'orca-image-edit'
const ANGLE_LORA_NAME = 'flux-multi-angles-v2-72poses-comfy.safetensors'
const ANGLE_LORA_STRENGTH = 0.7

const ANGLE_PROMPTS: Record<string, string> = {
  none: '',
  front: '<sks> front view eye-level shot medium shot',
  left: '<sks> left side view eye-level shot medium shot',
  right: '<sks> right side view eye-level shot medium shot',
  back: '<sks> back view eye-level shot medium shot',
  three_quarter_left: '<sks> three-quarter left view eye-level shot medium shot',
  three_quarter_right: '<sks> three-quarter right view eye-level shot medium shot',
  low: '<sks> front view low-angle shot medium shot',
  high: '<sks> front view high-angle shot medium shot',
  closeup: '<sks> front view eye-level shot close-up',
  full_body: '<sks> front view eye-level shot full body shot',
}

const INTERNAL_SERVER_ERROR_MESSAGE = 'Server processing failed. Please try again later.'
const ERROR_LOGIN_REQUIRED = 'Login is required.'
const ERROR_AUTH_FAILED = 'Authentication failed.'
const ERROR_GOOGLE_ONLY = 'Google login is required.'
const ERROR_SUPABASE_NOT_SET = 'Supabase server setting is missing.'
const ERROR_EMAIL_MISSING = 'Email address is missing.'
const ERROR_NO_TICKETS = 'Not enough tickets.'
const ERROR_INVALID_TICKET_REQUEST = 'Invalid ticket operation.'
const ERROR_ID_REQUIRED = 'id is required.'
const ERROR_USAGE_ID_REQUIRED = 'usage_id is required.'
const ERROR_JOB_NOT_FOUND = 'Job not found.'

const HIDDEN_MODEL_FILE_PATTERN = /[A-Za-z0-9_./%\\\-\s]+?\.(safetensors|gguf|onnx|pt|pth|ckpt|bin)/gi
const HIDDEN_MODEL_NAME_PATTERN = /qwen|flux|klein|lora|comfy|runpod|image[-_\s]?edit|gumix/gi
const GENERIC_MODEL_LABEL = 'image edit model'
const UNSAFE_PAYLOAD_KEYS = new Set([
  'data',
  'image',
  'images',
  'base64',
  'image_base64',
  'output_image',
  'output_images',
  'output_image_base64',
  'output_base64',
  'outputs',
  'files',
  'urls',
  'image_urls',
  'output_urls',
  'artifacts',
  'url',
  'image_url',
  'file_url',
  'download_url',
  'id',
  'jobId',
  'job_id',
  'usage_id',
  'usageId',
])

const sanitizeUserText = (value: string) =>
  value.replace(HIDDEN_MODEL_NAME_PATTERN, GENERIC_MODEL_LABEL).replace(HIDDEN_MODEL_FILE_PATTERN, `${GENERIC_MODEL_LABEL}.bin`)

const sanitizeJsonPayload = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') {
    if (UNSAFE_PAYLOAD_KEYS.has(key) || value.length > 4096) return value
    return sanitizeUserText(value)
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonPayload(item, key))
  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value)) {
      next[entryKey] = sanitizeJsonPayload(entryValue, entryKey)
    }
    return next
  }
  return value
}

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const normalizeEndpoint = (value?: string) => {
  const trimmed = (value ?? '').trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    return trimmed
  } catch {
    return ''
  }
}

const resolveEndpoint = (env: Env) =>
  normalizeEndpoint(env.RUNPOD_SUPER_IMAGE_EDIT_ENDPOINT_URL) || DEFAULT_ENDPOINT

const resolveRunpodApiKey = (env: Env) => (env.RUNPOD_SUPER_IMAGE_EDIT_API_KEY || env.RUNPOD_API_KEY || '').trim()

const isFile = (value: FormDataEntryValue | null): value is File => value instanceof File

const normalizeEmail = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

const isGoogleUser = (user: User) => {
  if (user.app_metadata?.provider === 'google') return true
  if (Array.isArray(user.identities)) return user.identities.some((identity) => identity.provider === 'google')
  return false
}

const extractBearerToken = (request: Request) => {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/Bearer\s+(.+)/i)
  return match ? match[1] : ''
}

const getSupabaseAdmin = (env: Env): SupabaseAdmin | null => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const requireGoogleUser = async (request: Request, env: Env, corsHeaders: HeadersInit): Promise<AuthResult> => {
  const token = extractBearerToken(request)
  if (!token) return { response: jsonResponse({ error: ERROR_LOGIN_REQUIRED }, 401, corsHeaders) }

  const admin = getSupabaseAdmin(env)
  if (!admin) return { response: jsonResponse({ error: ERROR_SUPABASE_NOT_SET }, 500, corsHeaders) }

  const { data, error } = await getSupabaseUserWithRetry(admin, token)
  if (error || !data?.user) return { response: jsonResponse({ error: ERROR_AUTH_FAILED }, 401, corsHeaders) }
  if (!isGoogleUser(data.user)) return { response: jsonResponse({ error: ERROR_GOOGLE_ONLY }, 403, corsHeaders) }

  return { admin, user: data.user }
}

const makeUsageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const parseTicketMetadata = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const isUsageOwnedByUser = (event: Pick<TicketEventRow, 'user_id' | 'email'>, user: User) => {
  if (event.user_id && event.user_id === user.id) return true
  const userEmail = normalizeEmail(user.email ?? '')
  return Boolean(userEmail && normalizeEmail(event.email) === userEmail)
}

const fetchUsageEvent = async (admin: SupabaseAdmin, usageId: string) => {
  const { data, error } = await admin
    .from('ticket_events')
    .select('usage_id, user_id, email, delta, metadata')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (error || !data) return { event: null as TicketEventRow | null, error }

  return {
    event: {
      usage_id: String(data.usage_id),
      user_id: data.user_id ? String(data.user_id) : null,
      email: data.email ? String(data.email) : null,
      delta: Number.isFinite(Number(data.delta)) ? Number(data.delta) : null,
      metadata: parseTicketMetadata(data.metadata),
    } satisfies TicketEventRow,
    error: null,
  }
}

const fetchTicketRow = async (admin: SupabaseAdmin, user: User) => {
  const email = user.email
  const { data: byUser, error: userError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('user_id', user.id)
    .maybeSingle()
  if (userError) return { error: userError }
  if (byUser) return { data: byUser, error: null }
  if (!email) return { data: null, error: null }

  const { data: byEmail, error: emailError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .ilike('email', email)
    .maybeSingle()
  if (emailError) return { error: emailError }
  return { data: byEmail, error: null }
}

const ensureTicketRow = async (admin: SupabaseAdmin, user: User) => {
  const email = user.email
  if (!email) return { data: null, error: null }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) return { data: null, error }
  if (existing) return { data: existing, error: null, created: false }

  const { data: inserted, error: insertError } = await admin
    .from('user_tickets')
    .insert({ email, user_id: user.id, tickets: SIGNUP_TICKET_GRANT })
    .select('id, email, user_id, tickets')
    .maybeSingle()

  if (insertError || !inserted) {
    const { data: retry, error: retryError } = await fetchTicketRow(admin, user)
    if (retryError) return { data: null, error: retryError }
    return { data: retry, error: null, created: false }
  }

  await admin.from('ticket_events').insert({
    usage_id: makeUsageId(),
    email,
    user_id: user.id,
    delta: SIGNUP_TICKET_GRANT,
    reason: 'signup_bonus',
    metadata: { source: 'auto_grant' },
  })

  return { data: inserted, error: null, created: true }
}

const consumeTicket = async (
  admin: SupabaseAdmin,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  if (!user.email) return { response: jsonResponse({ error: ERROR_EMAIL_MISSING }, 400, corsHeaders) }

  const { data: existing, error } = await ensureTicketRow(admin, user)
  if (error) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!existing) return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }

  if (!existing.user_id) await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  if (Number(existing.tickets) < TICKET_COST) return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }

  const { data: rpcData, error: rpcError } = await admin.rpc('consume_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: usageId,
    p_cost: TICKET_COST,
    p_reason: 'image_edit',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? INTERNAL_SERVER_ERROR_MESSAGE
    if (message.includes('INSUFFICIENT_TICKETS')) return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }
    if (message.includes('INVALID')) return { response: jsonResponse({ error: ERROR_INVALID_TICKET_REQUEST }, 400, corsHeaders) }
    return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return { ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined }
}

const refundTicket = async (
  admin: SupabaseAdmin,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  if (!user.email || !usageId) return { skipped: true }

  const { data: chargeEvent, error: chargeError } = await admin
    .from('ticket_events')
    .select('usage_id, user_id, email, delta')
    .eq('usage_id', usageId)
    .maybeSingle()
  if (chargeError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!chargeEvent) return { skipped: true }

  const chargeDelta = Number((chargeEvent as { delta?: unknown }).delta)
  const chargeOwner = {
    user_id: (chargeEvent as { user_id?: unknown }).user_id ? String((chargeEvent as { user_id?: unknown }).user_id) : null,
    email: (chargeEvent as { email?: unknown }).email ? String((chargeEvent as { email?: unknown }).email) : null,
  }
  if (!Number.isFinite(chargeDelta) || chargeDelta >= 0 || !isUsageOwnedByUser(chargeOwner, user)) return { skipped: true }

  const refundUsageId = `${usageId}:refund`
  const { data: existingRefund, error: refundCheckError } = await admin
    .from('ticket_events')
    .select('usage_id')
    .eq('usage_id', refundUsageId)
    .maybeSingle()
  if (refundCheckError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (existingRefund) return { alreadyRefunded: true }

  const { data: ticketRow, error } = await ensureTicketRow(admin, user)
  if (error) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!ticketRow) return { skipped: true }

  const { data: rpcData, error: rpcError } = await admin.rpc('refund_tickets', {
    p_ticket_id: ticketRow.id,
    p_usage_id: refundUsageId,
    p_amount: TICKET_COST,
    p_reason: 'image_edit_refund',
    p_metadata: metadata,
  })

  if (rpcError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return { ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined }
}

const requireOwnedUsageChargeEvent = async (
  admin: SupabaseAdmin,
  user: User,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  const { event, error } = await fetchUsageEvent(admin, usageId)
  if (error) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  if (!event || !isUsageOwnedByUser(event, user) || Number(event.delta) >= 0) {
    return { response: jsonResponse({ error: ERROR_JOB_NOT_FOUND }, 404, corsHeaders) }
  }
  return { event }
}

const bindUsageToJob = async (admin: SupabaseAdmin, user: User, usageId: string, jobId: string | null) => {
  if (!jobId) return
  const usageEvent = await fetchUsageEvent(admin, usageId)
  if (usageEvent.error || !usageEvent.event || !isUsageOwnedByUser(usageEvent.event, user)) return

  const metadata = usageEvent.event.metadata ?? {}
  if (String(metadata.job_id ?? '') === jobId) return
  await admin.from('ticket_events').update({ metadata: { ...metadata, job_id: jobId } }).eq('usage_id', usageId)
}

const bytesToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const fileToBase64 = async (file: File) => bytesToBase64(await file.arrayBuffer())

const safeFileName = (value: string, fallback: string) => {
  const cleaned = value
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

const readJsonResponse = async (response: Response) => {
  const raw = await response.text()
  let data: any = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = null
  }
  return { raw, data }
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id || payload?.result?.id

const extractStatus = (payload: any) =>
  String(
    payload?.status ??
      payload?.state ??
      payload?.output?.status ??
      payload?.result?.status ??
      payload?.output?.output?.status ??
      payload?.result?.output?.status ??
      '',
  )

const hasImageString = (value: unknown) => {
  if (typeof value !== 'string') return false
  const raw = value.trim()
  if (!raw) return false
  if (/^(data:image\/|https?:\/\/|blob:)/i.test(raw)) return true
  return raw.length >= 128
}

const normalizeImageString = (value: unknown) => {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  if (/^(data:image\/|https?:\/\/|blob:)/i.test(raw)) return raw
  if (raw.length < 128) return null
  return `data:image/png;base64,${raw}`
}

const extractImageFromItem = (value: unknown): string | null => {
  const direct = normalizeImageString(value)
  if (direct) return direct
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return normalizeImageString(
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
      item.output ??
      item.result,
  )
}

const extractImageList = (payload: unknown): string[] => {
  if (!payload) return []
  const roots = [
    payload,
    (payload as any)?.output,
    (payload as any)?.result,
    (payload as any)?.data,
    (payload as any)?.output?.output,
    (payload as any)?.result?.output,
    (payload as any)?.output?.result,
    (payload as any)?.result?.result,
    (payload as any)?.output?.data,
    (payload as any)?.result?.data,
  ].filter(Boolean)

  for (const root of roots) {
    if (Array.isArray(root)) {
      const images = root.map(extractImageFromItem).filter(Boolean) as string[]
      if (images.length) return images
      continue
    }

    const directRoot = extractImageFromItem(root)
    if (directRoot) return [directRoot]
    if (!root || typeof root !== 'object') continue

    const data = root as Record<string, unknown>
    const lists = [
      data.images,
      data.outputs,
      data.output_images,
      data.data,
      data.files,
      data.urls,
      data.image_urls,
      data.output_urls,
      data.artifacts,
      data.results,
    ]
    for (const list of lists) {
      if (!Array.isArray(list)) continue
      const images = list.map(extractImageFromItem).filter(Boolean) as string[]
      if (images.length) return images
    }
  }

  return []
}

const hasAssetItem = (value: unknown): boolean => {
  if (hasImageString(value)) return true
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return [
    item.image,
    item.data,
    item.content,
    item.b64,
    item.base64,
    item.image_base64,
    item.output_image_base64,
    item.url,
    item.image_url,
    item.file_url,
    item.download_url,
    item.output,
  ].some(hasImageString)
}

const hasAssets = (payload: any) => {
  if (!payload || typeof payload !== 'object') return false
  const roots = [
    payload,
    payload.output,
    payload.result,
    payload.output?.output,
    payload.result?.output,
    payload.output?.result,
    payload.result?.result,
    payload.output?.data,
    payload.result?.data,
  ].filter(Boolean)
  for (const root of roots) {
    if (Array.isArray(root)) {
      if (root.some(hasAssetItem)) return true
      continue
    }
    if (hasImageString(root)) return true
    if (!root || typeof root !== 'object') continue
    const data = root as Record<string, unknown>
    const lists = [
      data.images,
      data.outputs,
      data.output_images,
      data.data,
      data.files,
      data.urls,
      data.image_urls,
      data.output_urls,
      data.artifacts,
      data.results,
    ]
    if (lists.some((value) => Array.isArray(value) && value.some(hasAssetItem))) return true
    if (
      [
        data.image,
        data.image_base64,
        data.base64,
        data.output_image,
        data.output_image_base64,
        data.output_base64,
        data.url,
        data.image_url,
        data.file_url,
        data.download_url,
      ].some(hasImageString)
    ) {
      return true
    }
  }
  return false
}

const hasOutputError = (payload: any) =>
  Boolean(
    payload?.error ||
      payload?.output?.error ||
      payload?.result?.error ||
      payload?.output?.output?.error ||
      payload?.result?.output?.error,
  )

const extractOutputError = (payload: any) => {
  const value =
    payload?.error ??
    payload?.message ??
    payload?.detail ??
    payload?.output?.error ??
    payload?.result?.error ??
    payload?.output?.output?.error ??
    payload?.result?.output?.error
  if (!value) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return sanitizeUserText(text).slice(0, 240)
}

const isFailureStatus = (payload: any) => {
  const status = extractStatus(payload).toLowerCase()
  return status.includes('fail') || status.includes('error') || status.includes('cancel')
}

const clampNumber = (value: FormDataEntryValue | null, fallback: number, min: number, max: number) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403, headers: corsHeaders })
  return new Response(null, { headers: corsHeaders })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403, headers: corsHeaders })

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) return auth.response

  const url = new URL(request.url)
  const id = url.searchParams.get('id')?.trim()
  const usageId = url.searchParams.get('usage_id')?.trim() || ''
  if (!id) return jsonResponse({ error: ERROR_ID_REQUIRED }, 400, corsHeaders)
  if (!usageId) return jsonResponse({ error: ERROR_USAGE_ID_REQUIRED }, 400, corsHeaders)

  const usageEventResult = await requireOwnedUsageChargeEvent(auth.admin, auth.user, usageId, corsHeaders)
  if ('response' in usageEventResult) return usageEventResult.response

  const usageJobId = String(usageEventResult.event.metadata?.job_id ?? '')
  if (usageJobId && usageJobId !== id) return jsonResponse({ error: ERROR_JOB_NOT_FOUND }, 404, corsHeaders)
  if (!usageJobId) await bindUsageToJob(auth.admin, auth.user, usageId, id)

  const endpoint = resolveEndpoint(env)
  const runpodApiKey = resolveRunpodApiKey(env)
  if (!runpodApiKey || !endpoint) return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders)

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/status/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${runpodApiKey}` },
    })
  } catch {
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 502, corsHeaders)
  }

  const { raw, data } = await readJsonResponse(upstream)
  if (!data || typeof data !== 'object') {
    return new Response(raw.length > 4096 ? raw : sanitizeUserText(raw), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  }

  let ticketsLeft: number | undefined
  if (isFailureStatus(data) || hasOutputError(data)) {
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      { source: 'image_edit_status', job_id: id, status: data?.status ?? data?.state ?? null },
      usageId,
      corsHeaders,
    )
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
  }

  const images = extractImageList(data)
  if (images.length) data.images = images
  data.usage_id = usageId
  if (ticketsLeft !== undefined) data.ticketsLeft = ticketsLeft
  return jsonResponse(sanitizeJsonPayload(data), upstream.status, corsHeaders)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403, headers: corsHeaders })

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) return auth.response

  const endpoint = resolveEndpoint(env)
  const runpodApiKey = resolveRunpodApiKey(env)
  if (!runpodApiKey || !endpoint) return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders)

  const formData = await request.formData().catch(() => null)
  if (!formData) return jsonResponse({ error: 'multipart/form-data request body is required.' }, 400, corsHeaders)

  const imageFile = formData.get('image')
  const referenceFiles = [...formData.getAll('reference_images'), formData.get('reference_image')].filter(isFile)
  const prompt = String(formData.get('prompt') || '').trim()
  const negativePrompt = String(formData.get('negative_prompt') || '').trim()
  const angleId = String(formData.get('angle_prompt') || 'none').trim()
  const anglePrompt = ANGLE_PROMPTS[angleId] || ''
  const cfg = clampNumber(formData.get('cfg'), DEFAULT_CFG, 1, 5)

  if (!isFile(imageFile) || imageFile.size === 0) return jsonResponse({ error: 'Image file is required.' }, 400, corsHeaders)
  if (imageFile.size > MAX_IMAGE_BYTES) return jsonResponse({ error: 'Image file is too large.' }, 400, corsHeaders)
  if (referenceFiles.length > MAX_REFERENCE_IMAGES) {
    return jsonResponse({ error: `Reference images must be ${MAX_REFERENCE_IMAGES} or fewer.` }, 400, corsHeaders)
  }
  for (const file of referenceFiles) {
    if (file.size > MAX_IMAGE_BYTES) return jsonResponse({ error: 'Reference image file is too large.' }, 400, corsHeaders)
  }
  if (!prompt && !anglePrompt) return jsonResponse({ error: 'Prompt or angle preset is required.' }, 400, corsHeaders)
  if (prompt.length > MAX_PROMPT_LENGTH) return jsonResponse({ error: 'Prompt is too long.' }, 400, corsHeaders)
  if (negativePrompt.length > MAX_NEGATIVE_PROMPT_LENGTH) {
    return jsonResponse({ error: 'Negative prompt is too long.' }, 400, corsHeaders)
  }
  if (anglePrompt && angleId !== 'none') {
    const premiumMember = await hasActivePremiumMembership(auth.admin, auth.user)
    if (!premiumMember) {
      return jsonResponse({ error: 'Premium membership is required for angle presets.' }, 403, corsHeaders)
    }
  }

  const finalPrompt = [anglePrompt, prompt].filter(Boolean).join(', ')
  const loras =
    anglePrompt && angleId !== 'none'
      ? [{ lora_name: ANGLE_LORA_NAME, strength_model: ANGLE_LORA_STRENGTH, strength_clip: 0 }]
      : []
  const usageId = `image_edit:${makeUsageId()}`
  let ticketsLeft: number | undefined
  const ticketMeta = {
    source: 'image_edit',
    prompt_length: prompt.length,
    negative_prompt_length: negativePrompt.length,
    angle: angleId,
    cfg,
    steps: FIXED_STEPS,
    ticket_cost: TICKET_COST,
  }

  const ticketCharge = await consumeTicket(auth.admin, auth.user, ticketMeta, usageId, corsHeaders)
  if ('response' in ticketCharge) return ticketCharge.response
  if ('ticketsLeft' in ticketCharge) ticketsLeft = ticketCharge.ticketsLeft

  const imageBase64 = await fileToBase64(imageFile)
  const referenceImages = await Promise.all(
    referenceFiles.map(async (file, index) => ({
      name: safeFileName(file.name || '', `reference_${index + 1}.png`),
      image: await fileToBase64(file),
    })),
  )

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runpodApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          prompt: finalPrompt,
          negative_prompt: negativePrompt,
          image_base64: imageBase64,
          image_name: safeFileName(imageFile.name || '', 'source.png'),
          reference_images: referenceImages,
          loras,
          cfg,
          steps: FIXED_STEPS,
          megapixels: FIXED_MEGAPIXELS,
          sampler_name: DEFAULT_SAMPLER,
          filename_prefix: FILENAME_PREFIX,
        },
      }),
    })
  } catch {
    const refundResult = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'network_error' }, usageId, corsHeaders)
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, usage_id: usageId, ticketsLeft }, 502, corsHeaders)
  }

  const { raw, data } = await readJsonResponse(upstream)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const refundResult = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'parse_error' }, usageId, corsHeaders)
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, usage_id: usageId, ticketsLeft, raw: raw.slice(0, 256) }, 502, corsHeaders)
  }

  const jobId = extractJobId(data)
  if (jobId) await bindUsageToJob(auth.admin, auth.user, usageId, String(jobId))

  const isFailure = !upstream.ok || isFailureStatus(data) || hasOutputError(data)
  if (isFailure) {
    const refundResult = await refundTicket(
      auth.admin,
      auth.user,
      { ...ticketMeta, reason: 'runpod_failure', status: data?.status ?? data?.state ?? null },
      usageId,
      corsHeaders,
    )
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse(
      {
        error: 'RunPod request failed.',
        upstreamStatus: upstream.status,
        upstreamError: extractOutputError(data),
        usage_id: usageId,
        ticketsLeft,
      },
      502,
      corsHeaders,
    )
  }

  if (!jobId && !hasAssets(data)) {
    const refundResult = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'missing_job_id' }, usageId, corsHeaders)
    if ('response' in refundResult) return refundResult.response
    if ('ticketsLeft' in refundResult) ticketsLeft = refundResult.ticketsLeft
    return jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE, usage_id: usageId, ticketsLeft }, 502, corsHeaders)
  }

  const images = extractImageList(data)
  if (images.length) data.images = images
  data.usage_id = usageId
  if (ticketsLeft !== undefined) data.ticketsLeft = ticketsLeft
  return jsonResponse(sanitizeJsonPayload(data), upstream.status, corsHeaders)
}
