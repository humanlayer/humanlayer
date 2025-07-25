import { useState, useEffect, useCallback } from 'react'
import { daemonClient } from '@/lib/daemon/client'
import type { FileSnapshotInfo } from '@/lib/daemon/types'

interface SnapshotCache {
  [filePath: string]: FileSnapshotInfo
}

export function useSessionSnapshots(sessionId: string | undefined) {
  const [snapshots, setSnapshots] = useState<SnapshotCache>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSnapshots = useCallback(async () => {
    if (!sessionId) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await daemonClient.getSessionSnapshots(sessionId)

      // Build cache indexed by file path
      const cache: SnapshotCache = {}
      response.forEach(snapshot => {
        // Keep most recent snapshot per file
        if (
          !cache[snapshot.file_path] ||
          new Date(snapshot.created_at) > new Date(cache[snapshot.file_path].created_at)
        ) {
          cache[snapshot.file_path] = snapshot
        }
      })

      setSnapshots(cache)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch snapshots')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Initial fetch
  useEffect(() => {
    fetchSnapshots()
  }, [fetchSnapshots])

  const getSnapshot = useCallback(
    (filePath: string): FileSnapshotInfo | undefined => {
      const snapshot = snapshots[filePath]
      return snapshot
    },
    [snapshots],
  )

  return { snapshots, getSnapshot, loading, error, refetch: fetchSnapshots }
}
