// Reading a dropped file is not the same on every engine.
//
// Chromium and WKWebView put the file in `dataTransfer.files` and announce it as
// the `Files` type. WebKitGTK — the webview the Linux desktop app runs on —
// leaves `files` empty and announces only `text/uri-list`, holding a `file://`
// path. Without a path reader the drop looks like an empty upload there.
//
// The desktop app registers a reader at startup, because only it can read a
// local path. In a plain browser no reader is registered and a uri-list drop
// yields no files, which is correct: web pages cannot read local paths.

export type DroppedFilePathReader = (paths: string[]) => Promise<File[]>

let readFilesFromPaths: DroppedFilePathReader | null = null

export function registerDroppedFilePathReader(reader: DroppedFilePathReader): void {
	readFilesFromPaths = reader
}

/** True when the drag carries files, under either engine's naming. */
export function dragCarriesFiles(dataTransfer: DataTransfer | null | undefined): boolean {
	const types = dataTransfer?.types
	if (!types) return false
	return types.includes('Files') || types.includes('text/uri-list')
}

/** Local paths in a `text/uri-list` payload. Readable in `drop` only. */
export function localPathsFromDrop(dataTransfer: DataTransfer | null | undefined): string[] {
	const uriList = dataTransfer?.getData('text/uri-list') ?? ''
	return uriList
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('file://'))
		.map((uri) => {
			try {
				return decodeURIComponent(new URL(uri).pathname)
			} catch {
				return ''
			}
		})
		.filter((path) => path.length > 0)
}

/**
 * Files in a drop event. Reads `dataTransfer` synchronously — the object is
 * empty once the handler yields — then awaits the path reader if needed.
 */
export function readDroppedFiles(dataTransfer: DataTransfer | null | undefined): Promise<File[]> {
	const direct = Array.from(dataTransfer?.files ?? [])
	if (direct.length > 0) return Promise.resolve(direct)

	const paths = localPathsFromDrop(dataTransfer)
	if (paths.length === 0 || !readFilesFromPaths) return Promise.resolve([])
	return readFilesFromPaths(paths)
}
