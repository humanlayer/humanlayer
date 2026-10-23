import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMountEffect } from '@/hooks/useMountEffect'

// Publishes the visible session to the focus store so global actions (e.g. the
// command palette archive action) target it; cleared on unmount. Must be rendered
// with `key={sessionId}` so navigating between sessions remounts it — the session
// detail page itself is not remounted on param changes. Returns null — it exists
// purely to host the mount effect.
export function SessionFocusSync({ sessionId }: { sessionId: string }) {
	useMountEffect(() => {
		useFocusStore.getState().setFocusedSessionId(sessionId, 'keyboard')
		return () => {
			useFocusStore.getState().setFocusedSessionId(null, 'keyboard')
		}
	})
	return null
}
