import { ApprovalMethod, HumanLayer } from './approval'
import { with_env_var } from '../src/testing/index'
import exp from 'node:constants'
import { CloudHumanLayerBackend } from './cloud'

test('no args', () => {
  with_env_var('HUMANLAYER_API_KEY', '', () => {
    const hl = new HumanLayer({})
    expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
  })
})

test('cli hardcoded', () => {
  const hl = new HumanLayer({ approvalMethod: ApprovalMethod.cli })
  expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
})

test('invalid breaks', () => {
  with_env_var('HUMANLAYER_APPROVAL_METHOD', 'bar', () => {
    expect(() => new HumanLayer({})).toThrow('Invalid HUMANLAYER_APPROVAL_METHOD: bar')
  })
})

test('env cli', () => {
  with_env_var('HUMANLAYER_APPROVAL_METHOD', 'cli', () => {
    const hl = new HumanLayer({})
    expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
    with_env_var('HUMANLAYER_API_TOKEN', 'abc', () => {
      const hl = new HumanLayer({})
      expect(hl.approvalMethod).toBe(ApprovalMethod.cli)
    })
  })
})

test('env backend', () => {
  with_env_var('HUMANLAYER_APPROVAL_METHOD', 'backend', () => {
    expect(() => new HumanLayer({})).toThrow('HUMANLAYER_API_KEY is required for cloud approvals')

    with_env_var('HUMANLAYER_API_KEY', 'abc', () => {
      const hl = new HumanLayer({})
      expect(hl.approvalMethod).toBe(ApprovalMethod.backend)
    })
  })
})

test('HumanLayer.cloud()', () => {
  with_env_var('HUMANLAYER_API_KEY', '', () => {
    expect(() => HumanLayer.cloud({})).toThrow('HUMANLAYER_API_KEY is required for cloud approvals')
  })
})

test('HumanLayer.cloud() with apiKey', () => {
  const hl = new HumanLayer({ apiKey: 'abc' })
  expect(hl.approvalMethod).toBe(ApprovalMethod.backend)
  expect(hl.backend).toBeDefined()
  expect(hl.backend).toBeInstanceOf(CloudHumanLayerBackend)
  const cloudBackend = <CloudHumanLayerBackend>hl.backend
  expect(cloudBackend.connection.apiKey).toBe('abc')
  expect(cloudBackend.connection.apiBaseURL).toBe('https://api.humanlayer.dev/humanlayer/v1')
})

/**

def test_cloud_endpoint_kwarg() -> None:
    hl = HumanLayer(api_key="foo", api_base_url="fake")
    assert hl.approval_method == ApprovalMethod.BACKEND
    assert hl.backend is not None
    assert isinstance(hl.backend, CloudHumanLayerBackend)
    assert hl.backend.connection.api_base_url == "fake"


def test_env_var_cloud() -> None:
    with env_var("HUMANLAYER_API_KEY", "foo"):
        hl = HumanLayer()
        assert hl.approval_method == ApprovalMethod.BACKEND
        assert hl.backend is not None
        assert isinstance(hl.backend, CloudHumanLayerBackend)
        assert hl.backend.connection.api_key == "foo"
        assert hl.backend.connection.api_base_url == "https://api.humanlayer.dev/humanlayer/v1"

 */
