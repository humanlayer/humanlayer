import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'

import { MobileCommentComposer } from './MobileCommentComposer'

const meta: Meta<typeof MobileCommentComposer> = {
	title: 'Mobile/MobileCommentComposer',
	component: MobileCommentComposer,
	parameters: {
		layout: 'centered',
		viewport: { defaultViewport: 'mobile1' },
	},
}

export default meta

type Story = StoryObj<typeof MobileCommentComposer>

/** Minimal stateful wrapper — the composer is controlled (value/onChange). */
const ComposerWrapper = ({
	placeholder,
	authorDisplayName,
	authorAvatarUrl,
}: {
	placeholder?: string
	authorDisplayName?: string
	authorAvatarUrl?: string
}) => {
	const [value, setValue] = useState('')
	return (
		<div className="w-80">
			<MobileCommentComposer
				value={value}
				onChange={setValue}
				onSubmit={(text, json) => {
					console.log('submit', text, json)
					setValue('')
				}}
				placeholder={placeholder}
				authorDisplayName={authorDisplayName}
				authorAvatarUrl={authorAvatarUrl}
			/>
		</div>
	)
}

export const Reply: Story = {
	render: () => (
		<ComposerWrapper
			placeholder="Reply..."
			authorDisplayName="Anna Chen"
			authorAvatarUrl="https://github.com/evilrabbit.png"
		/>
	),
}

export const NewComment: Story = {
	render: () => <ComposerWrapper placeholder="Add a comment..." authorDisplayName="Anna Chen" />,
}
