'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { newDocumentId, readRecents } from '@/lib/documents'

/**
 * The app is a document workspace, so the root has nothing of its own to show.
 * It reopens whatever you had last, or starts a fresh document.
 */
export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const [mostRecent] = readRecents()
    router.replace(`/doc/${mostRecent ?? newDocumentId()}`)
  }, [router])

  return (
    <main style={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
      <span style={{ color: 'var(--ink-3)', fontSize: 13 }}>Opening your workspace…</span>
    </main>
  )
}
