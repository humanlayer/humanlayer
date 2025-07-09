import { useState, useEffect, useCallback } from 'react'
import { daemonClient, RecentPath } from '@/lib/daemon'
import { formatError } from '@/utils/errors'

interface UseRecentPathsReturn {
  paths: RecentPath[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useRecentPaths(limit = 20): UseRecentPathsReturn {
  const [paths, setPaths] = useState<RecentPath[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchRecentPaths = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await daemonClient.getRecentPaths(limit)
      setPaths(response.paths)
    } catch (err) {
      setError(formatError(err))
      setPaths([])
    } finally {
      setLoading(false)
    }
  }, [limit])

  // Fetch on mount and when limit changes
  useEffect(() => {
    fetchRecentPaths()
  }, [fetchRecentPaths])

  return {
    paths,
    loading,
    error,
    refresh: fetchRecentPaths,
  }
}
