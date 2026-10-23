import { describe, expect, test } from 'vitest'

import { createUniqueUploadFileNames } from './unique-upload-file-names'

describe('createUniqueUploadFileNames', () => {
	test('keeps names that are not in use', () => {
		expect(createUniqueUploadFileNames(['image.png', 'notes.txt'], [])).toEqual(['image.png', 'notes.txt'])
	})

	test('numbers duplicate names within one upload batch', () => {
		expect(createUniqueUploadFileNames(['image.png', 'image.png', 'image.png'], [])).toEqual([
			'image.png',
			'image-1.png',
			'image-2.png',
		])
	})

	test('skips numbered names that already exist', () => {
		expect(createUniqueUploadFileNames(['image.png'], ['image.png', 'image-1.png', 'image-2.png'])).toEqual([
			'image-3.png',
		])
	})

	test('adds the number after an extensionless name', () => {
		expect(createUniqueUploadFileNames(['image'], ['image'])).toEqual(['image-1'])
	})

	test('treats a leading dot as part of an extensionless name', () => {
		expect(createUniqueUploadFileNames(['.image'], ['.image'])).toEqual(['.image-1'])
	})
})
