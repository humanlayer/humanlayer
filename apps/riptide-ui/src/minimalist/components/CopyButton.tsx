import { Check, Copy } from 'lucide-react'
import { useRef, useState } from 'react'

import { useUi } from '@/minimalist/lib/ui-state'

/** How long the check mark stays after a copy. */
const CONFIRM_MS = 1500

/**
 * Copy what `text` returns when clicked, and show a check mark for a moment. `text` runs
 * at click time, so it can read the page (a code block's rendered text).
 */
export function CopyButton({ text, label, className }: { text: () => string; label: string; className?: string }) {
	const { showToast } = useUi()
	const [copied, setCopied] = useState(false)
	const reset = useRef<ReturnType<typeof setTimeout>>(undefined)
	const copy = () =>
		navigator.clipboard.writeText(text()).then(
			() => {
				clearTimeout(reset.current)
				setCopied(true)
				reset.current = setTimeout(() => setCopied(false), CONFIRM_MS)
			},
			() => showToast('Could not copy. Select the text and copy it by hand.'),
		)
	return (
		<button type="button" className={className} title={label} aria-label={label} onClick={() => void copy()}>
			{copied ? <Check className="i sm" /> : <Copy className="i sm" strokeWidth={1.6} />}
		</button>
	)
}
