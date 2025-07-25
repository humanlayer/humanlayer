import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient, ConversationEvent } from '@/lib/daemon'
import { formatError } from '@/utils/errors'
import { useStore } from '@/AppStore'

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  // Add abort controller for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null)

  // Get events from store if this is the active session
  const events = (
    activeSessionDetail?.session.id === sessionId ? activeSessionDetail.conversation : []
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
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController()

    try {
      setLoading(true)
      setError(null)

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
      // Ignore abort errors
      if (err.name === 'AbortError') {
        return
      }
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

  const formattedEvents: FormattedMessage[] = base.events.map(event => {
    let content = event.content || ''
    let type: FormattedMessage['type'] = 'message'

    if (event.event_type === 'tool_call') {
      type = 'tool_call'
      content = `Calling ${event.tool_name || 'tool'}`
      if (event.tool_input_json) {
        try {
          const input = JSON.parse(event.tool_input_json)
          content += `: ${JSON.stringify(input, null, 2)}`
        } catch {
          content += `: ${event.tool_input_json}`
        }
      }
    } else if (event.event_type === 'tool_result') {
      type = 'tool_result'
      content = event.tool_result_content || 'Tool completed'
    } else if (event.approval_status) {
      type = 'approval'
      content = `Approval ${event.approval_status}`
    }

    return {
      id: event.id,
      type,
      role: event.role,
      content,
      timestamp: new Date(event.created_at),
      metadata: {
        toolName: event.tool_name,
        toolId: event.tool_id,
        approvalStatus: event.approval_status || undefined,
        approvalId: event.approval_id,
      },
    }
  })

  return {
    ...base,
    formattedEvents,
  }
}
