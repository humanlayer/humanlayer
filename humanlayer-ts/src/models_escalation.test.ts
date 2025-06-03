import { ContactChannel, EmailContactChannel, Escalation } from './models'

test('Escalation type - basic functionality', () => {
  // Test escalation without channel
  const escalation: Escalation = {
    escalation_msg: 'Test escalation',
  }
  expect(escalation.channel).toBeUndefined()
  expect(escalation.escalation_msg).toBe('Test escalation')
  expect(escalation.additional_recipients).toBeUndefined()
})

test('Escalation type - with channel', () => {
  // Test escalation with channel
  const emailChannel: EmailContactChannel = {
    address: 'test@example.com',
  }
  const contactChannel: ContactChannel = {
    email: emailChannel,
  }
  const escalationWithChannel: Escalation = {
    escalation_msg: 'Escalation with channel',
    channel: contactChannel,
  }

  expect(escalationWithChannel.channel).toBeDefined()
  expect(escalationWithChannel.channel?.email).toBeDefined()
  expect(escalationWithChannel.channel?.email?.address).toBe('test@example.com')
  expect(escalationWithChannel.escalation_msg).toBe('Escalation with channel')
})

test('Escalation type - serialization includes channel', () => {
  // Test escalation serializes channel field correctly
  const emailChannel: EmailContactChannel = {
    address: 'ceo@company.com',
    experimental_subject_line: 'CRITICAL: Immediate approval required',
  }
  const contactChannel: ContactChannel = {
    email: emailChannel,
  }
  const escalation: Escalation = {
    escalation_msg: 'CRITICAL: Still no response',
    channel: contactChannel,
  }

  // Test JSON serialization includes channel field
  const serialized = JSON.parse(JSON.stringify(escalation))
  expect(serialized.channel).toBeDefined()
  expect(serialized.channel.email.address).toBe('ceo@company.com')
  expect(serialized.channel.email.experimental_subject_line).toBe(
    'CRITICAL: Immediate approval required'
  )
})