import { useEffect, useCallback } from 'react'
import { daemonClient, RecentPath } from '@/lib/daemon'
import { useAsyncState } from './useAsyncState'

interface UseRecentPathsReturn {
  paths: RecentPath[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useRecentPaths(limit = 20): UseRecentPathsReturn {
  const { data: paths, loading, error, execute } = useAsyncState<RecentPath[]>([])

  const fetchRecentPaths = useCallback(async () => {
    await execute(async () => {
      const response = await daemonClient.getRecentPaths(limit)
      // Convert string[] to RecentPath[] format
      return response.map(path => ({
        path,
        last_used: new Date().toISOString(),
        usage_count: 1,
      }))
    })
  }, [limit, execute])

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
