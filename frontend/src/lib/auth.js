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
    if (/confirm/i.test(error.message)) {
      throw new Error('That address has not been confirmed yet. Open the link we emailed, then sign in again.')
    }
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
 * Creates the account, or signs into it if it already exists.
 *
 * With "Confirm email" switched on — which is how an admin registration is
 * supposed to work — signUp() returns a user, an emailed link, and *no session
 * and no error*. That combination is the confirmation case, not a failure, and
 * it must be recognised before anything tries to sign in, because an
 * unconfirmed account answers that attempt with "Email not confirmed".
 */
export async function registerOrSignIn(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })

  if (!error && !data.session) return { user: data.user, needsConfirmation: true }
  if (!error) return { user: data.user, needsConfirmation: false }

  const duplicate = /already registered|an account with|user already/i.test(error.message)
  if (!duplicate) throw new Error(error.message)

  // The address was taken. A password that fits means it was already confirmed,
  // so this is really a sign-in.
  const retry = await supabase.auth.signInWithPassword({ email, password })
  if (!retry.error) return { user: retry.data.user, needsConfirmation: false }
  if (/confirm/i.test(retry.error.message)) return { user: null, needsConfirmation: true }

  throw new Error(retry.error.message)
}

/**
 * Verifies the staff user's password for sensitive action confirmations
 * (e.g. saving students or saving system/grade configurations).
 */
export async function verifyPassword(email, password) {
  const trimmed = password?.trim()
  if (!trimmed) {
    throw new Error('Please enter your password to confirm.')
  }
  if (!isLive || !email) {
    return true
  }
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: trimmed,
  })
  if (error) {
    throw new Error('Incorrect password. Please enter your valid account password.')
  }
  return true
}
