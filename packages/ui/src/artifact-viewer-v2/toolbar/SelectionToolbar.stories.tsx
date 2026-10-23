import type { Meta, StoryObj } from '@storybook/react'
import { MessageSquarePlus, X } from 'lucide-react'
import { fn } from 'storybook/test'

import { Button } from '../../components/button'
import { SelectionToolbar } from './SelectionToolbar'

// The toolbar positions itself with `position: fixed` from a viewport rect;
// place a representative rect near the top of the canvas so the floating bar is
// visible in the story frame.
const meta = {
	title: 'Components/ArtifactViewerV2/SelectionToolbar',
	component: SelectionToolbar,
	parameters: { layout: 'fullscreen' },
	decorators: [
		(Story) => (
			<div style={{ height: '12rem', position: 'relative' }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SelectionToolbar>
export default meta

type Story = StoryObj<typeof meta>

// Slice 5 composes only Comment and Dismiss controls into the shell.
export const CommentAndDismiss: Story = {
	args: {
		rect: new DOMRect(240, 96, 160, 20),
		children: (
			<>
				<Button variant="ghost" size="sm" onClick={fn()}>
					<MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
					Comment
				</Button>
				<Button variant="ghost" size="icon" aria-label="Dismiss selection" onClick={fn()}>
					<X className="h-3.5 w-3.5" />
				</Button>
			</>
		),
	},
}
