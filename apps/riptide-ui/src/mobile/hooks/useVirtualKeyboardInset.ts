import { useMountEffect } from '@/hooks/useMountEffect'

/**
 * Keeps the mobile composer visible when the on-screen keyboard opens.
 *
 * `dvh`/`100%` heights are measured against the *layout* viewport, which iOS
 * Safari does not shrink when the virtual keyboard appears — so a bottom-anchored
 * composer ends up hidden behind the keyboard. We watch `window.visualViewport`
 * (which *does* shrink) and publish the keyboard overlap as a `--keyboard-inset`
 * CSS variable on `<html>`. The mobile layout subtracts it from its height so the
 * composer stays above the keyboard.
 *
 * Writing a CSS variable (rather than React state) avoids a re-render on every
 * viewport tick. Guarded for browsers without `visualViewport`.
 */
export function useVirtualKeyboardInset(): void {
	useMountEffect(() => {
		const vv = window.visualViewport
		if (!vv) return

		const root = document.documentElement
		const update = () => {
			// Overlap between the layout viewport bottom and the visual viewport
			// bottom == keyboard height (plus any Safari toolbar offset).
			const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
			root.style.setProperty('--keyboard-inset', `${inset}px`)
		}

		update()
		vv.addEventListener('resize', update)
		vv.addEventListener('scroll', update)

		return () => {
			vv.removeEventListener('resize', update)
			vv.removeEventListener('scroll', update)
			root.style.removeProperty('--keyboard-inset')
		}
	})
}
