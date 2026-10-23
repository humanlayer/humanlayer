import type { Session } from '@humanlayer/db/tables/sessions'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NextStepCard } from './NextStepCard'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: {} }) }))
vi.mock('@/minimalist/lib/use-action', () => ({ useAction: () => ({ pending: false, run: vi.fn() }) }))
vi.mock('@/hooks/live-queries/useExistingSessionForNextStep', () => ({
	useExistingSessionForNextStep: () => ({ siblingSessionId: null }),
}))

const session = (id: string) =>
	({
		id,
		task_id: 'task',
		host_id: 'host',
		working_directory: '/repo',
		created_at: new Date(0),
		next_step_suggestions: [
			{
				parsedAt: 0,
				extraction: {
					type: 'next_step_found',
					nextStepPrompt: 'use the rpi:create-plan skill for the task',
					nextStepSummary: 'Proceed to the plan',
					nextStepType: 'create-plan',
					taskReference: 'task',
				},
			},
		],
	}) as unknown as Session

const task = { id: 'task', workspace_id: null }
const host = { online: true } as Parameters<typeof NextStepCard>[0]['host']

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('NextStepCard', () => {
	it('folds into a thin row for that session and opens again from it', () => {
		const { rerender } = render(<NextStepCard session={session('a')} task={task} host={host} />)
		expect(screen.getByRole('group', { name: 'Next step' })).toHaveTextContent('Write the plan')
		fireEvent.click(screen.getByRole('button', { name: 'Hide next step' }))
		expect(screen.queryByRole('group', { name: 'Next step' })).toBeNull()
		const row = screen.getByRole('button', { name: 'Show next step: Write the plan' })

		// Another session still shows its card; coming back keeps this one folded.
		rerender(<NextStepCard session={session('b')} task={task} host={host} />)
		expect(screen.getByRole('group', { name: 'Next step' })).toBeInTheDocument()
		rerender(<NextStepCard session={session('a')} task={task} host={host} />)
		fireEvent.click(screen.getByRole('button', { name: 'Show next step: Write the plan' }))
		expect(screen.getByRole('group', { name: 'Next step' })).toBeInTheDocument()
		expect(row.isConnected).toBe(false)
	})
})
