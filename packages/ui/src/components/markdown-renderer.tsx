import { Button } from '@humanlayer/ui/components/button'
import { Check, Copy } from 'lucide-react'
import yaml from 'js-yaml'
import React, { Suspense, lazy, memo, useMemo, useState } from 'react'
import { themeToShikiInput } from '../lib/shiki-theme-mapping'
import { useOptionalTheme } from './theme-provider'
import type { Components } from 'react-markdown'
import ReactMarkdown, { defaultUrlTransform as reactMarkdownDefaultUrlTransform } from 'react-markdown'
import { CommentedLine } from './commented-line'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import clojure from 'react-syntax-highlighter/dist/esm/languages/prism/clojure'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
// Import only needed languages for smaller bundle
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import zig from 'react-syntax-highlighter/dist/esm/languages/prism/zig'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import { createCodePlugin } from '@streamdown/code'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import {
	type Components as StreamdownComponents,
	type CustomRendererProps,
	defaultRehypePlugins,
	defaultRemarkPlugins,
	type PluginConfig,
	Streamdown,
	type StreamdownProps,
} from 'streamdown'

import 'streamdown/styles.css'

import { CommandToken } from '@humanlayer/ui/components/command-token'

// // Register languages
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('ts', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('js', javascript)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('kotlin', kotlin)
SyntaxHighlighter.registerLanguage('kt', kotlin)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('py', python)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('rs', rust)
SyntaxHighlighter.registerLanguage('swift', swift)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('lua', lua)
SyntaxHighlighter.registerLanguage('clojure', clojure)
SyntaxHighlighter.registerLanguage('clj', clojure)
SyntaxHighlighter.registerLanguage('zig', zig)
SyntaxHighlighter.registerLanguage('diff', diff)
SyntaxHighlighter.registerLanguage('patch', diff)

interface MarkdownRendererProps {
    content: string
    variant?: 'terminal' | 'pretty'
    preserveSingleLineBreaks?: boolean
    commentedLines?: Map<number, Array<{ userId: string; displayName?: string; avatarUrl?: string }>>
    onLineClick?: (lineNumber: number) => void
}

/** Parse frontmatter from markdown content */
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!match) return { data: {}, body: content }

    try {
        const parsed = yaml.load(match[1] ?? '')
        const data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
        return { data, body: match[2] ?? '' }
    } catch {
        return { data: {}, body: content }
    }
}

/** Render a frontmatter value */
const FrontmatterValue = memo(({ value }: { value: unknown }) => {
    if (Array.isArray(value)) {
        return (
            <span className="flex flex-wrap gap-1">
                {value.map((item, i) => (
                    <span key={i} className="text-xs border border-border px-1.5 py-0.5 rounded">
                        {String(item)}
                    </span>
                ))}
            </span>
        )
    }
    if (typeof value === 'object' && value !== null) {
        return <span className="font-mono text-xs text-muted-foreground">{JSON.stringify(value)}</span>
    }
    return <span className="text-foreground">{String(value)}</span>
})

FrontmatterValue.displayName = 'FrontmatterValue'

/** Render frontmatter as floating key/value pairs */
const FrontmatterBlock = memo(({ data }: { data: Record<string, unknown> }) => (
    <div className="mb-8 space-y-2 border-b border-border font-mono" style={{ paddingBottom: '1rem' }}>
        {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex gap-2 text-sm items-baseline">
                <span className="text-muted-foreground shrink-0">{key}:</span>
                <FrontmatterValue value={value} />
            </div>
        ))}
    </div>
))

FrontmatterBlock.displayName = 'FrontmatterBlock'

/** navigator.clipboard can reject silently in WKWebView; fall back to the legacy
 * textarea + execCommand path so copy works in the native app too. */
async function copyTextToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text)
        return
    } catch {
        // fall through to the legacy path
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
}

