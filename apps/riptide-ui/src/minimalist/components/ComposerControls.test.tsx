import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MinimalistPortalContext } from '@/minimalist/lib/portal'
import type { ComposerAttachments } from '@/minimalist/lib/use-attachments'

import { AddButton } from './ComposerControls'

// jsdom does not implement the browser's modal dialog API.
vi.mock('@/minimalist/lib/modal', () => ({
	openModal: (dialog: HTMLDialogElement | null) => {
		dialog?.setAttribute('open', '')
		return () => dialog?.removeAttribute('open')
	},
}))

const attachments = { add: vi.fn() } as unknown as ComposerAttachments

function open(multiplayer: Parameters<typeof AddButton>[0]['multiplayer']) {
	render(
		<MinimalistPortalContext value={document.body}>
			<AddButton attachments={attachments} disabled={false} onAddIssue={undefined} multiplayer={multiplayer} />
		</MinimalistPortalContext>,
	)
	fireEvent.click(screen.getByRole('button', { name: 'Open composer options' }))
}

describe('the + menu', () => {
	it('offers files and multiplayer prompting, and opens sharing', () => {
		const onSelect = vi.fn()
		open({ active: true, detail: '2 teammates can prompt · 42m left', disabled: false, onSelect })
		expect(screen.getByRole('button', { name: /^Files/ })).toBeInTheDocument()
		const item = screen.getByRole('button', { name: /Multiplayer prompting/ })
		expect(item).toHaveTextContent('2 teammates can prompt · 42m left')
		expect(item).toHaveTextContent('✓')
		fireEvent.click(item)
		expect(onSelect).toHaveBeenCalledOnce()
	})

	it('says why a member who is not the owner cannot change it', () => {
		const onSelect = vi.fn()
		open({ active: false, detail: 'Only the session owner can change this', disabled: true, onSelect })
		const item = screen.getByRole('button', { name: /Multiplayer prompting/ })
		expect(item).toBeDisabled()
		expect(item).toHaveTextContent('Only the session owner can change this')
	})
})
