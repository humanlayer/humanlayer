export function createUniqueUploadFileNames(
	fileNames: readonly string[],
	unavailableFileNames: Iterable<string>,
): string[] {
	const usedFileNames = new Set(unavailableFileNames)

	return fileNames.map((fileName) => {
		if (!usedFileNames.has(fileName)) {
			usedFileNames.add(fileName)
			return fileName
		}

		const extensionStart = fileName.lastIndexOf('.')
		const hasExtension = extensionStart > 0
		const stem = hasExtension ? fileName.slice(0, extensionStart) : fileName
		const extension = hasExtension ? fileName.slice(extensionStart) : ''
		let suffix = 1
		let uniqueFileName = `${stem}-${suffix}${extension}`

		while (usedFileNames.has(uniqueFileName)) {
			suffix += 1
			uniqueFileName = `${stem}-${suffix}${extension}`
		}

		usedFileNames.add(uniqueFileName)
		return uniqueFileName
	})
}
