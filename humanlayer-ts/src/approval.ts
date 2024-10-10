import crypto from 'crypto'
import { AgentBackend, HumanLayerException } from './protocol'
import { ContactChannel } from './models'
import { CloudHumanLayerBackend, HumanLayerCloudConnection } from './cloud'
import { logger } from './logger'
import { type } from 'node:os'

export enum ApprovalMethod {
  cli = 'cli',
  backend = 'backend',
}

/**
 * sure this'll work for now
 */
export const defaultGenid = (prefix: string) => {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export class HumanLayer {
  approvalMethod: ApprovalMethod
  backend?: AgentBackend
  runId: string
  agentName: string
  genid: (prefix: string) => string
  sleep: (ms: number) => Promise<void>
  contactChannel?: ContactChannel
  verbose?: boolean

  constructor(params?: {
    runId?: string
    approvalMethod?: ApprovalMethod
    backend?: AgentBackend
    agentName?: string
    genid?: (prefix: string) => string
    sleep?: (ms: number) => Promise<void>
    contactChannel?: ContactChannel
    apiKey?: string
    apiBaseUrl?: string
    verbose?: boolean
  }) {
    const {
      runId,
      approvalMethod,
      backend,
      agentName,
      genid = defaultGenid,
      sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
      contactChannel,
      apiKey,
      apiBaseUrl,
      verbose = false,
    } = params || {}
    this.genid = genid
    this.sleep = sleep
    this.verbose = verbose
    this.contactChannel = contactChannel

    // Determine approval method based on environment variables or provided arguments
    const envApprovalMethod = process.env.HUMANLAYER_APPROVAL_METHOD as keyof typeof ApprovalMethod

    if (!approvalMethod && envApprovalMethod && !(envApprovalMethod in ApprovalMethod)) {
      throw new HumanLayerException(`Invalid HUMANLAYER_APPROVAL_METHOD: ${envApprovalMethod}`)
    }
    if (!approvalMethod && envApprovalMethod && envApprovalMethod in ApprovalMethod) {
      this.approvalMethod = ApprovalMethod[envApprovalMethod]
    } else if (!approvalMethod) {
      this.approvalMethod =
        backend || apiKey || process.env.HUMANLAYER_API_KEY
          ? ApprovalMethod.backend
          : ApprovalMethod.cli
    } else {
      this.approvalMethod = approvalMethod
    }

    // Initialize backend if approval method is backend
    if (this.approvalMethod === ApprovalMethod.backend) {
      this.backend =
        backend ||
        new CloudHumanLayerBackend(
          new HumanLayerCloudConnection(
            apiKey || process.env.HUMANLAYER_API_KEY,
            apiBaseUrl || process.env.HUMANLAYER_API_BASE,
          ),
        )
    }

    this.agentName = agentName || 'agent'
    this.genid = genid || defaultGenid
    this.runId = runId || this.genid(this.agentName)
  }

  static cloud(params?: {
    connection?: HumanLayerCloudConnection
    apiKey?: string
    apiBaseUrl?: string
  }): HumanLayer {
    let { connection, apiKey, apiBaseUrl } = params || {}

    if (!connection) {
      connection = new HumanLayerCloudConnection(apiKey, apiBaseUrl)
    }
    return new HumanLayer({
      approvalMethod: ApprovalMethod.backend,
      backend: new CloudHumanLayerBackend(connection),
    })
  }

  static cli(): HumanLayer {
    return new HumanLayer({
      approvalMethod: ApprovalMethod.cli,
    })
  }

  requireApproval<TFn extends Function>(contactChannel?: ContactChannel): (fn: TFn) => TFn {
    return (fn: TFn) => {
      if (this.approvalMethod === ApprovalMethod.cli) {
        return this.approveCli(fn)
      }

      return this.approveWithBackend(fn, contactChannel)
    }
  }

  approveCli<TFn extends Function>(fn: TFn): TFn {
    const name = fn.name
    // todo fix the types here
    const f: any = async (kwargs: any) => {
      console.log(`Agent ${this.runId} wants to call

${fn.name}(${JSON.stringify(kwargs, null, 2)})

${kwargs.length ? ' with args: ' + JSON.stringify(kwargs, null, 2) : ''}`)
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const feedback = await new Promise(resolve => {
        readline.question(
          'Hit ENTER to proceed, or provide feedback to the agent to deny: \n\n',
          (answer: string) => {
            readline.close()
            resolve(answer)
          },
        )
      })
      if (feedback !== null && feedback !== '') {
        return `User denied ${fn.name} with feedback: ${feedback}`
      }
      try {
        return await fn(kwargs)
      } catch (e) {
        return `Error running ${fn.name}: ${e}`
      }
    }
    Object.defineProperty(f, 'name', { value: name, writable: false })
    return f
  }

  approveWithBackend<TFn extends Function>(fn: TFn, contactChannel?: ContactChannel): TFn {
    const channel = contactChannel || this.contactChannel
    const name = fn.name
    // todo fix the types here
    const f: any = async (kwargs: any) => {
      const backend = this.backend!
      const callId = this.genid('call')
      await backend.functions().add({
        run_id: this.runId,
        call_id: callId,
        spec: {
          fn: fn.name,
          kwargs: kwargs,
          channel: channel,
        },
      })
      if (this.verbose) {
        console.log(`HumanLayer: Requested approval for function ${name}`)
      }
      while (true) {
        await this.sleep(3000)
        const functionCall = await backend.functions().get(callId)
        if (
          functionCall.status?.approved === null ||
          typeof functionCall.status?.approved === 'undefined'
        ) {
          continue
        }

        if (functionCall.status?.approved) {
          if (this.verbose) {
            console.log(`HumanLayer: User approved function ${functionCall.spec.fn}`)
          }
          return fn(kwargs)
        } else {
          return `User denied function ${functionCall.spec.fn} with comment: ${functionCall.status?.comment}`
        }
      }
    }
    Object.defineProperty(f, 'name', { value: name, writable: false })
    return f
  }

  humanAsTool(contactChannel?: ContactChannel): ({ message }: { message: string }) => Promise<string> {
    if (this.approvalMethod === ApprovalMethod.cli) {
      return this.humanAsToolCli()
    }

    return this.humanAsToolBackend(contactChannel)
  }

  humanAsToolCli(): ({ message }: { message: string }) => Promise<string> {
    return async ({ message }: { message: string }) => {
      console.log(`Agent ${this.runId} requests assistance:

      ${message}
      `)
      const feedback = prompt('Please enter a response: \n\n')

      return feedback || ''
    }
  }

  humanAsToolBackend(
    contactChannel?: ContactChannel,
  ): ({ message }: { message: string }) => Promise<string> {
    const channel = contactChannel || this.contactChannel
    return async ({ message }: { message: string }) => {
      const backend = this.backend!
      const callId = this.genid('human_call')
      const contact = {
        run_id: this.runId,
        call_id: callId,
        spec: {
          msg: message,
          channel: channel,
        },
      }
      await backend.contacts().add(contact)

      if (this.verbose) {
        console.log(`HumanLayer: Requested human contact for message ${message}`)
      }
      while (true) {
        await this.sleep(3000)
        const humanContact = await backend.contacts().get(callId)
        if (!humanContact.status?.response) {
          continue
        }

        if (this.verbose) {
          console.log(`HumanLayer: Received human contact response: ${humanContact.status.response}`)
        }
        return humanContact.status.response
      }
    }
  }
}
