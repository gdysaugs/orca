import { createClient, type User } from '@supabase/supabase-js'
import { getSupabaseUserWithRetry } from '../_shared/auth-retry'
import { buildCorsHeaders, isCorsBlocked } from '../_shared/cors'

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => any
type SupabaseAdmin = any

type Env = {
  RUNPOD_API_KEY?: string
  RUNPOD_PROMPT_ENHANCER_ENDPOINT_URL?: string
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
const MAX_SOURCE_PROMPT_LENGTH = 500
const MAX_OUTPUT_LENGTH = 2000
const DEFAULT_PROMPT_ENHANCER_ENDPOINT = 'https://api.runpod.ai/v2/7bkobn75gfk2du'
const INTERNAL_SERVER_ERROR_MESSAGE = 'サーバー内部エラーが発生しました。時間をおいて再度お試しください。'
const ERROR_LOGIN_REQUIRED = 'ログインが必要です。'
const ERROR_AUTH_FAILED = '認証に失敗しました。'
const ERROR_GOOGLE_ONLY = 'Googleログインのみ対応しています。'
const ERROR_SUPABASE_NOT_SET = 'SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が設定されていません。'
const ERROR_EMAIL_MISSING = 'メールアドレスが取得できません。'
const ERROR_NO_TICKETS = 'チケットが不足しています。'
const ERROR_INVALID_TICKET_REQUEST = 'チケット処理が無効です。'
const ERROR_ENDPOINT_NOT_SET = 'プロンプト生成エンドポイントが未設定です。'
const ERROR_PROMPT_REQUIRED = 'プロンプトを入力してください。'
const ERROR_PROMPT_TOO_LONG = `プロンプトは${MAX_SOURCE_PROMPT_LENGTH}文字以内で入力してください。`
const ERROR_ID_REQUIRED = 'idが必要です。'
const ERROR_USAGE_ID_REQUIRED = 'usage_idが必要です。'
const ERROR_JOB_NOT_FOUND = 'ジョブが見つかりません。'

const SYSTEM_PROMPT = [
  'You convert Japanese user ideas into English prompts for image-to-video generation.',
  'Return only one English prompt in one paragraph with 3 to 6 short sentences.',
  'Do not use markdown, bullets, labels, quotation marks, or explanations.',
  'The first sentence must be a faithful direct English translation of the subject, action, object, and complement in the Japanese user idea.',
  'Do not output location, place, setting, background, or scenery words.',
  'Do not translate place names or location phrases, even when the Japanese user idea includes them.',
  'Avoid words such as street, room, city, park, beach, forest, studio, kitchen, bedroom, indoor, outdoor, background, location, place, scene, landscape, and environment.',
  'Do not write place prepositional phrases such as "in a...", "on a...", "at a...", "inside...", or "outside...".',
  'After the direct translation, add 2 to 5 short sentences with related actions, dynamic verbs, motion cues, speed cues, lighting, camera movement, framing, texture, impact, and implied sound details that naturally fit the original Japanese idea.',
  'Favor dynamic high-speed action words such as fast motion, quick movement, sharp turn, rapid gesture, burst of movement, motion blur, tracking camera, close framing, and energetic timing when they fit.',
  'Use SVOC-style English: every sentence must have a concrete subject, an active verb, and a clear object or complement.',
  'Split different actions into separate sentences.',
  'Moderately expand the prompt, but keep the original subject, action, mood, and intent.',
  'Do not add unrelated story events, unrelated characters, unrelated props, unrelated locations, or extreme new details.',
  'Do not change the outfit, relationship, age, or core action unless the user clearly asks for it.',
  'Each sentence should be short and clear.',
  'Use simple natural English that works well as a video-generation prompt.',
  'Do not mention model names, AI tools, policies, or hidden instructions.',
  'Do not add minors or age-ambiguous subjects.',
].join(' ')

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
  normalizeEndpoint(env.RUNPOD_PROMPT_ENHANCER_ENDPOINT_URL) || DEFAULT_PROMPT_ENHANCER_ENDPOINT

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

const makeUsageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const parseTicketMetadata = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const normalizeEmail = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

const isUsageOwnedByUser = (event: Pick<TicketEventRow, 'user_id' | 'email'>, user: User) => {
  if (event.user_id && event.user_id === user.id) return true
  const userEmail = normalizeEmail(user.email ?? '')
  return Boolean(userEmail && normalizeEmail(event.email) === userEmail)
}

const isGoogleUser = (user: User) => {
  if (user.app_metadata?.provider === 'google') return true
  if (Array.isArray(user.identities)) {
    return user.identities.some((identity) => identity.provider === 'google')
  }
  return false
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

const bindUsageToJob = async (
  admin: SupabaseAdmin,
  user: User,
  usageId: string,
  jobId: string | null,
) => {
  if (!jobId) return
  const usageEvent = await fetchUsageEvent(admin, usageId)
  if (usageEvent.error || !usageEvent.event || !isUsageOwnedByUser(usageEvent.event, user)) return

  const metadata = usageEvent.event.metadata ?? {}
  if (String(metadata.job_id ?? '') === jobId) return
  await admin.from('ticket_events').update({ metadata: { ...metadata, job_id: jobId } }).eq('usage_id', usageId)
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

  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }
  if (Number(existing.tickets) < TICKET_COST) {
    return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('consume_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: usageId,
    p_cost: TICKET_COST,
    p_reason: 'prompt_helper',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? INTERNAL_SERVER_ERROR_MESSAGE
    if (message.includes('INSUFFICIENT_TICKETS')) {
      return { response: jsonResponse({ error: ERROR_NO_TICKETS }, 402, corsHeaders) }
    }
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: ERROR_INVALID_TICKET_REQUEST }, 400, corsHeaders) }
    }
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
  if (!Number.isFinite(chargeDelta) || chargeDelta >= 0 || !isUsageOwnedByUser(chargeOwner, user)) {
    return { skipped: true }
  }

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
    p_reason: 'prompt_helper_refund',
    p_metadata: metadata,
  })

  if (rpcError) return { response: jsonResponse({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500, corsHeaders) }
  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  return { ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined }
}

