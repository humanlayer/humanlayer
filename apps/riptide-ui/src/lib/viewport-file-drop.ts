// The whole viewport accepts a dropped file whenever a surface can take one.
//
// A surface that uploads files (the session composer, the draft launcher)
// registers here while it is mounted. The overlay then treats every point in
// the window as a drop target, so a drop no longer has to land on the small
// composer box.
//
// Registrations form a stack: the newest surface that can accept a file wins,
// so a launcher opened over a session takes the drop, and unmounting it hands
// the drop back to the session underneath.

export type ViewportFileDropHandler = (files: File[]) => void

interface Registration {
	readonly getHandler: () => ViewportFileDropHandler | null
}

const registrations: Registration[] = []

export function registerViewportFileDrop(registration: Registration): () => void {
	registrations.push(registration)
	return () => {
		const index = registrations.indexOf(registration)
		if (index >= 0) registrations.splice(index, 1)
	}
}

/** The handler of the newest surface that can accept a file, if any. */
export function activeViewportFileDropHandler(): ViewportFileDropHandler | null {
	for (let index = registrations.length - 1; index >= 0; index--) {
		const handler = registrations[index]?.getHandler() ?? null
		if (handler) return handler
	}
	return null
}
