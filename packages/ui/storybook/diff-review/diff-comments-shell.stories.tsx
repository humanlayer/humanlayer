import type { Meta, StoryObj } from '@storybook/react'

import { DiffCommentsShellDemo } from './DiffCommentsShellDemo'

const meta = {
	title: 'Shell Demos/Diff Review/Comment Interactions',
	component: DiffCommentsShellDemo,
} satisfies Meta<typeof DiffCommentsShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
