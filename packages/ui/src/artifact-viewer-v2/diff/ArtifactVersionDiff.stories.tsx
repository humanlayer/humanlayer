import type { Meta, StoryObj } from '@storybook/react'

import { ArtifactVersionDiff, type ArtifactVersionDiffProps } from './ArtifactVersionDiff'

function ArtifactVersionDiffShellDemo(props: ArtifactVersionDiffProps) {
	return (
		<div className="h-[42rem] min-h-0 overflow-hidden border border-border bg-background">
			<ArtifactVersionDiff {...props} />
		</div>
	)
}

const meta = {
	title: 'Shell Demos/Artifact Viewer V2/Artifact Version Diff',
	component: ArtifactVersionDiffShellDemo,
} satisfies Meta<typeof ArtifactVersionDiffShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Prose: Story = {
	args: {
		sourceLabel: 'Version 1',
		destinationLabel: 'Latest',
		sourceText: 'The first paragraph stays.\n\nThe second paragraph needs review.\n',
		destinationText: 'The first paragraph stays.\n\nThe second paragraph is ready.\n',
	},
}

export const Markdown: Story = {
	args: {
		sourceLabel: 'Version 2',
		destinationLabel: 'Latest',
		sourceText: '# Release\n\n- Draft API\n- Add tests\n',
		destinationText: '# Release\n\n- Publish API\n- Add tests\n- Update docs\n',
	},
}

export const CodeFences: Story = {
	args: {
		sourceLabel: 'Version 3',
		destinationLabel: 'Latest',
		sourceText: '```ts\nexport const answer = 41\n```\n',
		destinationText: '```ts\nexport const answer = 42\n```\n',
	},
}

export const BlankLines: Story = {
	args: {
		sourceLabel: 'Version 4',
		destinationLabel: 'Latest',
		sourceText: 'One\n\n\nThree\n',
		destinationText: 'One\n\nTwo\n\nThree\n',
	},
}

export const LongUnchangedSection: Story = {
	args: {
		sourceLabel: 'Version 5',
		destinationLabel: 'Latest',
		sourceText: Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n'),
		destinationText: Array.from({ length: 80 }, (_, index) =>
			index === 39 ? 'Line 40 changed' : `Line ${index + 1}`,
		).join('\n'),
	},
}

export const Identical: Story = {
	args: {
		sourceLabel: 'Version 6',
		destinationLabel: 'Latest',
		sourceText: 'No changes in this comparison.\n',
		destinationText: 'No changes in this comparison.\n',
	},
}

export const EmptyInputs: Story = {
	args: {
		sourceLabel: 'Version 0',
		destinationLabel: 'Latest',
		sourceText: '',
		destinationText: '',
	},
}
