import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { ArtifactsListPure } from './ArtifactsListPure'
import {
	FIXTURE_EMPTY_ARTIFACTS,
	FIXTURE_IMAGE_ARTIFACTS,
	FIXTURE_LONG_NAME_ARTIFACTS,
	FIXTURE_MIXED_ARTIFACTS,
	FIXTURE_SINGLE_CATEGORY_ARTIFACTS,
} from './storybook/artifact-list-fixtures'

const meta: Meta<typeof ArtifactsListPure> = {
	title: 'Components/ArtifactsListPure',
	component: ArtifactsListPure,
	args: {
		commentCounts: {},
	},
	parameters: {
		layout: 'centered',
	},
	decorators: [
		(Story) => (
			<div className="w-72 h-96 border rounded p-2 bg-background font-mono">
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
	args: {
		artifacts: FIXTURE_EMPTY_ARTIFACTS,
		onArtifactClick: fn(),
	},
}

export const MixedCategories: Story = {
	args: {
		artifacts: FIXTURE_MIXED_ARTIFACTS,
		onArtifactClick: fn(),
	},
}

export const GroupedByFrontmatterType: Story = {
	args: {
		artifacts: FIXTURE_MIXED_ARTIFACTS,
		onArtifactClick: fn(),
		groupByFrontmatterType: true,
		onGroupByFrontmatterTypeChange: fn(),
	},
}

export const LongNames: Story = {
	args: {
		artifacts: FIXTURE_LONG_NAME_ARTIFACTS,
		onArtifactClick: fn(),
	},
}

export const SingleCategory: Story = {
	args: {
		artifacts: FIXTURE_SINGLE_CATEGORY_ARTIFACTS,
		onArtifactClick: fn(),
	},
}

export const WithImages: Story = {
	args: {
		artifacts: FIXTURE_IMAGE_ARTIFACTS,
		onArtifactClick: fn(),
	},
}
