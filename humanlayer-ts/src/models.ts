type FunctionCallStatus = {
  requested_at: Date
  responded_at?: Date
  approved?: boolean
  comment?: string
}

type SlackContactChannel = {
  // the slack channel or user id to contact
  channel_or_user_id: string
  // the context about the channel or user to contact
  context_about_channel_or_user?: string
  // the bot token to use to contact the channel or user
  bot_token?: string
  experimental_slack_blocks?: boolean
}

type SMSContactChannel = {
  phone_number: string
  context_about_user?: string
}

type WhatsAppContactChannel = {
  phone_number: string
  context_about_user?: string
}

type EmailContactChannel = {
  address: string
  context_about_user?: string
}

type ContactChannel = {
  slack?: SlackContactChannel
  sms?: SMSContactChannel
  whatsapp?: WhatsAppContactChannel
  email?: EmailContactChannel
}

type ResponseOption = {
  name: string
  title?: string
  description?: string
  prompt_fill?: string
}

type FunctionCallSpec = {
  // the function name to call
  fn: string
  // the function arguments
  kwargs: Record<string, any>
  // the contact channel to use to contact the human
  channel?: ContactChannel
  reject_options?: ResponseOption[]
}

type FunctionCall = {
  // the run id
  run_id: string
  call_id: string
  spec: FunctionCallSpec
  status?: FunctionCallStatus
}

type HumanContactSpec = {
  // the message to send to the human
  msg: string
  // the contact channel to use to contact the human
  channel?: ContactChannel
  response_options?: ResponseOption[]
}

type HumanContactStatus = {
  requested_at?: Date
  responded_at?: Date
  // the response from the human
  response?: string
}

type HumanContact = {
  // the run id
  run_id: string
  // the call id
  call_id: string
  // the spec for the human contact
  spec: HumanContactSpec
  status?: HumanContactStatus
}

export {
  FunctionCallStatus,
  SlackContactChannel,
  SMSContactChannel,
  WhatsAppContactChannel,
  EmailContactChannel,
  ContactChannel,
  ResponseOption,
  FunctionCallSpec,
  FunctionCall,
  HumanContactSpec,
  HumanContactStatus,
  HumanContact,
}
