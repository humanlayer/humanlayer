import type { Meta, StoryObj } from '@storybook/react'

import { JsonArtifactViewerShellDemo } from './json-artifact-viewer-shell-demo'

const meta = {
	title: 'Shell Demos/Artifact Viewer JSON',
	component: JsonArtifactViewerShellDemo,
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof JsonArtifactViewerShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Json: Story = {
	args: {
		fileName: 'session.json',
		content: JSON.stringify({ session: { id: 'ses_123', status: 'running' }, tools: ['Read', 'Edit', 'Bash'] }, null, 2),
	},
}

export const Jsonl: Story = {
	args: {
		fileName: 'events.jsonl',
		content: '{"event":"start","session":"ses_123"}\ninvalid\n\n{"event":"finish","session":"ses_123"}\n',
	},
}
