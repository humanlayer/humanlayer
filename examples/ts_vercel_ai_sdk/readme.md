# HumanLayer + Vercel AI SDK example

## Overview

This example demonstrates how to use HumanLayer with the Vercel AI SDK in Typescript.

It makes user of the `humanlayer-ts-vercel-ai-sdk` package, which includes methods
specifically for wrapping Vercel AI SDK tools.

There are two examples:

- `npm run math` will run a math problem, where `add` can be called without approval, but `multiply` requires approval.

![initial prompt](./doc/math-prompt.png)

![math-request](./doc/math-request.png)

- `npm run human-as-tool` will run a prompt where the model should select the "contact a human" tool, which will fetch a human response via humanlayer

![initial prompt](./doc/prompt.png)
![human-as-tool](./doc/humanlayer-clarification.png)

## Running the Example

Set up env

```
cp dotenv.example .env
# configure API token(s)
```

## Running with NPM

```
npm install
npm run example
```
