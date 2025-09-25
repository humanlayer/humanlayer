import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient, ConversationEvent } from '@/lib/daemon'
import { formatError } from '@/utils/errors'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'

interface UseConversationReturn {
  events: ConversationEvent[]
  loading: boolean
  error: string | null
  isInitialLoad: boolean
  refresh: () => Promise<void>
}

export function useConversation(
  sessionId?: string,
  claudeSessionId?: string,
  pollInterval: number = 1000,
): UseConversationReturn {
  const activeSessionDetail = useStore(state => state.activeSessionDetail)
  const updateActiveSessionConversation = useStore(state => state.updateActiveSessionConversation)
  const sessionStatus = activeSessionDetail?.session.status
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Add abort controller for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  // Get events from store if this is the active session
  const events = (
    activeSessionDetail?.session.id === sessionId ? activeSessionDetail?.conversation : []
  ) as ConversationEvent[]

  const fetchConversation = useCallback(async () => {
    if (errorCount > 3) {
      return
    }

    if (!sessionId && !claudeSessionId) {
      setError('Either sessionId or claudeSessionId must be provided')
      setLoading(false)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort()
      } catch (err) {
        console.log('[useConversation] Error aborting request:', err)
      }
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      if (abortControllerRef.current.signal.aborted) {
        console.log('[useConversation] Ignoring abort error')
        return
      }

      setLoading(true)
      setError(null)

      console.log('[useConversation] Fetching conversation for session:', sessionId, 'status:', sessionStatus, 'abortControllerRef.current:', abortControllerRef.current)

      const response = await daemonClient.getConversation(
        { session_id: sessionId, claude_session_id: claudeSessionId },
        { signal: abortControllerRef.current.signal },
      )

      // Update the store if this is the active session
      if (activeSessionDetail?.session.id === sessionId) {
        updateActiveSessionConversation(response)
      }

      setErrorCount(0)
      setIsInitialLoad(false)
    } catch (err: any) {
      if (abortControllerRef.current?.signal.aborted || err?.cause?.name === 'AbortError') {
        console.log('[useConversation] Ignoring abort error')
        return
      }

      console.log('[useConversation] Error fetching conversation:', err, 'sessionStatus:', sessionStatus)

      setError(formatError(err))
      setErrorCount(prev => prev + 1)
    } finally {
      setLoading(false)
    }
  }, [sessionId, claudeSessionId, errorCount, activeSessionDetail, updateActiveSessionConversation])

  // Store the latest fetchConversation function in a ref
  const fetchConversationRef = useRef(fetchConversation)
  fetchConversationRef.current = fetchConversation

  useEffect(() => {
    // Don't poll if sessionId is undefined (e.g., for draft sessions)
    if (!sessionId) {
      return
    }

    // Only poll if this is the active session
    if (activeSessionDetail?.session.id !== sessionId) {
      return
    }

    // Initial fetch
    fetchConversationRef.current()

    const interval = setInterval(() => {
      fetchConversationRef.current()
    }, pollInterval)

    return () => {
      clearInterval(interval)
      // Cancel any pending request on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [sessionId, activeSessionDetail?.session.id, pollInterval])

  return {
    events,
    loading,
    error,
    refresh: fetchConversation,
    isInitialLoad,
  }
}

// Formatted conversation for display
export interface FormattedMessage {
  id: number
  type: 'message' | 'tool_call' | 'tool_result' | 'approval'
  role?: string
  content: string
  timestamp: Date
  metadata?: {
    toolName?: string
    toolId?: string
    approvalStatus?: string
    approvalId?: string
  }
}

export function useFormattedConversation(
  sessionId?: string,
  claudeSessionId?: string,
): UseConversationReturn & { formattedEvents: FormattedMessage[] } {
  const base = useConversation(sessionId, claudeSessionId)

  const formattedEvents: FormattedMessage[] = base.events
    .filter(event => event.id !== undefined)
    .map(event => {
      let content = event.content || ''
      let type: FormattedMessage['type'] = 'message'

      if (event.eventType === 'tool_call') {
        type = 'tool_call'
        content = `Calling ${event.toolName || 'tool'}`
        if (event.toolInputJson) {
          try {
            const input = JSON.parse(event.toolInputJson)
            content += `: ${JSON.stringify(input, null, 2)}`
          } catch {
            content += `: ${event.toolInputJson}`
          }
        }
      } else if (event.eventType === 'tool_result') {
        type = 'tool_result'
        content = event.toolResultContent || 'Tool completed'
      } else if (event.approvalStatus) {
        type = 'approval'
        content = `Approval ${event.approvalStatus}`
      }

      return {
        id: event.id!,
        type,
        role: event.role,
        content,
        timestamp: new Date(event.createdAt || new Date()),
        metadata: {
          toolName: event.toolName,
          toolId: event.toolId,
          approvalStatus: event.approvalStatus || undefined,
          approvalId: event.approvalId,
        },
      }
    })

  return {
    ...base,
    formattedEvents,
  }
}
