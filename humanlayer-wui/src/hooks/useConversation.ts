import { useState, useEffect, useCallback, useRef } from 'react'
import { daemonClient, ConversationEvent } from '@/lib/daemon'
import { formatError } from '@/utils/errors'

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
  const [events, setEvents] = useState<ConversationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [isInitialLoad, setIsInitialLoad] = useState(true)

  const fetchConversation = useCallback(async () => {
    if (errorCount > 3) {
      return
    }

    if (!sessionId && !claudeSessionId) {
      setError('Either sessionId or claudeSessionId must be provided')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const response = await daemonClient.getConversation(sessionId, claudeSessionId)
      setEvents(response.events)
      setErrorCount(0)
      setIsInitialLoad(false)
    } catch (err) {
      setError(formatError(err))
      setErrorCount(prev => prev + 1)
    } finally {
      setLoading(false)
    }
  }, [sessionId, claudeSessionId, errorCount])

  // Store the latest fetchConversation function in a ref
  const fetchConversationRef = useRef(fetchConversation)
  fetchConversationRef.current = fetchConversation

  useEffect(() => {
    // Initial fetch
    fetchConversationRef.current()

    const interval = setInterval(() => {
      fetchConversationRef.current()
    }, pollInterval)

    return () => {
      clearInterval(interval)
    }
  }, []) // Empty dependency array - only runs once on mount

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
