import { describe, expect, test } from 'vitest'

import { parseApplyPatch } from './apply-patch-parser'

describe('parseApplyPatch', () => {
	test('parses Add, Update, Delete, and Move operations', () => {
		const operations = parseApplyPatch(`*** Begin Patch
*** Add File: docs/new.md
+new content
*** Update File: docs/update.md
@@ heading
-before
+after
*** Delete File: docs/delete.md
*** Update File: docs/old.md
*** Move to: docs/moved.md
@@
 unchanged
*** End Patch`)

		expect(operations).toMatchObject([
			{ type: 'add', filePath: 'docs/new.md', content: 'new content' },
			{ type: 'update', filePath: 'docs/update.md' },
			{ type: 'delete', filePath: 'docs/delete.md' },
			{ type: 'move', filePath: 'docs/old.md', targetPath: 'docs/moved.md' },
		])
	})
})
