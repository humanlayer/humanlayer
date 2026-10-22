import { CommandToken } from '@humanlayer/ui/components/command-token'
import { CodeCopyButton, getMarkdownNodeText } from '@humanlayer/ui/components/markdown-renderer'
import { math } from '@streamdown/math'

import 'katex/dist/katex.min.css'
import 'streamdown/styles.css'

import { cloneElement, isValidElement, lazy, memo, Suspense } from 'react'
import remarkBreaks from 'remark-breaks'
import {
	type Components,
	type CustomRendererProps,
	defaultRehypePlugins,
	defaultRemarkPlugins,
	type PluginConfig,
	Streamdown,
	type StreamdownProps,
} from 'streamdown'

import { PierreCodeFence } from '@/components/PierreCodeFence'
import { TaskArtifactMarkdownElement } from '@/components/TaskArtifactInline'
import { TaskArtifactViewer } from '@/components/TaskArtifactViewer'
import { openExternalUrl } from '@/integrations/desktop/external-url'
import {
	remarkTaskArtifactImages,
	remarkTaskArtifactMentions,
	TASK_ARTIFACT_IMAGE_TAG,
	TASK_ARTIFACT_MENTION_TAG,
} from '@/lib/task-artifact-remark'
import { isDesktop } from '@/lib/utils'

const LazyMermaidDiagram = lazy(() =>
	import('@humanlayer/ui/components/mermaid-diagram').then((m) => ({ default: m.MermaidDiagram })),
)

export interface MarkdownRendererFullProps {
	content: string
	preserveSingleLineBreaks?: boolean
	preserveXmlTags?: boolean
	streaming?: boolean
	/** Render `@.humanlayer/tasks/<slug>/<file>` mentions as artifact previews and chips. */
	artifactMentions?: boolean
}

/** Mermaid fences render through our diagram viewer (expand-to-lightbox, foreignObject
 * fixes) instead of Streamdown's built-in mermaid plugin. */
const MermaidBlock = ({ code }: CustomRendererProps) => (
	<Suspense fallback={<div className="animate-pulse bg-muted rounded h-24" />}>
		<LazyMermaidDiagram code={code} />
	</Suspense>
)

/** Render task-artifact files (HTML, images, etc.) from the task directory. */
const TaskArtifactBlock = ({ code }: CustomRendererProps) => <TaskArtifactViewer filePath={code.trim()} />

// Module scope: Streamdown memoizes completed blocks with a comparator that includes
// components/plugins identity, so none of these may be recreated per render.
const renderers = [
	{ language: 'mermaid', component: MermaidBlock },
	{ language: 'task-artifact', component: TaskArtifactBlock },
]

// No streamdown code plugin: fences render through Pierre's `File` (PierreCodeFence),
// which tokenizes in the shared diff worker pool instead of on the main thread. Without a
// code plugin streamdown emits plain <pre><code>, which the `pre` component replaces.
const plugins: PluginConfig = { math, renderers }

// Tables render as plain elements styled by prose-terminal, matching the previous
// react-markdown renderer; no controls header bar.
const controls = { table: false, code: false } as const
type MarkdownNode = {
	type: string
	value?: string
	children?: MarkdownNode[]
}

const preserveRawNodeLineBreaks = () => (tree: MarkdownNode) => {
	const visit = (node: MarkdownNode) => {
		if (!node.children) return

		for (let index = 0; index < node.children.length; index += 1) {
			const child = node.children[index]
			if (!child) continue
			if (child.type !== 'html' || !child.value?.includes('\n')) {
				visit(child)
				continue
			}

			const lines = child.value.split('\n')
			const replacement: MarkdownNode[] = []
			for (const [lineIndex, line] of lines.entries()) {
				if (lineIndex > 0) replacement.push({ type: 'break' })
				if (line) replacement.push({ type: 'text', value: line })
			}
			node.children.splice(index, 1, ...replacement)
			index += replacement.length - 1
		}
	}

	visit(tree)
}

type PluggableList = NonNullable<StreamdownProps['remarkPlugins']>
type Pluggable = PluggableList[number]

interface RemarkPluginOptions {
	preserveSingleLineBreaks: boolean
	preserveXmlTags: boolean
	artifactMentions: boolean
}

function buildRemarkPlugins({
	preserveSingleLineBreaks,
	preserveXmlTags,
	artifactMentions,
}: RemarkPluginOptions): PluggableList {
	const plugins: PluggableList = Object.values(defaultRemarkPlugins)
	if (preserveSingleLineBreaks) plugins.push(remarkBreaks)
	if (preserveXmlTags) plugins.push(preserveRawNodeLineBreaks)
	plugins.push(remarkTaskArtifactImages)
	if (artifactMentions) plugins.push(remarkTaskArtifactMentions)
	return plugins
}

const remarkPluginLists = new Map<string, PluggableList>()

function getRemarkPlugins(options: RemarkPluginOptions): PluggableList {
	const key = `${options.preserveSingleLineBreaks}:${options.preserveXmlTags}:${options.artifactMentions}`
	let plugins = remarkPluginLists.get(key)
	if (!plugins) {
		plugins = buildRemarkPlugins(options)
		remarkPluginLists.set(key, plugins)
	}
	return plugins
}

