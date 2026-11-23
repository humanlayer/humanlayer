import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AskCard } from './AskCard'

vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: { approvals: { resolve: vi.fn() } } }) }))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast: vi.fn() }) }))

function approval(command: string) {
	return { id: 'approval', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'tool', suggestions: null }
}

describe('AskCard', () => {
	it('shows a short command whole, with no toggle', () => {
		render(<AskCard approval={approval('bun test')} total={1} onDenyWithFeedback={vi.fn()} />)
		expect(screen.getByText('bun test')).not.toHaveClass('collapsed')
		expect(screen.queryByRole('button', { name: /full command/ })).toBeNull()
	})

	// A command taller than the window pushed Approve off screen with no way to scroll to it.
	it('collapses a long command and keeps Approve reachable', () => {
		const command = Array.from({ length: 40 }, (_, line) => `echo line ${line}`).join('\n')
		render(<AskCard approval={approval(command)} total={1} onDenyWithFeedback={vi.fn()} />)
		const block = screen.getByText(/echo line 0/)
		expect(block).toHaveClass('collapsed')
		fireEvent.click(screen.getByRole('button', { name: 'Show the full command' }))
		expect(block).not.toHaveClass('collapsed')
		expect(screen.getByRole('button', { name: 'Show less of the command' })).toHaveAttribute(
			'aria-expanded',
			'true',
		)
		expect(screen.getByRole('button', { name: /Approve/ })).toBeEnabled()
	})

	it('collapses one very long wrapped line too', () => {
		render(<AskCard approval={approval(`curl ${'x'.repeat(2000)}`)} total={1} onDenyWithFeedback={vi.fn()} />)
		expect(screen.getByText(/^curl x+$/)).toHaveClass('collapsed')
	})
})
