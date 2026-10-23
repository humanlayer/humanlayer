import type { Meta, StoryObj } from '@storybook/react'
import type { Editor } from '@tiptap/react'
import { useRef } from 'react'

import { ArtifactSearchBar } from '../../components/artifact-search-bar'
import { Button } from '../../components/button'
import { useArtifactSearch } from '../../markdown-viewer/useArtifactSearch'
import { RawArtifactView, type RawArtifactViewProps } from './RawArtifactView'

interface RawArtifactViewShellDemoProps extends RawArtifactViewProps {
	showSearch?: boolean
}

function RawArtifactViewShellDemo({ showSearch = false, ...props }: RawArtifactViewShellDemoProps) {
	const editorRef = useRef<Editor | null>(null)
	const search = useArtifactSearch({
		editorRef,
		content: props.content,
		activeTab: 'raw',
		rendererKind: 'raw',
	})

	return (
		<div className="relative min-h-96 overflow-auto border border-border bg-background">
			{showSearch ? (
				<div className="sticky top-2 z-10 flex justify-end px-2">
					{search.isOpen ? (
						<ArtifactSearchBar
							query={search.query}
							totalMatches={search.totalMatches}
							currentIndex={search.currentIndex}
							onQueryChange={search.setQuery}
							onNext={search.next}
							onPrev={search.prev}
							onClose={search.closeSearch}
							inputRef={search.inputRef}
						/>
					) : (
						<Button size="sm" onClick={search.openSearch}>
							Search source
						</Button>
					)}
				</div>
			) : null}
			<RawArtifactView
				{...props}
				searchQuery={search.query}
				searchCurrentMatch={search.searchCurrentMatch}
			/>
		</div>
	)
}

const meta = {
	title: 'Shell Demos/RawArtifactView',
	component: RawArtifactViewShellDemo,
	parameters: { layout: 'padded' },
} satisfies Meta<typeof RawArtifactViewShellDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Frontmatter: Story = {
	args: {
		fileName: 'review.md',
		content: '---\ntitle: Raw source\ntags: [review, v2]\n---\n\n# Review\n\nSource stays unchanged.\n',
	},
}

export const Markdown: Story = {
	args: {
		fileName: 'guide.md',
		content: '# Guide\n\n- [x] Keep list markers\n- [ ] Keep links to [Riptide](https://example.com)\n',
	},
}

export const CodeFences: Story = {
	args: {
		fileName: 'commands.md',
		content: '# Commands\n\n```ts\nconst exact = `source`\n```\n\n```mermaid\ngraph TD\n  A --> B\n```\n',
	},
}

export const LongLines: Story = {
	args: {
		fileName: 'long-lines.jsonl',
		content: `${JSON.stringify({ event: 'artifact.updated', payload: 'x'.repeat(240) })}\n`,
	},
}

export const Unicode: Story = {
	args: {
		fileName: 'unicode.md',
		content: '# 日本語と emoji\n\nnaïve café — “quoted” — ✅ 🚀\n',
	},
}

export const EmptyContent: Story = {
	args: { fileName: 'empty.md', content: '' },
}

export const SearchNavigation: Story = {
	args: {
		fileName: 'search.md',
		content: '# Search source\n\nmatch once\nmatch twice on the same line: match\n\nLast match.\n',
		showSearch: true,
	},
}
