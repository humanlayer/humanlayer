import { FunctionCall, HumanContact } from './models'

type EmailMessage = {
  from_address: string
  to_address: string[]
  cc_address: string[]
  bcc_address: string[]
  subject: string
  content: string
  datetime: string
}

type EmailPayload = {
  from_address: string
  to_address: string
  subject: string
  body: string
  message_id: string
  previous_thread?: EmailMessage[]
  raw_email: string
  is_test?: boolean
}

type SlackMessage = {
  from_user_id: string
  channel_id: string
  content: string
  message_id: string
}

type SlackThread = {
  thread_ts: string
  channel_id: string
  events: SlackMessage[]
}

type V1Beta2EmailEventReceived = {
  is_test?: boolean
  type: 'agent_email.received'
  event: EmailPayload
}

type V1Beta2SlackEventReceived = {
  is_test?: boolean
  type: 'agent_slack.received'
  event: SlackThread
}

type V1Beta2FunctionCallCompleted = {
  is_test?: boolean
  type: 'function_call.completed'
  event: FunctionCall
}

type V1Beta2HumanContactCompleted = {
  is_test?: boolean
  type: 'human_contact.completed'
  event: HumanContact
}

export {
  V1Beta2EmailEventReceived,
  V1Beta2SlackEventReceived,
  V1Beta2FunctionCallCompleted,
  V1Beta2HumanContactCompleted,
}
