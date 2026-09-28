import { isLive, supabase } from './config.js'

export const authAvailable = isLive

export async function getCurrentUser() {
  if (!isLive) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user ?? null
}

export function watchAuth(onChange) {
  if (!isLive) return () => {}
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => onChange(session?.user ?? null))
  return () => subscription.unsubscribe()
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(
      error.message.includes('Invalid login credentials')
        ? 'That email and password did not match. Create the admin user under Supabase Studio > Authentication > Users.'
        : error.message,
    )
  }
}

export async function signOut() {
  if (isLive) await supabase.auth.signOut()
}

/**
 * Creates the account, or signs into it if it already exists. The second half
 * matters because Supabase projects ship with email confirmation switched on:
 * signUp() then returns no session, and a retry would fail as a duplicate.
 */
export async function registerOrSignIn(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password })

  if (!error && data.session) return data.user

  const duplicate = /already registered|an account with|user already/i.test(error?.message ?? '')
  if (error && !duplicate) throw new Error(error.message)

  const retry = await supabase.auth.signInWithPassword({ email, password })
  if (retry.error) {
    throw new Error(
      duplicate
        ? 'That email is already registered. Sign in instead, or use a different address.'
        : 'Account created, but no session was returned. Turn off "Confirm email" in Supabase Studio > Authentication > Sign In / Up, then sign in.',
    )
  }
  return retry.data.user
}
