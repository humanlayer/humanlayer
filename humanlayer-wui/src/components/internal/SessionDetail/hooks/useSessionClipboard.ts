import { useRegisteredHotkey } from '@/hooks/useRegisteredHotkey'
import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'
import { copyToClipboard } from '@/utils/clipboard'
import { SessionDetailHotkeysScope } from '../SessionDetail'

export function useSessionClipboard(focusedEvent: ConversationEvent | null, enabled: boolean = true) {
  const getMessageContent = (event: ConversationEvent): string | null => {
    if (event.event_type !== ConversationEventType.Message) return null
    if (event.role !== 'user' && event.role !== 'assistant') return null
    return event.content || null
  }

  useRegisteredHotkey(
    'COPY_MESSAGE_CONTENT',
    () => {
      if (!focusedEvent) return

      const content = getMessageContent(focusedEvent)
      if (content) {
        copyToClipboard(content)
      }
    },
    {
      scopes: [SessionDetailHotkeysScope],
      enabled: enabled && !!focusedEvent,
    },
  )
}
