import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useRef, useState } from 'react'
import { MarkdownViewer, type CommentData, type SelectionInfo } from './MarkdownViewer'
import type { BlockClickInfo, CommentClickInfo, ExternalBlockComment } from './CommentGutter'
import type { Editor } from '@tiptap/react'

import '../styles/tiptap.css'

// ─── Shared markdown content ─────────────────────────────────────────────────

const sampleMarkdown = `# Heading 1
This is a paragraph under heading 1.

## Heading 2
This is a paragraph under heading 2.

### Heading 3
This is a paragraph under heading 3.

## Code Examples

Here's some inline code: \`const foo = "bar"\`

### TypeScript Code Block
\`\`\`typescript
interface User {
  id: string;
  name: string;
  email: string;
}

const getUser = async (id: string): Promise<User> => {
  const response = await fetch(\`/api/users/\${id}\`);
  return response.json();
};
\`\`\`

## Lists

### Unordered List
- First item with **bold text**
- Second item with \`inline code\` and *emphasis*
  - Nested item 1 with a [link](https://example.com)
  - Nested item 2 with **mixed _formatting_**
- Third item

### Ordered List
1. First step with **bold text**
2. Second step with \`inline code\` and *emphasis*
   1. Sub-step A with a [link](https://example.com)
   2. Sub-step B with **mixed _formatting_**
3. Third step

## Text Formatting

This is **bold text** and this is *italic text*.

This is a [link to Google](https://google.com).

> This is a blockquote. It should be styled differently from regular text.

---

## Table

| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |
`

const seedComments: CommentData[] = [
	{
		commentId: 'seed-1',
		authorName: 'Kyle S',
		authorAvatarUrl: 'https://github.com/shadcn.png',
		color: '#fbbf24',
		commentedUponBlockText: 'This is a paragraph under heading 2.',
		previousBlockText: 'Heading 2',
		nextBlockText: 'Heading 3',
	},
	{
		commentId: 'seed-2',
		authorName: 'Evil Rabbit',
		authorAvatarUrl: 'https://github.com/evilrabbit.png',
		color: '#fbbf24',
		commentedUponBlockText: 'This is a paragraph under heading 2.',
		previousBlockText: 'Heading 2',
		nextBlockText: 'Heading 3',
	},
]

const multiParticipantComments: CommentData[] = [
	{
		commentId: 'mp-1',
		authorName: 'Kyle S',
		authorAvatarUrl: 'https://github.com/shadcn.png',
		color: '#fbbf24',
		commentedUponBlockText: 'This is a paragraph under heading 2.',
		previousBlockText: 'Heading 2',
		nextBlockText: 'Heading 3',
		participants: [
			{ name: 'Kyle S', avatarUrl: 'https://github.com/shadcn.png' },
			{ name: 'Evil Rabbit', avatarUrl: 'https://github.com/evilrabbit.png' },
			{ name: 'Anna Chen', avatarUrl: 'https://github.com/humanlayer.png' },
		],
	},
	{
		commentId: 'mp-2',
		authorName: 'Bob Park',
		authorAvatarUrl: 'https://github.com/leerob.png',
		color: '#38bdf8',
		commentedUponBlockText: 'This is bold text and this is italic text.',
		previousBlockText: 'Text Formatting',
		nextBlockText: 'This is a link to Google.',
		participants: [
			{ name: 'Bob Park', avatarUrl: 'https://github.com/leerob.png' },
			{ name: 'Kyle S', avatarUrl: 'https://github.com/shadcn.png' },
			{ name: 'Evil Rabbit', avatarUrl: 'https://github.com/evilrabbit.png' },
			{ name: 'Anna Chen', avatarUrl: 'https://github.com/humanlayer.png' },
			{ name: 'Dana Lee', avatarUrl: 'https://github.com/maxleiter.png' },
		],
	},
]

// ─── Demo authors for the "add comment" flow ────────────────────────────────

const AUTHORS = [
	{ name: 'Alice Chen', avatar: 'https://github.com/shadcn.png', color: '#f472b6' },
	{ name: 'Bob Park', avatar: 'https://github.com/leerob.png', color: '#38bdf8' },
	{ name: 'Charlie Kim', avatar: 'https://github.com/evilrabbit.png', color: '#a78bfa' },
	{ name: 'Dana Lee', avatar: 'https://github.com/maxleiter.png', color: '#34d399' },
]

