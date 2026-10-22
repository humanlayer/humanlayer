import type { Meta, StoryObj } from '@storybook/react'

import { DiffFullscreenShellDemo } from './DiffFullscreenShellDemo'

const meta = {
	title: 'Shell Demos/Diff Fullscreen Review',
	component: DiffFullscreenShellDemo,
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DiffFullscreenShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
