import { useState, useCallback } from 'react'
import { formatError } from '@/utils/errors'

interface UseAsyncStateOptions<T> {
  initialData?: T
}

interface UseAsyncStateReturn<T> {
  data: T
  loading: boolean
  error: string | null
  execute: (asyncFn: () => Promise<T>) => Promise<void>
}

export function useAsyncState<T>(
  defaultValue: T,
  options?: UseAsyncStateOptions<T>,
): UseAsyncStateReturn<T> {
  const [data, setData] = useState<T>(options?.initialData ?? defaultValue)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (asyncFn: () => Promise<T>) => {
    try {
      setLoading(true)
      setError(null)
      const result = await asyncFn()
      setData(result)
    } catch (err) {
      setError(await formatError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, execute }
}
