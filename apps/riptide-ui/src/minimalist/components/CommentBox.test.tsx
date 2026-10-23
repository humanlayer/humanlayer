import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommentBox } from './DocThread'

const key = 'comment:edit:comment'
const stored = () => JSON.parse(sessionStorage.getItem(key) ?? 'null') as string | null

function box(props: Partial<Parameters<typeof CommentBox>[0]> = {}) {
	return render(
		<CommentBox placeholder="Comment" action="Save" draftKey={key} onSave={vi.fn()} onClose={vi.fn()} {...props} />,
	)
}

beforeEach(() => {
	sessionStorage.clear()
	// jsdom has no layout, so a box can't scroll itself into view.
	Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('CommentBox drafts', () => {
	it('keeps what you type and brings it back in a new box', () => {
		const first = box()
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Half a thought' } })
		expect(stored()).toBe('Half a thought')
		first.unmount()
		box()
		expect(screen.getByRole('textbox')).toHaveValue('Half a thought')
	})
	it('keeps the draft on Escape and throws it away on Discard', () => {
		const onClose = vi.fn()
		box({ onClose })
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Maybe later' } })
		fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
		expect(onClose).toHaveBeenCalledOnce()
		expect(stored()).toBe('Maybe later')
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
		expect(stored()).toBeNull()
	})
	it('clears the draft when the comment saves, and keeps it when it does not', () => {
		const onSave = vi.fn(() => false)
		box({ onSave })
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Try once' } })
		fireEvent.click(screen.getByRole('button', { name: /Save/ }))
		expect(onSave).toHaveBeenCalledWith('Try once')
		expect(stored()).toBe('Try once')
		onSave.mockReturnValue(true)
		fireEvent.click(screen.getByRole('button', { name: /Save/ }))
		expect(stored()).toBeNull()
	})
	it('starts an edit from the comment, and stores nothing until the text changes', () => {
		box({ initial: 'Saved text' })
		expect(screen.getByRole('textbox')).toHaveValue('Saved text')
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved text, edited' } })
		expect(stored()).toBe('Saved text, edited')
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved text' } })
		expect(stored()).toBeNull()
	})
})
