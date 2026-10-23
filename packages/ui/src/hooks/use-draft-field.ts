import { useSessionStorage } from '@uidotdev/usehooks'

export interface DraftField {
	/** The current draft text, kept reactive via sessionStorage. '' when there is no draft. */
	value: string
	/** Persist the draft; a value that is empty/whitespace removes the key. */
	setValue: (value: string) => void
	/** Remove the draft key. */
	clear: () => void
}

/**
 * A sessionStorage-backed draft primitive for transient free-form text inputs.
 *
 * Wraps {@link useSessionStorage} from `@uidotdev/usehooks` (the same library we use
 * for `useLocalStorage`) so the value stays **reactive** — every component reading the
 * same key re-renders when the draft changes — rather than reading/writing
 * `window.sessionStorage` directly. Draft-specific semantics layered on top:
 * - an empty/whitespace value removes the key (no empty drafts linger), and
 * - a missing key reads back as `''`.
 *
 * `initialValue` is `undefined` so the hook never seeds an empty placeholder into
 * storage on mount — only real keystrokes write a key.
 */
export function useDraftField(key: string): DraftField {
	const [stored, setStored] = useSessionStorage<string | undefined>(key, undefined)

	const setValue = (value: string) => {
		// undefined removes the key in useSessionStorage; trim so whitespace-only never lingers.
		setStored(value.trim() === '' ? undefined : value)
	}

	const clear = () => setStored(undefined)

	return { value: stored ?? '', setValue, clear }
}
