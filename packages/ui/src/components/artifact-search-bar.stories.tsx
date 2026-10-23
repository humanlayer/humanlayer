import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { ArtifactSearchBar } from './artifact-search-bar'

function Demo(props: { initialQuery?: string; totalMatches: number }) {
	const [query, setQuery] = useState(props.initialQuery ?? '')
	const [currentIndex, setCurrentIndex] = useState(0)
	return (
		<div className="p-8 bg-background">
			<ArtifactSearchBar
				query={query}
				totalMatches={props.totalMatches}
				currentIndex={currentIndex}
				onQueryChange={setQuery}
				onNext={() => setCurrentIndex((i) => (i + 1) % Math.max(1, props.totalMatches))}
				onPrev={() =>
					setCurrentIndex((i) => (i - 1 + props.totalMatches) % Math.max(1, props.totalMatches))
				}
				onClose={() => setQuery('')}
			/>
		</div>
	)
}

const meta = {
	title: 'Shell Demos/ArtifactSearchBar',
	component: Demo,
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { args: { totalMatches: 0 } }
export const WithMatches: Story = { args: { initialQuery: 'function', totalMatches: 7 } }
export const NoMatches: Story = { args: { initialQuery: 'zzzzzzz', totalMatches: 0 } }
export const LongQuery: Story = {
	args: {
		initialQuery: 'a-really-long-search-query-that-might-otherwise-push-the-x-out',
		totalMatches: 3,
	},
}
