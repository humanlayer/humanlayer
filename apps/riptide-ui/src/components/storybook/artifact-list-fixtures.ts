import type { SessionArtifact } from '@/utils/sidebar-transforms'

export const FIXTURE_MIXED_ARTIFACTS: SessionArtifact[] = [
	{
		id: 'a1',
		path: '.humanlayer/tasks/eng-1234/research-questions.md',
		categories: ['source'],
		frontmatterType: 'research-questions',
	},
	{
		id: 'a2',
		path: '.humanlayer/tasks/eng-1234/design-discussion.md',
		categories: ['source', 'edited'],
		frontmatterType: 'design-discussion',
	},
	{ id: 'a3', path: '.humanlayer/tasks/eng-1234/plan.md', categories: ['edited'], frontmatterType: 'plan' },
	{
		id: 'a4',
		path: '.humanlayer/tasks/eng-1234/structure-outline.md',
		categories: ['new'],
		frontmatterType: 'structure-outline',
	},
	{ id: 'a5', path: 'src/components/ArtifactsListPure.tsx', categories: ['new'] },
	{
		id: 'a6',
		path: 'uploads/screenshot.png',
		categories: ['unreferenced'],
		storageType: 's3',
	},
	{ id: 'a7', path: 'docs/README.md', categories: ['unreferenced'] },
]

export const FIXTURE_LONG_NAME_ARTIFACTS: SessionArtifact[] = [
	{
		id: 'l1',
		path: '.humanlayer/tasks/eng-12345-very-long-task-description/2026-01-10-research-questions.md',
		categories: ['source'],
	},
	{
		id: 'l2',
		path: '.humanlayer/tasks/core-180-extremely-long-task-name/2026-01-10-implementation-plan.md',
		categories: ['edited'],
	},
	{
		id: 'l3',
		path: 'packages/some-deeply-nested-package/src/components/very-specific-component-name.tsx',
		categories: ['new'],
	},
]

export const FIXTURE_EMPTY_ARTIFACTS: SessionArtifact[] = []

export const FIXTURE_SINGLE_CATEGORY_ARTIFACTS: SessionArtifact[] = [
	{ id: 's1', path: 'src/index.ts', categories: ['edited'] },
	{ id: 's2', path: 'src/app.ts', categories: ['edited'] },
	{ id: 's3', path: 'src/config.ts', categories: ['edited'] },
]

export const FIXTURE_IMAGE_ARTIFACTS: SessionArtifact[] = [
	{ id: 'i1', path: 'assets/logo.png', categories: ['new'] },
	{ id: 'i2', path: 'assets/banner.jpg', categories: ['unreferenced'], storageType: 's3' },
	{ id: 'i3', path: 'src/styles.css', categories: ['edited'] },
]
