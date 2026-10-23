const ROOT_SCROLL_GUARD_DURATION_MS = 2_000

let guardEndsAt = 0
let animationFrameId: number | null = null
let guardInstalled = false

export function restoreDocumentRootScrollPosition(): boolean {
	const root = document.scrollingElement
	const hasRootOffset =
		(root?.scrollTop ?? 0) !== 0 ||
		document.documentElement.scrollTop !== 0 ||
		document.body.scrollTop !== 0 ||
		window.scrollY !== 0

	if (!hasRootOffset) return false

	if (root) root.scrollTop = 0
	document.documentElement.scrollTop = 0
	document.body.scrollTop = 0
	window.scrollTo(0, 0)
	return true
}

function finishGuard(): void {
	if (!guardInstalled) return
	guardInstalled = false
	guardEndsAt = 0
	window.removeEventListener('scroll', restoreDocumentRootScrollPosition)
	if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId)
	animationFrameId = null
}

function checkRootPosition(now: number): void {
	restoreDocumentRootScrollPosition()
	if (now >= guardEndsAt) {
		finishGuard()
		return
	}
	animationFrameId = window.requestAnimationFrame(checkRootPosition)
}

export function startDocumentRootScrollGuard(durationMs = ROOT_SCROLL_GUARD_DURATION_MS): void {
	guardEndsAt = Math.max(guardEndsAt, performance.now() + durationMs)
	if (guardInstalled) return

	guardInstalled = true
	window.addEventListener('scroll', restoreDocumentRootScrollPosition, { passive: true })
	animationFrameId = window.requestAnimationFrame(checkRootPosition)
}

export function stopDocumentRootScrollGuard(): void {
	finishGuard()
}
