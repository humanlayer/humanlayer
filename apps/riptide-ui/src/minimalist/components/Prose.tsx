import { eq, queryOnce } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { isValidElement, type MouseEvent, memo, type ReactNode, useRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { useSync } from '@/components/providers/SyncProvider'
import { openExternalUrl } from '@/integrations/desktop/external-url'
import { isDesktop } from '@/lib/utils'
import { CopyButton } from '@/minimalist/components/CopyButton'
import { TaskArtifactEmbed } from '@/minimalist/components/TaskArtifactEmbed'
import { taskArtifactPaths } from '@/minimalist/lib/artifacts'
import { useMinimalistDark } from '@/minimalist/lib/color-scheme'
import { renderDiagram } from '@/minimalist/lib/diagrams'
import { highlightCode } from '@/minimalist/lib/highlight'
import { linkTarget } from '@/minimalist/lib/links'
import { relink, useOpenInTask } from '@/minimalist/lib/thread-panel'
import { getCloudOrigin } from '@/utils/artifact-links'

const REMARK = [remarkGfm]
const REHYPE = [highlightCode]

const COMPONENTS: Components = {
	a: ({ href, children }) => <ProseLink href={href}>{children}</ProseLink>,
	pre: ({ children }) => {
		const artifacts = fenceSource(children, 'task-artifact')
		if (artifacts !== null) return <ArtifactEmbeds source={artifacts} />
		const diagram = fenceSource(children, 'mermaid')
		return diagram === null ? <CodeBlock>{children}</CodeBlock> : <Diagram source={diagram} />
	},
}

export const Prose = memo(function Prose({ text }: { text: string }) {
	return (
		<div className="prose">
			<Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
				{text}
			</Markdown>
		</div>
	)
})

const ORIGINS = {
	app: [window.location.origin, import.meta.env.VITE_PUBLIC_APP_ORIGIN].filter(Boolean) as string[],
	cloud: getCloudOrigin(),
}

/**
 * A link the agent or a teammate wrote. A document's page opens the document in its task's
 * side panel, a page of this app opens here, anything else in a new tab. A bare file path
 * leads nowhere in a browser, so it stays text.
 */
function ProseLink({ href, children }: { href?: string; children?: ReactNode }) {
	const navigate = useNavigate()
	const openInTask = useOpenInTask()
	const { artifactsMetadataCollection } = useSync()
	const target = href ? linkTarget(href, ORIGINS) : ({ kind: 'none' } as const)
	if (target.kind === 'none') return <span title={href}>{children}</span>
	if (target.kind === 'anchor') return <a href={target.href}>{children}</a>
	if (target.kind === 'external')
		return (
			<a href={target.href} target="_blank" rel="noreferrer">
				{children}
			</a>
		)

	const publicHref = target.kind === 'document' ? target.href : publicAppUrl(target.path)
	const follow = async (event: MouseEvent) => {
		// ⌘-click and friends open a new tab: the browser does that itself, the desktop app hands it to the browser.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			if (!isDesktop()) return
			if (publicHref) {
				event.preventDefault()
				return void openExternalUrl(publicHref)
			}
		}
		event.preventDefault()
		if (target.kind === 'app') return void navigate({ href: target.path, state: relink() })
		const doc = await queryOnce((q) =>
			q
				.from({ doc: artifactsMetadataCollection })
				.where(({ doc }) => eq(doc.id, target.artifactId))
				.findOne(),
		)
		// A document you can't see here (another organization's, or one that was deleted) opens where it lives.
		if (doc?.task_id) void openInTask(doc.task_id, { artifactId: doc.id, commentId: target.commentId })
		else void openExternalUrl(target.href)
	}
	return (
		<a href={target.kind === 'app' ? target.path : target.href} onClick={(event) => void follow(event)}>
			{children}
		</a>
	)
}

/** A page of this app at the address anyone can open, when the build knows it. */
function publicAppUrl(path: string) {
	const origin = import.meta.env.VITE_PUBLIC_APP_ORIGIN
	return origin ? new URL(path, origin).href : undefined
}

/** The source of a fenced block in `language`, or null for any other code. */
function fenceSource(code: ReactNode, language: string): string | null {
	if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) return null
	if (!code.props.className?.split(' ').includes(`language-${language}`)) return null
	// A fenced block's only child is its text.
	return typeof code.props.children === 'string' ? code.props.children.replace(/\n$/, '') : null
}

/** A ```task-artifact block: each path in it, shown in place. */
function ArtifactEmbeds({ source }: { source: string }) {
	return taskArtifactPaths(source).map((path) => <TaskArtifactEmbed key={path} path={path} />)
}

/** A mermaid block drawn as its diagram. One that won't draw shows its source, so nothing is lost. */
function Diagram({ source }: { source: string }) {
	const dark = useMinimalistDark()
	const drawn = useQuery({
		queryKey: ['minimalist-diagram', source, dark],
		queryFn: () => renderDiagram(source, dark),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
	if (drawn.isError)
		return (
			<>
				<CodeBlock>
					<code>{source}</code>
				</CodeBlock>
				<div className="diagram-note">Could not draw this diagram, so here is its source.</div>
			</>
		)
	return (
		<div className="diagram">
			{drawn.data ? (
				// Mermaid's strict mode sanitizes the SVG.
				// eslint-disable-next-line react/no-danger
				<div className="diagram-svg" dangerouslySetInnerHTML={{ __html: drawn.data }} />
			) : (
				<div className="diagram-wait" />
			)}
			<CopyButton className="iconbtn copy-code" label="Copy diagram source" text={() => source} />
		</div>
	)
}

/** A code block, with a copy button for the command or snippet in it. */
function CodeBlock({ children }: { children?: ReactNode }) {
	const code = useRef<HTMLPreElement>(null)
	return (
		<div className="codeblock">
			<pre ref={code}>{children}</pre>
			<CopyButton
				className="iconbtn copy-code"
				label="Copy code"
				text={() => code.current?.textContent?.replace(/\n$/, '') ?? ''}
			/>
		</div>
	)
}
