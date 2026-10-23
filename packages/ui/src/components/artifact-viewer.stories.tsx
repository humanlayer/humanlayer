import type { Meta, StoryObj } from '@storybook/react'
import { useRef, useState } from 'react'
import { fn } from 'storybook/test'
import { ArtifactCommentPanelDemo } from '../../storybook/artifact-comment-panel'
import { ArtifactViewer } from './artifact-viewer'
import { designDiscussionMarkdown } from './artifact-viewer/mock-data'
import {
	createMockComment,
	mockUsers,
	resolvedComment,
	spanlessComment,
} from './__stories__/comment-fixtures'
import {
  type ArtifactCommentPanelHandle,
  useCommentThreads,
} from './artifact-comment-panel'
import { ArtifactRaw } from './artifact-raw'
import { GeneralCommentSection } from './general-comment-section'

const userLookup = new Map(
	Object.values(mockUsers).map((u) => [u.userId, { displayName: u.displayName, avatarUrl: u.avatarUrl }]),
)

const meta: Meta<typeof ArtifactViewer> = {
  title: 'Shell Demos/ArtifactViewer',
  component: ArtifactViewer,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div style={{ width: '80%', margin: '2rem auto' }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof ArtifactViewer>

export const WiderRenderedView: Story = {
  args: {
    content: designDiscussionMarkdown,
    fileName: '03-design-discussion-feature-name.md',
    defaultView: 'rendered',
  },
}

export const WiderRawView: Story = {
  args: {
    content: designDiscussionMarkdown,
    fileName: '03-design-discussion-feature-name.md',
    defaultView: 'raw',
  },
}

export const NonMarkdownFile: Story = {
  args: {
    content: `function hello() {\n  console.log('Hello!')\n}`,
    fileName: 'hello.ts',
  },
}

export const RenderedJson: Story = {
  args: {
    content: JSON.stringify({ task: 'artifact-viewer', enabled: true, limits: { nodes: 50000 } }, null, 2),
    fileName: 'viewer-config.json',
    defaultView: 'rendered',
  },
}

export const InvalidJsonFallback: Story = {
  args: { content: '{ "enabled": yes }\n', fileName: 'broken.json', defaultView: 'rendered' },
}

export const RenderedJsonlMixedRecords: Story = {
  args: {
    content: '{"event":"created","id":1}\ninvalid record\n\n{"event":"finished","id":1}\n',
    fileName: 'events.jsonl',
    defaultView: 'rendered',
  },
}

export const RawJsonlExactSource: Story = {
  args: {
    content: '{ "event": "spaced" }\n\n',
    fileName: 'events.jsonl',
    defaultView: 'raw',
  },
}

export const NoFileName: Story = {
  args: {
    content: '# Some Content\n\nWithout a filename.',
  },
}

const sampleCode = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}

export function processItems(items: string[]): string[] {
  return items.map(greet)
}

// Entry point
export { greet }`

const resolvedInlineComment = {
  ...resolvedComment,
  id: 'resolved-inline-comment',
  commented_upon_block_text: 'function greet(name: string): string {',
  previous_block_text: null,
  next_block_text: 'return `Hello, ${name}!`',
}

// Inline comments targeting actual lines in the designDiscussionMarkdown:
// Content line 9  = "### Summary of change request" (h3 heading)
// Content line 17 = "### Current State" (h3 heading)
const mdInlineComment1 = createMockComment({
  highlighted_text: '### Summary of change request',
  highlighted_text_line_number: 9,
  highlighted_text_has_match_in_current_artifact: true,
  content_text: 'This heading could be more descriptive.',
  created_by_user_id: 'user_abc1',
})

const mdInlineComment2 = createMockComment({
  highlighted_text: '### Current State',
  highlighted_text_line_number: 17,
  highlighted_text_has_match_in_current_artifact: true,
  content_text: 'Should we update this section after the refactor?',
  created_by_user_id: 'user_abc2',
})

const generalComment2 = createMockComment({
  content_text: 'Can we add better error handling for the edge cases discussed in standup?',
  created_by_user_id: 'user_abc3',
})

/** Helper component that renders general comments below the artifact */
function GeneralCommentsBelow({ comments }: { comments: Parameters<typeof useCommentThreads>[0] }) {
  const { generalThreads } = useCommentThreads(comments)
  return (
    <div className="mt-4">
      <GeneralCommentSection
        threads={generalThreads}
        onReply={fn()}
        onDelete={fn()}
        onResolve={fn()}
        onCreateComment={fn()}
        currentUserId="user_abc1"
        userLookup={userLookup}
      />
    </div>
  )
}

export const FullscreenWithComments: Story = {
  render: () => {
    const [tabValue, setTabValue] = useState<'rendered' | 'raw'>('rendered')
    const panelRef = useRef<ArtifactCommentPanelHandle>(null)
    const allComments = [mdInlineComment1, mdInlineComment2, spanlessComment, generalComment2]
    return (
      <div className="flex gap-4 h-[700px]">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <ArtifactViewer
            content={designDiscussionMarkdown}
            fileName="03-design-discussion-feature-name.md"
            tabValue={tabValue}
            onTabValueChange={setTabValue}
            commentedLines={new Map([
              [9, [mockUsers.user1]],
              [17, [mockUsers.user2]],
            ])}
            onLineClick={(line) => panelRef.current?.focusThread(line)}
          />
          <GeneralCommentsBelow comments={allComments} />
        </div>
        <div className="w-80 overflow-y-auto pl-4">
          <ArtifactCommentPanelDemo
            ref={panelRef}
            comments={allComments}
            computedLineNumbers={new Map([[mdInlineComment1.id, 9], [mdInlineComment2.id, 17]])}
            linePositions={new Map([[9, 100], [17, 300]])}
          />
        </div>
      </div>
    )
  },
}

export const PreviewWithHighlights: Story = {
  render: () => (
    <div className="w-full">
      <ArtifactRaw
        content={sampleCode}
        fileName="utils.ts"
        commentedLines={new Map([
          [1, [mockUsers.user1]],
          [5, [mockUsers.user1, mockUsers.user2]],
          [9, [mockUsers.user3]],
        ])}
        searchQuery="render"
        searchCurrentMatch={{ line: 1, occurrence: 0, charIndex: 16 }}
      />
    </div>
  ),
}

export const RawTabWithSearch: Story = {
  render: () => (
    <div className="w-full">
      <ArtifactRaw
        content={sampleCode}
        fileName="utils.ts"
        searchQuery="function"
        searchCurrentMatch={{ line: 1, occurrence: 0, charIndex: 0 }}
      />
    </div>
  ),
}

export const WithResolvedComments: Story = {
  render: () => {
    const panelRef = useRef<ArtifactCommentPanelHandle>(null)
    return (
      <div className="flex gap-4 h-[600px]">
        <div className="flex-1 min-w-0">
          <ArtifactRaw
            content={sampleCode}
            fileName="utils.ts"
            commentedLines={new Map([[1, [mockUsers.user1]]])}
            onLineClick={(line) => panelRef.current?.focusThread(line)}
          />
        </div>
        <div className="w-80 overflow-y-auto pl-4">
          <ArtifactCommentPanelDemo
            ref={panelRef}
            comments={[resolvedInlineComment]}
            computedLineNumbers={new Map([[resolvedInlineComment.id, 1]])}
            linePositions={new Map([[1, 80]])}
          />
        </div>
      </div>
    )
  },
}

export const MarkdownWithComments: Story = {
  render: () => {
    const [tabValue, setTabValue] = useState<'rendered' | 'raw'>('rendered')
    const panelRef = useRef<ArtifactCommentPanelHandle>(null)
    const allComments = [mdInlineComment1, spanlessComment, generalComment2]
    return (
      <div className="flex gap-4 h-[700px]">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <ArtifactViewer
            content={designDiscussionMarkdown}
            fileName="03-design-discussion-feature-name.md"
            tabValue={tabValue}
            onTabValueChange={setTabValue}
            commentedLines={new Map([
              [9, [mockUsers.user1]],
            ])}
            onLineClick={(line) => panelRef.current?.focusThread(line)}
          />
          <GeneralCommentsBelow comments={allComments} />
        </div>
        <div className="w-80 overflow-y-auto pl-4">
          <ArtifactCommentPanelDemo
            ref={panelRef}
            comments={allComments}
            computedLineNumbers={new Map([[mdInlineComment1.id, 9]])}
            linePositions={new Map([[9, 100]])}
          />
        </div>
      </div>
    )
  },
}