/** Extract the raw text content of a react-markdown/streamdown node tree. */
export function getMarkdownNodeText(node: unknown): string {
    if (typeof node === 'string') return node
    if (typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(getMarkdownNodeText).join('')
    if (React.isValidElement(node)) return getMarkdownNodeText((node.props as { children?: unknown }).children)
    return ''
}

/** Copy button with local state - avoids re-rendering parent on copy */
export const CodeCopyButton = ({ code }: { code: string }) => {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await copyTextToClipboard(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (error) {
            console.error(error)
        }
    }

    return (
        <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 touch:opacity-100 md:touch:opacity-0 md:touch:group-hover:opacity-100 bg-transparent hover:bg-transparent"
            onClick={(e) => {
                e.stopPropagation()
                handleCopy()
            }}
            aria-label="Copy code"
            title="Copy code"
        >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </Button>
    )
}

const LazyMermaidDiagram = lazy(() =>
	import('./mermaid-diagram').then((m) => ({ default: m.MermaidDiagram })),
)

/** Mermaid fences in the Streamdown path render through our diagram viewer
 * (expand-to-lightbox, foreignObject fixes) instead of Streamdown's mermaid plugin. */
const StreamdownMermaidBlock = ({ code }: CustomRendererProps) => (
	<Suspense fallback={<div className="animate-pulse bg-muted rounded h-24" />}>
		<LazyMermaidDiagram code={code} />
	</Suspense>
)

const streamdownRenderers = [{ language: 'mermaid', component: StreamdownMermaidBlock }]

/** Streamdown plugins with the shiki highlighter themed to the current app theme —
 * the same mapping the @pierre/diffs viewer uses, so code matches the diff viewer.
 * Streamdown ignores its `shikiTheme` prop whenever a code plugin is present and uses
 * the plugin's own themes, so the theme must be baked into the plugin here. Memoized
 * per theme: the plugins object must stay identity-stable or Streamdown's block
 * memoization re-renders every block on every render. */
function useStreamdownPlugins(): PluginConfig {
	const themeContext = useOptionalTheme()
	const input = themeToShikiInput(themeContext?.theme)
	return useMemo(
		() => ({
			// The app theme system picks one concrete palette; shiki wants a [light, dark]
			// pair, so pass it in both slots. Cast: @streamdown/code binds shiki 3 types
			// while streamdown's bind to the workspace's shiki 2 — interfaces match.
			code: createCodePlugin({
				themes: [input, input] as Parameters<typeof createCodePlugin>[0] extends { themes?: infer T } ? T : never,
			}) as PluginConfig['code'],
			renderers: streamdownRenderers,
		}),
		[input],
	)
}

// Tables render as plain elements styled by the prose classes, matching the previous
// react-markdown renderer; no controls header bar.
const streamdownControls = { table: false, code: false } as const
const singleLineBreakRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks]

type SanitizeOptions = {
	protocols?: Record<string, string[]>
	[key: string]: unknown
}

const [streamdownSanitizePlugin, streamdownSanitizeOptions] = defaultRehypePlugins.sanitize as [
	unknown,
	SanitizeOptions,
]
const streamdownRehypePlugins = [
	defaultRehypePlugins.raw,
	[
		streamdownSanitizePlugin,
		{
			...streamdownSanitizeOptions,
			protocols: {
				...streamdownSanitizeOptions.protocols,
				href: [...(streamdownSanitizeOptions.protocols?.href ?? []), 'tauri'],
			},
		},
	],
	defaultRehypePlugins.harden,
] as StreamdownProps['rehypePlugins']

function markdownUrlTransform(url: string): string {
	if (url.startsWith('tauri://localhost/')) return url
	return reactMarkdownDefaultUrlTransform(url)
}

/** Overrides that keep our prose styling authoritative over Streamdown's defaults. */
const sharedStreamdownComponents: StreamdownComponents = {
	p({ children }) {
		return <p>{children}</p>
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
	img(props) {
		return <img {...props} />
	},
	// Replicates streamdown's default pre (the data-block clone drives its block/inline
	// code routing) and layers our own hover copy button over normal code blocks —
	// streamdown's built-in controls are disabled (controls.code false): its copy relies
	// on navigator.clipboard alone, which WKWebView rejects silently.
	pre({ children }) {
		const child = React.isValidElement(children) ? children : null
		const blockChildren = child
			? React.cloneElement(child, { 'data-block': 'true' } as never)
			: children
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
				{blockChildren}
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
			>
				{children}
			</a>
		)
	},
}

