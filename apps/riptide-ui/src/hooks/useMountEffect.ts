import { type EffectCallback, useEffect } from 'react'

/**
 * Runs an effect exactly once on mount (and cleans up on unmount).
 * Use this instead of `useEffect(..., [])` to make intent explicit.
 */
export function useMountEffect(effect: EffectCallback) {
	// eslint-disable-next-line no-restricted-syntax
	useEffect(effect, [])
}
