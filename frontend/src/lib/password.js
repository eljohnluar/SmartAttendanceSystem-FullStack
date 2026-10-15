// Single password policy for every account creation point (Add Staff,
// Register). 8–14 characters with at least one letter, one digit, and one
// special character. Ambiguous glyphs (0/O, 1/l/I) are left out so a
// password survives being read to someone over the phone.

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 14

const LETTERS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SPECIALS = '!@#$%^&*-_+=?'
const ALL = LETTERS + DIGITS + SPECIALS

export const PASSWORD_HINT = `Use ${PASSWORD_MIN}–${PASSWORD_MAX} characters with letters, numbers, and a special character (${SPECIALS}).`

/** Returns null when the password is acceptable, otherwise the error to show. */
export function passwordError(password) {
  if (!password) return 'Enter a password.'
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Use ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*\-_+=?]/.test(password)) {
    return 'Include letters, numbers, and a special character (!@#$%^&*-_+=?).'
  }
  return null
}

/** 12-char generator that always satisfies the policy above. */
export function generatePassword(length = 12) {
  const size = Math.min(Math.max(length, PASSWORD_MIN), PASSWORD_MAX)
  const bytes = crypto.getRandomValues(new Uint8Array(size * 2))
  const chars = [
    LETTERS[bytes[0] % LETTERS.length],
    DIGITS[bytes[1] % DIGITS.length],
    SPECIALS[bytes[2] % SPECIALS.length],
  ]
  for (let i = 3; i < size; i++) {
    chars.push(ALL[bytes[i] % ALL.length])
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[size + i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
