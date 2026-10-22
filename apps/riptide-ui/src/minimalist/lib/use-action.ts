import { useRef, useState } from 'react'

import { useUi } from '@/minimalist/lib/ui-state'

/**
 * Run one async action at a time and report a failure. `toast` shows the failure as a
 * toast; `inline` keeps it in `error` for the caller to show, for dialogs, whose
 * backdrop covers the toast and hides it from screen readers.
 */
export function useAction(report: 'toast' | 'inline' = 'toast') {
	const { showToast } = useUi()
	const lock = useRef(false)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const run = async (action: () => Promise<unknown>, failure: string) => {
		if (lock.current) return false
		lock.current = true
		setPending(true)
		setError(null)
		try {
			await action()
			return true
		} catch {
			if (report === 'toast') showToast(failure)
			else setError(failure)
			return false
		} finally {
			lock.current = false
			setPending(false)
		}
	}
	return { pending, error, run }
}
