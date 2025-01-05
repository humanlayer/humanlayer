
## 0.7.0

- TS - Fix a bug in fetchHumanApproval with callId resolution
- TS - remove env var for HUMANLAYER_APPROVAL_METHOD
- TS - add non-constructor entrypoint `import { humanlayer } from "humanlayer"` -- `humanlayer(params)` is a wrapper around `new HumanLayer(params)`
- DEV - update makefile for building/testing TS more regularly

## 0.6.1

- Fix - Add more comprehensive module exports for CommonJS and ES modules
- Enhancement - add lower-level create/fetch methods to typescript package
- Enhancement - expand EmailContactChannel to support experimental subject and message id fields

## 0.5.8

### Enhancements

- Add support for client-side usage of `respond` methods for responding to function calls / human contacts. This enables building custom approval UX in your web app / client of choice.
- Added some contrived examples for client-side approvals in [TS](https://github.com/humanlayer/humanlayer/blob/main/examples/ts_openai_client/04-agent-side-approvals.ts#L99-L103) and [PY](https://github.com/humanlayer/humanlayer/blob/main/examples/openai_client/04-agent-side-approvals.py#L118)
