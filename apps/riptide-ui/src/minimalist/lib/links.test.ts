import { describe, expect, it } from 'vitest'

import { linkTarget } from '@/minimalist/lib/links'

const origins = { app: ['https://app.example.com', 'tauri://localhost'], cloud: 'https://cloud.example.com' }
const id = '01a0e453-1a60-7bea-a47d-3a3d43fbb912'

describe('linkTarget', () => {
	it('opens a document page or share link as a document', () => {
		expect(linkTarget(`https://cloud.example.com/artifacts/${id}`, origins)).toEqual({
			kind: 'document',
			artifactId: id,
			href: `https://cloud.example.com/artifacts/${id}`,
		})
		expect(linkTarget(`https://app.example.com/shared/artifacts/${id}?key=k`, origins)).toMatchObject({
			kind: 'document',
			artifactId: id,
		})
	})

	it('keeps the comment a document link names', () => {
		expect(linkTarget(`https://cloud.example.com/artifacts/${id}?commentId=c1`, origins)).toMatchObject({
			kind: 'document',
			commentId: 'c1',
		})
		expect(linkTarget(`https://cloud.example.com/artifacts/${id}?comment=c2`, origins)).toMatchObject({
			commentId: 'c2',
		})
	})

	it('leaves a link to a place in the page, like a footnote, alone', () => {
		expect(linkTarget('#user-content-fn-1', origins)).toEqual({ kind: 'anchor', href: '#user-content-fn-1' })
	})

	it('keeps links to this app in the app, from either origin or a bare path', () => {
		expect(linkTarget('https://app.example.com/tasks/t1?artifactId=a1#x', origins)).toEqual({
			kind: 'app',
			path: '/tasks/t1?artifactId=a1#x',
		})
		expect(linkTarget('tauri://localhost/pull-requests', origins)).toEqual({ kind: 'app', path: '/pull-requests' })
		expect(linkTarget('/settings', origins)).toEqual({ kind: 'app', path: '/settings' })
	})

	it('sends other sites to a new tab', () => {
		expect(linkTarget('https://github.com/acme/app/pull/1', origins)).toEqual({
			kind: 'external',
			href: 'https://github.com/acme/app/pull/1',
		})
		expect(linkTarget(`https://cloud.example.com/settings`, origins).kind).toBe('external')
		expect(linkTarget('mailto:ada@example.com', origins).kind).toBe('external')
	})

	it('leaves file paths and unknown schemes unlinked', () => {
		expect(linkTarget('src/app.ts', origins)).toEqual({ kind: 'none' })
		expect(linkTarget('./README.md#setup', origins)).toEqual({ kind: 'none' })
		expect(linkTarget('javascript:alert(1)', origins)).toEqual({ kind: 'none' })
	})
})
