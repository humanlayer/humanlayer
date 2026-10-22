import type { Meta, StoryObj } from '@storybook/react'
import { useRef, useState } from 'react'

import { Button } from '../../components/button'
import { ArtifactCommentDeleteDialog } from './ArtifactCommentDeleteDialog'

interface ArtifactCommentDeleteDialogShellDemoProps {
	state?: 'ready' | 'pending' | 'error'
	startOpen?: boolean
	target?: 'reply' | 'root'
	replyCount?: number
}

function ArtifactCommentDeleteDialogShellDemo({
	state = 'ready',
	startOpen = false,
	target = 'reply',
	replyCount = 0,
}: ArtifactCommentDeleteDialogShellDemoProps) {
	const [open, setOpen] = useState(startOpen)
	const returnFocusRef = useRef<HTMLButtonElement>(null)
	return (
		<div className="artifact-viewer-v2 min-h-80 items-center justify-center p-4">
			<Button ref={returnFocusRef} variant="outline" onClick={() => setOpen(true)}>
				Delete owned {target === 'root' ? 'thread' : 'reply'}
			</Button>
			<ArtifactCommentDeleteDialog
				open={open}
				onOpenChange={setOpen}
				onConfirm={() => {
					if (state === 'ready') setOpen(false)
				}}
				target={target}
				replyCount={replyCount}
				pending={state === 'pending'}
				error={state === 'error' ? `Failed to delete ${target === 'root' ? 'thread' : 'reply'}. Try again.` : null}
				returnFocusRef={returnFocusRef}
			/>
		</div>
	)
}

const meta = {
	title: 'Shell Demos/Artifact Viewer V2/Comment Delete Dialog',
	component: ArtifactCommentDeleteDialogShellDemo,
	parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ArtifactCommentDeleteDialogShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
	args: {},
}

export const Pending: Story = {
	args: { state: 'pending', startOpen: true },
}

export const ErrorWithRetry: Story = {
	args: { state: 'error', startOpen: true },
}

export const RootWithoutReplies: Story = {
	args: { target: 'root', replyCount: 0, startOpen: true },
}

export const RootWithOneReply: Story = {
	args: { target: 'root', replyCount: 1, startOpen: true },
}

export const RootWithManyReplies: Story = {
	args: { target: 'root', replyCount: 4, startOpen: true },
}

export const RootPending: Story = {
	args: { target: 'root', replyCount: 2, state: 'pending', startOpen: true },
}

export const RootErrorWithRetry: Story = {
	args: { target: 'root', replyCount: 2, state: 'error', startOpen: true },
}

export const Narrow: Story = {
	args: { target: 'root', replyCount: 3, startOpen: true },
	parameters: { viewport: { defaultViewport: 'mobile1' } },
}
