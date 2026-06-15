import type { User } from '@supabase/supabase-js'

type SupabaseAdmin = {
  from: (table: string) => any
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing'])
const MISSING_TABLE_ERROR_CODES = new Set(['42P01', 'PGRST205'])

const isMissingSubscriptionTableError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false
  const code = String((error as { code?: unknown }).code ?? '')
  const message = String((error as { message?: unknown }).message ?? '')
  return MISSING_TABLE_ERROR_CODES.has(code) || message.includes('user_subscriptions')
}

export const hasActivePremiumMembership = async (admin: SupabaseAdmin, user: User) => {
  const { data, error } = await admin
    .from('user_subscriptions')
    .select('status,current_period_end')
    .eq('user_id', user.id)
    .in('status', [...ACTIVE_SUBSCRIPTION_STATUSES])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingSubscriptionTableError(error)) return false
    return false
  }
  if (!data) return false

  const status = String(data.status ?? '')
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return false

  const currentPeriodEnd = data.current_period_end ? Date.parse(String(data.current_period_end)) : null
  return currentPeriodEnd === null || (Number.isFinite(currentPeriodEnd) && currentPeriodEnd > Date.now())
}
