import type { Meta, StoryObj } from '@storybook/react'

import { DiffCommentsPanelShellDemo } from './DiffCommentsPanelShellDemo'

const meta = {
	title: 'Shell Demos/Diff Review/Comments Panel',
	component: DiffCommentsPanelShellDemo,
} satisfies Meta<typeof DiffCommentsPanelShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Empty: Story = { args: { threads: [] } }
