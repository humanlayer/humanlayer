import { useUi } from '@/minimalist/lib/ui-state'

/** Copy text and say so in a toast. The failure toast should tell people where to copy it by hand. */
export function useCopy() {
	const { showToast } = useUi()
	return (text: string, done: string, failure: string) =>
		void navigator.clipboard.writeText(text).then(
			() => showToast(done),
			() => showToast(failure),
		)
}
