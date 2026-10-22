import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'

import { LauncherAttachmentControl } from './LauncherAttachmentControl'

const meta = {
	title: 'Components/LauncherV3/AttachmentControl',
	component: LauncherAttachmentControl,
	parameters: { layout: 'centered' },
	decorators: [
		(Story) => (
			<div className="w-[680px] max-w-full">
				<Story />
			</div>
		),
	],
	args: {
		ticket: null,
		integrations: {
			linear: { status: 'available', description: 'Import from a Linear issue' },
			github: { status: 'available', description: 'Import from an installed repository' },
			jira: { status: 'unavailable', description: 'Connect Jira to import issues', actionLabel: 'Connect' },
		},
		providerShortcuts: {
			linear: formatShortcut(hotkeysCatalog.launcherV3.shortcuts.attachLinear.display),
			github: formatShortcut(hotkeysCatalog.launcherV3.shortcuts.attachGitHub.display),
			jira: formatShortcut(hotkeysCatalog.launcherV3.shortcuts.attachJira.display),
		},
		onAddTicket: fn(),
		onConnectIntegration: fn(),
		onAddFiles: fn(),
	},
} satisfies Meta<typeof LauncherAttachmentControl>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {},
}

export const Disabled: Story = {
	args: { disabled: true },
}
