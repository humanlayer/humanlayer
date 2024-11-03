## 0.5.10

### Enhancements

- Add support for client-side usage of `respond` methods for responding to function calls / human contacts. This enables building custom approval UX in your web app / client of choice.
- Added some contrived examples for client-side approvals in [TS](https://github.com/humanlayer/humanlayer/blob/main/examples/ts_openai_client/04-agent-side-approvals.ts#L99-L103) and [PY](https://github.com/humanlayer/humanlayer/blob/main/examples/openai_client/04-agent-side-approvals.py#L118)

## 0.5.9

### Fixes

- Ensure HumanLayer cloud errors are correctly forwarded into thrown execeptions

### Cloud

- Switched from subscriptions to more flexible credits-based usage model

## 0.5.8

### Features

Functionality to enable lower-level control over approval and human interaction. We had requests from users for more control over these processes compared to higher-order-function approaches.

- Add lower-level `fetch_approval`, `create_function_call`, `get_function_call` methods to `HumanLayer`
- Add lower-level `fetch_human_response`, `create_human_contact`, `get_human_contact` methods to `HumanLayer`

Examples:

- [imperative_fetch](examples/openai_client/02-imperative_fetch.py)
- [for the especially based](examples/openai_client/03-imperative_fetch_based.py)

### Enhancements

- Improved Makefile harness for running/testing examples with prerelease version or local API instances
- Updated examples to use `run_id` to identify agents in slack and in approval history
- Support for python 3.10 - please let us know if you hit any issues with 3.10!

## 0.5.7

- Support for GripTape Custom Tools

## 0.5.6

- Support for `reject_options` and `response_options` in `require_approval` and `human_as_tool`, respectively, allowing custom response buttons in slack and web platforms
