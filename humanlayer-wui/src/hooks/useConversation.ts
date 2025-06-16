import { useState, useEffect, useCallback } from 'react'
import { daemonClient, ConversationEvent } from '@/lib/daemon'
import { formatError } from '@/utils/errors'

interface UseConversationReturn {
  events: ConversationEvent[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useConversation(
  sessionId?: string,
  claudeSessionId?: string
): UseConversationReturn {
  const [events, setEvents] = useState<ConversationEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConversation = useCallback(async () => {
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
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [sessionId, claudeSessionId])

  useEffect(() => {
    fetchConversation()
  }, [fetchConversation])

  return {
    events,
    loading,
    error,
    refresh: fetchConversation
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
  claudeSessionId?: string
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
        approvalId: event.approval_id
      }
    }
  })
  
  return {
    ...base,
    formattedEvents
  }
}