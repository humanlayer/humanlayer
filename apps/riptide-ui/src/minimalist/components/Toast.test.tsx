import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Toast } from './Toast'

const { dismissToast, run } = vi.hoisted(() => ({ dismissToast: vi.fn(), run: vi.fn() }))
vi.mock('@/minimalist/lib/ui-state', () => ({
	useUi: () => ({ toast: { id: 7, text: 'Task unarchived', action: { label: 'Undo', run } }, dismissToast }),
}))

describe('Toast', () => {
	it('closes from its dismiss button without running the action', () => {
		render(<Toast />)
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
		expect(dismissToast).toHaveBeenCalledWith(7)
		expect(run).not.toHaveBeenCalled()
	})
})
