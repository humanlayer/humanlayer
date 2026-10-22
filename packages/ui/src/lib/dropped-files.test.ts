import { afterEach, describe, expect, test, vi } from 'vitest'

import {
	dragCarriesFiles,
	localPathsFromDrop,
	readDroppedFiles,
	registerDroppedFilePathReader,
} from './dropped-files'

function dataTransfer(input: { types: string[]; files?: File[]; uriList?: string }): DataTransfer {
	return {
		types: input.types,
		files: input.files ?? [],
		getData: (type: string) => (type === 'text/uri-list' ? (input.uriList ?? '') : ''),
	} as unknown as DataTransfer
}

describe('dropped files', () => {
	afterEach(() => {
		registerDroppedFilePathReader(async () => [])
	})

	test('recognizes files under either engine name', () => {
		expect(dragCarriesFiles(dataTransfer({ types: ['Files'] }))).toBe(true)
		expect(dragCarriesFiles(dataTransfer({ types: ['text/uri-list', 'text/html'] }))).toBe(true)
		expect(dragCarriesFiles(dataTransfer({ types: ['text/plain'] }))).toBe(false)
	})

	test('uses files the engine already decoded', async () => {
		const file = new File(['hi'], 'note.md')

		await expect(readDroppedFiles(dataTransfer({ types: ['Files'], files: [file] }))).resolves.toEqual([file])
	})

	test('reads local paths through the registered reader when files are empty', async () => {
		const read = vi.fn(async (paths: string[]) => paths.map((path) => new File(['x'], path)))
		registerDroppedFilePathReader(read)

		const files = await readDroppedFiles(
			dataTransfer({
				types: ['text/uri-list'],
				uriList: 'file:///home/pepijn/a%20file.png\r\nfile:///home/pepijn/b.png',
			}),
		)

		expect(read).toHaveBeenCalledWith(['/home/pepijn/a file.png', '/home/pepijn/b.png'])
		expect(files).toHaveLength(2)
	})

	test('ignores remote and malformed URI list entries', () => {
		expect(
			localPathsFromDrop(
				dataTransfer({
					types: ['text/uri-list'],
					uriList: 'https://example.com/x.png\nfile://%zz',
				}),
			),
		).toEqual([])
	})
})
