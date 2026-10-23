import type { Meta, StoryObj } from '@storybook/react'

import { SingleFileDiffPanel } from '../../src/components/diff-review/single-file-diff-panel'

const modifiedPatch = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,4 @@
 export function greet(name: string) {
-  return name
+  const greeting = \`Hello, \${name}\`
+  return greeting
 }
`

const addedPatch = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,2 @@
+export const enabled = true
+
`

const deletedPatch = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
--- a/src/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const legacy = true
-
`

const renamedPatch = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 70%
rename from src/old-name.ts
rename to src/new-name.ts
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1 +1 @@
-export const name = 'old'
+export const name = 'new'
`

const meta = {
	title: 'Components/Diff Review/Single File Diff Panel',
	component: SingleFileDiffPanel,
	parameters: { layout: 'fullscreen' },
	decorators: [(Story) => <div className="flex h-screen flex-col"><Story /></div>],
} satisfies Meta<typeof SingleFileDiffPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Modified: Story = { args: { fileName: 'src/example.ts', patch: modifiedPatch } }
export const Added: Story = { args: { fileName: 'src/new-file.ts', patch: addedPatch } }
export const Deleted: Story = { args: { fileName: 'src/old-file.ts', patch: deletedPatch } }
export const Renamed: Story = { args: { fileName: 'src/new-name.ts', patch: renamedPatch } }
export const Binary: Story = { args: { fileName: 'assets/logo.png', binary: true } }
export const PatchPending: Story = { args: { fileName: 'src/pending.ts', loading: true } }
