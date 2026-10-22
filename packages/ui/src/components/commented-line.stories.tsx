import type { Meta, StoryObj } from '@storybook/react'
import { fn } from 'storybook/test'
import { mockUsers } from './__stories__/comment-fixtures'
import { CommentedLine } from './commented-line'

const meta = {
	title: 'Comments/CommentedLine',
	component: CommentedLine,
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
	args: {
		onClick: fn(),
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-2xl font-mono text-sm">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof CommentedLine>

export default meta
type Story = StoryObj<typeof meta>

export const SingleAuthor: Story = {
	args: {
		children: <span className="px-4 block">const result = await fetchData()</span>,
		commentAuthors: [mockUsers.user1],
	},
}

export const MultipleAuthors: Story = {
	args: {
		children: <span className="px-4 block">export function processItems(items: Item[]) {'{'}</span>,
		commentAuthors: [mockUsers.user1, mockUsers.user2, mockUsers.user3],
	},
}

export const Overflow: Story = {
	args: {
		children: <span className="px-4 block">{'// TODO: handle edge cases here'}</span>,
		commentAuthors: [
			mockUsers.user1,
			mockUsers.user2,
			mockUsers.user3,
			mockUsers.user4,
			mockUsers.user5,
		],
	},
}

export const ClickInteraction: Story = {
	args: {
		children: <span className="px-4 block">return response.data.items.map(transform)</span>,
		commentAuthors: [mockUsers.user1],
	},
}

export const BlockVariant: Story = {
	args: {
		children: (
			<p className="px-4">
				This is a longer paragraph of text that might wrap across multiple visual lines.
				In the rendered markdown view, we use a subtle left-border indicator instead of
				a full background highlight to avoid making it look like the entire paragraph is selected.
			</p>
		),
		commentAuthors: [mockUsers.user1, mockUsers.user2],
		variant: 'block',
	},
}

export const BlockVariantSingleAuthor: Story = {
	args: {
		children: (
			<p className="px-4">
				A short paragraph with a block-level comment indicator.
			</p>
		),
		commentAuthors: [mockUsers.user1],
		variant: 'block',
	},
}
