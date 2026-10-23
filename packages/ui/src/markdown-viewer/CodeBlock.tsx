import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Check, Copy } from 'lucide-react'
import type { ComponentType, CSSProperties } from 'react'
import { lazy, Suspense, useState } from 'react'
import { z } from 'zod'
import { Button } from '../components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip'

const LazyMermaidDiagram = lazy(() =>
  import('../components/mermaid-diagram').then((m) => ({ default: m.MermaidDiagram })),
)

/** Props for custom language renderers */
export interface CustomLanguageRendererProps {
  code: string
  className?: string
}

/** Map of language names to custom renderer components */
export type CustomLanguageRenderers = Record<string, ComponentType<CustomLanguageRendererProps>>

export function getForwardedDecorationClasses(className: string): string {
  // ProseMirror applies block focus to the node-view wrapper itself. Forwarding
  // it through React can leave the old code block focused until React rerenders.
  return className
    .split(/\s+/)
    .filter(name => name && name !== 'artifact-viewer-v2-block-focused')
    .join(' ')
}

/** Copy button with local state - avoids re-rendering parent on copy */
const CodeCopyButton = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 touch:opacity-100 md:touch:opacity-0 md:touch:group-hover:opacity-100 bg-[var(--terminal-bg-alt)] hover:bg-[var(--terminal-bg-alt)]"
          onClick={(e) => {
            e.stopPropagation()
            handleCopy()
          }}
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Copy code</p>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Factory function to create a CodeBlock component with custom language renderers.
 * Use this when you need to add support for custom languages like `task-artifact`.
 *
 * @example
 * const MyCodeBlock = createCodeBlockComponent({
 *   'task-artifact': TaskArtifactViewer,
 * })
 */
export function createCodeBlockComponent(
  customRenderers: CustomLanguageRenderers = {}
): React.ComponentType<ReactNodeViewProps<HTMLElement>> {
  return function CodeBlockWithCustomRenderers({ node, decorations }) {
    // Extract decoration attributes (class, style, data-*) from ProseMirror decorations
    let decoClass = ''
    let decoStyle: CSSProperties | undefined
    const dataAttrs: Record<string, string> = {}

    for (const deco of decorations ?? []) {
      // Try multiple paths to access decoration attributes (ProseMirror structure varies)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = deco as any
      const attrs = d.type?.attrs ?? d.spec?.attrs ?? d.attrs ?? {}

      if (attrs.class) {
        const forwardedClasses = getForwardedDecorationClasses(z.string().parse(attrs.class))
        if (forwardedClasses) decoClass += ` ${forwardedClasses}`
      }
      if (attrs.style) {
        // Parse CSS string like "--comment-color: #fbbf24" into React style object
        const styleParts = (attrs.style as string).split(';').filter(Boolean)
        const styleObj: Record<string, string> = {}
        for (const part of styleParts) {
          const [key, val] = part.split(':').map(s => s.trim())
          if (key && val) styleObj[key] = val
        }
        decoStyle = styleObj as CSSProperties
      }
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith('data-')) dataAttrs[k] = v as string
      }
    }

    const language = node.attrs.language as string

    // Check custom renderers first
    const CustomRenderer = customRenderers[language]
    if (CustomRenderer) {
      return (
        <NodeViewWrapper className={decoClass.trim() || undefined} style={decoStyle} {...dataAttrs}>
          <CustomRenderer code={node.textContent.trim()} />
        </NodeViewWrapper>
      )
    }

    if (language === 'mermaid') {
      return (
        <NodeViewWrapper className={decoClass.trim() || undefined} style={decoStyle} {...dataAttrs}>
          <Suspense fallback={<div className="animate-pulse bg-muted rounded h-24" />}>
            <LazyMermaidDiagram code={node.textContent} />
          </Suspense>
        </NodeViewWrapper>
      )
    }

    return (
      <NodeViewWrapper className={`code-block rounded-none group${decoClass}`} style={decoStyle} {...dataAttrs}>
        <div contentEditable={false}>
          <CodeCopyButton code={node.textContent} />
        </div>
        <pre>
          {/* @ts-expect-error - lib code */}
          <NodeViewContent as="code" />
        </pre>
      </NodeViewWrapper>
    )
  }
}

/** Default CodeBlock component without custom renderers (backwards compatible) */
export const CodeBlockComponent = createCodeBlockComponent()
