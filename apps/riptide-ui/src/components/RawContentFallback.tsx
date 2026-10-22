import { memo } from 'react'

interface RawContentFallbackProps {
	content: string
}

/**
 * Final fallback when both full and lite renderers fail.
 * Shows raw content as plain text.
 */
export const RawContentFallback = memo(({ content }: RawContentFallbackProps) => (
	<pre className="whitespace-pre-wrap">{content}</pre>
))

RawContentFallback.displayName = 'RawContentFallback'
