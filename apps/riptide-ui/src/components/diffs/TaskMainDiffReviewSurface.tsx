import type { ReactNode } from 'react'

export function TaskMainDiffReviewSurface({
	active,
	overview,
	review,
}: {
	active: boolean
	overview: ReactNode
	review: ReactNode
}) {
	return active ? review : overview
}