function allowTaskArtifactTags(sanitize: Pluggable | undefined): Pluggable | undefined {
	if (!Array.isArray(sanitize)) return sanitize
	const [plugin, schema] = sanitize
	if (typeof schema !== 'object' || schema === null) return sanitize
	const tagNames = 'tagNames' in schema && Array.isArray(schema.tagNames) ? schema.tagNames : []
	const attributes = 'attributes' in schema && typeof schema.attributes === 'object' ? schema.attributes : {}
	return [
		plugin,
		{
			...schema,
			tagNames: [...tagNames, TASK_ARTIFACT_IMAGE_TAG, TASK_ARTIFACT_MENTION_TAG],
			attributes: {
				...attributes,
				[TASK_ARTIFACT_IMAGE_TAG]: ['path', 'alt'],
				[TASK_ARTIFACT_MENTION_TAG]: ['path'],
			},
		},
	]
}

const rehypePlugins: PluggableList = [
	defaultRehypePlugins.raw,
	allowTaskArtifactTags(defaultRehypePlugins.sanitize),
	defaultRehypePlugins.harden,
].filter((plugin): plugin is Pluggable => plugin !== undefined)
const xmlPreservingRehypePlugins = rehypePlugins.filter((plugin) => plugin !== defaultRehypePlugins.raw)

const components: Components = {
	h1({ children }) {
		return <h1># {children}</h1>
	},
	h2({ children }) {
		return <h2>## {children}</h2>
	},
	h3({ children }) {
		return <h3>### {children}</h3>
	},
	h4({ children }) {
		return <h4>#### {children}</h4>
	},
	h5({ children }) {
		return <h5>##### {children}</h5>
	},
	h6({ children }) {
		return <h6>###### {children}</h6>
	},
	li({ children }) {
		// Strip leading whitespace text nodes so numbered lists don't render a newline
		// between the marker and the text.
		if (Array.isArray(children)) {
			const filteredChildren = children.filter((child, index) => {
				if (index === 0 && typeof child === 'string' && child.trim() === '') {
					return false
				}
				return true
			})
			return <li>{filteredChildren}</li>
		}
		return <li>{children}</li>
	},
	inlineCode({ children }) {
		return <CommandToken>{children}</CommandToken>
	},
	// Plain img: streamdown's default wraps images with an always-on download control.
	img({ node: _node, ...props }) {
		return <img {...props} />
	},
	[TASK_ARTIFACT_IMAGE_TAG]: TaskArtifactMarkdownElement,
	[TASK_ARTIFACT_MENTION_TAG]: TaskArtifactMarkdownElement,
	// Routes mermaid/task-artifact fences to their custom renderers (the data-block clone
	// drives streamdown's block/inline code routing) and renders every other fence through
	// Pierre's worker-pool highlighter with our own hover copy button — streamdown's
	// built-in controls are disabled (controls.code false): its copy relies on
	// navigator.clipboard alone, which WKWebView rejects silently.
	pre({ children }) {
		const child = isValidElement(children) ? children : null
		const blockChildren = child ? cloneElement(child, { 'data-block': 'true' } as never) : children
		const className = String((child?.props as { className?: string } | undefined)?.className ?? '')
		const language = /language-([\w-]+)/.exec(className)?.[1]
		if (language === 'mermaid' || language === 'task-artifact') {
			return <>{blockChildren}</>
		}
		const code = getMarkdownNodeText(
			(child?.props as { children?: unknown } | undefined)?.children ?? children,
		).replace(/\n$/, '')
		return (
			<div className="group relative sd-code-wrap">
				<CodeCopyButton code={code} />
				<PierreCodeFence code={code} language={language} />
			</div>
		)
	},
	table({ children }) {
		return <table>{children}</table>
	},
	thead({ children }) {
		return <thead>{children}</thead>
	},
	tbody({ children }) {
		return <tbody>{children}</tbody>
	},
	tr({ children }) {
		return <tr>{children}</tr>
	},
	th({ children }) {
		return <th>{children}</th>
	},
	td({ children }) {
		return <td>{children}</td>
	},
	a({ href, children }) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="text-accent underline hover:text-accent/80 transition-colors"
				onClick={(e) => {
					if ((e.metaKey || e.ctrlKey) && href && isDesktop()) {
						e.preventDefault()
						e.stopPropagation()
						void openExternalUrl(href)
					}
					// Non-Tauri: let browser default (target="_blank") handle it
				}}
			>
				{children}
			</a>
		)
	},
}

const MarkdownRendererInner = memo(
	({
		content,
		preserveSingleLineBreaks = false,
		preserveXmlTags = false,
		streaming = false,
		artifactMentions = false,
	}: MarkdownRendererFullProps) => {
		return (
			<div className="prose-terminal">
				<Streamdown
					components={components}
					controls={controls}
					lineNumbers={false}
					parseIncompleteMarkdown={streaming}
					plugins={plugins}
					rehypePlugins={preserveXmlTags ? xmlPreservingRehypePlugins : rehypePlugins}
					remarkPlugins={getRemarkPlugins({ preserveSingleLineBreaks, preserveXmlTags, artifactMentions })}
				>
					{content}
				</Streamdown>
			</div>
		)
	},
	(prevProps, nextProps) =>
		prevProps.content === nextProps.content &&
		prevProps.preserveSingleLineBreaks === nextProps.preserveSingleLineBreaks &&
		prevProps.preserveXmlTags === nextProps.preserveXmlTags &&
		prevProps.streaming === nextProps.streaming &&
		prevProps.artifactMentions === nextProps.artifactMentions,
)

MarkdownRendererInner.displayName = 'MarkdownRendererInner'

const MarkdownRendererFull = MarkdownRendererInner

export default MarkdownRendererFull
