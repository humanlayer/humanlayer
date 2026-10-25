import type { ToastT } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { toForwardedToast } from './sonner-toasts'

function sonnerToast(fields: Partial<ToastT>): ToastT {
	return { id: 1, ...fields }
}

function ToastButtons(_: { action: { label: string; onClick: () => void } }) {
	return null
}

describe('toForwardedToast', () => {
	it('joins the title and description into one line', () => {
		expect(
			toForwardedToast(
				sonnerToast({
					title: 'Could not copy file path',
					description: 'Clipboard access was denied. Try again.',
				}),
			),
		).toEqual({ text: 'Could not copy file path. Clipboard access was denied. Try again.' })
	})

	it('does not add a second full stop after a title that ends a sentence', () => {
		expect(toForwardedToast(sonnerToast({ title: 'Update failed.', description: 'Try again.' }))?.text).toBe(
			'Update failed. Try again.',
		)
	})

	it('keeps an action object as the toast button', () => {
		const onClick = vi.fn()
		const forwarded = toForwardedToast(
			sonnerToast({ title: 'A billing subscription is required.', action: { label: 'Open Billing', onClick } }),
		)
		expect(forwarded?.action?.label).toBe('Open Billing')
		forwarded?.action?.run()
		expect(onClick).toHaveBeenCalledOnce()
	})

	it('reads the action out of a buttons element', () => {
		const onClick = vi.fn()
		const forwarded = toForwardedToast(
			sonnerToast({
				title: 'Could not start the daemon on this device',
				action: <ToastButtons action={{ label: 'Retry', onClick }} />,
			}),
		)
		expect(forwarded?.action?.label).toBe('Retry')
		forwarded?.action?.run()
		expect(onClick).toHaveBeenCalledOnce()
	})

	it('reads the text of an element title', () => {
		expect(toForwardedToast(sonnerToast({ title: <span>Welcome, Pat</span> }))?.text).toBe('Welcome, Pat')
	})

	it('skips a toast with no readable title', () => {
		expect(toForwardedToast(sonnerToast({ jsx: <div /> }))).toBeNull()
	})
})