// ─── Pending comment target (either a text selection or a block click) ───────

type PendingTarget =
	| { type: 'selection'; info: SelectionInfo }
	| { type: 'block'; info: BlockClickInfo }

// ─── Interactive wrapper ─────────────────────────────────────────────────────

function InteractiveCommentViewer() {
	const editorRef = useRef<Editor | null>(null)
	const [comments, setComments] = useState<CommentData[]>(seedComments)
	const [blockComments, setBlockComments] = useState<ExternalBlockComment[]>([])
	const [pending, setPending] = useState<PendingTarget | null>(null)
	const [clicked, setClicked] = useState<CommentClickInfo | null>(null)
	const [authorIdx, setAuthorIdx] = useState(0)
	const nextId = useRef(1)

	const handleSelectionChange = useCallback((info: SelectionInfo | null) => {
		if (info) {
			setPending({ type: 'selection', info })
		} else {
			setPending((prev) => (prev?.type === 'selection' ? null : prev))
		}
	}, [])

	const handleBlockClick = useCallback((info: BlockClickInfo) => {
		setPending((prev) => {
			// Toggle off if clicking the same block
			if (prev?.type === 'block' && prev.info.blockPos === info.blockPos) {
				return null
			}
			return { type: 'block', info }
		})
	}, [])

	const handleAddComment = useCallback(() => {
		const editor = editorRef.current
		if (!editor || !pending) return

		const author = AUTHORS[authorIdx % AUTHORS.length]
		const commentId = `user-${nextId.current++}`

		if (pending.type === 'selection') {
			// Inline mark comment on the selected text span
			const markType = editor.schema.marks.comment
			const mark = markType.create({
				commentId,
				authorName: author.name,
				authorAvatarUrl: author.avatar,
				color: author.color,
				lineNumber: 0,
			})

			const { tr } = editor.state
			tr.addMark(pending.info.from, pending.info.to, mark)
			editor.view.dispatch(tr)

			setComments((prev) => [
				...prev,
				{
					commentId,
					authorName: author.name,
					authorAvatarUrl: author.avatar,
					color: author.color,
					commentedUponBlockText: pending.info.text,
					previousBlockText: null,
					nextBlockText: null,
				},
			])
		} else {
			// Block-level comment (code block, blockquote, etc.)
			setBlockComments((prev) => [
				...prev,
				{
					commentId,
					authorName: author.name,
					authorAvatarUrl: author.avatar,
					color: author.color,
					blockPos: pending.info.blockPos,
				},
			])

			setComments((prev) => [
				...prev,
				{
					commentId,
					authorName: author.name,
					authorAvatarUrl: author.avatar,
					color: author.color,
					commentedUponBlockText: pending.info.textContent,
					previousBlockText: null,
					nextBlockText: null,
				},
			])
		}

		setAuthorIdx((i) => i + 1)
		setPending(null)
	}, [pending, authorIdx])

	const handleCommentClick = useCallback((info: CommentClickInfo) => {
		setClicked((prev) => (prev?.lineNumber === info.lineNumber ? null : info))
	}, [])

	const pendingLabel = pending
		? pending.type === 'selection'
			? `"${pending.info.text.slice(0, 40)}${pending.info.text.length > 40 ? '...' : ''}"`
			: `[${pending.info.nodeType}]`
		: null

	return (
		<div className="interactive-comment-demo">
			<div className="interactive-comment-toolbar">
				<span className="interactive-comment-hint">
					{pending
						? pending.type === 'selection'
							? 'Text selected — add a span comment'
							: 'Block selected — add a block comment'
						: 'Select text or click a block to comment'}
				</span>
				{pending && (
					<button
						type="button"
						className="interactive-comment-add-btn"
						onClick={handleAddComment}
					>
						+ Comment {pendingLabel} as{' '}
						{AUTHORS[authorIdx % AUTHORS.length].name}
					</button>
				)}
				<span className="interactive-comment-count">
					{comments.length} comment{comments.length !== 1 ? 's' : ''}
				</span>
			</div>

			<MarkdownViewer
				content={sampleMarkdown}
				comments={comments}
				blockComments={blockComments}
				onSelectionChange={handleSelectionChange}
				onBlockClick={handleBlockClick}
				onCommentClick={handleCommentClick}
				editorRef={editorRef}
			/>

			{clicked && (
				<div className="comment-click-info">
					<div className="comment-click-info-header">
						<span className="comment-click-info-line">
							Line {clicked.lineNumber}
						</span>
						<button
							type="button"
							className="comment-click-info-close"
							onClick={() => setClicked(null)}
						>
							&times;
						</button>
					</div>
					<pre className="comment-click-info-source">
						<code>{clicked.markdown}</code>
					</pre>
					<div className="comment-click-info-meta">
						{clicked.comments.map((c) => (
							<span key={c.commentId} className="comment-click-info-author">
								{c.authorName}
							</span>
						))}
					</div>
				</div>
			)}

			{comments.length > 0 && (
				<div className="interactive-comment-sidebar">
					<h4>Comments</h4>
					{comments.map((c) => (
						<div
							key={c.commentId}
							className="interactive-comment-sidebar-item"
							style={{ borderLeftColor: c.color || '#fbbf24' }}
						>
							<strong>{c.authorName}</strong>
							<span className="interactive-comment-sidebar-text">
								&ldquo;{c.commentedUponBlockText}&rdquo;
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

// ─── Read-only wrapper (original Default story behavior) ─────────────────────

function MarkdownViewerWithClickInfo(props: React.ComponentProps<typeof MarkdownViewer>) {
	const [clicked, setClicked] = useState<CommentClickInfo | null>(null)

	return (
		<div>
			<MarkdownViewer
				{...props}
				onCommentClick={(info) => {
					setClicked((prev) =>
						prev?.lineNumber === info.lineNumber ? null : info,
					)
				}}
			/>
			{clicked && (
				<div className="comment-click-info">
					<div className="comment-click-info-header">
						<span className="comment-click-info-line">
							Line {clicked.lineNumber}
						</span>
						<button
							type="button"
							className="comment-click-info-close"
							onClick={() => setClicked(null)}
						>
							&times;
						</button>
					</div>
					<pre className="comment-click-info-source">
						<code>{clicked.markdown}</code>
					</pre>
					<div className="comment-click-info-meta">
						{clicked.comments.map((c) => (
							<span key={c.commentId} className="comment-click-info-author">
								{c.authorName}
							</span>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

// ─── Storybook config ────────────────────────────────────────────────────────

const meta = {
	title: 'Shell Demos/MarkdownViewer',
	component: MarkdownViewer,
	parameters: {
		layout: 'padded',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof MarkdownViewer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	args: {
		content: sampleMarkdown,
		comments: seedComments,
	},
	render: (args) => <MarkdownViewerWithClickInfo {...args} />,
}

export const InteractiveComments: Story = {
	args: {
		content: sampleMarkdown,
	},
	render: () => <InteractiveCommentViewer />,
}

export const SimpleText: Story = {
	args: {
		content: 'This is a simple paragraph with **bold** and *italic* text.',
	},
}

export const CodeOnly: Story = {
	args: {
		content: `\`\`\`typescript
const config = {
  theme: 'dark',
  language: 'en',
  features: {
    markdown: true,
    syntax: true,
  }
};
\`\`\``,
	},
}

export const ConsecutiveCodeBlocks: Story = {
	args: {
        content: "```js\nconst a = 1\n```\n\n```python\nx = 2\n```\n\n```sh\necho hello\n```",
        className: ""
    },
}

export const EmptyContent: Story = {
	args: {
		content: '',
	},
}

const taskListMarkdown = `## Task List

- [ ] Unchecked item
- [x] Checked item
- [ ] Another unchecked item

## Mixed List (bullets and checkboxes)

- Regular bullet item
- [ ] Task item in a bullet list
- [x] Completed task in a bullet list
- Another regular bullet

## Nested Task List

- [ ] Parent task
  - [ ] Child task one
  - [x] Child task two (done)
- [x] Completed parent task
  - [x] All children done
`

export const TaskList: Story = {
	args: {
		content: taskListMarkdown,
	},
}

export const MultiParticipantGutter: Story = {
	args: {
		content: sampleMarkdown,
		comments: multiParticipantComments,
	},
	render: (args) => <MarkdownViewerWithClickInfo {...args} />,
}
