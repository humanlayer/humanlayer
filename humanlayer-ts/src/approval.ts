import crypto from 'crypto'
import { AgentBackend, HumanLayerException } from './protocol'
import {
  ContactChannel,
  Escalation,
  FunctionCall,
  FunctionCallSpec,
  FunctionCallStatus,
  HumanContact,
  HumanContactSpec,
  HumanContactStatus,
} from './models'
import { CloudHumanLayerBackend, HumanLayerCloudConnection } from './cloud'
import { logger } from './logger'

export enum ApprovalMethod {
  cli = 'cli',
  backend = 'backend',
}

const nullIsh = (value: any) => value === null || typeof value === 'undefined'

/**
 * sure this'll work for now
 */
const defaultGenid = (prefix: string) => {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export const humanlayer = (params?: HumanLayerParams) => {
  return new HumanLayer(params)
}

export interface HumanLayerParams {
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
  httpTimeoutSeconds?: number
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

  constructor(params?: HumanLayerParams) {
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
      httpTimeoutSeconds = parseInt(process.env.HUMANLAYER_HTTP_TIMEOUT_SECONDS || '10'),
    } = params || {}
    this.genid = genid
    this.sleep = sleep
    this.verbose = verbose
    this.contactChannel = contactChannel

    // Simplified approval method logic
    this.approvalMethod =
      approvalMethod ||
      (backend || apiKey || process.env.HUMANLAYER_API_KEY
        ? ApprovalMethod.backend
        : ApprovalMethod.cli)

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
      logger.info(`Agent ${this.runId} wants to call

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
        logger.info(`HumanLayer: Requested approval for function ${name}`)
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
            logger.info(`HumanLayer: User approved function ${functionCall.spec.fn}`)
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
      logger.info(`Agent ${this.runId} requests assistance:

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
      return this.fetchHumanResponse({
        spec: {
          msg: message,
          channel: channel,
        },
      })
    }
  }

  async fetchHumanResponse({ spec }: { spec: HumanContactSpec }): Promise<string> {
    spec.channel = nullIsh(spec.channel) ? this.contactChannel : spec.channel
    let humanContact = await this.createHumanContact({ spec })
    if (this.verbose) {
      logger.info(`HumanLayer: Requested human response from HumanLayer cloud`)
    }
    while (true) {
      await this.sleep(3000)
      humanContact = await this.getHumanContact(humanContact.call_id)
      if (!humanContact.status?.response) {
        continue
      }
      if (this.verbose) {
        logger.info(`HumanLayer: Received human response: ${humanContact.status.response}`)
      }
      return humanContact.status.response
    }
  }

  async createHumanContact({ spec }: { spec: HumanContactSpec }): Promise<HumanContact> {
    spec.channel = nullIsh(spec.channel) ? this.contactChannel : spec.channel
    if (!this.backend) {
      throw new HumanLayerException('createHumanContact requires a backend')
    }
    const callId = this.genid('human_call')
    const ret = await this.backend.contacts().add({
      run_id: this.runId,
      call_id: callId,
      spec: spec,
    })
    return ret
  }

  async escalateEmailHumanContact(call_id: string, escalation: Escalation): Promise<HumanContact> {
    if (!this.backend) {
      throw new HumanLayerException('escalateEmailFunctionCall requires a backend')
    }

    return this.backend.contacts().escalateEmail(call_id, escalation)
  }

  getHumanContact(call_id: string): Promise<HumanContact> {
    if (!this.backend) {
      throw new HumanLayerException('getHumanContact requires a backend')
    }
    return this.backend.contacts().get(call_id)
  }

  async fetchHumanApproval({ spec }: { spec: FunctionCallSpec }): Promise<FunctionCallStatus> {
    spec.channel = nullIsh(spec.channel) ? this.contactChannel : spec.channel
    let functionCall = await this.createFunctionCall({
      spec: spec,
    })
    if (this.verbose) {
      logger.info(`HumanLayer: Requested human approval from HumanLayer cloud`)
    }
    while (true) {
      await this.sleep(3000)
      functionCall = await this.getFunctionCall(functionCall.call_id)
      if (
        functionCall.status?.approved === null ||
        typeof functionCall.status?.approved === 'undefined'
      ) {
        continue
      }
      if (this.verbose) {
        logger.info(
          `HumanLayer: Received response ${
            functionCall.status?.approved ? ' (approved)' : ' (denied)'
          } ${functionCall.status?.comment ? `with comment: ${functionCall.status?.comment}` : ''}`,
        )
      }
      return functionCall.status!
    }
  }

  async createFunctionCall({ spec }: { spec: FunctionCallSpec }): Promise<FunctionCall> {
    spec.channel = nullIsh(spec.channel) ? this.contactChannel : spec.channel
    if (!this.backend) {
      throw new HumanLayerException('createFunctionCall requires a backend')
    }
    const callId = this.genid('call')
    return this.backend.functions().add({
      run_id: this.runId,
      call_id: callId,
      spec: spec,
    })
  }

  async escalateEmailFunctionCall(call_id: string, escalation: Escalation): Promise<FunctionCall> {
    if (!this.backend) {
      throw new HumanLayerException('escalateEmailFunctionCall requires a backend')
    }

    return this.backend.functions().escalateEmail(call_id, escalation)
  }

  async getFunctionCall(call_id: string): Promise<FunctionCall> {
    if (!this.backend) {
      throw new HumanLayerException('getFunctionCall requires a backend')
    }
    return this.backend.functions().get(call_id)
  }
}
