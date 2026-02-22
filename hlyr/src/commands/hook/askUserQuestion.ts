import { DaemonClient } from '../../daemonClient.js'
import { resolveFullConfig } from '../../config.js'

interface HookInput {
  session_id: string
  tool_name: string
  tool_input: {
    questions: Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiSelect: boolean
    }>
  }
  tool_use_id: string
}

export async function hookAskUserQuestionCommand(): Promise<void> {
  // Read hld session ID from env (set by hld on the Claude Code process)
  const hldSessionId = process.env.HUMANLAYER_SESSION_ID
  if (!hldSessionId) {
    // Daemon not managing this session — fall through silently
    process.exit(0)
  }

  try {
    const input = await readStdin()
    const hookInput: HookInput = JSON.parse(input)

    const { tool_input: toolInput, tool_use_id: toolUseId } = hookInput

    if (!toolInput?.questions || !toolUseId) {
      writeOutput(makeErrorOutput('Missing required fields: tool_input.questions, tool_use_id'))
      process.exit(0)
    }

    // Connect to daemon
    const resolvedConfig = resolveFullConfig({})
    const socketPath = process.env.HUMANLAYER_DAEMON_SOCKET || resolvedConfig.daemon_socket
    const daemonClient = new DaemonClient(socketPath)
    await daemonClient.connect()

    try {
      // Create question in hld (with tool_use_id directly, using hld's session ID)
      const createResponse = await daemonClient.createQuestion(
        hldSessionId,
        { questions: toolInput.questions },
        toolUseId,
      )
      const questionId = createResponse.question_id

      // Poll for answer (timeout after 30 minutes)
      const maxPollDurationMs = 30 * 60 * 1000
      const pollStartTime = Date.now()

      while (Date.now() - pollStartTime < maxPollDurationMs) {
        const resp = await daemonClient.getQuestion(questionId)
        const q = resp.question

        if (q.status === 'declined') {
          writeOutput({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'User declined to answer the question',
            },
          })
          return
        }

        if (q.status !== 'pending') {
          writeOutput({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'allow',
              updatedInput: {
                questions: toolInput.questions,
                answers: q.answers_json as Record<string, unknown>,
              },
            },
          })
          return
        }

        await new Promise(resolve => setTimeout(resolve, 1000))
      }

      writeOutput(makeErrorOutput('Question polling timed out after 30 minutes'))
    } finally {
      daemonClient.close()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeOutput(makeErrorOutput(`Hook error: ${message}`))
  }

  process.exit(0)
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function writeOutput(output: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(output) + '\n')
}

function makeErrorOutput(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: reason,
    },
  }
}
