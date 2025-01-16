HumanLayer TS changelog

## 0.7.2

--END--

From this point on, python and typescript will be released together. Any further changes to the typescript SDK will be inlcuded in the repos main [CHANGELOG.md](../CHANGELOG.md).

## 0.7.1

### Features

- Support for `interactive: boolean` on ReponseOption - setting to false will cause prompts to be written in by default

  - BREAKING - if you are using prompt_fill on ReponseOption, and want to give users the option to edit prompt, you will need to add interactive=true

- API now returns `HumanContactStatus.response_option_name` and `FunctionCallStatus.reject_option_name` on objects for consuming human classification/steering reponses with deterministic (non-llm) code

### Updates

- Changed default http client timeout to 30s in python clients

### Examples

- Added ts_email_classifier example in [./examples/ts_email_classifier](./examples/ts_email_classifier)
- Added in-depth examples docs in [./examples/README.md](./examples/README.md)

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
