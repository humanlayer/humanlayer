import type { ArtifactFlow, SessionStatus, WorkflowSession } from './types'

export interface MockWorkflowData {
  sessions: WorkflowSession[]
  artifactFlows: ArtifactFlow[]
}

function session(
  id: string,
  labelName: string,
  labelTitle: string,
  status: SessionStatus,
  title?: string,
  artifacts: WorkflowSession['artifacts'] = [],
): WorkflowSession {
  return { id, labelName, labelTitle, status, title, artifacts }
}

/** Empty task — all phases are placeholders, no sessions yet */
export function createEmptyTaskData(): MockWorkflowData {
  return {
    sessions: [],
    artifactFlows: [],
  }
}

/** Mid-workflow — research through structure done, plan actively running */
export function createMidWorkflowData(): MockWorkflowData {
  return {
    sessions: [
      session('s-rq-1', 'rpi:research-questions', 'research-questions', 'ready_for_input',
        'Generate research questions', [
          { fileName: '01-research-questions.md', category: 'new' },
        ]),
      session('s-r-1', 'rpi:research', 'research', 'ready_for_input',
        'Initial codebase research', [
          { fileName: '01-research-questions.md', category: 'source' },
          { fileName: '02-research.md', category: 'new' },
        ]),
      session('s-r-2', 'rpi:research', 'research', 'ready_for_input',
        'Deep-dive into artifact system', [
          { fileName: '02-research.md', category: 'edited' },
        ]),
      session('s-d-1', 'rpi:design', 'design', 'ready_for_input',
        'Design discussion', [
          { fileName: '02-research.md', category: 'source' },
          { fileName: '03-design-discussion.md', category: 'new' },
        ]),
      session('s-st-1', 'rpi:structure', 'structure', 'ready_for_input',
        'Create structure outline', [
          { fileName: '03-design-discussion.md', category: 'source' },
          { fileName: '04-structure-outline.md', category: 'new' },
        ]),
      session('s-p-1', 'rpi:plan', 'plan', 'running',
        'Create implementation plan', [
          { fileName: '04-structure-outline.md', category: 'source' },
        ]),
    ],
    artifactFlows: [
      { fromSessionId: 's-rq-1', toSessionId: 's-r-1', fileName: '01-research-questions.md', category: 'source' },
      { fromSessionId: 's-r-1', toSessionId: 's-r-2', fileName: '02-research.md', category: 'edited' },
      { fromSessionId: 's-r-1', toSessionId: 's-d-1', fileName: '02-research.md', category: 'source' },
      { fromSessionId: 's-d-1', toSessionId: 's-st-1', fileName: '03-design-discussion.md', category: 'source' },
      { fromSessionId: 's-st-1', toSessionId: 's-p-1', fileName: '04-structure-outline.md', category: 'source' },
    ],
  }
}

/** Completed task — all phases done, full artifact trail */
export function createCompletedTaskData(): MockWorkflowData {
  return {
    sessions: [
      session('s-rq-1', 'rpi:research-questions', 'research-questions', 'ready_for_input',
        'Generate research questions', [
          { fileName: '01-research-questions.md', category: 'new' },
        ]),
      session('s-r-1', 'rpi:research', 'research', 'ready_for_input',
        'Initial codebase research', [
          { fileName: '01-research-questions.md', category: 'source' },
          { fileName: '02-research.md', category: 'new' },
        ]),
      session('s-r-2', 'rpi:research', 'research', 'ready_for_input',
        'Deep-dive into artifact system', [
          { fileName: '02-research.md', category: 'edited' },
        ]),
      session('s-d-1', 'rpi:design', 'design', 'ready_for_input',
        'Design discussion', [
          { fileName: '02-research.md', category: 'source' },
          { fileName: '03-design-discussion.md', category: 'new' },
        ]),
      session('s-st-1', 'rpi:structure', 'structure', 'ready_for_input',
        'Create structure outline', [
          { fileName: '03-design-discussion.md', category: 'source' },
          { fileName: '04-structure-outline.md', category: 'new' },
        ]),
      session('s-p-1', 'rpi:plan', 'plan', 'ready_for_input',
        'Create implementation plan', [
          { fileName: '04-structure-outline.md', category: 'source' },
          { fileName: '05-plan.md', category: 'new' },
        ]),
      session('s-p-2', 'rpi:plan', 'plan', 'ready_for_input',
        'Iterate on plan', [
          { fileName: '05-plan.md', category: 'edited' },
        ]),
      session('s-wt-1', 'rpi:worktree-setup', 'worktree-setup', 'ready_for_input',
        'Set up worktree'),
      session('s-i-1', 'rpi:implementation', 'implementation', 'ready_for_input',
        'Implement phase 1-3', [
          { fileName: '05-plan.md', category: 'source' },
        ]),
      session('s-i-2', 'rpi:implementation', 'implementation', 'ready_for_input',
        'Implement phase 4', [
          { fileName: '05-plan.md', category: 'source' },
        ]),
      session('s-i-3', 'rpi:implementation', 'implementation', 'ready_for_input',
        'Implement phase 5'),
      session('s-pr-1', 'rpi:describe-pr', 'describe-pr', 'ready_for_input',
        'Generate PR description'),
    ],
    artifactFlows: [
      { fromSessionId: 's-rq-1', toSessionId: 's-r-1', fileName: '01-research-questions.md', category: 'source' },
      { fromSessionId: 's-r-1', toSessionId: 's-r-2', fileName: '02-research.md', category: 'edited' },
      { fromSessionId: 's-r-1', toSessionId: 's-d-1', fileName: '02-research.md', category: 'source' },
      { fromSessionId: 's-d-1', toSessionId: 's-st-1', fileName: '03-design-discussion.md', category: 'source' },
      { fromSessionId: 's-st-1', toSessionId: 's-p-1', fileName: '04-structure-outline.md', category: 'source' },
      { fromSessionId: 's-p-1', toSessionId: 's-p-2', fileName: '05-plan.md', category: 'edited' },
      { fromSessionId: 's-p-1', toSessionId: 's-i-1', fileName: '05-plan.md', category: 'source' },
      { fromSessionId: 's-p-1', toSessionId: 's-i-2', fileName: '05-plan.md', category: 'source' },
    ],
  }
}

