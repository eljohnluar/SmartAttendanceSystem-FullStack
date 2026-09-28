import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isLive = Boolean(url && anonKey)

export const supabase = isLive
  ? createClient(url, anonKey, { realtime: { params: { eventsPerSecond: 10 } } })
  : null
