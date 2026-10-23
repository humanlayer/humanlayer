import type { Meta, StoryObj } from '@storybook/react-vite'

import { LauncherV3WidthMatrixShellDemo } from './launcher-v3-width-matrix-shell-demo'

const meta = {
	title: 'Shell Demos/Launcher V3/Width Matrix',
	component: LauncherV3WidthMatrixShellDemo,
	parameters: {
		layout: 'fullscreen',
	},
} satisfies Meta<typeof LauncherV3WidthMatrixShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
