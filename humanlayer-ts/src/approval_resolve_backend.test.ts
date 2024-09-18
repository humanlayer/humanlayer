import { ApprovalMethod, HumanLayer } from './approval'
import { with_env_var } from '../src/testing/index'
import exp from 'node:constants'
import { CloudHumanLayerBackend } from './cloud'

test('no args', () => {
  with_env_var('HUMANLAYER_API_KEY', '', () => {
    const hl = new HumanLayer()
    expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
  })
})

test('cli hardcoded', () => {
  const hl = new HumanLayer({ approvalMethod: ApprovalMethod.cli })
  expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
})

test('invalid breaks', () => {
  with_env_var('HUMANLAYER_APPROVAL_METHOD', 'bar', () => {
    expect(() => new HumanLayer()).toThrow('Invalid HUMANLAYER_APPROVAL_METHOD: bar')
  })
})

test('env cli', () => {
  with_env_var('HUMANLAYER_APPROVAL_METHOD', 'cli', () => {
    const hl = new HumanLayer()
    expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
    with_env_var('HUMANLAYER_API_TOKEN', 'abc', () => {
      const hl = new HumanLayer()
      expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
    })
  })
})

test('env backend', () => {
  with_env_var('HUMANLAYER_APPROVAL_METHOD', 'backend', () => {
    expect(() => new HumanLayer()).toThrow('HUMANLAYER_API_KEY is required for cloud approvals')

    with_env_var('HUMANLAYER_API_KEY', 'abc', () => {
      const hl = new HumanLayer()
      expect(hl.approvalMethod).toBe(ApprovalMethod.backend)
    })
  })
})

test('HumanLayer.cloud()', () => {
  with_env_var('HUMANLAYER_API_KEY', '', () => {
    expect(() => HumanLayer.cloud()).toThrow('HUMANLAYER_API_KEY is required for cloud approvals')
  })
})

test('HumanLayer.cloud() with apiKey', () => {
  const hl = HumanLayer.cloud({ apiKey: 'abc' })
  expect(hl.approvalMethod).toBe(ApprovalMethod.backend)
  expect(hl.backend).toBeDefined()
  expect(hl.backend).toBeInstanceOf(CloudHumanLayerBackend)
  const cloudBackend = <CloudHumanLayerBackend>hl.backend
  expect(cloudBackend.connection.apiKey).toBe('abc')
  expect(cloudBackend.connection.apiBaseURL).toBe('https://api.humanlayer.dev/humanlayer/v1')
})

test('Humanlayer with api key and endpoint', () => {
  const hl = new HumanLayer({ apiKey: 'abc', apiBaseUrl: 'fake' })
  expect(hl.approvalMethod).toBe(ApprovalMethod.backend)
  expect(hl.backend).toBeDefined()
  expect(hl.backend).toBeInstanceOf(CloudHumanLayerBackend)
  const cloudBackend = <CloudHumanLayerBackend>hl.backend
  expect(cloudBackend.connection.apiKey).toBe('abc')
  expect(cloudBackend.connection.apiBaseURL).toBe('fake')
})

test('HumanLayer() with env var', () => {
  with_env_var('HUMANLAYER_API_KEY', 'abc', () => {
    const hl = new HumanLayer()
    expect(hl.approvalMethod).toBe(ApprovalMethod.backend)
    expect(hl.backend).toBeDefined()
    expect(hl.backend).toBeInstanceOf(CloudHumanLayerBackend)
    const cloudBackend = <CloudHumanLayerBackend>hl.backend
    expect(cloudBackend.connection.apiKey).toBe('abc')
    expect(cloudBackend.connection.apiBaseURL).toBe('https://api.humanlayer.dev/humanlayer/v1')
  })
})
