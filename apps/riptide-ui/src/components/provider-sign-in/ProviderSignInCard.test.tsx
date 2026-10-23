import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import {
	ProviderSignInAction,
	ProviderSignInCard,
	type ProviderSignInHost,
	type ProviderSignInRequest,
} from './ProviderSignInCard'

const makeRequest = (status: ProviderSignInRequest['status']): ProviderSignInRequest => ({
	id: 'request-1',
	status,
	url: null,
	userCode: null,
	submittedCode: null,
	error: null,
	accountLabel: null,
})

function renderCard(request: ProviderSignInRequest | null, host: ProviderSignInHost = { state: 'ready' }) {
	const onSignIn = vi.fn()
	const onCancel = vi.fn()
	const onOpenDaemonSettings = vi.fn()
	render(
		<ProviderSignInCard
			provider="claude"
			request={request}
			variant="card"
			host={host}
			isStarting={false}
			onSignIn={onSignIn}
			onCancel={onCancel}
			onSubmitCode={vi.fn()}
			onOpenUrl={vi.fn()}
			onOpenDaemonSettings={onOpenDaemonSettings}
		/>,
	)
	return { onSignIn, onCancel, onOpenDaemonSettings }
}

describe('ProviderSignInCard', () => {
	test.each(['failed', 'cancelled'] as const)('claims no sign-in state after %s and offers a restart', (status) => {
		const error = 'Sign-in timed out. Start again when you are ready.'
		const { onSignIn } = renderCard({ ...makeRequest(status), error })
		expect(screen.queryByText(/signed in/i)).not.toBeInTheDocument()
		expect(screen.getByText(error)).not.toHaveClass('text-destructive')
		fireEvent.click(screen.getByRole('button', { name: status === 'failed' ? 'Try again' : 'Sign in to Claude' }))
		expect(onSignIn).toHaveBeenCalledOnce()
	})

	test.each([null, makeRequest('cancelled'), makeRequest('failed')])(
		'offers to sign in again when the agent already works on the host (request: %o)',
		(request) => {
			const onSignIn = vi.fn()
			render(
				<ProviderSignInAction
					provider="claude"
					request={request}
					host={{ state: 'ready' }}
					isStarting={false}
					hasWorkingSignIn
					onSignIn={onSignIn}
					onCancel={vi.fn()}
				/>,
			)
			fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
			expect(onSignIn).toHaveBeenCalledOnce()
		},
	)

	test('blocks sign-in on a host whose CLI daemon cannot run it and points to daemon settings', () => {
		const { onOpenDaemonSettings } = renderCard(null, { state: 'outdated', daemonVersion: '0.31.173-dev.0' })
		expect(
			screen.getByText('Update the HumanLayer CLI from 0.31.173-dev.0 to 0.31.183 or later.'),
		).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Sign in to Claude' })).toBeDisabled()
		fireEvent.click(screen.getByRole('button', { name: 'Open host settings' }))
		expect(onOpenDaemonSettings).toHaveBeenCalledOnce()
	})

	test('lets you cancel a live sign-in', () => {
		const { onCancel } = renderCard(makeRequest('awaiting_approval'))
		expect(screen.getByText('Waiting for you')).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
		expect(onCancel).toHaveBeenCalledWith('request-1')
	})
})
