import { describe, expect, test } from 'vitest'

import {
	collectRelativeAssetReferences,
	isRelativeAssetReference,
	resolveArtifactSubpath,
	rewriteRelativeAssets,
} from './html-artifact-assets'

const MOCKUP = `<!doctype html>
<html>
<head>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono" rel="stylesheet">
<link rel="stylesheet" href="mockup-base.css">
<link rel='stylesheet' href='./mockup-today.css'>
<link rel="icon" href="favicon.png">
<link rel="icon" href="data:image/png;base64,AAAA">
</head>
<body>
<img src="shots/current.png" alt="">
<a href="other.html">next</a>
<script src="mockup-shared.js"></script>
<script type="module" src="mockup-module.js" defer></script>
<script src="/absolute.js"></script>
<script src="#"></script>
</body>
</html>`

const resolveEverything = async (reference: string) => `https://bucket.test/${reference}?sig=a&b=c`
const noText = async () => null

describe('isRelativeAssetReference', () => {
	test.each(['mockup-base.css', './a.js', '../b.png', 'dir/c.css?v=1'])('accepts %s', (reference) => {
		expect(isRelativeAssetReference(reference)).toBe(true)
	})

	test.each(['https://x.test/a.css', 'data:text/plain,hi', 'blob:abc', '/root.js', '#top', '', 'mailto:a@b.c'])(
		'rejects %s',
		(reference) => {
			expect(isRelativeAssetReference(reference)).toBe(false)
		},
	)
})

describe('collectRelativeAssetReferences', () => {
	test('finds relative references on link, script and img but not anchors or absolute URLs', () => {
		expect(collectRelativeAssetReferences(MOCKUP)).toEqual([
			'mockup-base.css',
			'./mockup-today.css',
			'favicon.png',
			'shots/current.png',
			'mockup-shared.js',
			'mockup-module.js',
		])
	})
})

describe('resolveArtifactSubpath', () => {
	test('resolves against the directory of the source artifact', () => {
		expect(resolveArtifactSubpath('mockup-a.html', 'mockup-base.css')).toBe('mockup-base.css')
		expect(resolveArtifactSubpath('mockups/a.html', './shared.js')).toBe('mockups/shared.js')
		expect(resolveArtifactSubpath('mockups/a.html', '../shots/x.png')).toBe('shots/x.png')
		expect(resolveArtifactSubpath('a.html', 'style.css?v=2#frag')).toBe('style.css')
		expect(resolveArtifactSubpath('a.html', 'my%20file.css')).toBe('my file.css')
	})

	test('rejects paths that escape the task root', () => {
		expect(resolveArtifactSubpath('a.html', '../outside.css')).toBeNull()
		expect(resolveArtifactSubpath('a.html', '')).toBeNull()
	})
})

describe('rewriteRelativeAssets', () => {
	test('inlines stylesheets and scripts and re-points other assets at their URLs', async () => {
		const texts: Record<string, string> = {
			'mockup-base.css': 'body { color: red } /* </style> */',
			'./mockup-today.css': '.today { margin: 0 }',
			'mockup-shared.js': 'console.log("</script>")',
			'mockup-module.js': 'export const x = 1',
		}
		const result = await rewriteRelativeAssets(
			MOCKUP,
			resolveEverything,
			async (url) => texts[decodeURIComponent(url.replace('https://bucket.test/', '').replace('?sig=a&b=c', ''))] ?? null,
		)

		expect(result.rewrittenCount).toBe(6)
		expect(result.unresolved).toEqual([])
		expect(result.html).toContain('<style>body { color: red } /* <\\/style> */</style>')
		expect(result.html).toContain('<style>.today { margin: 0 }</style>')
		expect(result.html).toContain('<script>console.log("<\\/script>")</script>')
		expect(result.html).toContain('<script type="module" defer>export const x = 1</script>')
		expect(result.html).toContain('<link rel="icon" href="https://bucket.test/favicon.png?sig=a&amp;b=c">')
		expect(result.html).toContain('<img src="https://bucket.test/shots/current.png?sig=a&amp;b=c" alt="">')
		expect(result.html).not.toContain('href="mockup-base.css"')
		expect(result.html).toContain('href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono"')
		expect(result.html).toContain('<a href="other.html">')
		expect(result.html).toContain('src="/absolute.js"')
	})

	test('falls back to the resolved URL when the asset text cannot be fetched', async () => {
		const result = await rewriteRelativeAssets('<link rel="stylesheet" href="a.css">', resolveEverything, noText)
		expect(result.html).toBe('<link rel="stylesheet" href="https://bucket.test/a.css?sig=a&amp;b=c">')
	})

	test('only rewrites references the resolver knows and reports the rest', async () => {
		const result = await rewriteRelativeAssets(
			MOCKUP,
			async (reference) => (reference.endsWith('.png') ? `https://bucket.test/${reference}` : null),
			noText,
		)
		expect(result.rewrittenCount).toBe(2)
		expect(result.unresolved).toEqual(
			expect.arrayContaining(['mockup-base.css', './mockup-today.css', 'mockup-shared.js', 'mockup-module.js']),
		)
		expect(result.html).toContain('<script src="mockup-shared.js">')
	})

	test('returns the original document untouched when nothing resolves', async () => {
		const result = await rewriteRelativeAssets(MOCKUP, async () => null, noText)
		expect(result.html).toBe(MOCKUP)
		expect(result.rewrittenCount).toBe(0)
	})

	test('treats a rejected resolver as unresolved', async () => {
		const result = await rewriteRelativeAssets(
			'<script src="a.js"></script>',
			async () => {
				throw new Error('offline')
			},
			noText,
		)
		expect(result.rewrittenCount).toBe(0)
		expect(result.unresolved).toEqual(['a.js'])
	})
})
