import crypto from 'crypto'
import { AgentBackend, HumanLayerException } from './protocol'
import {
  ContactChannel,
  FunctionCall,
  FunctionCallSpec,
  HumanContact,
  HumanContactSpec,
} from './models'
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
    } = params || {}
    this.genid = genid
    this.sleep = sleep
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
    // todo fix the types here
    const f: any = (kwargs: any) => {
      console.log(`Agent ${this.runId} wants to call

${fn.name}(${JSON.stringify(kwargs, null, 2)})

${kwargs.length ? ' with args: ' + JSON.stringify(kwargs, null, 2) : ''}`)
      const feedback = prompt('Hit ENTER to proceed, or provide feedback to the agent to deny: \n\n')
      if (feedback !== null && feedback !== '') {
        return new Error(`User denied ${fn.name} with feedback: ${feedback}`)
      }
      try {
        return fn(kwargs)
      } catch (e) {
        return `Error running ${fn.name}: ${e}`
      }
    }
    f.name = fn.name
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
          return fn(kwargs)
        } else {
          return `User denied function ${functionCall.spec.fn} with comment: ${functionCall.status?.comment}`
        }
      }
    }
    Object.defineProperty(f, 'name', { value: name, writable: false })
    return f
  }

  /**
   *
   def human_as_tool(
   self,
   contact_channel: ContactChannel | None = None,
   ) -> Callable[[str], str]:
   if self.approval_method is ApprovalMethod.CLI:
   return self._human_as_tool_cli()

   return self._human_as_tool(contact_channel)

   def _human_as_tool_cli(
   self,
   ) -> Callable[[str], str]:
   def contact_human(
   question: str,
   ) -> str:
   """ask a human a question on the CLI"""
   print(
   f"""Agent {self.run_id} requests assistance:

   {question}
   """
   )
   feedback = input("Please enter a response: \n\n")
   return feedback

   return contact_human

   def _human_as_tool(
   self,
   contact_channel: ContactChannel | None = None,
   ) -> Callable[[str], str]:
   contact_channel = contact_channel or self.contact_channel

   def contact_human(
   message: str,
   ) -> str:
   """contact a human"""
   assert self.backend is not None
   call_id = self.genid("human_call")

   contact = HumanContact(
   run_id=self.run_id,  # type: ignore
   call_id=call_id,
   spec=HumanContactSpec(
   msg=message,
   channel=contact_channel,
   ),
   )
   self.backend.contacts().add(contact)

   # todo lets do a more async-y websocket soon
   while True:
   self.sleep(3)
   human_contact = self.backend.contacts().get(call_id)
   if human_contact.status is None:
   continue

   if human_contact.status.response is not None:
   return human_contact.status.response

   if contact_channel is None:
   return contact_human

   if contact_channel.slack:
   contact_human.__doc__ = "Contact a human via slack and wait for a response"
   contact_human.__name__ = "contact_human_in_slack"
   if contact_channel.slack.context_about_channel_or_user:
   contact_human.__doc__ += f" in {contact_channel.slack.context_about_channel_or_user}"
   fn_ctx = contact_channel.slack.context_about_channel_or_user.replace(" ", "_")
   contact_human.__name__ = f"contact_human_in_slack_in_{fn_ctx}"

   return contact_human
   */
  humanAsTool(contactChannel?: ContactChannel): (message: string) => Promise<string> {
    if (this.approvalMethod === ApprovalMethod.cli) {
      return this.humanAsToolCli()
    }

    return this.humanAsToolBackend(contactChannel)
  }

  humanAsToolCli(): (message: string) => Promise<string> {
    return async (message: string) => {
      console.log(`Agent ${this.runId} requests assistance:

      ${message}
      `)
      const feedback = prompt('Please enter a response: \n\n')

      return feedback || ''
    }
  }

  humanAsToolBackend(contactChannel?: ContactChannel): (message: string) => Promise<string> {
    return async (message: string) => {
      const backend = this.backend!
      const callId = this.genid('human_call')
      const contact = {
        run_id: this.runId,
        call_id: callId,
        spec: {
          msg: message,
          channel: this.contactChannel,
        },
      }
      await backend.contacts().add(contact)

      while (true) {
        await this.sleep(3000)
        const humanContact = await backend.contacts().get(callId)
        if (!humanContact.status?.response) {
          continue
        }

        return humanContact.status.response
      }
    }
  }
}
