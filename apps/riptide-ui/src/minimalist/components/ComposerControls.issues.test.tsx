import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MinimalistPortalContext } from '@/minimalist/lib/portal'
import type { TicketProvider } from '@/minimalist/lib/tickets'
import type { ComposerAttachments } from '@/minimalist/lib/use-attachments'

import { AddButton } from './ComposerControls'

// jsdom does not implement the browser's modal dialog API.
vi.mock('@/minimalist/lib/modal', () => ({
	openModal: (dialog: HTMLDialogElement | null) => {
		dialog?.setAttribute('open', '')
		return () => dialog?.removeAttribute('open')
	},
}))

const connect = vi.fn()
vi.mock('@/hooks/useConnectIntegrationAction', () => ({ useConnectIntegrationAction: () => connect }))

// Linear is connected, GitHub needs connecting, and this deployment has no Jira keys.
vi.mock('@/minimalist/lib/tickets', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/lib/tickets')>()),
	useIssueSourceState: (provider: TicketProvider) =>
		({ linear: 'connected', github: 'disconnected', jira: 'not-set-up' })[provider],
}))

const attachments = { add: vi.fn() } as unknown as ComposerAttachments

describe('the + menu issue items', () => {
	it('says who can set up an integration this deployment lacks, and offers no connect', () => {
		const onAddIssue = vi.fn()
		render(
			<MinimalistPortalContext value={document.body}>
				<AddButton attachments={attachments} disabled={false} onAddIssue={onAddIssue} multiplayer={undefined} />
			</MinimalistPortalContext>,
		)
		fireEvent.click(screen.getByRole('button', { name: 'Add files or an issue' }))

		expect(screen.getByRole('button', { name: /^Linear issue/ })).toBeEnabled()
		expect(screen.getByRole('button', { name: /^Connect GitHub/ })).toBeEnabled()
		expect(screen.queryByRole('button', { name: /Connect Jira/ })).not.toBeInTheDocument()

		const jira = screen.getByRole('button', { name: /^Jira issue/ })
		expect(jira).toBeDisabled()
		expect(jira).toHaveTextContent('Jira is not set up on this instance. Check with your admin.')
		fireEvent.click(jira)
		expect(connect).not.toHaveBeenCalled()
		expect(onAddIssue).not.toHaveBeenCalled()
	})
})