/** Failed task — implementation failed after 2 attempts */
export function createFailedTaskData(): MockWorkflowData {
  return {
    sessions: [
      session('s-rq-1', 'rpi:research-questions', 'research-questions', 'ready_for_input',
        'Generate research questions', [
          { fileName: '01-research-questions.md', category: 'new' },
        ]),
      session('s-r-1', 'rpi:research', 'research', 'ready_for_input',
        'Codebase research', [
          { fileName: '01-research-questions.md', category: 'source' },
          { fileName: '02-research.md', category: 'new' },
        ]),
      session('s-d-1', 'rpi:design', 'design', 'ready_for_input',
        'Design discussion', [
          { fileName: '02-research.md', category: 'source' },
          { fileName: '03-design-discussion.md', category: 'new' },
        ]),
      session('s-st-1', 'rpi:structure', 'structure', 'ready_for_input',
        'Create structure outline', [
          { fileName: '03-design-discussion.md', category: 'source' },
          { fileName: '04-structure-outline.md', category: 'new' },
        ]),
      session('s-p-1', 'rpi:plan', 'plan', 'ready_for_input',
        'Create implementation plan', [
          { fileName: '04-structure-outline.md', category: 'source' },
          { fileName: '05-plan.md', category: 'new' },
        ]),
      session('s-wt-1', 'rpi:worktree-setup', 'worktree-setup', 'ready_for_input',
        'Set up worktree'),
      session('s-i-1', 'rpi:implementation', 'implementation', 'failed',
        'Implement phase 1 (failed)', [
          { fileName: '05-plan.md', category: 'source' },
        ]),
      session('s-i-2', 'rpi:implementation', 'implementation', 'failed',
        'Retry implementation (failed)', [
          { fileName: '05-plan.md', category: 'source' },
        ]),
    ],
    artifactFlows: [
      { fromSessionId: 's-rq-1', toSessionId: 's-r-1', fileName: '01-research-questions.md', category: 'source' },
      { fromSessionId: 's-r-1', toSessionId: 's-d-1', fileName: '02-research.md', category: 'source' },
      { fromSessionId: 's-d-1', toSessionId: 's-st-1', fileName: '03-design-discussion.md', category: 'source' },
      { fromSessionId: 's-st-1', toSessionId: 's-p-1', fileName: '04-structure-outline.md', category: 'source' },
      { fromSessionId: 's-p-1', toSessionId: 's-i-1', fileName: '05-plan.md', category: 'source' },
      { fromSessionId: 's-p-1', toSessionId: 's-i-2', fileName: '05-plan.md', category: 'source' },
    ],
  }
}

/** Waiting for input — design session is waiting for human review */
export function createWaitingForInputData(): MockWorkflowData {
  return {
    sessions: [
      session('s-rq-1', 'rpi:research-questions', 'research-questions', 'ready_for_input',
        'Generate research questions', [
          { fileName: '01-research-questions.md', category: 'new' },
        ]),
      session('s-r-1', 'rpi:research', 'research', 'ready_for_input',
        'Codebase research', [
          { fileName: '01-research-questions.md', category: 'source' },
          { fileName: '02-research.md', category: 'new' },
        ]),
      session('s-d-1', 'rpi:design', 'design', 'ready_for_input',
        'Design discussion — awaiting review', [
          { fileName: '02-research.md', category: 'source' },
          { fileName: '03-design-discussion.md', category: 'new' },
        ]),
    ],
    artifactFlows: [
      { fromSessionId: 's-rq-1', toSessionId: 's-r-1', fileName: '01-research-questions.md', category: 'source' },
      { fromSessionId: 's-r-1', toSessionId: 's-d-1', fileName: '02-research.md', category: 'source' },
    ],
  }
}
