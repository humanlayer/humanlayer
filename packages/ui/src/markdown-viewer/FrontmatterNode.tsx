import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'
import { memo, useState } from 'react'

/** Render a frontmatter value */
export const FrontmatterValue = memo(({ value }: { value: unknown }) => {
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

/** Render frontmatter as a collapsible key/value block — collapsed by default */
export const FrontmatterBlock = memo(
	({ node }: ReactNodeViewProps) => {
		const data = (node.attrs.data ?? {}) as Record<string, unknown>
		const [expanded, setExpanded] = useState(false)
		const entries = Object.entries(data)
		if (entries.length === 0) return null

		return (
			<NodeViewWrapper>
				<div className="mb-4 font-mono">
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1 cursor-pointer"
					>
						<ChevronRight
							className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
						/>
						<span>frontmatter</span>
						<span className="text-muted-foreground/60">({entries.length})</span>
					</button>
					{expanded && (
						<div className="space-y-2 pb-3 pt-1">
							{entries.map(([key, value]) => (
								<div key={key} className="flex gap-2 text-sm items-baseline pl-4">
									<span className="text-muted-foreground shrink-0">{key}:</span>
									<FrontmatterValue value={value} />
								</div>
							))}
						</div>
					)}
				</div>
			</NodeViewWrapper>
		)
	},
)

FrontmatterBlock.displayName = 'FrontmatterBlock'

export const FrontmatterNode = Node.create({
	name: 'frontmatter',
	group: 'block',
	atom: true,

	addOptions() {
		return { data: {} as Record<string, unknown> }
	},

	addAttributes() {
		return {
			data: {
				default: {},
				parseHTML: (element: HTMLElement) => {
					const raw = element.getAttribute('data-frontmatter')
					try {
						return raw ? JSON.parse(raw) : {}
					} catch {
						return {}
					}
				},
				renderHTML: (attributes: Record<string, unknown>) => ({
					'data-frontmatter': JSON.stringify(attributes.data ?? {}),
				}),
			},
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-type="frontmatter"]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'frontmatter', ...HTMLAttributes }, 0]
	},

	addNodeView() {
		return ReactNodeViewRenderer(FrontmatterBlock)
	},

	onCreate() {
		const data = this.options.data as Record<string, unknown>
		if (data && Object.keys(data).length > 0) {
			this.editor.commands.insertContentAt(0, {
				type: 'frontmatter',
				attrs: { data },
			})
		}
	},
})
