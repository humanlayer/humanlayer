import type { SendMessageKeybinding } from '@/hooks/stores/settingsStore'

/** The parts of a keydown event this reads; a React keyboard event fits. */
type Keys = {
	key: string
	shiftKey: boolean
	metaKey: boolean
	ctrlKey: boolean
	nativeEvent: { isComposing: boolean }
}

/**
 * What an Enter press does in the composer. The send key sends (or queues while the agent runs);
 * while the agent runs, the send key plus ⌘ (or ⇧ when ⌘ already sends) interrupts and sends.
 * Anything else, such as ⇧ Enter or Enter while an input method composes, adds a line.
 */
export function enterAction(
	keys: Keys,
	sendKey: SendMessageKeybinding,
	canInterrupt: boolean,
): 'send' | 'interrupt' | null {
	if (keys.key !== 'Enter' || keys.nativeEvent.isComposing) return null
	const mod = keys.metaKey || keys.ctrlKey
	if (canInterrupt && mod && (sendKey === 'enter' ? !keys.shiftKey : keys.shiftKey)) return 'interrupt'
	const send = sendKey === 'enter' ? !keys.shiftKey && !mod : mod && !keys.shiftKey
	return send ? 'send' : null
}
