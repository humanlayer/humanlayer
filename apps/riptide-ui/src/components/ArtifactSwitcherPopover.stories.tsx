import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import type { SessionArtifact } from '@/utils/sidebar-transforms'
import { ArtifactSwitcherPopover } from './ArtifactSwitcherPopover'

const artifacts: SessionArtifact[] = [
	{
		id: '1',
		path: '.humanlayer/tasks/demo/image.png',
		categories: ['source'],
		storageType: null,
	},
	{
		id: '2',
		path: '.humanlayer/tasks/demo/plan.md',
		categories: ['edited'],
		storageType: null,
	},
	{
		id: '3',
		path: '.humanlayer/tasks/demo/draft.md',
		categories: ['new'],
		storageType: null,
	},
	{
		id: '4',
		path: '.humanlayer/tasks/demo/upload.zip',
		categories: ['unreferenced'],
		storageType: 's3',
	},
	{
		id: '5',
		path: '.humanlayer/tasks/demo/source.md',
		categories: ['source'],
		storageType: null,
	},
]

const meta: Meta<typeof ArtifactSwitcherPopover> = {
	title: 'Components/ArtifactSwitcherPopover',
	component: ArtifactSwitcherPopover,
	parameters: { layout: 'centered' },
	args: {
		artifacts,
		onArtifactSelect: fn(),
		commentCounts: { '2': 3 },
		toggleHotkeyScopes: [HOTKEY_SCOPES.SESSION_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
	},
}
export default meta
type Story = StoryObj<typeof meta>

export const ImageSelected: Story = {
	args: { selectedArtifactId: '1' },
}

export const EditedSelected: Story = {
	args: { selectedArtifactId: '2' },
}

export const NewSelected: Story = {
	args: { selectedArtifactId: '3' },
}

export const UnreferencedS3Selected: Story = {
	args: { selectedArtifactId: '4' },
}

export const SourceSelected: Story = {
	args: { selectedArtifactId: '5' },
}

export const NoSelection: Story = {
	args: { selectedArtifactId: null },
}
