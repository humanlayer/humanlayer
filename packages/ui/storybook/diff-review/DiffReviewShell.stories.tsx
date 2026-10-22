import type { Meta, StoryObj } from '@storybook/react'

import { DiffReviewShellDemo } from './DiffReviewShellDemo'

const meta = {
	title: 'Shell Demos/DiffReview',
	component: DiffReviewShellDemo,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof DiffReviewShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
