import type { Meta, StoryObj } from '@storybook/react-vite'
import { FIXTURE_MIXED_ARTIFACTS } from './artifact-list-fixtures'
import { ArtifactListPopoverShellDemo } from './artifact-list-shell-demo'

const meta: Meta<typeof ArtifactListPopoverShellDemo> = {
	title: 'Shell Demos/ArtifactListShells',
	component: ArtifactListPopoverShellDemo,
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<div className="w-96 p-4 bg-background">
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof meta>

export const PopoverShell: Story = {
	args: {
		artifacts: FIXTURE_MIXED_ARTIFACTS,
	},
}
