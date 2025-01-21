## 0.7.4 (unreleased)

- Add [v1beta2 webhook payload](https://humanlayer.dev/docs/core/response-webhooks) types to ts and python sdks

## 0.7.3

This was an internal release with build/release process changes, but no user-facing changes.

## 0.7.2 - Deprecated

This was an internal release with no user-facing changes. It did introduce a small issue, so please upgrade to 0.7.3.

## 0.7.1

### Features

- Support for `interactive: bool` on ReponseOption - setting to false will cause prompts to be written in by default
  - BREAKING - if you are using prompt_fill on ReponseOption, and want to give users the option to edit prompt, you will need to add interactive=True

```python
# before
@hl.require_approval(
    # reject options lets you show custom pre-filled rejection prompts to the human
    reject_options=[
        ResponseOption(
            name="reject",
            description="Reject the message",
            prompt_fill="try again but this time ",
        ),
   # ...
```

```diff
# after
@hl.require_approval(
    # reject options lets you show custom pre-filled rejection prompts to the human
    reject_options=[
        ResponseOption(
            name="reject",
            description="Reject the message",
            prompt_fill="try again but this time ",
+           interactive=True
        ),
   # ...


```

- API now returns `HumanContactStatus.response_option_name` and `FunctionCallStatus.reject_option_name` on objects for consuming human classification/steering reponses with deterministic (non-llm) code

### Updates

- Changed default http client timeout to 30s in python clients

### Examples

- Added ts_email_classifier example in [./examples/ts_email_classifier](./examples/ts_email_classifier)
- Added in-depth examples docs in [./examples/README.md](./examples/README.md)

## 0.7.0

- AsyncHumanLayer.human_as_tool() is no longer async (but the tool it returns still is)
  - simplifies syntax to `await hl.human_as_tool()(message="lorem ipsum")` instead of `await (await hl.human_as_tool())(message="lorem ipsum")`
- remove all approval_method logic for AsyncHumanLayer - only `backend` usage is supported. Use a sync HumanLayer if you want to use the cli or toggle between backend/cli methods
- BREAKING - remove AsyncHumanLayer.cloud()
- BREAKING - reduce ways to configure approval method by remoing env var for HUMANLAYER_APPROVAL_METHOD

## 0.6.5

### Features

- Added state preservation support to FunctionCallSpec and HumanContactSpec for maintaining context across request lifecycles ([docs](https://humanlayer.dev/docs/core/state-management)) ([example](https://github.com/humanlayer/humanlayer/blob/main/examples/fastapi-email/app-statehooks.py))

### Enhancements

- Moved to `uv` for project management (examples still encourage throwaway envs with `pip` / `requirements.txt`)
- Updated CI/CD pipeline to use uv instead of poetry
- Improved PR template with clearer sections and guidance
- Updated all example dependencies to use v0.6.5

## 0.6.4

### Features

- Add support for required slack responders, restricting who can respond to a slack message. See https://humanlayer.dev/docs/channels/slack for more detail

## 0.6.3

### Features

- Added async support for HumanLayer python SDK with `AsyncHumanLayer` class ([example](https://github.com/humanlayer/humanlayer/tree/main/examples/fastapi))
- Added FastAPI example demonstrating webhooks and async usage ([example](https://github.com/humanlayer/humanlayer/tree/main/examples/fastapi-webhooks))

### Documentation

- Improved webhook documentation and added concrete examples

## 0.6.2

### Features

- Added beta support for agent webhooks to launch agents in response to emails ([docs](https://humanlayer.dev/docs/core/agent-webhooks)) - support for slack inbound coming soon!

### Enhancements

- Added support for non-experimental email threading fields:

  - `subject` replaces `experimental_subject_line`
  - `references_message_id` replaces `experimental_references_message_id`
  - `in_reply_to_message_id` replaces `experimental_in_reply_to_message_id`
  - Old fields remain supported for backwards compatibility

- Added convienience method `EmailContactChannel.in_reply_to` for easily creating an email contact channel that is in reply to another email

- Improved handling of `human_as_tool.__name__` generation to exclude more special characters

### Documentation

- Enhanced Slack channel documentation with setup instructions and ID lookup tips
- Improved email channel documentation with clearer threading examples
- Added Ruby and cURL examples for API reference
- Updated documentation navigation and cross-linking
- Added webhook documentation clarifications

### Branding

- Updated logo and documentation assets
- Updated documentation links and social references

## 0.6.1

### Features

- Added initial Mintlify documentation structure
- Added API reference documentation for function calls and classifications
- Added smoke test target for faster example testing
- Added email threading support ([docs](https://humanlayer.dev/docs/channels/email)) with:
  - `experimental_subject_line`
  - `experimental_references_message_id`
  - `experimental_in_reply_to_message_id`

### Documentation

- Updated documentation links to point to humanlayer.dev
- Added Docker configuration for local documentation development

## 0.6.0

### Features

- Added email channel support with subject line customization and threading capabilities ([docs](https://humanlayer.dev/docs/channels/email))
- Added new examples demonstrating email channel usage:
  - Email channel with Linear ticket creation ([example](https://github.com/humanlayer/humanlayer/tree/main/examples/langchain/08-email-channel.py))
  - Email contact handling with threading ([example](https://github.com/humanlayer/humanlayer/tree/main/examples/langchain/09-email-contact.py))
- Updated TypeScript definitions for email channel models
- Updated all example dependencies to latest versions

## 0.5.11

Initial prep for email feature, use 0.6.0 instead

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
