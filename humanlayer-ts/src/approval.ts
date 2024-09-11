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

export enum ApprovalMethod {
  CLI = 'cli',
  BACKEND = 'backend',
}

/**
 * sure this'll work for now
 */
export const default_genid = (prefix: string) => {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

export class HumanLayer {
  approval_method: ApprovalMethod
  backend?: AgentBackend
  run_id: string
  agent_name: string
  genid: (prefix: string) => string
  sleep: (ms: number) => Promise<void>
  contact_channel?: ContactChannel

  constructor({
    run_id,
    approval_method,
    backend,
    agent_name,
    genid,
    sleep,
    contact_channel,
    api_key,
    api_base_url,
  }: {
    run_id?: string
    approval_method?: ApprovalMethod
    backend?: AgentBackend
    agent_name?: string
    genid?: (prefix: string) => string
    sleep?: (ms: number) => Promise<void>
    contact_channel?: ContactChannel
    api_key?: string
    api_base_url?: string
  }) {
    this.genid = genid || default_genid
    this.sleep = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.contact_channel = contact_channel

    if (!approval_method && process.env.HUMANLAYER_APPROVAL_METHOD) {
      const method = process.env.HUMANLAYER_APPROVAL_METHOD as keyof typeof ApprovalMethod
      if (method in ApprovalMethod) {
        this.approval_method = ApprovalMethod[method]
      } else {
        throw new Error(`Invalid HUMANLAYER_APPROVAL_METHOD: ${process.env.HUMANLAYER_APPROVAL_METHOD}`)
      }
    }

    if (!approval_method) {
      if (backend || process.env.HUMANLAYER_API_KEY) {
        this.approval_method = ApprovalMethod.BACKEND
        this.backend =
          backend ||
          new CloudHumanLayerBackend(
            new HumanLayerCloudConnection(
              api_key || process.env.HUMANLAYER_API_KEY,
              api_base_url || process.env.HUMANLAYER_API_BASE_URL,
            ),
          )
      } else {
        logger.info('No HUMANLAYER_API_KEY found, defaulting to CLI approval')
        this.approval_method = ApprovalMethod.CLI
      }
    } else {
      this.approval_method = approval_method
    }

    this.agent_name = agent_name || 'agent'
    this.genid = genid || default_genid
    this.run_id = run_id || this.genid(this.agent_name)

    if (this.approval_method === ApprovalMethod.BACKEND && !backend) {
      throw new HumanLayerException('backend is required for non-cli approvals')
    }
    this.backend = backend
  }

  static cloud({
    connection,
    api_key,
    api_base_url,
  }: {
    connection: HumanLayerCloudConnection | null
    api_key?: string
    api_base_url?: string
  }): HumanLayer {
    if (!connection) {
      connection = new HumanLayerCloudConnection(api_key, api_base_url)
    }
    return new HumanLayer({
      approval_method: ApprovalMethod.BACKEND,
      backend: new CloudHumanLayerBackend(connection),
    })
  }

  static cli(): HumanLayer {
    return new HumanLayer({
      approval_method: ApprovalMethod.CLI,
    })
  }

  require_approval<T_Fn extends Function>(contact_channel?: ContactChannel): (fn: T_Fn) => T_Fn {
    return (fn: T_Fn) => {
      if (this.approval_method === ApprovalMethod.CLI) {
        return this._approve_cli(fn)
      }

      return this._approve_with_backend(fn, contact_channel)
    }
  }

  _approve_cli<T_Fn extends Function>(fn: T_Fn): T_Fn {
    // todo fix the types here
    const f: any = (...args: any[]) => {
      console.log(`Agent ${this.run_id} wants to call

${fn.name}(${JSON.stringify(args, null, 2)})

${args.length ? ' with args: ' + JSON.stringify(args, null, 2) : ''}`)
      const feedback = prompt('Hit ENTER to proceed, or provide feedback to the agent to deny: \n\n')
      if (feedback !== null && feedback !== '') {
        return new Error(`User denied ${fn.name} with feedback: ${feedback}`)
      }
      try {
        return fn(...args)
      } catch (e) {
        return `Error running ${fn.name}: ${e}`
      }
    }
    f.name = fn.name
    return f
  }

  _approve_with_backend<T_Fn extends Function>(fn: T_Fn, contact_channel?: ContactChannel): T_Fn {
    // todo fix the types here
    const f: any = async (...args: any[]) => {
      const backend = this.backend!
      const call_id = this.genid('call')
      await backend.functions().add({
        run_id: this.run_id,
        call_id,
        spec: {
          fn: fn.name,
          kwargs: args,
          channel: contact_channel,
        },
      })
      while (true) {
        await this.sleep(3000)
        const function_call = await backend.functions().get(call_id)
        if (function_call.status?.approved) {
          return fn(...args)
        } else {
          return function_call.status?.comment
        }
      }
    }
    f.name = fn.name
    return f
  }
}

/**

class HumanLayer(BaseModel):
    """HumanLayer"""

    def require_approval(
        self,
        contact_channel: ContactChannel | None = None,
    ) -> HumanLayerWrapper:
        def decorator(fn):  # type: ignore
            if self.approval_method is ApprovalMethod.CLI:
                return self._approve_cli(fn)

            return self._approve_with_backend(fn, contact_channel)

        return HumanLayerWrapper(decorator)

    def _approve_cli(self, fn: Callable[[T], R]) -> Callable[[T], R | str]:
        """
        NOTE we convert a callable[[T], R] to a Callable [[T], R | str]

        this is safe to do for most LLM use cases. It will blow up
        a normal function.

        If we can guarantee the function calling framework
        is properly handling exceptions, then we can
        just raise and let the framework handle the stringification
        of what went wrong.

        Because some frameworks dont handle exceptions well, were stuck with the hack for now
        """

        @wraps(fn)
        def wrapper(*args, **kwargs) -> R | str:  # type: ignore
            print(
                f"""Agent {self.run_id} wants to call

{fn.__name__}({json.dumps(kwargs, indent=2)})

{"" if not args else " with args: " + str(args)}"""
            )
            feedback = input("Hit ENTER to proceed, or provide feedback to the agent to deny: \n\n")
            if feedback not in {
                None,
                "",
            }:
                return str(UserDeniedError(f"User denied {fn.__name__} with feedback: {feedback}"))
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

    def _approve_with_backend(
        self,
        fn: Callable[[T], R],
        contact_channel: ContactChannel | None = None,
    ) -> Callable[[T], R | str]:
        """
        NOTE we convert a callable[[T], R] to a Callable [[T], R | str]

        this is safe to do for most LLM use cases. It will blow up
        a normal function.

        If we can guarantee the function calling framework
        is properly handling exceptions, then we can
        just raise and let the framework handle the stringification
        of what went wrong.

        Because some frameworks dont handle exceptions well, were stuck with the hack for now
        """
        contact_channel = contact_channel or self.contact_channel

        @wraps(fn)
        def wrapper(*args, **kwargs) -> R | str:  # type: ignore
            assert self.backend is not None
            call_id = self.genid("call")
            try:
                call = FunctionCall(
                    run_id=self.run_id,  # type: ignore
                    call_id=call_id,
                    spec=FunctionCallSpec(
                        fn=fn.__name__,
                        kwargs=kwargs,
                        channel=contact_channel,
                    ),
                )
                self.backend.functions().add(call)

                # todo lets do a more async-y websocket soon
                while True:
                    self.sleep(3)
                    function_call: FunctionCall = self.backend.functions().get(call_id)
                    if function_call.status is None or function_call.status.approved is None:
                        continue

                    if function_call.status.approved:
                        return fn(*args, **kwargs)
                    else:
                        if (
                            function_call.spec.channel
                            and function_call.spec.channel.slack
                            and function_call.spec.channel.slack.context_about_channel_or_user
                        ):
                            return f"User in {function_call.spec.channel.slack.context_about_channel_or_user} denied {fn.__name__} with message: {function_call.status.comment}"
                        elif (
                            contact_channel
                            and contact_channel.slack
                            and contact_channel.slack.context_about_channel_or_user
                        ):
                            return f"User in {contact_channel.slack.context_about_channel_or_user} denied {fn.__name__} with message: {function_call.status.comment}"
                        else:
                            return f"User denied {fn.__name__} with message: {function_call.status.comment}"
            except Exception as e:
                logger.exception("Error requesting approval")
                # todo - raise vs. catch behavior - many tool clients handle+wrap errors
                # but not all of them :rolling_eyes:
                return f"Error running {fn.__name__}: {e}"

        return wrapper

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