const terminalStreamdownComponents: StreamdownComponents = {
	...sharedStreamdownComponents,
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
}

const prettyStreamdownComponents: StreamdownComponents = {
	...sharedStreamdownComponents,
	h1({ children }) {
		return <h1>{children}</h1>
	},
	h2({ children }) {
		return <h2>{children}</h2>
	},
	h3({ children }) {
		return <h3>{children}</h3>
	},
	h4({ children }) {
		return <h4>{children}</h4>
	},
	h5({ children }) {
		return <h5>{children}</h5>
	},
	h6({ children }) {
		return <h6>{children}</h6>
	},
}

/** Convert react-syntax-highlighter AST nodes into React elements (avoids importing library internals) */
function renderSyntaxNode(node: any, key: string | number): React.ReactNode {
    if (node.type === 'text') return node.value
    const { tagName: Tag = 'span', properties = {}, children = [] } = node
    const { className: classNames, ...restProps } = properties
    const cls = Array.isArray(classNames) ? classNames.filter(Boolean).join(' ') : classNames
    return React.createElement(
        Tag,
        { ...restProps, className: cls || undefined, key },
        ...children.map((child: any, i: number) => renderSyntaxNode(child, `${key}-${i}`)),
    )
}


const MarkdownRendererInner = memo(
    ({ content, variant = 'terminal', preserveSingleLineBreaks = false, commentedLines, onLineClick }: MarkdownRendererProps) => {
        const { data: frontmatter, body } = React.useMemo(() => parseFrontmatter(content), [content])
        const streamdownPlugins = useStreamdownPlugins()
        const isPretty = variant === 'pretty'
        const proseClass = isPretty ? 'prose-pretty' : 'prose-terminal'
        const hasFrontmatter = Object.keys(frontmatter).length > 0

        // ReactMarkdown parses `body` (after frontmatter stripping), so AST line numbers
        // are relative to `body`. Offset them back to original content line numbers so they
        // match the `commentedLines` keys used by ArtifactRaw.
        const frontmatterLineOffset = React.useMemo(() => {
            if (!hasFrontmatter) return 0
            const prefix = content.slice(0, content.length - body.length)
            return (prefix.match(/\n/g) || []).length
        }, [content, body, hasFrontmatter])

        const components: Components = React.useMemo(() => {
            /** Compute the source line number for a given AST node */
            const getSourceLine = (node: any): number | undefined =>
                node?.position?.start?.line != null
                    ? node.position.start.line + frontmatterLineOffset
                    : undefined

            /** Find the first commentedLines match within a node's line range */
            const findCommentInRange = (node: any): { authors: Array<{ userId: string; displayName?: string; avatarUrl?: string }>; lineNumber: number } | null => {
                if (!commentedLines) return null
                const startLine = node?.position?.start?.line
                if (startLine == null) return null
                const endLine = node?.position?.end?.line ?? startLine
                for (let i = startLine; i <= endLine; i++) {
                    const contentLine = i + frontmatterLineOffset
                    const authors = commentedLines.get(contentLine)
                    if (authors) return { authors, lineNumber: contentLine }
                }
                return null
            }

            /** Wrap a single-line element (heading, etc.) with full CommentedLine highlight */
            const wrap = (node: any, element: React.ReactElement) => {
                const match = findCommentInRange(node)
                if (!match) return element
                return (
                    <CommentedLine
                        commentAuthors={match.authors}
                        onClick={onLineClick ? () => onLineClick(match.lineNumber) : undefined}
                        sourceLineNumber={match.lineNumber}
                    >
                        {element}
                    </CommentedLine>
                )
            }

            /** Wrap a paragraph with a CommentedLine block indicator */
            const wrapParagraph = (node: any, element: React.ReactElement) => {
                const match = findCommentInRange(node)
                if (!match) return element

                return (
                    <CommentedLine
                        commentAuthors={match.authors}
                        onClick={onLineClick ? () => onLineClick(match.lineNumber) : undefined}
                        variant="block"
                        sourceLineNumber={match.lineNumber}
                    >
                        {element}
                    </CommentedLine>
                )
            }
            return ({
            h1({ children, node }) {
                const sl = getSourceLine(node)
                return wrap(node, <h1 data-source-line={sl}>{isPretty ? '' : '# '}{children}</h1>)
            },
            h2({ children, node }) {
                const sl = getSourceLine(node)
                return wrap(node, <h2 data-source-line={sl}>{isPretty ? '' : '## '}{children}</h2>)
            },
            h3({ children, node }) {
                const sl = getSourceLine(node)
                return wrap(node, <h3 data-source-line={sl}>{isPretty ? '' : '### '}{children}</h3>)
            },
            h4({ children, node }) {
                const sl = getSourceLine(node)
                return wrap(node, <h4 data-source-line={sl}>{isPretty ? '' : '#### '}{children}</h4>)
            },
            h5({ children, node }) {
                const sl = getSourceLine(node)
                return wrap(node, <h5 data-source-line={sl}>{isPretty ? '' : '##### '}{children}</h5>)
            },
            h6({ children, node }) {
                const sl = getSourceLine(node)
                return wrap(node, <h6 data-source-line={sl}>{isPretty ? '' : '###### '}{children}</h6>)
            },
            li({ children, node }) {
                const sl = getSourceLine(node)
                // Remove any leading whitespace/newlines from list items
                // This fixes the issue where numbered lists have newlines between number and text
                if (Array.isArray(children)) {
                    // Filter out pure whitespace text nodes at the beginning
                    const filteredChildren = children.filter((child, index) => {
                        if (index === 0 && typeof child === 'string' && child.trim() === '') {
                            return false
                        }
                        return true
                    })
                    return <li data-source-line={sl}>{filteredChildren}</li>
                }
                return <li data-source-line={sl}>{children}</li>
            },
            p({ children, node }) {
                // Check if we're inside a list item
                const isInList = (node as any)?.parent?.tagName === 'li'
                const sl = getSourceLine(node)
                // Let CSS handle margins, only control display
                return wrapParagraph(node, <p style={{ display: isInList ? 'inline' : 'block' }} data-source-line={sl}>{children}</p>)
            },
            pre({ children, node }) {
                // Mark the code element as being inside a pre block
                // Don't wrap in another <pre> - SyntaxHighlighter provides its own via PreTag
                // NOTE: do NOT use wrap() here — the code() component handles per-line
                // highlighting internally via highlightedCodeLines. Wrapping the entire
                // <pre> would double-highlight the whole code block.
                const codeElement = children as any
                const lineNumber = (node as any)?.position?.start?.line
                if (codeElement?.props) {
                    return React.cloneElement(codeElement, { 'data-is-block': true, 'data-source-line-start': lineNumber })
                }
                return <pre>{children}</pre>
            },
            code(props) {
                const { className, children, ...rest } = props as any
                const codeString = String(children).replace(/\n$/, '')

                // Check if this code is inside a pre block
                const isBlock = rest['data-is-block'] === true
                const sourceLineStart = rest['data-source-line-start'] as number | undefined

                // Extract language if present
                const match = /language-(\w+)/.exec(className || '')
                const language = match?.[1] ?? 'plaintext'

                // Render mermaid diagrams using MermaidDiagram component
                if (isBlock && language === 'mermaid') {
                    return (
                        <Suspense fallback={<div className="animate-pulse bg-muted rounded h-24" />}>
                            <LazyMermaidDiagram code={codeString} />
                        </Suspense>
                    )
                }

                // Calculate per-line highlights within code blocks
                let highlightedCodeLines: Set<number> | null = null
                if (isBlock && commentedLines && sourceLineStart != null) {
                    const numLines = codeString.split('\n').length
                    const highlighted = new Set<number>()
                    for (let i = 1; i <= numLines; i++) {
                        if (commentedLines.has(sourceLineStart + frontmatterLineOffset + i)) {
                            highlighted.add(i)
                        }
                    }
                    if (highlighted.size > 0) highlightedCodeLines = highlighted
                }

                return isBlock ? (
                    <SyntaxHighlighter
                        language={language}
                        useInlineStyles={false}
                        className="rsh-code-block text-sm grid min-w-[250px]"
                        codeTagProps={{}}
                        wrapLines={highlightedCodeLines != null}
                        renderer={highlightedCodeLines ? ({ rows }: { rows: any[] }) => {
                            const result: React.ReactNode[] = []
                            let i = 0
                            while (i < rows.length) {
                                const lineNum = i + 1
                                if (highlightedCodeLines!.has(lineNum)) {
                                    // Collect consecutive highlighted lines into a single group
                                    const groupStart = i
                                    const groupLines: React.ReactNode[] = []
                                    while (i < rows.length && highlightedCodeLines!.has(i + 1)) {
                                        groupLines.push(renderSyntaxNode(rows[i], `code-line-${i}`))
                                        i++
                                    }
                                    const sourceLineNum = sourceLineStart! + frontmatterLineOffset + groupStart + 1
                                    const authors = commentedLines!.get(sourceLineNum)
                                    if (authors) {
                                        result.push(
                                            <CommentedLine
                                                key={`code-group-${groupStart}`}
                                                commentAuthors={authors}
                                                onClick={onLineClick ? () => onLineClick(sourceLineNum) : undefined}
                                                multiline={groupLines.length > 1}
                                                sourceLineNumber={sourceLineNum}
                                            >
                                                <div className="flex flex-col">
                                                    {groupLines}
                                                </div>
                                            </CommentedLine>,
                                        )
                                    } else {
                                        result.push(...groupLines)
                                    }
                                } else {
                                    result.push(renderSyntaxNode(rows[i], `code-line-${i}`))
                                    i++
                                }
                            }
                            return result
                        } : undefined}
                        PreTag={({ children, ...preProps }) => (
                            <div className="relative group overflow-hidden" style={{ marginTop: '1.25em', marginBottom: '1.25em' }}>
                                <CodeCopyButton code={codeString} />
                                <pre className="rsh-pre" {...preProps} style={{ ...preProps.style, marginTop: 0, marginBottom: 0 }}>
                                    {children}
                                </pre>
                            </div>
                        )}
                    >
                        {codeString}
                    </SyntaxHighlighter>
                ) : (
                    <CommandToken>{children}</CommandToken>
                )
            },
            a({ href, children }) {
                return (
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline hover:text-accent/80 transition-colors"
                    >
                        {children}
                    </a>
                )
            },
        })
        }, [isPretty, commentedLines, onLineClick, frontmatterLineOffset])

        // Comment anchoring needs source-global line positions from a single-pass parse;
        // Streamdown parses per block, so those renders stay on the legacy pipeline.
        const canUseStreamdown = !commentedLines && !onLineClick

        if (canUseStreamdown) {
            return (
                <div className={`${proseClass} pb-4`}>
                    {hasFrontmatter && <FrontmatterBlock data={frontmatter} />}
                    <Streamdown
                        components={isPretty ? prettyStreamdownComponents : terminalStreamdownComponents}
                        controls={streamdownControls}
                        lineNumbers={false}
                        parseIncompleteMarkdown={false}
                        plugins={streamdownPlugins}
						rehypePlugins={streamdownRehypePlugins}
                        remarkPlugins={preserveSingleLineBreaks ? singleLineBreakRemarkPlugins : undefined}
						urlTransform={markdownUrlTransform}
                    >
                        {body}
                    </Streamdown>
                </div>
            )
        }

        return (
            <div className={`${proseClass} pb-4`}>
                {hasFrontmatter && <FrontmatterBlock data={frontmatter} />}
                <ReactMarkdown
					components={components}
					remarkPlugins={preserveSingleLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}
					urlTransform={markdownUrlTransform}
				>
                    {body}
                </ReactMarkdown>
            </div>
        )
    },
    (prevProps, nextProps) =>
        prevProps.content === nextProps.content &&
        prevProps.variant === nextProps.variant &&
        prevProps.preserveSingleLineBreaks === nextProps.preserveSingleLineBreaks &&
        prevProps.commentedLines === nextProps.commentedLines &&
        prevProps.onLineClick === nextProps.onLineClick,
)

MarkdownRendererInner.displayName = 'MarkdownRendererInner'

export const MarkdownRenderer = MarkdownRendererInner
