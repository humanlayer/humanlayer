/**
 * Maps each path to a row Pierre Trees can hold, keyed by the source path in input order.
 *
 * A diff can name a path as a file and as a folder at once: the agent replaces the file
 * `maps` (or a symlink or submodule) with a folder `maps/`, so the diff holds both `maps`
 * and `maps/index.ts`. Pierre Trees throws on that, so the file moves to a sibling row,
 * `maps (file)`. Repeated paths keep their first row.
 */
export function toFileTreePaths(paths: readonly string[]): Map<string, string> {
	const folders = new Set<string>()
	for (const path of paths) {
		for (let end = path.indexOf('/'); end !== -1; end = path.indexOf('/', end + 1)) {
			folders.add(path.slice(0, end))
		}
	}
	const taken = new Set<string>([...folders, ...paths])
	const treePaths = new Map<string, string>()
	for (const path of paths) {
		if (treePaths.has(path)) continue
		if (!folders.has(path)) {
			treePaths.set(path, path)
			continue
		}
		let treePath = `${path} (file)`
		for (let copy = 2; taken.has(treePath); copy++) treePath = `${path} (file ${copy})`
		taken.add(treePath)
		treePaths.set(path, treePath)
	}
	return treePaths
}
