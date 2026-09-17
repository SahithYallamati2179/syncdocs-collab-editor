/**
 * Sanity checks on DATABASE_URL, run at startup.
 *
 * These exist because every one of them is a mistake that otherwise surfaces
 * late and badly. The connection string is copied by hand out of a dashboard,
 * usually once, usually in a hurry, and the failure modes are unhelpfully
 * quiet: a placeholder password authenticates as the literal string
 * "[YOUR-PASSWORD]", and an unreachable host does not refuse the connection,
 * it hangs until a timeout that reads like a slow database rather than a
 * wrong address.
 *
 * Pure string work, deliberately — no pg import — so it is cheap to test and
 * runs before anything tries to open a socket.
 */

export type ProblemLevel = 'error' | 'warning'

export interface Problem {
  level: ProblemLevel
  message: string
}

/** Supabase's own connect dialog ships this literal placeholder. */
const PASSWORD_PLACEHOLDERS = [
  '[your-password]',
  '[yourpassword]',
  '[password]',
  'your-password',
  'yourpassword',
]

export function analyseDatabaseUrl(raw: string): Problem[] {
  const value = raw.trim()
  const problems: Problem[] = []

  if (!value) {
    return [
      {
        level: 'error',
        message:
          'STORAGE_DRIVER=postgres but DATABASE_URL is empty. Set it to your pooled connection string, or set STORAGE_DRIVER=file.',
      },
    ]
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return [
      {
        level: 'error',
        message:
          'DATABASE_URL is not a valid URL. It should look like postgresql://user:password@host:5432/postgres',
      },
    ]
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    problems.push({
      level: 'error',
      message: `DATABASE_URL has protocol "${url.protocol}". Expected postgres: or postgresql:.`,
    })
  }

  const password = decodeURIComponent(url.password || '')
  if (!password) {
    problems.push({
      level: 'error',
      message: 'DATABASE_URL has no password in it. Copy the full string, including the password.',
    })
  } else if (PASSWORD_PLACEHOLDERS.includes(password.toLowerCase())) {
    // Pasting the dashboard string unedited is the single most common way this
    // goes wrong, and the resulting error ("password authentication failed")
    // does not hint that the password is literally the placeholder.
    problems.push({
      level: 'error',
      message:
        'DATABASE_URL still contains the placeholder password from the dashboard. Replace [YOUR-PASSWORD] with the real one.',
    })
  }

  /**
   * The direct host is IPv6-only on Supabase's free tier, and a free Render
   * instance has no IPv6 route to it. That does not fail fast: the connection
   * hangs and eventually times out, so it reads as a slow database rather than
   * an unreachable one. The pooler is dual-stack.
   */
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(url.hostname)) {
    problems.push({
      level: 'warning',
      message:
        `DATABASE_URL points at the direct host (${url.hostname}), which is IPv6-only on Supabase's free tier. ` +
        'Most free hosts cannot reach it, and the symptom is a hang rather than a refusal. ' +
        'Use the Session pooler string instead (host ends in .pooler.supabase.com, port 5432).',
    })
  }

  const port = url.port || '5432'
  if (/pooler\.supabase\.com$/i.test(url.hostname) && port !== '5432' && port !== '6543') {
    problems.push({
      level: 'warning',
      message: `DATABASE_URL uses port ${port} against the pooler. Expected 5432 (session) or 6543 (transaction).`,
    })
  }

  const database = url.pathname.replace(/^\//, '')
  if (!database) {
    problems.push({
      level: 'warning',
      message: 'DATABASE_URL names no database. Supabase expects /postgres at the end.',
    })
  }

  return problems
}

/** A connection string with the password blanked, safe to print in a log. */
export function redactDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw.trim())
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return '(unparseable)'
  }
}
