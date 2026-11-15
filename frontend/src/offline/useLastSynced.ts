import { useEffect, useState } from 'react'
import { idbKv } from './kv'

export function useLastSynced(): string | null {
  const [at, setAt] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void idbKv
      .get('last-synced')
      .then((stored) => {
        if (current && stored) setAt((prev) => prev ?? stored)
      })
      .catch(() => undefined)

    const onSync = (event: Event) => {
      const iso = (event as CustomEvent<string>).detail
      if (typeof iso === 'string') setAt(iso)
    }
    const onCached = (event: Event) => {
      const iso = (event as CustomEvent<string>).detail
      if (typeof iso === 'string') setAt((prev) => prev ?? iso)
    }
    window.addEventListener('famcal:synced', onSync)
    window.addEventListener('famcal:cached-at', onCached)
    return () => {
      current = false
      window.removeEventListener('famcal:synced', onSync)
      window.removeEventListener('famcal:cached-at', onCached)
    }
  }, [])

  return at
}
