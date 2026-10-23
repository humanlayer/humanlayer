import { describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import {
	commentContainsExactGitHubTaskMarker,
	githubTaskMarker,
	renderGitHubArtifactBacklink,
} from '../../src/effects/services/github/github.backlink'

describe('GitHub artifact backlink', () => {
	it.effect('matches only an exact marker line', () =>
		Effect.sync(() => {
			const taskId = '019f536c-b021-763a-84b2-bbd8ee8e2913'
			expect(commentContainsExactGitHubTaskMarker(`hello\n${githubTaskMarker(taskId)}`, taskId)).toBe(true)
			expect(commentContainsExactGitHubTaskMarker(`hello ${githubTaskMarker(taskId)}`, taskId)).toBe(false)
			expect(commentContainsExactGitHubTaskMarker(`<!-- humanlayer-task:${taskId}-other -->`, taskId)).toBe(false)
			expect(commentContainsExactGitHubTaskMarker(null, taskId)).toBe(false)
		}),
	)

	it.effect('renders a deterministic complete artifact set with encoded cloud links', () =>
		Effect.sync(() => {
			const body = renderGitHubArtifactBacklink({
				taskId: '019f536c-b021-763a-84b2-bbd8ee8e2913',
				cloudOrigin: 'https://cloud.example.test/',
				artifacts: [
					{ id: 'artifact-1', fileName: '01-research.md' },
					{ id: 'artifact/2', fileName: 'technical-design.md' },
				],
			})

			expect(body).toBe(
				[
					'This issue is being worked on in HumanLayer.',
					'Artifacts:\n- [01 Research](https://cloud.example.test/artifacts/artifact-1)\n- [Technical Design](https://cloud.example.test/artifacts/artifact%2F2)',
					'<!-- humanlayer-task:019f536c-b021-763a-84b2-bbd8ee8e2913 -->',
				].join('\n\n'),
			)
		}),
	)
})
