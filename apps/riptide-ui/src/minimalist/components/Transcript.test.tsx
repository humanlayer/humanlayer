import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { FileEdits } from '@/minimalist/lib/tools'
import type { Turn } from '@/minimalist/lib/transcript'

import { Transcript } from './Transcript'

const { turnWrites } = vi.hoisted(() => ({ turnWrites: vi.fn() }))

vi.mock('@/minimalist/lib/data', () => ({
	useTask: () => ({ task: null }),
	canReview: () => false,
}))
vi.mock('@/minimalist/lib/tools', () => ({ turnWrites, latestTodos: () => [] }))
vi.mock('@/minimalist/components/Steps', () => ({ StepList: () => null }))
vi.mock('@/minimalist/components/Prose', () => ({ Prose: () => null }))

const turn: Turn = {
	kind: 'agent',
	id: 'turn',
	steps: [],
	answer: null,
	startedAt: 1000,
	endedAt: 2000,
}

describe('minimalist end-of-turn edits summary', () => {
	it.each([1, 2])('hides the card when all %i files have zero line counts', (count) => {
		turnWrites.mockReturnValue({
			docs: [],
			files: Array.from({ length: count }, (_, index) => ({ path: `file-${index}.ts`, added: 0, removed: 0 })),
		})
		const { container } = render(<Transcript turns={[turn]} running={false} />)
		expect(container.querySelector('.diffcard.edits')).toBeNull()
	})

	it.each([
		{ added: 3, removed: 0 },
		{ added: 0, removed: 2 },
		{ added: 3, removed: 2 },
	])('shows the card for +$added/-$removed', ({ added, removed }) => {
		const files: FileEdits[] = [{ path: 'src/file.ts', added, removed }]
		turnWrites.mockReturnValue({ docs: [], files })
		const { container } = render(<Transcript turns={[turn]} running={false} />)
		expect(screen.getByText('Edited file.ts')).toBeInTheDocument()
		expect(container.querySelector('.add')).toHaveTextContent(`+${added}`)
		expect(container.querySelector('.del')).toHaveTextContent(`\u2212${removed}`)
	})
})
