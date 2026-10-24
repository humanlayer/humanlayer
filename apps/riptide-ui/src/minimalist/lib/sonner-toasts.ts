import { isValidElement } from 'react'
import type { ToastT } from 'sonner'

export interface ForwardedToast {
	text: string
	action?: { label: string; run: () => void }
}

interface ClickAction {
	label: unknown
	onClick: () => void
}

function plainText(node: unknown): string | null {
	if (typeof node === 'string' || typeof node === 'number') return String(node).trim() || null
	if (typeof node === 'function') return plainText(node())
	if (Array.isArray(node)) return node.map(plainText).filter(Boolean).join(' ') || null
	if (isValidElement<{ title?: unknown; children?: unknown }>(node))
		return plainText(node.props.title ?? node.props.children)
	return null
}

function isClickAction(value: unknown): value is ClickAction {
	return (
		typeof value === 'object' &&
		value !== null &&
		'label' in value &&
		'onClick' in value &&
		typeof value.onClick === 'function'
	)
}

function clickActionOf(action: unknown): ClickAction | null {
	if (isClickAction(action)) return action
	if (isValidElement<{ action?: unknown }>(action) && isClickAction(action.props.action)) return action.props.action
	return null
}

function endsWithPunctuation(text: string): boolean {
	return /[.!?…]$/.test(text)
}

function oneLine(title: string, description: string | null): string {
	if (!description) return title
	return `${title}${endsWithPunctuation(title) ? ' ' : '. '}${description}`
}

export function toForwardedToast(sonnerToast: ToastT): ForwardedToast | null {
	const title = plainText(sonnerToast.title)
	if (!title) return null
	const text = oneLine(title, plainText(sonnerToast.description))
	const action = clickActionOf(sonnerToast.action)
	const label = action ? plainText(action.label) : null
	if (!action || !label) return { text }
	return { text, action: { label, run: () => action.onClick() } }
}
