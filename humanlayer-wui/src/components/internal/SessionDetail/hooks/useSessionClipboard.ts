import { useHotkeys } from 'react-hotkeys-hook'
import { ConversationEvent, ConversationEventType } from '@/lib/daemon/types'
import { copyToClipboard } from '@/utils/clipboard'
import { SessionDetailHotkeysScope } from '../SessionDetail'

export function useSessionClipboard(focusedEvent: ConversationEvent | null, enabled: boolean = true) {
  const getMessageContent = (event: ConversationEvent): string | null => {
    if (event.eventType !== ConversationEventType.Message) return null
    if (event.role !== 'user' && event.role !== 'assistant') return null
    return event.content || null
  }

  useHotkeys(
    'y',
    () => {
      if (!focusedEvent) return

      const content = getMessageContent(focusedEvent)
      if (content) {
        copyToClipboard(content)
      }
    },
    {
      enabled: enabled && !!focusedEvent,
      scopes: SessionDetailHotkeysScope,
    },
  )
}
