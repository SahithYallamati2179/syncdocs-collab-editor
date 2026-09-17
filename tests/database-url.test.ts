import { describe, expect, it } from 'vitest'
import {
  analyseDatabaseUrl,
  redactDatabaseUrl,
} from '../apps/server/src/storage/database-url.js'

/**
 * Each case here is a mistake that is easy to make and expensive to diagnose,
 * because none of them fail in a way that names the real cause. The point of
 * the check is to turn a confusing runtime symptom into a sentence at startup.
 */

const messages = (url: string) => analyseDatabaseUrl(url).map((problem) => problem.message)
const errors = (url: string) =>
  analyseDatabaseUrl(url).filter((problem) => problem.level === 'error')
const warnings = (url: string) =>
  analyseDatabaseUrl(url).filter((problem) => problem.level === 'warning')

const POOLER =
  'postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'

describe('DATABASE_URL checks', () => {
  it('passes a well-formed session pooler string', () => {
    expect(analyseDatabaseUrl(POOLER)).toEqual([])
  })

  it('accepts the transaction pooler port too', () => {
    expect(analyseDatabaseUrl(POOLER.replace(':5432', ':6543'))).toEqual([])
  })

  it('accepts a plain local connection', () => {
    expect(analyseDatabaseUrl('postgres://user:pw@localhost:5432/collab')).toEqual([])
  })

  it('treats an empty value as an error, since the driver cannot start', () => {
    expect(errors('')).toHaveLength(1)
    expect(messages('')[0]).toMatch(/empty/i)
    expect(errors('   ')).toHaveLength(1)
  })

  it('rejects something that is not a URL at all', () => {
    expect(errors('not a url')).toHaveLength(1)
    expect(messages('not a url')[0]).toMatch(/valid URL/i)
  })

  it('rejects a non-postgres protocol', () => {
    const problems = errors('mysql://user:pw@localhost:3306/db')
    expect(problems.some((problem) => /protocol/i.test(problem.message))).toBe(true)
  })

  /**
   * Supabase's connect dialog ships "[YOUR-PASSWORD]" as a literal, and pasting
   * it unedited produces "password authentication failed" — which says nothing
   * about the password being a placeholder.
   */
  it('catches the placeholder password left in from the dashboard', () => {
    const withPlaceholder = POOLER.replace(':s3cret@', ':%5BYOUR-PASSWORD%5D@')
    const problems = errors(withPlaceholder)
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/placeholder/i)
  })

  it('catches a missing password', () => {
    const problems = errors(POOLER.replace(':s3cret@', '@'))
    expect(problems.some((problem) => /no password/i.test(problem.message))).toBe(true)
  })

  /**
   * The direct host is IPv6-only on the free tier. It does not refuse the
   * connection, it hangs — so this is the difference between "wrong host" and
   * an afternoon spent blaming the database.
   */
  it('warns about the IPv6-only direct host, without refusing to start', () => {
    const direct = 'postgresql://postgres:s3cret@db.abcdefghijklmnop.supabase.co:5432/postgres'
    expect(errors(direct)).toHaveLength(0)

    const warned = warnings(direct)
    expect(warned).toHaveLength(1)
    expect(warned[0].message).toMatch(/IPv6/i)
    expect(warned[0].message).toMatch(/pooler/i)
  })

  it('warns about an unexpected port on the pooler', () => {
    const odd = POOLER.replace(':5432', ':1234')
    expect(warnings(odd).some((problem) => /port 1234/i.test(problem.message))).toBe(true)
  })

  it('warns when no database is named', () => {
    // Built explicitly rather than by stripping "/postgres" off POOLER: the
    // first such substring is inside "postgresql://postgres…", so a replace
    // would corrupt the scheme instead of dropping the database.
    const noDatabase =
      'postgresql://postgres.abcdefghijklmnop:s3cret@aws-0-ap-northeast-2.pooler.supabase.com:5432'
    expect(warnings(noDatabase).some((problem) => /names no database/i.test(problem.message))).toBe(
      true,
    )
  })

  it('reports several problems at once rather than only the first', () => {
    const bad = 'postgresql://postgres.abc@db.abcdefghijklmnop.supabase.co:5432'
    const problems = analyseDatabaseUrl(bad)
    expect(problems.length).toBeGreaterThan(1)
    expect(problems.some((problem) => /no password/i.test(problem.message))).toBe(true)
    expect(problems.some((problem) => /IPv6/i.test(problem.message))).toBe(true)
  })
})

describe('redacting a connection string for logs', () => {
  it('removes the password but keeps everything else readable', () => {
    const redacted = redactDatabaseUrl(POOLER)
    expect(redacted).not.toContain('s3cret')
    expect(redacted).toContain('aws-0-ap-northeast-2.pooler.supabase.com')
    expect(redacted).toContain('5432')
    expect(redacted).toContain('postgres.abcdefghijklmnop')
  })

  it('never throws on input it cannot parse', () => {
    expect(redactDatabaseUrl('nonsense')).toBe('(unparseable)')
    expect(redactDatabaseUrl('')).toBe('(unparseable)')
  })

  it('leaves a string with no password alone apart from parsing it', () => {
    expect(redactDatabaseUrl('postgres://localhost:5432/db')).not.toContain('***')
  })
})