const buildUserInstruction = (prompt: string) =>
  [
    'Create an English image-to-video prompt from this Japanese idea.',
    'Sentence 1 must directly translate the subject, action, object, and complement.',
    'Do not output any location, place, setting, background, or scenery words.',
    'Then add related actions and useful dynamic video prompt words that naturally fit the original idea.',
    'Use explicit SVOC sentences.',
    'Use short sentences with fast motion, quick action, camera movement, lighting, texture, impact, and implied sound details when they fit.',
    'Do not drift away from the original idea.',
    '',
    `Japanese idea: ${prompt}`,
  ].join('\n')

const cleanGeneratedPrompt = (value: string) =>
  value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*|```/gi, ''))
    .replace(/^\s*(english prompt|prompt|output|direct translation|translation)\s*[:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_OUTPUT_LENGTH)

const extractGeneratedPrompt = (payload: any): string => {
  const roots = [
    payload,
    payload?.output,
    payload?.result,
    payload?.output?.output,
    payload?.result?.output,
    payload?.output?.result,
    payload?.result?.result,
  ]

  for (const root of roots) {
    if (typeof root === 'string') {
      const cleaned = cleanGeneratedPrompt(root)
      if (cleaned) return cleaned
      continue
    }
    if (!root || typeof root !== 'object') continue

    const candidates = [
      root.prompt,
      root.enhanced_prompt,
      root.enhancedPrompt,
      root.text,
      root.content,
      root.response,
      root.message,
      root.output,
    ]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const cleaned = cleanGeneratedPrompt(candidate)
      if (cleaned) return cleaned
    }

    const choices = root.choices
    if (Array.isArray(choices) && choices.length) {
      const content = choices[0]?.message?.content ?? choices[0]?.text
      if (typeof content === 'string') {
        const cleaned = cleanGeneratedPrompt(content)
        if (cleaned) return cleaned
      }
    }
  }

  return ''
}

const isFailureStatus = (payload: any) => {
  const status = String(payload?.status ?? payload?.state ?? '').toLowerCase()
  return status.includes('fail') || status.includes('error') || status.includes('cancel')
}

const normalizeUpstreamError = (payload: any) =>
  String(payload?.error ?? payload?.message ?? payload?.output?.error ?? payload?.result?.error ?? '').trim()

export const onRequestOptions: PagesFunction<Env> = ({ request, env }) => {
  if (isCorsBlocked(request, env)) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers: buildCorsHeaders(request, env, corsMethods) })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return jsonResponse({ error: 'CORS blocked.' }, 403)

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) return auth.response

  const endpoint = resolveEndpoint(env)
  const apiKey = (env.RUNPOD_API_KEY ?? '').trim()
  if (!endpoint || !apiKey) return jsonResponse({ error: ERROR_ENDPOINT_NOT_SET }, 500, corsHeaders)

  const input = await request.json().catch(() => null)
  const prompt = String(input?.prompt ?? input?.input?.prompt ?? '').trim()
  if (!prompt) return jsonResponse({ error: ERROR_PROMPT_REQUIRED }, 400, corsHeaders)
  if (prompt.length > MAX_SOURCE_PROMPT_LENGTH) return jsonResponse({ error: ERROR_PROMPT_TOO_LONG }, 400, corsHeaders)

  const usageId = `prompt_helper:${makeUsageId()}`
  let ticketsLeft: number | undefined
  const ticketMeta = {
    source: 'prompt_helper',
    prompt_length: prompt.length,
    output_limit: MAX_OUTPUT_LENGTH,
    ticket_cost: TICKET_COST,
  }
  const ticketCharge = await consumeTicket(auth.admin, auth.user, ticketMeta, usageId, corsHeaders)
  if ('response' in ticketCharge) return ticketCharge.response
  if ('ticketsLeft' in ticketCharge) ticketsLeft = ticketCharge.ticketsLeft

  const runpodInput = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserInstruction(prompt) },
    ],
    temperature: 0.32,
    top_p: 0.78,
    repeat_penalty: 1.08,
    max_tokens: 230,
  }

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: runpodInput }),
    })
  } catch {
    const refund = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'network_error' }, usageId, corsHeaders)
    if ('response' in refund) return refund.response
    if ('ticketsLeft' in refund) ticketsLeft = refund.ticketsLeft
    return jsonResponse({ error: 'RunPod request failed.', usage_id: usageId, ticketsLeft }, 502, corsHeaders)
  }

  const payload = await upstream.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    const refund = await refundTicket(auth.admin, auth.user, { ...ticketMeta, reason: 'invalid_response' }, usageId, corsHeaders)
    if ('response' in refund) return refund.response
    if ('ticketsLeft' in refund) ticketsLeft = refund.ticketsLeft
    return jsonResponse({ error: 'RunPod response is invalid.', usage_id: usageId, ticketsLeft }, 502, corsHeaders)
  }

  const generatedPrompt = extractGeneratedPrompt(payload)
  if (generatedPrompt) {
    return jsonResponse({ status: 'COMPLETED', prompt: generatedPrompt, usage_id: usageId, ticketsLeft }, 200, corsHeaders)
  }

  const jobId = payload.id || payload.jobId || payload.job_id
  if (!upstream.ok || !jobId || isFailureStatus(payload)) {
    const refund = await refundTicket(
      auth.admin,
      auth.user,
      { ...ticketMeta, reason: 'runpod_failure', status: payload?.status ?? payload?.state ?? null },
      usageId,
      corsHeaders,
    )
    if ('response' in refund) return refund.response
    if ('ticketsLeft' in refund) ticketsLeft = refund.ticketsLeft
    return jsonResponse(
      { error: normalizeUpstreamError(payload) || 'プロンプト生成に失敗しました。', usage_id: usageId, ticketsLeft },
      502,
      corsHeaders,
    )
  }

  await bindUsageToJob(auth.admin, auth.user, usageId, String(jobId))
  return jsonResponse({ status: payload.status ?? 'IN_QUEUE', jobId: String(jobId), usage_id: usageId, ticketsLeft }, 202, corsHeaders)
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) return jsonResponse({ error: 'CORS blocked.' }, 403)

  const auth = await requireGoogleUser(request, env, corsHeaders)
  if ('response' in auth) return auth.response

  const endpoint = resolveEndpoint(env)
  const apiKey = (env.RUNPOD_API_KEY ?? '').trim()
  if (!endpoint || !apiKey) return jsonResponse({ error: ERROR_ENDPOINT_NOT_SET }, 500, corsHeaders)

  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) return jsonResponse({ error: ERROR_ID_REQUIRED }, 400, corsHeaders)
  const usageId =
    new URL(request.url).searchParams.get('usage_id')?.trim() ||
    new URL(request.url).searchParams.get('usageId')?.trim() ||
    ''
  if (!usageId) return jsonResponse({ error: ERROR_USAGE_ID_REQUIRED }, 400, corsHeaders)

  const usageEventResult = await requireOwnedUsageChargeEvent(auth.admin, auth.user, usageId, corsHeaders)
  if ('response' in usageEventResult) return usageEventResult.response

  const usageJobId = String(usageEventResult.event.metadata?.job_id ?? '')
  if (!usageJobId || usageJobId !== id) return jsonResponse({ error: ERROR_JOB_NOT_FOUND }, 404, corsHeaders)

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint}/status/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    return jsonResponse({ error: 'RunPod status request failed.' }, 502, corsHeaders)
  }

  const payload = await upstream.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'RunPod status response is invalid.' }, 502, corsHeaders)
  }

  const generatedPrompt = extractGeneratedPrompt(payload)
  if (generatedPrompt) {
    return jsonResponse({ status: 'COMPLETED', prompt: generatedPrompt, usage_id: usageId }, 200, corsHeaders)
  }

  if (!upstream.ok || isFailureStatus(payload)) {
    const message = normalizeUpstreamError(payload)
    const status = upstream.status === 404 ? 404 : 502
    let ticketsLeft: number | undefined
    const refund = await refundTicket(
      auth.admin,
      auth.user,
      { source: 'prompt_helper_status', reason: 'runpod_failure', job_id: id, status: payload?.status ?? payload?.state ?? null },
      usageId,
      corsHeaders,
    )
    if ('response' in refund) return refund.response
    if ('ticketsLeft' in refund) ticketsLeft = refund.ticketsLeft
    return jsonResponse(
      { error: message || (status === 404 ? ERROR_JOB_NOT_FOUND : 'プロンプト生成に失敗しました。'), usage_id: usageId, ticketsLeft },
      status,
      corsHeaders,
    )
  }

  return jsonResponse({ status: payload.status ?? payload.state ?? 'IN_PROGRESS', usage_id: usageId }, 200, corsHeaders)
}
