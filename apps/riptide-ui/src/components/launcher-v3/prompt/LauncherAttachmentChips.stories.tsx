import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { LauncherAttachmentChips } from './LauncherAttachmentChips'

const textAttachment = {
	fileName: 'repro-notes.md',
	contentType: 'text/markdown',
	fileSizeBytes: 412,
	contentHash: 'a'.repeat(64),
}

const imageAttachment = {
	fileName: 'screenshot.png',
	contentType: 'image/png',
	fileSizeBytes: 24_120,
	contentHash: 'b'.repeat(64),
}

const meta = {
	title: 'Components/LauncherV3/AttachmentChips',
	component: LauncherAttachmentChips,
	parameters: { layout: 'centered' },
	decorators: [
		(Story) => (
			<div className="flex w-[680px] max-w-full flex-wrap items-center gap-1 bg-foreground/5 p-2">
				<Story />
			</div>
		),
	],
	args: {
		ticket: null,
		attachments: [],
		uploadingFileNames: [],
		onRemoveTicket: fn(),
		onRemoveFile: fn(),
	},
} satisfies Meta<typeof LauncherAttachmentChips>

export default meta
type Story = StoryObj<typeof meta>

export const UploadingOnly: Story = {
	args: { uploadingFileNames: ['hashing.txt', 'screenshot.png'] },
}

export const UploadingAndSuccessful: Story = {
	args: { attachments: [textAttachment], uploadingFileNames: ['screenshot.png'] },
}

export const TicketOnly: Story = {
	args: { ticket: { provider: 'jira', ticketId: 'OPS-7', name: '' } },
}

export const FilesOnly: Story = {
	args: { attachments: [textAttachment, imageAttachment] },
}

export const TicketAndFiles: Story = {
	args: {
		ticket: { provider: 'linear', ticketId: 'ENG-1234', name: '[ENG-1234] Fix session launch stalls' },
		attachments: [textAttachment, imageAttachment],
	},
}

export const LongName: Story = {
	args: {
		attachments: [
			{
				...textAttachment,
				fileName: 'a-very-long-file-name-that-truncates-in-the-completed-attachment-chip.md',
			},
		],
	},
}

export const Disabled: Story = {
	args: { attachments: [textAttachment], disabled: true },
}
