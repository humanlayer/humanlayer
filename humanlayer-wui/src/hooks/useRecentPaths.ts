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
      // Response is already RecentPath[] with proper data
      return response
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
