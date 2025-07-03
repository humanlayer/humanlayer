## === Getting-Started/deploy-to-custom-domain.mdx ===

title: Deploy to a Custom Domain
description: Prepare a custom domain for deployment with Freestyle

---

import { Steps, Step } from "fumadocs-ui/components/steps";
import { Callout } from "fumadocs-ui/components/callout";

Once you have [verified ownership of a domain](/Getting-Started/domains), you have the ability to deploy websites to it. However, verification is only the first step. You must also configure the domain to point to Freestyle's servers.

### Single APEX Domain

If you want to deploy to an APEX domain (e.g. `yourdomain.com`), you need to add an A record to your domain's DNS settings. The A record should point to the IP address of the Freestyle server that will host your website.

```
    Type: A
    NAME: @
    VALUE: 35.235.84.134
```

### Subdomain

If you want to deploy to a subdomain (e.g. `subdomain.yourdomain.com`), you need to add a A record to your domain's DNS settings. The A record should point to the Freestyle server that will host your website.

```
    Type: A
    NAME: subdomain
    VALUE: 35.235.84.134
```

### All subdomains of a domain

If you want to deploy to all subdomains of a domain (e.g. `*.yourdomain.com`), you need to add a wildcard A record to your domain's DNS settings. The A record should point to the Freestyle server that will host your website.

```
    Type: A
    NAME: *
    VALUE: 35.235.84.134
```

<Callout>
  When dealing with DNS records its easy to set a record like
  `yourdomain.com.yourdomain.com` on accident. The easiest way to test if the
  record is set correctly is to run `dig domain.youexpect.com` and see if it
  shows up.
</Callout>

## === Getting-Started/dev-servers.mdx ===

title: Run a Dev Server
description: Use a git repo and dev server to create a hot reload environment.

---

import { CodeBlock } from "fumadocs-ui/components/codeblock";
import { CodeTabs } from "../../../src/components/code-tabs";

Dev Servers are instant development and preview environments for your [Git Repositories](/git).

They come with everything you need to show a live preview to your users, while giving your agents the ability to work with the code.

Dev Servers on Freestyle Dev Servers:

- Automatically keep `npm run dev` alive — if it crashes we detect that and restart it.
- An [MCP](#model-context-protocol-mcp) server that makes connecting your agents to the dev server easy.
- A managed Git Identity for your dev server, so it can push/pull code from the repo.

Special Features:

- VSCode Web Interface accessible for human collaboration on dev servers.
- Chromium + Playwright setup for testing

Coming Soon:

- VSCode Server Interface to open Dev Servers in VSCode and Chromium
- VSCode Language Server Interface to run LSP commands (which the MCP will have access to)

## Creating a Dev Server

In order to create a dev server, you'll need a Git Repository to base it on.

<CodeTabs
typescript={{
title: "create-repo.ts",
code: `

    import { FreestyleSandboxes } from "freestyle-sandboxes";

    const freestyle = new FreestyleSandboxes();


    const { repoId } = await freestyle.createGitRepository({
      name: "Test Repository",

      // This will make it easy for us to clone the repo during testing.
      // The repo won't be listed on any public registry, but anybody
      // with the uuid can clone it. You should disable this in production.
      public: true,

      source: {
        url: "https://github.com/freestyle-sh/freestyle-next",
        type: "git",
      },
    });

    console.log(\`Created repo with ID: \${repoId}\`);

`}}

python={{
title: "create-repo.py",
code: `

    import freestyle

    client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

    repo = client.create_repository(
      name="Test Repository from Python SDK",


      # This will make it easy for us to clone the repo during testing.
      # The repo won't be listed on any public registry, but anybody
      # with the uuid can clone it. You should disable this in production.
      public=True,
      source=freestyle.CreateRepoSource.from_dict(
          {
              "type": "git",
              "url": "https://github.com/freestyle-sh/freestyle-base-nextjs-shadcn",
          }
      ),
    )

    print(f"Created repo with ID: {repo.repo_id}")
    `

}}
/>

Then, you can request a dev server for the repo you just created.

<CodeTabs typescript={{
title: "request-dev-server.ts",
code: `

    import { FreestyleSandboxes } from "freestyle-sandboxes";

    const freestyle = new FreestyleSandboxes();

    const devServer = await freestyle.requestDevServer({ repoId });

    console.log(\`Dev Server URL: \${devServer.ephemeralUrl}\`);

`
}} python={{

title: "request-dev-server.py",
code: `

    import freestyle

    client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

    dev_server = client.request_dev_server(repo_id=repo.repo_id)

    print(f"Dev Server URL: {dev_server.ephemeral_url}")
    `

}} />

This will give you a dev server that is automatically running `npm run dev`. If you don't keep it alive, **it will shut itself down**.

## Working with Dev Servers

When you run a dev server, you get access to the following utilities:

<CodeTabs typescript={{
title: "dev-server.ts",
code: `
const {
ephemeralUrl, // URL to the dev server, shows whatever server the dev server is running
mcpEphemeralUrl, // URL to the MCP server, which lets your AI Agents interact with the dev server
codeServerUrl, // URL to the VSCode Web Interface

    commitAndPush, // Function to commit and push whatever is on the dev server now to the repo
    fs, // File system interface to the dev server
    process, // Process interface to the dev server to run commands

    isNew, // Boolean indicating if the dev server was just created
    shutdown, // Shutdown handle to stop the dev server

} = await freestyle.requestDevServer({
repoId: repoId,
});
`}}

python={{
title: "dev-server.py",
code: `

    dev_server = client.request_dev_server(
        repo_id=repo.repo_id,
    )

    ephemeral_url = dev_server.ephemeral_url # URL to the dev server, shows whatever server the dev server is running
    mcp_ephemeral_url = dev_server.mcp_ephemeral_url # URL to the MCP server, which lets your AI Agents interact with the dev server
    code_server_url = dev_server.code_server_url # URL to the VSCode Web Interface

    commit_and_push = dev_server.commit_and_push # Function to commit and push whatever is on the dev server now to the repo
    fs = dev_server.fs # File system interface to the dev server
    process = dev_server.process # Process interface to the dev server to run commands

    is_new = dev_server.is_new # Boolean indicating if the dev server was just created
    shutdown = dev_server.shutdown # Shutdown handle to stop the dev server

`

}} />

## The URLs

Dev Servers provide a series of URLs that you can use to get different interfaces from the dev server. All these URLs are **ephemeral**, we do not guarantee that they will be available, or the same at any future point. In order to work with them, we recommend re-requesting the dev server every time you want to use them.

| URL               | Description                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ephemeralUrl`    | This url displays whatever is on **port 3000** of the dev server, or a loading indicator until that shows up                            |
| `mcpEphemeralUrl` | This url is an MCP that lets your AI work with the dev server                                                                           |
| `codeServerUrl`   | This url opens a VSCode window in the browser that is inside the dev server, useful for letting you/your users collaborate with the AI. |

## The File System Interface

The dev server provides a file system interface that lets you read and write files in the dev server.

### Writing files

You can write files using the `fs`. The default encoding is utf-8, but you can specify another one (like `base64`) if you want to upload something like an image.

<CodeTabs typescript={{
title: "write-file.ts",
code: `

    await fs.writeFile("src/index.tsx", \`console.log("Hello World!");\`);

`}} python={{
title: "write-file.py",
code:`
fs.write_file("/test.txt", "Hello, Freestyle!")
`
}}/>

### Reading files

You can read files using the `fs`. The default encoding is utf-8, but you can specify another one (like `base64`) if you want to download something like an image.

<CodeTabs typescript={{
title: "read-file.ts",
code: `

    const content = await fs.readFile("src/index.tsx");

    console.log(content);

`}} python={{
title: "read-file.py",
code: `

    content = fs.read_file("src/index.tsx")

    print(content)

`}}

/>

### Listing files

You can list files in a directory using the `fs`. This is not a recursive listing, it only lists files in the specified directory. If you want to list files recursively, you'll want to use the `process` interface to run a command like `ls -R` or `find .`.

<CodeTabs typescript={{
title: "list-files.ts",
code: `

    const files = await fs.ls("src");

    console.log(files);

`}} python={{
title: "list-files.py",
code: `

    files = fs.ls("src")

    print(files)

`}}/>

## Executing Commands

You can execute any command on the dev server using the `process` interface.

<CodeTabs typescript={{
title: "run-command.ts",
code: `

    const { stdout, stderr } = await process.exec("npm run dev");

    console.log(stdout);
    console.error(stderr);

`}} python={{
title: "run-command.py",
code: `

    result = process.exec("npm run dev")

    print(result.stdout)
    print(result.stderr)

`}}/>

### Running background tasks

You can run background tasks using the `process.exec`, by passing a second argument `true` to the `exec` function. This will run the task in the background.

<CodeTabs typescript={{
title: "run-background-command.ts",
code: `

    await process.exec("npm run dev", true);
    // This will run in the background so you can continue doing other things

`}} python={{
title: "run-background-command.py",
code: `

    process.exec("npm run dev", background=True)
    # This will run in the background so you can continue doing other things

`}}/>

## Committing and Pushing Changes

You can commit and push changes to the repo using the `commitAndPush` function. This will commit all changes in the dev server and push them to the repo. The commit will go to the branch that the dev server is currently on, which is usually `main`.

<CodeTabs typescript={{
  title: "commit-and-push.ts",
  code: `
    await commitAndPush("Updated index.tsx");
`}} python={{
title: "commit-and-push.py",
code: `

    commit_and_push("Updated index.tsx")

`}}/>

>

## Using in NextJS

When building a web interface for your dev server, we provide a `FreestyleDevServer` component for NextJS. The component automatically keeps the dev server alive.

To use it, you'll first need to create a server action to handle the request. This action
will create a dev server for the repo if one isn't already running or return the
status if one is already running.

```tsx title="preview-actions.ts"
'use server'

import { freestyle } from '@/lib/freestyle'

export async function requestDevServer({ repoId }: { repoId: string }) {
  const { ephemeralUrl, devCommandRunning, installCommandRunning } = await freestyle.requestDevServer({
    repoId,
  })

  return { ephemeralUrl, devCommandRunning, installCommandRunning }
}
```

Then, you can use the `FreestyleDevServer` component in your NextJS app with the `requestDevServer` action you just created.

```tsx
import { FreestyleDevServer } from 'freestyle-sandboxes/react/dev-server'
import { requestDevServer } from './preview-actions'

export function Preview({ repoId }: { repoId: string }) {
  ;<FreestyleDevServer actions={{ requestDevServer }} repoId={repoId} />
}
```

## Working in Parallel

You can clone the repo locally and try pushing to it. You should see the dev
server update in realtime. Note this will only work if you made the repo public,
otherwise, you'll need to create git credentials to access the repo. See the
[Git Documentation](/git) for more information.

```bash
git clone https://git.freestyle.sh/<repoId>
```

For production use in App Builders, we suggest using isomorphic-git to manage
git from serverless JavaScript environments.

```ts
import git from 'isomorphic-git'
import fs from 'fs'
import http from 'isomorphic-git/http/node'

git.clone({
  fs,
  url: 'https://git.freestyle.sh/<repoId>',
  singleBranch: true,
  depth: 1,
  http,
})
```

## Model Context Protocol (MCP)

MCP is a protocol for allowing AI agents to discover and use tools. Dev servers
automatically expose a set of tools for interacting with the file system and
other core operations such as installing npm modules, running commands, and
testing code. You can get the url for this server in the dev server response.

We provide the following tools by default:

- readFile: Read a file from the dev server
- writeFile: Write a file to the dev server
- editFile: Search and replace based file editing
- ls: List files in a directory
- exec: Execute a command on the dev server
- commitAndPush: Commit and push changes to the repo
- npmInstall: Install an npm module on the dev server
- npmLint: Lint the code on the dev server

Together, these tools make it easy to get your agents started on development. They do not handle everything, but we recommend the MCP as a good starting point for building your own tools.

## On Current Limitations

Dev Servers are primarily made to run **JavaScript/typescript Dev Servers**. When we start a dev server, we run `npm run dev` and expect it to start a server on port 3000. If you want to add more on startup, you can change the script in `npm run dev` to run whatever you want. We automatically keep track of the process and restart it if it crashes.

This approach makes it theoretically work with other languages, but in practice not well. We are actively working on improving this. For the best experience today, a good rule of thumb is, "Would this be a part of my npm run dev workflow locally?" If the answer is yes, then it will work well on a dev server. If not, let us know, we'd like to make it work better.

## === Getting-Started/domains.mdx ===

title: Verify a Custom Domain
description: Verify ownership of and start managing custom domains via Freestyle API

---

import InstallSandboxes from "../../../src/components/installSandboxes";
import { Steps, Step } from "fumadocs-ui/components/steps";
import { CodeTabs } from "../../../src/components/code-tabs";

Domain Verification is the process for you to prove that you own a domain. It is useful not just for managing to your domains, but for managing your user's domains. Once you have verified ownership of a domain, you can deploy to it or any of its subdomains, provision certificates for it, and manage its DNS through the Freestyle API.

It runs through a 3 step process: First, you create a domain verification request, this creates a request token — you (or your users) add that DNS record to their DNS, then you tell us you completed the challenge, we check it, and assuming its correct, you have the ability to use that domain.

<Steps>
<Step>
### Install the Freestyle Sandboxes package
<InstallSandboxes includePip />
</Step>
<Step>
### Get your API key
Go to the [Freestyle Dashboard](https://admin.freestyle.sh) and get your API key
</Step>
<Step>
### Create a Domain Verification Request

<CodeTabs
typescript={{
code: `
import { FreestyleSandboxes } from "freestyle-sandboxes";

      const api = new FreestyleSandboxes({
        apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
      });

      const domainVerificationRequset = api.createDomainVerificationRequest("yourdomain.com") // this also works for subdomains
        .then((result) => {
          console.log("Domain verification request created @ ", result);
          /* The result looks like: {
            verificationCode: string;
            domain: string;
          } */
        });
    `,
    title: "createDomainVerification.js"

}}

    python={{

code: `

    import freestyle

    client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

    verification_request = client.create_domain_verification_request(
        domain="yourdomain.com" # this also works for subdomains
    )

    print("Domain verification request created successfully!")
    print(f"Domain: {verification_request.domain}")
    print(f"Verification Code: {verification_request.verification_code}")
    print(f"Id: {verification_request.id}")

`,
title: "create_domain_verification.py"

}}
/>

You can also view your domain verification request in the [Freestyle Dashboard](https://admin.freestyle.sh)

</Step>
<Step>
### Add the record

Add the following DNS record to your domain's DNS settings:

```txt
Type: TXT
Name: _freestyle_custom_hostname.{yourdomain.com}
Value: {verificationCode}

```

You can check if its propagated by running the following command:

```bash
dig TXT _freestyle_custom_hostname.{yourdomain.com}

```

</Step>
<Step>
### Verify the domain

<CodeTabs
typescript={{
code: `
import { FreestyleSandboxes } from "freestyle-sandboxes";

      const api = new FreestyleSandboxes({
        apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
      });

      const domainVerificationRequset = api
        .verifyDomain("yourdomain.com") // this also works for subdomains
        .then((result) => {
          if (result.domain) {
            console.log("Domain verified @ ", result.domain);
          } else {
            console.log("Domain verification failed", result.message);
          }
        });
    `,
    title: "verifyDomain.js"

}}
python={{
code: `

      import freestyle

      client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

      domain_verification_result = client.verify_domain("yourdomain.com")  # this also works for subdomains
      if domain_verification_result.domain:
          print("Domain verified @ ", domain_verification_result.domain)
      else:
          print("Domain verification failed", domain_verification_result.message)
    `,
    title: "verify_domain.py"

}}
/>

You can see if the domain is verified in the **Domains** section of the [Freestyle Dashboard](https://admin.freestyle.sh)

</Step>

</Steps>

## Next Steps

- [Deploy to a Custom Domain](/Getting-Started/deploy-to-custom-domain)

=== Getting-Started/meta.json ===
{
"pages": [
"web",
"domains",
"deploy-to-custom-domain",
"run",
"dev-servers"
]
}
=== Getting-Started/run.mdx ===

---

title: Run Code
description: Run code you didn't write

---

import InstallSandboxes from "../../../src/components/installSandboxes";
import { CodeTabs } from "../../../src/components/code-tabs";
import { Steps, Step } from "fumadocs-ui/components/steps";

## Simple Code Execution

<Steps>
  <Step>
    ### Install the required dependencies

    <InstallSandboxes includePip />

  </Step>
  <Step>
  ### Create a Freestyle Client

<CodeTabs
typescript={{
title: "run.ts",
code: `

    import { FreestyleSandboxes } from "freestyle-sandboxes";

    const api = new FreestyleSandboxes({
      apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
    });

`,

}}

python={{
title: "run.py",
code: `
import freestyle

client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY") # make sure to set this
`,
}}
/>

  </Step>
  <Step>
  ### Run the code

<CodeTabs
typescript={{
title: "run.ts",
code: `
import { FreestyleSandboxes } from "freestyle-sandboxes";

const api = new FreestyleSandboxes({
apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
});

const code = \`export default () => {
// calculate the factorial of 543
return Array.from({ length: 543 }, (\_, i) => i + 1).reduce((acc, cur) => acc \* cur, 1);
}\`;

api.executeScript(code).then((result) => {
console.log("Result: ", result);
});
`}}

python={{
title: "run.py",
code: `
import freestyle
client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY") # make sure to set this

const code = """
export default () => {
// calculate the factorial of 543
return Array.from({ length: 543 }, (\_, i) => i + 1).reduce((acc, cur) => acc \* cur, 1);
}
"""

response = client.execute_script(code)

print(f"Result: {response.result}")

`}}
/>

  </Step>

</Steps>
## Advanced Code Execution

### Custom Node Modules

<CodeTabs
typescript={{
code: `
import { FreestyleSandboxes } from "freestyle-sandboxes";

      const api = new FreestyleSandboxes({
        apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
      });

      api
        .executeScript(
          \`import axios from 'axios';

          export default async () => {
            // Fetch data from an external API
            const res = await axios.get('https://jsonplaceholder.typicode.com/todos/1');
            return res.data;
          }\`,
          {
            nodeModules: {
              axios: "0.21.1", // specify the version of the module you want to use
            },
          }
        )
        .then((result) => {
          console.log("Result: ", result);
        });
    `,
    title: "run.js"

}}
python={{
code: `

      import freestyle

      client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

      result = client.execute_script(
          code="""

          import axios from 'axios';

          export default async () => {
              // Fetch data from an external API
              const res = await axios.get('https://jsonplaceholder.typicode.com/todos/1');
              return res.data;
          }
          """,
          freestyle.FreestyleExecuteScriptParamsConfiguration(
            node_modules={
              "axios": "0.21.1"  # specify the version of the module you want to use
            }
          }
        ),
      )
      print(f"Result: {result.result}")
    `,
    title: "run.py"

}}
/>

This pattern can be used for any node modules, and can be used to connect to any API or service.

### Custom Environment Variables

<CodeTabs
typescript={{
code: `
import { FreestyleSandboxes } from "freestyle-sandboxes";

      const api = new FreestyleSandboxes({
        apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
      });

      api
        .executeScript(\`return process.env.SOME_ENV_VAR;\`, {
          envVars: {
            SOME_ENV_VAR: "Hello, World!",
          },
        })
        .then((result) => {
          console.log("Result: ", result);
        });
    `,
    title: "run.js"

}}
python={{
code: `
import freestyle

      client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

      result = client.execute_script(
          code="""
          return process.env.SOME_ENV_VAR;
          """,
          freestyle.FreestyleExecuteScriptParamsConfiguration(
              env_vars={
                  "SOME_ENV_VAR": "Hello, World!"
              }
          )
      )

      print(f"Result: {result.result}")
    `,
    title: "run.py"

}}
/>

Environment variables are accessible via the `process.env` object in the code execution environment.

## Running Code with AI

Check out our integrations — we have support for all major AI Agent frameworks.
AI models today have gotten incredibly good at writing code, when you give your Agents the ability to run code the scope of problems they can solve.
Specifically it makes, data integration and analytical questions. When connecting to an external tool you can build 20 different tools, or you can give your AI the docs and let it figure out how to connect — the ladder is much more adaptable.

Most people who use us start with the prebuilt AI integrations liners, but then move towards a more fine grained approach executing the code themselves with custom definitions.

## === Getting-Started/web.mdx ===

title: Deploying a Website
description: How to deploy a website you didn't write with Freestyle

---

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { CodeBlock } from "fumadocs-ui/components/codeblock";
import InstallSandboxes from "../../../src/components/installSandboxes";
import { CodeTabs } from "../../../src/components/code-tabs";
import { Steps, Step } from "fumadocs-ui/components/steps";
import {
Tab,
Tabs,
TabsTrigger,
TabsList,
TabsContent,
} from "fumadocs-ui/components/tabs";

This guide will go through how to deploy a sample website on Freestyle using our JavaScript SDK.

<Steps>
<Step>
### Install the Freestyle Sandboxes package
First, install the package with your preferred package manager
<InstallSandboxes includePip />
</Step>

<Step>

### Get your API key

Go to the [Freestyle Dashboard](https://admin.freestyle.sh) and get your API key

</Step>

<Step>
### Deploy the website

Create a deploy script in the root of the repo with the following code:

<CodeTabs
typescript={{
code: `
import { FreestyleSandboxes } from "freestyle-sandboxes";

      const api = new FreestyleSandboxes({
        apiKey: process.env.FREESTYLE_API_KEY!, // make sure to set this
      });

      api
        .deployWeb(
          {
            kind: "git",
            url: "https://github.com/freestyle-sh/freestyle-base-nextjs-shadcn", // URL of the repository you want to deploy
          },
          {
            domains: ["yourtestdomain.style.dev"],
            build: true, // automatically detects the framework and builds the code
          }
        )
        .then((result) => {
          console.log("Deployed website @ ", result.domains);
        });
    `,
    title: "deploy.js"

}}
python={{
code: `

      import freestyle

      client = freestyle.Freestyle("YOUR_FREESTYLE_API_KEY")

      response = client.deploy_web(
          src=freestyle.DeploymentSource.from_dict(
          {
              "kind": "git",
              "url": "https://github.com/freestyle-sh/freestyle-base-nextjs-shadcn",
          }
          ),
          config=freestyle.FreestyleDeployWebConfiguration(
              domains=["welcomepython.style.dev"],
              build=freestyle.DeploymentBuildOptions.from_dict(True),
          ),
      )


      print(
          f"Deployed website @ {response.domains}"
      )
    `,
    title: "deploy.py"

}}
/>

Then run the file to deploy the website:

<CodeTabs
script
typescript={{
    code: `node deploy.js`,
    title: "JavaScript",
  }}
python={{
    code: `python deploy.py`,
    title: "Python",
  }}
/>

</Step>

</Steps>

## Next Steps

- If you want to deploy to custom domain, first you need to [verify a domain](/Getting-Started/domains)

## === git/git-objects-api.mdx ===

title: The Git Objects API
description: A comprehensive guide to working with Git objects (blobs, commits, trees, tags, and refs) in Freestyle

---

# Git Objects API

The Git Objects API allows you to access and explore Git objects directly from your repositories. This API is useful for building tools that need to understand Git repository structure, inspect files, visualize commit history, and more.

## Overview

Git stores all data as objects of four fundamental types:

1. **Blobs** - Raw file content
2. **Trees** - Directory listings mapping names to blobs or other trees
3. **Commits** - Snapshots of the repository at a specific point in time
4. **Tags** - References to specific commits with additional metadata

The Git Objects API in Freestyle provides access to all these object types through a consistent REST API.

## Usage

### Blobs

Blobs represent the content of files in Git. When you retrieve a blob, you get the raw file content (always base64 encoded for binary safety).

#### Get a Blob

```javascript
// Using fetch directly with the API
fetch(`https://api.freestyle.sh/git/v1/repo/${repoId}/git/blobs/${blobHash}`, {
  headers: {
    Authorization: 'Bearer your-api-key',
  },
})
  .then(response => response.json())
  .then(blob => {
    // blob.content is base64 encoded
    const decodedContent = atob(blob.content)
    console.log(decodedContent)
  })
```

Response structure:

```typescript
interface BlobObject {
  // The blob content (base64 encoded)
  content: string
  // Always "base64"
  encoding: 'base64'
  // The blob's hash
  sha: string
}
```

### Commits

Commits represent snapshots of your repository at specific points in time.

#### Get a Commit

```javascript
fetch(`https://api.freestyle.sh/git/v1/repo/${repoId}/git/commits/${commitHash}`, {
  headers: {
    Authorization: 'Bearer your-api-key',
  },
})
  .then(response => response.json())
  .then(commit => {
    console.log(commit.message)
    console.log(commit.author)
    console.log(commit.tree.sha)
  })
```

Response structure:

```typescript
interface CommitObject {
  // The commit author
  author: {
    date: string
    name: string
    email: string
  }
  // The committer (may be different from author)
  committer: {
    date: string
    name: string
    email: string
  }
  // The commit message
  message: string
  // The tree this commit points to
  tree: {
    sha: string
  }
  // Parent commits (usually one, multiple for merge commits)
  parents: Array<{
    sha: string
  }>
  // The commit's hash
  sha: string
}
```

### Trees

Trees represent directories in Git. A tree object contains a list of entries, each with a name, type (blob or tree), and hash.

#### Get a Tree

```javascript
fetch(`https://api.freestyle.sh/git/v1/repo/${repoId}/git/trees/${treeHash}`, {
  headers: {
    Authorization: 'Bearer your-api-key',
  },
})
  .then(response => response.json())
  .then(tree => {
    // Inspect files and subdirectories
    tree.tree.forEach(entry => {
      if (entry.type === 'blob') {
        console.log(`File: ${entry.path}`)
      } else if (entry.type === 'tree') {
        console.log(`Directory: ${entry.path}`)
      }
    })
  })
```

Response structure:

```typescript
interface TreeObject {
  // The tree's entries (files and subdirectories)
  tree: Array<{
    // The entry's type: "blob" (file) or "tree" (directory)
    type: 'blob' | 'tree'
    // The entry's path (filename or directory name)
    path: string
    // The entry's hash
    sha: string
  }>
  // The tree's hash
  sha: string
}
```

### Tags

Tags are references to specific objects (usually commits) with additional metadata like tagger information and a message.

#### Get a Tag

```javascript
fetch(`https://api.freestyle.sh/git/v1/repo/${repoId}/git/tags/${tagHash}`, {
  headers: {
    Authorization: 'Bearer your-api-key',
  },
})
  .then(response => response.json())
  .then(tag => {
    console.log(tag.name)
    console.log(tag.message)
    console.log(tag.target.sha)
  })
```

Response structure:

```typescript
interface TagObject {
  // The tag name
  name: string
  // The tagger (may be null for lightweight tags)
  tagger?: {
    date: string
    name: string
    email: string
  }
  // The tag message (may be null for lightweight tags)
  message?: string
  // The object this tag points to (usually a commit)
  target: {
    sha: string
  }
  // The tag's hash
  sha: string
}
```

## Common Use Cases

### Processing Files from a Git Trigger

When a Git trigger is invoked by a push to your repository, Freestyle sends a payload containing information about the event, including the commit hash. You can use this to inspect files that were changed in the commit:

```javascript
// This function would be called by your webhook handler
async function processGitTriggerWebhook(webhookPayload, apiKey) {
  const repoId = webhookPayload.repoId
  const commitHash = webhookPayload.commit

  const headers = {
    Authorization: `Bearer ${apiKey}`,
  }

  // Get the commit to find what was changed
  const commitResponse = await fetch(
    `https://api.freestyle.sh/git/v1/repo/${repoId}/git/commits/${commitHash}`,
    { headers },
  )
  const commit = await commitResponse.json()

  console.log(`Processing commit: ${commit.message}`)
  console.log(`Author: ${commit.author.name} <${commit.author.email}>`)

  // Get the tree pointed to by the commit
  const treeResponse = await fetch(
    `https://api.freestyle.sh/git/v1/repo/${repoId}/git/trees/${commit.tree.sha}`,
    { headers },
  )
  const rootTree = await treeResponse.json()

  // Example: Find package.json in the repository
  const packageJsonEntry = treeEntries.find(
    entry => entry.type === 'blob' && entry.path === 'package.json',
  )
  if (packageJsonEntry) {
    // Get the content of package.json
    const blobResponse = await fetch(
      `https://api.freestyle.sh/git/v1/repo/${repoId}/git/blobs/${packageJsonEntry.sha}`,
      { headers },
    )
    const blob = await blobResponse.json()

    // Parse the package.json content
    const packageJson = JSON.parse(atob(blob.content))
    console.log(`Project name: ${packageJson.name}`)
    console.log(`Dependencies: ${Object.keys(packageJson.dependencies || {}).length}`)
  }
}
```

### Building a File Browser

You can build a recursive file browser:

```javascript
async function exploreDirectory(repoId, treeSha, apiKey, currentPath = '') {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  }

  const treeResponse = await fetch(
    `https://api.freestyle.sh/git/v1/repo/${repoId}/git/trees/${treeSha}`,
    { headers },
  )
  const tree = await treeResponse.json()

  for (const entry of tree.tree) {
    const entryPath = currentPath ? `${currentPath}/${entry.path}` : entry.path

    if (entry.type === 'tree') {
      // Recursively explore subdirectories
      await exploreDirectory(repoId, entry.sha, apiKey, entryPath)
    } else if (entry.type === 'blob') {
      // Process files
      console.log(`File: ${entryPath}`)
      // You could fetch the blob content here if needed
    }
  }
}
```

### Viewing File Contents from a Specific Commit

```javascript
async function viewFileAtCommit(repoId, commitHash, filePath, apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  }

  // Get the commit
  const commitResponse = await fetch(
    `https://api.freestyle.sh/git/v1/repo/${repoId}/git/commits/${commitHash}`,
    { headers },
  )
  const commit = await commitResponse.json()

  // Get the root tree
  let treeResponse = await fetch(
    `https://api.freestyle.sh/git/v1/repo/${repoId}/git/trees/${commit.tree.sha}`,
    { headers },
  )
  let currentTree = await treeResponse.json()

  // Navigate the directory structure
  const pathParts = filePath.split('/')
  const fileName = pathParts.pop()

  for (const directory of pathParts) {
    const dirEntry = currentTree.tree.find(entry => entry.type === 'tree' && entry.path === directory)

    if (!dirEntry) {
      throw new Error(`Directory not found: ${directory}`)
    }

    treeResponse = await fetch(
      `https://api.freestyle.sh/git/v1/repo/${repoId}/git/trees/${dirEntry.sha}`,
      { headers },
    )
    currentTree = await treeResponse.json()
  }

  // Find the file in the current directory
  const fileEntry = currentTree.tree.find(entry => entry.type === 'blob' && entry.path === fileName)

  if (!fileEntry) {
    throw new Error(`File not found: ${fileName}`)
  }

  // Get the file content
  const blobResponse = await fetch(
    `https://api.freestyle.sh/git/v1/repo/${repoId}/git/blobs/${fileEntry.sha}`,
    { headers },
  )
  const blob = await blobResponse.json()

  // Decode and return the content
  return atob(blob.content)
}
```

## Best Practices

1. **Cache results when possible** - Git objects are immutable, so you can safely cache them
2. **Handle binary data correctly** - Remember that blob content is base64 encoded

## Conclusion

The Git Objects API provides low-level access to Git repository data, enabling you to build powerful tools for Git repository management, visualization, and integration with other systems.

For detailed API reference documentation, see the [API Reference](/API-Reference/git/handle_get_blob) section.

Refs API coming soon.

## === git/github-sync.mdx ===

title: GitHub Synchronization
description: Seamlessly sync your Freestyle repositories with GitHub using bidirectional synchronization

---

import { CodeTabs } from "../../../src/components/code-tabs";

# GitHub Synchronization

Freestyle provides seamless bidirectional synchronization between your Freestyle repositories and GitHub repositories. This integration allows you to maintain synchronized code across both platforms while leveraging Freestyle's infrastructure capabilities alongside GitHub's collaboration features.

## Overview

The GitHub sync feature enables you to:

- **Automatically sync changes** between Freestyle and GitHub repositories
- **Leverage GitHub workflows** on the Github side while using Freestyle's infrastructure
- **Collaborate on GitHub** your users' teams can continue to use Github without interruption while you utilize Freestyle's infrastructure
- **Avoid conflicts** with intelligent conflict detection

## How It Works

Freestyle's GitHub integration uses GitHub Apps to provide secure, repository-specific access. When you push code to either platform, changes are automatically synchronized to the other, ensuring both repositories stay in sync.

### Architecture

1. **GitHub App**: You own the custom Github app with repository permissions for secure access to the repositories on Github
2. **Webhook Processing**: You get real-time notifications when code changes occur on Github or on Freestyle
3. **Bidirectional Sync**: When a change is made on the Github repository, its proactively synced to the Freestyle repository, and vice versa
4. **Conflict Detection**: We prevents data loss by detecting diverged branches before applying changes

## Setup Process

### Step 1: Create a GitHub App

<Callout type="info">
  **Coming Soon**: Bring-your-own GitHub App support will be available soon,
  allowing you to use your existing GitHub Apps with Freestyle's sync system.
</Callout>

1. Navigate to the **Git > Sync** section in your [Freestyle Admin Dashboard](https://admin.freestyle.sh)
2. Click **"Create GitHub App"**
3. Choose a custom name for your GitHub App (this will be visible to users when they install it)
4. Click **"Create App"** - you'll be redirected to GitHub to confirm app creation
5. After confirming on GitHub, you'll be redirected back to Freestyle where your app credentials are automatically encrypted and stored

### Step 2: Configure App Settings (Optional)

You can customize your GitHub App settings if needed:

1. From the sync page, click **"Configure on GitHub"** or navigate directly to your app on GitHub
2. Update **App Name**, **Homepage URL**, or **Description** as desired

<Callout type="warning">
  **Important**: Do not change the webhook URL or remove any permissions, as
  this will break synchronization functionality.
</Callout>

### Step 3: Install the App

To sync repositories, the GitHub App must be installed on the repositories you want to sync:

**For App Builders**: You'll need to have your users install your GitHub App on their repositories. Each user must install the app to enable sync with their own repos.

**Installation Process**:

1. From the sync page, click **"Install on GitHub"** or go to your GitHub App's page
2. Click **"Install"** (or **"Configure"**, if already installed)
3. Choose which repositories or organizations to grant access to:
   - **All repositories**: Grants access to all current and future repos
   - **Selected repositories**: Choose specific repositories to sync

**Sharing with Users**: You can share your GitHub App's installation page with users by providing them with the app URL from your GitHub App settings.

## Repository Configuration

Once your GitHub App is installed on the target repositories, you can configure repository synchronization:

### Linking Repositories

#### Via Admin Dashboard

1. In your Freestyle admin dashboard, navigate to **Git > Repositories**
2. Select the Freestyle repository you want to sync
3. Click **"Configure GitHub Sync"**
4. Choose the corresponding GitHub repository from the repositories where your app is installed
5. Save the configuration

#### Via API

To configure sync programmatically, you can use the GitHub sync endpoint or our SDK.

<CodeTabs
typescript={{
title: "JavaScript",
code: `
const freestyle = new FreestyleSandboxes({
apiKey: process.env.FREESTYLE_API_KEY!,
});

      // Configure GitHub sync for a Freestyle repository
      // The GitHub repository must have your GitHub App installed
      await freestyle.configureGitRepoGitHubSync({
        repoId: "your-freestyle-repo-id", // The ID of the Freestyle repository to sync
        githubRepoName: "user/repo-name", // The full name of the GitHub repository (e.g., "user/repo")
      });
    `

}}
python={{
    title: "Python",
    code: "Python SDK does not yet support GitHub sync configuration. Please use the JavaScript SDK or the API directly for now."
  }}
/>

For complete API documentation on configuring GitHub sync, see the [GitHub Sync Configuration API Reference](/API-Reference/git/configure_github_sync).

<Callout type="info">
  **For App Builders**: You can only link repositories where your users have
  installed your GitHub App. Make sure your users have completed the app
  installation process first.
</Callout>

### Sync Behavior

When repositories are linked, synchronization happens automatically:

#### Automatic Sync Triggers

- **GitHub → Freestyle**: Triggered when you push to GitHub
- **Freestyle → GitHub**: Triggered when you push to your Freestyle repository
- **Branch Operations**: New branches, branch deletions, and updates

#### What Gets Synced

- **All branches**: Including main, feature branches, and release branches
- **Commit history**: Complete Git history is preserved
- **Tags**: Git tags are synchronized between repositories
- **Branch deletions**: Removing branches on one side removes them on the other

## Sync Process Details

### Bidirectional Synchronization

Freestyle's sync engine performs intelligent bidirectional synchronization:

1. **Fetch Updates**: Retrieves all changes from both repositories
2. **Analyze Branches**: Checks each branch for conflicts or divergence
3. **Fast-Forward Merges**: Applies updates where branches haven't diverged
4. **Conflict Detection**: Identifies branches that have conflicting changes
5. **Safe Updates**: Only applies changes that won't cause data loss

### Conflict Handling

When conflicts are detected, Freestyle prioritizes data safety:

- **No Automatic Merges**: Conflicting branches are not automatically merged
- **Conflict Detection**: Conflicts can be viewed in the admin dashboard
- **Manual Resolution**: You can resolve conflicts manually in either repository
- **Resume Sync**: Once conflicts are resolved, sync resumes automatically

<Callout type="info">
  **Note**: Automatic conflict notifications and monitoring are not yet
  implemented. You'll need to check the admin dashboard or a clone of the repo
  to monitor for conflicts.
</Callout>

### Branch Management

The sync engine handles various branch scenarios:

- **New Branches**: Created on both repositories when added to either side
- **Updated Branches**: Fast-forwarded when no conflicts exist
- **Deleted Branches**: Removed from both repositories when deleted from either side
- **Diverged Branches**: Requires manual resolution, we **never** force push or overwrite branches.

## === git/index.mdx ===

title: Overview
description: Learn how to use Freestyle's Git API to manage and deploy code from Git repositories

---

# Git with Freestyle

Freestyle provides a comprehensive Git API that enables you to manage Git repositories, control access permissions, and set up automation triggers. This document covers everything you need to know about using Git with Freestyle.

## Overview

Freestyle's Git support allows you to:

- Create and manage Git repositories
- Control repository access with identity-based permissions
- Set up automation triggers for repository events
- Integrate with CI/CD workflows
- Deploy applications directly from Git

## Git Repositories

### Creating a Repository

To create a new Git repository:

```javascript
import { FreestyleSandboxes } from 'freestyle-sandboxes'

const sandboxes = new FreestyleSandboxes({
  apiKey: 'your-api-key',
})

// Create a basic repository
sandboxes
  .createGitRepository({
    name: 'example-repo',
  })
  .then(res => {
    console.log(res.repoId)
  })
```

<Callout type="info">
  Note that the name of the repository is optional and is for display purposes
  only. The actual repository ID is generated by Freestyle.
</Callout>

Create a public repository:

```javascript
sandboxes
  .createGitRepository({
    name: 'public-example',
    public: true,
  })
  .then(res => {
    console.log(res.repoId)
  })
```

Create a repository from an existing Git repository

```javascript
sandboxes.createGitRepository({
  name: 'cloned-example',
  source: {
    type: 'git',
    url: 'https://github.com/freestyle-sh/cloudstate',
    branch: 'main' // Optional: specify branch to checkout
    depth: 0, // Optional: shallow clone
  }
}).then(res => {
  console.log(res.repoId);
});
```

<Callout type="info">
  Note that there is currently no support for private repositories from outside
  of Freestyle.
</Callout>

After creating a repository, you can push code to it using the standard Git CLI:

```bash
# Add the repository as a remote
git remote add freestyle https://git.freestyle.sh/your-repo-id

# Push your code
git push freestyle main
```

### Listing Repositories

You can list all repositories associated with your account:

```javascript
sandboxes.listGitRepositories().then(repos => {
  console.log(repos)
})
```

### Deleting Repositories

When you no longer need a repository, you can delete it:

```javascript
sandboxes
  .deleteGitRepository({
    repoId: 'repo-id',
  })
  .then(() => {
    console.log('Repository deleted')
  })
```

## Identity and Access Management

Freestyle uses identity-based access control for Git repositories. This allows you to create separate identities for different purposes (e.g., CI/CD, team members) and grant them specific permissions.

### Creating an Identity

```javascript
sandboxes.createGitIdentity().then(identity => {
  console.log(identity.id)
})
```

### Managing Access Tokens

Each identity can have one or more access tokens used for authentication:

```javascript
// Create a token for an identity
sandboxes
  .createGitToken({
    identityId: 'identity-id',
  })
  .then(token => {
    console.log(token.value) // Store this securely
  })

// List tokens for an identity
sandboxes
  .listGitTokens({
    identityId: 'identity-id',
  })
  .then(tokens => {
    console.log(tokens)
  })

// Revoke a token
sandboxes
  .revokeGitToken({
    identityId: 'identity-id',
    tokenId: 'token-id',
  })
  .then(() => {
    console.log('Token revoked')
  })
```

### Managing Permissions

You can grant identities different levels of access to your repositories:

```javascript
// Grant read-only access
sandboxes
  .grantPermission({
    identityId: 'identity-id',
    repoId: 'repo-id',
    permission: 'read',
  })
  .then(() => {
    console.log('Read access granted')
  })

// Grant read-write access
sandboxes
  .grantPermission({
    identityId: 'identity-id',
    repoId: 'repo-id',
    permission: 'write',
  })
  .then(() => {
    console.log('Write access granted')
  })

// List permissions for an identity
sandboxes
  .listPermissions({
    identityId: 'identity-id',
  })
  .then(permissions => {
    console.log(permissions)
  })

// Revoke access
sandboxes
  .revokePermission({
    identityId: 'identity-id',
    repoId: 'repo-id',
  })
  .then(() => {
    console.log('Access revoked')
  })
```

## Git Triggers

Git triggers allow you to automate actions when certain events occur in your repositories, such as a push to a specific branch.

### Creating a Trigger

```javascript
// Create a webhook trigger for all pushes to the main branch
sandboxes
  .createGitTrigger({
    repoId: 'repo-id',
    trigger: {
      event: 'push',
      branch: ['main'], // Optional: filter by branch
      fileGlob: ['*.js'], // Optional: filter by file patterns
    },
    action: {
      type: 'webhook',
      url: 'https://your-webhook-url.com',
    },
  })
  .then(result => {
    console.log(`Trigger created: ${result.triggerId}`)
  })
```

The `action` currently only supports webhooks.

The webhook payload includes the following fields:

```typescript
interface GitTriggerPayload {
  repoId: string
  // The name of the branch that was updated
  branch: string
  // The SHA of the commit that triggered the webhook
  commit: string
}
```

#### Local Development

For local development, you can use a tool like [tailscale](https://tailscale.com) to create a secure tunnel to your localhost, allowing your webhook to receive events from Freestyle.

You can setup Tailscale by following the quickstart guide [here](https://tailscale.com/kb/1017/install).

To set up a tunnel once you have `tailscale` installed, you can use the following command (Replace `3000` with the port your server is listening on):

```bash
tailscale funnel 3000
```

This exposes your server to the public internet on a url given to you by Tailscale.

The output should look like this:

```
Available on the internet:

https://<device name>.<tailnet id/name>.ts.net/
|-- proxy http://127.0.0.1:3000

Press Ctrl+C to exit.
```

Use the provided url as the webhook URL in your trigger configuration.

### Listing Triggers

```javascript
sandboxes
  .listGitTriggers({
    repoId: 'repo-id',
  })
  .then(triggers => {
    console.log(triggers)
  })
```

### Deleting Triggers

```javascript
sandboxes
  .deleteGitTrigger({
    repoId: 'repo-id',
    triggerId: 'trigger-id',
  })
  .then(() => {
    console.log('Trigger deleted')
  })
```

## Authentication for Git Operations

To authenticate Git CLI operations with Freestyle, you'll need to configure Git to use your access token:

```bash
# Set up credential helper for freestyle domains
git config --global credential.helper store
echo "https://x-access-token:your-token@git.freestyle.sh" >> ~/.git-credentials
```

For non-standard Git clients that only provide an `access token` field, just use the token.

<Callout type="info">

The username is your identity ID, and the password is your access token. The access token
ID is only used for revoking the token and isn't needed here.

Don't do this on a shared machine, as it will set your git credentials globally. To do this
locally, you can use the `--local` flag with `git config`.

</Callout>

## Continuous Integration Example

Here's an example of how to set up a CI workflow with Freestyle Git:

1. Create a dedicated Git identity for CI:

```javascript
const ciIdentity = await sandboxes.createGitIdentity()
const token = await sandboxes.createGitToken({
  identityId: ciIdentity.id,
})
console.log(`CI token: ${token.value}`)
```

2. Grant the identity write access to your repository:

```javascript
await sandboxes.grantPermission({
  identityId: ciIdentity.id,
  repoId: 'repo-id',
  permission: 'write',
})
```

3. Set up a webhook trigger to notify your CI system:

```javascript
await sandboxes.createGitTrigger({
  repoId: 'repo-id',
  trigger: {
    event: 'push',
    branch: ['main'],
  },
  action: {
    type: 'webhook',
    url: 'https://your-ci-system.com/webhook',
  },
})
```

4. Configure your CI system to clone the repository, run tests, and deploy if successful.

## Deployment with Git

Freestyle makes it easy to deploy applications directly from Git repositories:

```javascript
// TODO: This is not yet implemented
// Deploy a web application from a Git repository
const yourRepoId = "your-repo-id";

sandboxes
  .deployWeb({
    source: {
      type: "git",
      url: `https://git.freestyle.sh/${yourRepoId}`,
      branch: "main", // Optional: defaults to main
    },
    {
      entrypoint: "index.js", // Optional: defaults to index.js
      domains: ["example.style.dev"], // Optional: specify domains
      build: true // automatically detect your framework and build for you
    }
  })
  .then((deployment) => {
    console.log(`Deployed to: ${deployment.url}`);
  });
```

## Git Objects API

Freestyle provides a Git Objects API that allows you to access and explore Git objects directly from your repositories. This API is useful for building tools that need to understand Git repository structure, inspect files, visualize commit history, and more.

For a detailed guide on working with Git objects, check out our [Git Objects API Guide](/git/git-objects-api).

## GitHub Synchronization

Freestyle provides seamless bidirectional synchronization between your Freestyle repositories and GitHub repositories. This integration allows you to maintain synchronized code across both platforms while leveraging Freestyle's infrastructure.

For complete setup instructions and usage details, see our [GitHub Sync Guide](/git/github-sync).

## API Reference

For complete details on all available Git API endpoints, refer to the [API Reference](/api-reference/git) section.

## Best Practices

1. **Use dedicated identities** for different purposes (CI/CD, team members, etc.)
2. **Regularly rotate access tokens** for security
3. **Limit permissions** to the minimum required access level
4. **Use webhooks** to integrate with your existing CI/CD workflows
5. **Secure sensitive variables** using environment variables rather than committing them to your repository

=== git/meta.json ===
{
"pages": [
"index",
"github-sync",
"git-objects-api"
]
}
=== guides/app-builder/index.mdx ===

---

title: Building an AI App Builder
description: How to make an AI App Builder on Freestyle

---

import { Mermaid } from "../../../../src/components/mermaid";

Freestyle is **the cloud for AI App Builders**. We provide all the tools you need to build, preview, deploy and manage the code your AI writes. This guide shows you how to build with Freestyle, how we think about our tools, and how to get the most out of them.

## Architecture

### Managing the Code with Git

The life blood of every AI App is the code that powers it. To make the most of it, we provide a [Git](/git) API for creating and managing repositories.

We recommend using Git to manage the code your AI writes because:

- **Version Control**: You get a free version history, along with reverting, branching, and merging.
- **Collaboration**: You can have multiple agents working on different prototypes and merging them together.
- **Debugability**: Your AI's process is tracked over time, and you can clone any of its prototypes locally anytime.
- **Portability**: You can sync your repo's to Github, or give your users the ability to clone them locally and work alongside your AI.
- **Integration**: By working through Git, we can provide live previews based on the current versions of the code, along with automatic deployments — the same way you get with the Continuous Integration and Continuous Deployment (CI/CD) tools you're used to.

### Developing with Dev Servers

As your AI writes code, it needs some form of development server to run it on. This development server has jobs like linting the code, running it (or running tests), and serving it to the browser to preview it for your users. We provide a [Dev Servers](/Getting-Started/dev-servers) API for creating and managing these servers.

The Dev Server API is **not a generic container API**, it is specialized for lifecycle management of **JavaScript/TypeScript** apps. Instead of making you manage the lifecycle, it runs through Git and is synced to the latest version of a given git repository. The Dev Server automatically keeps your dev server healthy, routes traffic to a given url to provide a live preview, manages npm installs, and shuts down when the code is not being used. It's also controllable via both an HTTP API and an MCP service that lets you or your agents control it.

This api is not the most powerful container API in the market — this is by design. We believe AI App Builders should be able to focus on building apps, not managing container lifecycle and health. The Dev Server API is designed to take this off your plate. It is designed to be extensible, but if you are looking for a generic container API, this is not it.

### Deploying Previews

Once your AI has written code, it needs to be deployed to a live server. Dev Server's are slow, expensive to run and non-scalable. We provide a [Deployments](/Getting-Started/web) API for deploying your code to our production serverless infrastructure.

This API is extremely customizable, you can build that app yourself, have it detect the framework and build for you, or configure your own build, then you can add any number of domains, environment variables, advanced security features like network permissions and more. It also manages the related DNS, routing and TLS Certificates without you needing to do anything.

Any Freestyle user can deploy their code to any `*.style.dev` domain, and can also deploy to their own custom domains.

AI App Builders should have their own `*.yourapp.com` domain that you use to deploy initial production versions of your app to. You can set this up with the [following guide](/Getting-Started/domains) and point the domain at us following the [DNS Instructions](/Getting-Started/deploy-to-custom-domain). This **should not be a subdomain of any domains you use** for security reasons.

The simplest way to deploy if you're using [Git](/git) is to set the deployment source to your git repository itself. This way, we'll automatically pull the latest version of your code, build it and deploy it. You can do this yourself, or you can set up a Git Trigger to automatically deploy your code whenever you push to a given branch. This is the same way you would do it with any other CI/CD tool.

### Production Deployments

Once your users see the live preview of the app, they'll want to deploy it to their own domains. This is where the [domains](/Getting-Started/domains) API comes in. This API allows you to deploy your app to any custom domain.

Domains on Freestyle are completely decoupled from deployments, allowing you to attach/detach them at will.

In order to do this, you should create an API that takes your users through the [same verification process for managing your own domain](/Getting-Started/domains) you went through to set up your own domain. Then tell them to point their domain at us following the [DNS Instructions](/Getting-Started/deploy-to-custom-domain). Once they do that, you can deploy their app to their domain using the [Deployments](/Getting-Started/web) API.

### All together

<Mermaid chart="flowchart TB
T([AI App Builder on Freestyle]):::title
A[New Chat] --> B[Chat Git Repo]
C[Template Repo] --> B
B --> D[Request Dev Server]
D --> E[Dev Server]

    E <---> F[AI Agent]
    F --> G[Commits to Chat Repo]
    G -- Update Code for Future Dev Server Sessions --> B
    G -.-> H[Publish Website]
    I[Click Deploy Button] -.-> H

    B -.-> J[User clones the git repo]
    J --> G

    classDef title font-size:24px,font-weight:bold;

" />

All these together make up an AI App Builder built on Freestyle. Our goal is to take the pain of infrastructure off of building an AI App Builder to let you focus on everything else. If this architecture is compelling to you, check out our [example repository here](https://github.com/freestyle-sh/adorable).

## Guide

This guide will take you through the process of building an AI App Builder on Freestyle. While we will use an opinionated tech stack, we've intentionally segmented the guide into different sections so you can take the parts you like and leave the rest. The goal is to give you a starting point for building your own AI App Builder.

### Tech Stack

- [TypeScript](https://www.typescriptlang.org/) - This AI App Builder will be built 100% in Full Stack TypeScript.
- [NextJS](https://nextjs.org/)
- [Vercel AI SDK](https://sdk.vercel.ai) - We will use the Vercel AI SDK to handle our Chat UI and message streaming.
- [Freestyle](https://freestyle.sh/) - We will use Freestyle to manage our Git Repositories, Dev Servers and Deployments.
- [Anthropic](https://www.anthropic.com/) - We will use Anthropic's Claude to power our AI. You can use any LLM you want, but we like Claude.

### Setup

#### Setting up the Project

```bash
npx create-next-app@latest --ts --tailwind --yes  freestyle-ai-app-builder
cd freestyle-ai-app-builder
npm install freestyle-sandboxes ai @ai-sdk/react @ai-sdk/anthropic @modelcontextprotocol/sdk
```

#### Environment

- Create a `.env` file in the root of your project with the following contents:

```
FREESTYLE_API_KEY=your_freestyle_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

- You can get your Freestyle API key from the [Freestyle Dashboard](https://admin.freestyle.sh).
- You can get your Anthropic API key from the [Anthropic Dashboard](https://console.anthropic.com).

### Mechanics of the Chat

The following sections are the pieces that we will later put together to make the AI App Builder chat.

#### Setting up a Git Repository

In order to start developing your AI App Builder, you'll need a Git repo to build the app in.

You'll want one Git repo for every chat in your AI App Builder, this way the chat has a place to manage its code. However you store your chats, you should include a `repoId` on the chat object to refer to the code linked to it.

```ts title="setup.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'

const freestyle = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY,
})

const { repoId } = await freestyle.createGitRepository({
  name: 'Test Repository',
  // This will make it easy for us to clone the repo during testing.
  public: true,
  source: {
    url: 'https://github.com/freestyle-sh/freestyle-next', //[!code highlight] can be any public git repo, or any git repo you own on Freestyle
    type: 'git',
  },
})
```

We have a series of prebuild templates for you to base your AI Apps on

| Setup             | Url                                                                      |
| ----------------- | ------------------------------------------------------------------------ |
| NextJS            | https://github.com/freestyle-sh/freestyle-next                           |
| Vite + Tailwind   | https://github.com/freestyle-sh/freestyle-base-vite-react-typescript-swc |
| Expo (for mobile) | https://github.com/freestyle-sh/freestyle-expo                           |

We recommend forking one of them to make your own custom one. Your template should include everything custom you might want your AI to use. For example, if you want it to process payments, you should install the SDK into your template repo and create the setup files.

#### Running a the Dev Server

Dev Servers exist as short lived previews and dev environments to work with your Freestyle Git Repositories. To use one, provision it like:

```ts title="dev.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'

export const freestyle = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

const {
  ephemeralUrl, // The URL of the preview of the dev server
  mcpEphemeralUrl, // The URL of the mcp service for the dev server
} = await freestyle.requestDevServer({
  repoId: repoId, // [!code highlight] the repoId from the previous step
})
```

The `ephemeralUrl` is a URL that you can use to preview the dev server. The `mcpEphemeralUrl` is a URL that you can use to connect to the mcp service for the dev server. While we also offer a Rest API to control the dev server, we recommend using the mcp service to start, and using the Rest API when you have specific use cases that the MCP can't handle.

#### Integrating with AI

In order to integrate with AI, we'll use the [Vercel AI SDK](https://sdk.vercel.ai) and [Anthropic Claude](https://www.anthropic.com/) to create a simple ReAct agent that works with the Dev Server for the repository.

#### Setup the AI + MCP

In order to connect the AI to the Dev Server, we'll first instantiate the model and connect the MCP client to the dev server.

```ts title="mcp.ts"
import { anthropic } from '@ai-sdk/anthropic'
import { experimental_createMCPClient as createMCPClient } from 'ai'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export const ANTHROPIC_MODEL = anthropic('claude-3-7-sonnet-20250219')

const devServerMcp = await createMCPClient({
  transport: new StreamableHTTPClientTransport(new URL(mcpUrl)), // [!code highlight] mcpUrl is the url of the dev server
})

const tools = await devServerMcp.getTools()
```

#### Run the AI

Then, we can use the `streamText` function to run the AI. This function takes a model, a prompt, and a set of tools to use. We set `steps` to 100 to give the AI lots of time to iterate, and `toolCallStreaming` to `true` to get the AI to call the tools as it goes. This is important, as it lets you see as the AI is writing a file, instead of waiting for it to be done.

```ts title="run.ts"
import { streamText } from '@ai-sdk/react'

streamText({
  model: ANTHROPIC_MODEL, // [!code highlight] the model from the previous step
  maxSteps: 100,
  tools: tools, // [!code highlight] the tools from the previous step
  toolCallStreaming: true,
  messages: [
    {
      role: 'system',
      content: `
      You are an AI App Builder. The existing app is in the /template directory. Please edit the app how the user wants and commit the changes incrementally.
      `,
    },
    {
      role: 'user',
      content: `Make me Tic Tac Toe`, // [!code ++] Put your prompt here
    },
  ],
})
```

Now, if you visit the `url` of the dev server, you should see the changes to your app live as the AI makes them.

### Putting the pieces together

Now that we have all the pieces in place, we can create the two functions that manage the chat:

1. `createChat` - This function will create a new git repository for the chat and request a dev server for it.
2. `respond` - This function will take the user messages and run the AI with the dev server to build the app.

```ts title="lib/create-chat.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'

const freestyle = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

export async function createChat() {
  const { repoId } = await freestyle.createGitRepository({
    name: 'Test Repository',
    public: true,
    source: {
      url: 'https://github.com/freestyle-sh/freestyle-next', // [!code highlight] replace this with your own template repo
      type: 'git',
    },
  })

  const { ephemeralUrl, mcpEphemeralUrl } = await freestyle.requestDevServer({
    repoId: repoId,
  })

  return {
    repoId,
    ephemeralUrl,
  }
}
```

We'll put the `respond` function at `/api/chat/route.ts`, because this is
=== guides/app-builder/mobile.mdx ===

---

title: Building an AI Mobile App Builder
description: Shipping AI driven mobile apps with Freestyle

---

Freestyle is **the platform for building AI Mobile App Builders**. There are many AI Mobile App Builder companies already on the platform, and we have specialized utilities to help you.

## Pre-requisites

This guide is a follow up to the generic [AI App Builder](./) guide. Everything about managing code, dev servers and deployments for web servers applies for mobile app builders too.

## Intro

This guide goes over the utilities we have for AI Mobile App Builders and best practices we've seen for building them.

We recommend using [Expo](https://expo.dev/) as the base for your mobile app. Expo is a framework and platform for universal React applications. It works well for AI App Builders because:

- Expo is a React based framework, AI is great at React.
- Expo has hot reload, which makes iteration fast.
- Expo has web support for both previews and production, this makes previewing and debugging the easy, it also makes sharing the app with your users easy.
- Freestyle has thousands of Expo Apps running on it, so we know how to make it work well.

## Dev Servers

When using [Dev Servers](/Getting-Started/dev-servers), your users can view the web preview through the `FreestyleDevServer`.

For viewing on mobile devices, you can use the `ephemeralUrl` in Expo Go Via a QR Code, or via any [Expo Developer Build Client](https://docs.expo.dev/develop/development-builds/create-a-build/). However, these URL's are `ephemeral`, so we recommend proxying them through another router server that you can control, to define a permanent URL for the Expo Client to pull from.

## Deploy

Freestyle offers an Expo bundling system that makes our builds compatible with the Expo Updates standard, and visible on a website. When enabled, if you deploy to `someapp.style.dev` (or any domain), your users will be able to view the website at that domain, and if an Expo Client is pointed at that domain it will use it as the bundle source.

To enable this, you should build your app on us with **Freestyle Auto Building**. You can enable this by adding `build: true` to your deployment configurations.

## Notes

- Freestyle Expo Auto Building currently **does not support Android or code signing**, we're working on it.
- Freestyle Expo Auto Builds currently support **static or single** web apps, we're working on supporting server mode.
- We recommend using Expo + Hono/some external server rather than Expo + Expo API Routes — Expo API Routes seem to have shockingly bad performance and not work with hot reloading. This can be deployed separately from the app and used by it.

## === guides/expo.mdx ===

title: Deploying Expo Projects
description: How to deploy an Expo Project to Freestyle

---

import { Callout } from "fumadocs-ui/components/callout";
import { Tabs, Tab } from "fumadocs-ui/components/tabs";

[Expo](https://expo.dev) is a framework for building cross-platform mobile apps.
While primarily used to create iOS and Android Apps, these apps can also be compiled to static websites and hosted on Freestyle.
This guide will walk you through the process of configuring and deploying an Expo app to Freestyle. This guide shows you how to deploy a `Static` or `SPA` Expo app. If you want to deploy a server-side rendered Expo app, the general same steps should apply, except for the server implementation.

## Setup

If you don't have a pre-existing Expo app, run the command below to initialize it. It'll ask you where to put the app, for the purposes of this guide I'll be putting it in `my-app`

```bash
npx create-expo-app@latest
```

Once you've created the app, install the dependencies necessary for shipping it to website. `react-dom` is necessary for React to render on the web, `react-native-web` is for React Native to compile its components to html, and `@expo/metro-runtime` is for Expo to be able to compile it's structures to web.

```bash
npx expo install react-dom react-native-web @expo/metro-runtime
```

Now you have an expo app ready to be deployed.

## Deploying the App

<Tabs items={['Building on Freestyle', 'Building Yourself']}>
<Tab title="Building on Freestyle" >

Get your API key from the [Freestyle dashboard](https://admin.freestyle.sh), and create a .env file with the following content:

```
FREESTYLE_API_KEY=your-api-key
```

Install the Freestyle Sandboxes Client

```bash
npm i freestyle-sandboxes
```

Now you need a script to deploy the app. This is an example script that deploys the app.

It first creates a `FreestyleSandboxes` client with your Freestyle API Key. then it calls `.deployWeb` with two options: `source` + `configuration`.

`source` is an object of files to their file contents, you can write a custom function that takes your directory and prepares it for uploading, however we provide a series of utilities making it easy.

`configuration` comes with anything other than the code you want to configure, that might be the domains, the entrypoint, the environment variables, or the network permissions.

```ts title="deploy.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { prepareDirForDeploymentSync } from 'freestyle-sandboxes/utils'

// Create a sandboxes client
const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync('.'), {
    domains: ['example.style.dev'],
    build: true, // This automatically detects the framework and configures/builds for you // [!code highlight]
  })
}

deploy()
```

Finally, to make the deploy happen, run it

```bash
bun run deploy.ts
```

</Tab>
<Tab title="Building Yourself" >
## Preparing the App for Deployment

We run the command below to create a production build of your app for web.

```bash
npx expo export --platform web
```

Now, we slightly modify the output so that it works with freestyle module resolution by changing the dists `node_modules` folder to `modules`. Freestyle doesn't support uploading `node_modules` as we have a special carveout for caching them, however expo build outputs a directory called `dist/assets/node_modules` which we can rename to `dist/assets/modules` so it will work.

This is an example way to do it

```bash
find dist -type f -name "*.js" -exec sed -i '' 's/node_modules/modules/g' {} +
mv dist/assets/node_modules dist/assets/modules
```

## Creating a Server

<Tabs items={['Static Mode', 'Server Mode']}>

<Tab title="Static Mode" >
By default, [Expo](https://expo.dev) outputs only static files. In order to serve them on Freestyle, we create a simple server using [Hono](https://hono.dev/), a lightweight web framework for Deno. This server will serve the static files generated by Expo.

First install `hono`

```bash
npm i hono
```

Then you can use the following code to serve the files.

```ts title="main.ts"
import { Hono } from 'hono'
import { serveStatic } from 'hono/deno'

const app = new Hono()

app.use('*', serveStatic({ root: './dist' }))

// fallback to index.html
app.get('*', serveStatic({ path: './dist/index.html' }))

Deno.serve(app.fetch)
```

<Callout>
  This setup works for both the expo output configurations of `"output":
  "single"` and `"output": "static"`, for `"output": "server"`, use the server
  entrypoint instead of creating a custom one.
</Callout>
</Tab>
<Tab title="Server Mode" >

If you want to run expo in server mode, with support for [Expo API Routes](https://docs.expo.dev/router/reference/api-routes/), you can set the output to `server` in your `app.json` file.

```json
{
  "expo": {
    "web": {
      "bundler": "metro",
      "output": "server" // [!code ++]
    }
  }
}
```

Then, you'll need to create a simple entrypoint to run the server. Freestyle provides first class support for Expo server mode:

```ts title="main.ts"
import { freestyleExpoServer } from 'freestyle-sandboxes/expo'

freestyleExpoServer()
```

By default, this expects the output to be in the `dist` folder, but you can override where the server and client files it pulls from are by passing the `options` object to `freestyleExpoServer`.

</Tab>

</Tabs>

## Deploying the App

### CLI

Install the Freestyle CLI.

```bash
npm i freestyle-sh
```

Now deploy it

```bash
npx freestyle deploy --domain some.style.dev --web main.ts
```

### API

You can also deploy the app using the API.

Get your API key from the [Freestyle dashboard](https://admin.freestyle.sh), and create a .env file with the following content:

```
FREESTYLE_API_KEY=your-api-key
```

Install the Freestyle Sandboxes Client

```bash
npm i freestyle-sandboxes
```

Now you need a script to deploy the app. This is an example script that deploys the app.

It first creates a `FreestyleSandboxes` client with your Freestyle API Key. then it calls `.deployWeb` with two options: `source` + `configuration`.

`source` is an object of files to their file contents, you can write a custom function that takes your directory and prepares it for uploading, however we provide a series of utilities making it easy.

`configuration` comes with anything other than the code you want to configure, that might be the domains, the entrypoint, the environment variables, or the network permissions.

```ts title="deploy.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { prepareDirForDeploymentSync } from 'freestyle-sandboxes/utils'

// Create a sandboxes client
const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync('.'), {
    entrypoint: 'main.ts',
    // put whatever domains you want here
    domains: ['example.style.dev'],
  })
}

deploy()
```

Finally, to make the deploy happen, run it

```bash
bun run deploy.ts
```

</Tab>
</Tabs>

### Next Steps

Now that you can deploy Expo apps to Freestyle, you'll probably want to deploy them to [custom domains](/Getting-Started/domains). To deploy to your own custom domains, you can use the UI in the [Freestyle dashboard](https://admin.freestyle.sh), and to start building self serve to deploy to your users domains you should check out [this guide](/Getting-Started/domains)

=== guides/meta.json ===
{
"pages": ["expo", "next", "vite", "static", "app-builder"]
}

## === guides/next.mdx ===

title: Deploying NextJS Projects
description: How to deploy an NextJS Project to Freestyle

---

import { Callout } from "fumadocs-ui/components/callout";
import { Tabs, Tab } from "fumadocs-ui/components/tabs";

[NextJS](https://nextjs.org) is the most popular React Framework for building web applications. We support NextJS with a small bit of configuration.

## Set NextJS to `Standalone` mode

NextJS defaults to a `serverless` bundle we do not support. To make NextJS output a valid NodeJS App, you need to set the `output` to `standalone`.

We also don't support binaries, and therefore don't support Sharp (NextJS's image optimization library), so we disable the image optimization features of NextJS.

```js title='next.config.mjs'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // [!code highlight]
  images: {
    unoptimized: true, // [!code highlight]
  },
};

export default nextConfig;
```

## Deploying The Project

<Tabs items={[ "Building on Freestyle", "Building Yourself"]}>

<Tab value="Building Yourself">
## Prepare a Production Build

First, you need to build your NextJS project. You can do this by running the following command:

```bash
npm run build
```

<Callout type="info">
  This guide will work with `bun`, `yarn`, `pnpm` or `npm`. However, it relies
  on your lockfile, so make sure to copy the correct lockfile for the package
  manager you are using.
</Callout>

Then, you need to copy the package lock, public files, and static files in:

```bash
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# This is for use with npm, replace with any lockfile you want.
cp package-lock.json .next/standalone/package-lock.json
```

## Deploy to Freestyle

### Via the CLI

First, you need to install the Freestyle CLI:

```bash
npm i freestyle-sh
```

Then, you can deploy your project by running:

```bash
cd .next/standalone
npx freestyle deploy --web server.js --domain something.style.dev
```

### Via the SDK

First, install the Freestyle Sandboxes SDK:

```bash
npm i freestyle-sandboxes
```

Then, you can deploy your project by running:

```js title='deploy.js'
import { FreestyleSandboxes } from "freestyle-sandboxes";
import { prepareDirForDeploymentSync } from "freestyle-sandboxes/utils";

// Create a sandboxes client
const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
});

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync(".next/standalone"), {
    entrypoint: "server.js",
    // put whatever domains you want here
    domains: ["example.style.dev"],
  });
}

deploy();
```

</Tab>

<Tab value="Building on Freestyle">

## Build on Freestyle

You can deploy NextJS projects and have them built on Freestyle by sending us the files, and enabling `"build": true` in the deploy options.

```ts title="deploy.js"
import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { prepareDirForDeploymentSync } from 'freestyle-sandboxes/utils'

// Create a sandboxes client
const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync('.'), {
    // put whatever domains you want here
    domains: ['example.style.dev'],
    build: true, // This automatically detects the framework and configures/builds for you
  })
}

deploy()
```

<Callout type="info">
  NextJS must be in `standalone` mode for this to work.
</Callout>

</Tab>
</Tabs>

### Next Steps

Now that you can deploy NextJS Apps to Freestyle, you'll probably want to deploy them to [custom domains](/Getting-Started/domains). To deploy to your own custom domains, you can use the UI in the [Freestyle dashboard](https://admin.freestyle.sh), and to start building self serve to deploy to your users domains you should check out [this guide](/Getting-Started/domains)

## === guides/static.mdx ===

title: Deploying Static Assets
description: How to deploy a static bundle to Freestyle

---

import { Callout } from "fumadocs-ui/components/callout";
import { Tabs, Tab } from "fumadocs-ui/components/tabs";
import { CodeBlock } from "fumadocs-ui/components/codeblock";

Deploying static assets can be useful for hosting websites, or static files in general. Freestyle lets you host them with all our support for custom domains, certificates, and analytics.

## Deploying Static Assets

All deploys on Freestyle are servers, so to host the static assets you need to create a simple server that serves them. You can do this with any server you like, but we recommend [hono](https://hono.dev/) for its simplicity and speed.

To set it up, first, you need to install the hono package:

```bash
npm init -y # Only necessary if you don't have a package.json in the root directory already  # [!code highlight]
npm install hono
```

Then, you can create a simple server that serves the static assets. Here is a simple example that serves the files in a `static` folder, and falls back to `static/index.html` for any requests that don't match a file:

```ts title="main.ts"
import { Hono } from 'hono'
import { serveStatic } from 'hono/deno'

const app = new Hono()

app.use('*', serveStatic({ root: './static' }))

// fallback to index.html
app.get('*', serveStatic({ path: './static/index.html' }))

Deno.serve(app.fetch)
```

## Deploying to Freestyle

### Via the SDK

First, you can get your API Key from the [Freestyle Dashboard](https://admin.freestyle.sh).

Then, you need to install the Freestyle SDK:

```bash
npm i freestyle-sandboxes
```

Then you can create an instance of the client in your code:

```ts title="deploy.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'

const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})
```

Then, you can deploy your app with the following code:

```ts title="deploy.ts"
import { prepareDirForDeploymentSync } from 'freestyle-sandboxes/utils'
import { FreestyleSandboxes } from 'freestyle-sandboxes'

const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync('.'), {
    entrypoint: 'main.ts',
    // put whatever domains you want here
    domains: ['example.style.dev'],
  })
}
deploy()
```

This will upload everything in your current directory to Freestyle, and deploy it as a web server.

<Callout type="info">
  You can use the `prepareDirForDeploymentSync` function to prepare the
  directory for deployment. This will copy all the files in the current
  directory to a temporary directory, and return the path to that directory. You
  can also refer to the API Reference for constructing the deployment object
  yourself, or deploying through a Tar or Git Repository.
</Callout>

### Via the CLI

First, you need to install the Freestyle CLI:

```bash
npm install -g freestyle-cli
```

Then, you need to login to your Freestyle account:

```bash
npx freestyle login
```

Then, you can deploy your app with the following command:

```bash
npx freestyle deploy --web main.ts --domain anydomain.style.dev
```

This will upload everything in your current directory to Freestyle, and deploy it as a web server.

## Next Steps

Now that you can deploy static assets, you'll likely want to set up a custom domain for your server. You can do this by following the [Custom Domains](/Getting-Started/domains) guide.

## === guides/vite/index.mdx ===

title: Deploying Vite Projects
description: How to deploy an Vite project to Freestyle

---

[Vite](https://vitejs.dev) is a build tool that aims to provide a faster and leaner development experience for modern web projects. We support Vite with a small bit of configuration.

## Setup

First, you'll need to create a Vite project. You can do this by running the following command:

```bash
npm create vite@latest
```

Follow Vite's instructions relating to framework choices, installing dependencies, and CD'ing into the app.

## Build the App

```bash
npm run build
```

This will create a `dist` folder with the production build of your app. This folder contains all the static files needed to run your app.

## Preparing the App for Deployment

Freestyle requires a JavaScript or TypeScript entrypoint for your apps. To serve the Vite app, we need to create a server that serves the files in the `dist` folder.

The simplest way to do this is to use `hono`, a lightweight web framework that I like:

```typescript title="main.ts"
import { Hono } from 'hono'
import { serveStatic } from 'hono/deno'

const app = new Hono()

app.use('*', serveStatic({ root: './dist' }))

Deno.serve(app.fetch)
```

## Deploying the App

### CLI

Install the Freestyle CLI.

```bash
npm i freestyle-sh
```

Now deploy it

```bash
npx freestyle deploy --domain some.style.dev --web main.ts
```

### API

You can also deploy the app using the API.

Install the Freestyle API client.

```bash
npm i freestyle-sandboxes
```

Then you can use the following code to deploy the app:

```ts title="deploy.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { prepareDirForDeploymentSync } from 'freestyle-sandboxes/utils'

// Create a sandboxes client
const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync('.'), {
    entrypoint: 'main.ts',
    // put whatever domains you want here
    domains: ['example.style.dev'],
  })
}

deploy()
```

Finally, to make the deploy happen, run it

```bash
bun run deploy.ts
```

### Next Steps

- If you want to add SSR to your Vite app check [this guide out](/guides/vite/ssr).
- Now that you can deploy Vite apps to Freestyle, you'll probably want to deploy them to [custom domains](/Getting-Started/domains). To deploy to your own custom domains, you can use the UI in the [Freestyle dashboard](https://admin.freestyle.sh), and to start building self serve to deploy to your users domains you should check out [this guide](/Getting-Started/domains)

## === guides/vite/ssr.mdx ===

title: Deploying Vite Projects with SSR
description: How to add SSR to a Vite project to Freestyle

---

## Setup

When you're setting up a Vite project for SSR, use the `vite-extra` CLI to give you all the parts you need for SSR.

```bash
npm create vite-extra@latest
```

This will create a Vite project with the extra configuration you need for SSR like separate server and client entrypoints. For more information check out [Vite's Official SSR Documentation](https://vite.dev/guide/ssr.html#server-side-rendering-ssr)

## Custom Configuration

This template comes with the infrastructure for SSR, but you have to add a server to handle it. On Freestyle, we recommend using `hono` for this. We recommend adding `index.js` and installing `hono` as a dependency.

```bash
npm i hono
```

Then create a file called `index.js` in the root of your project. This file will be the entrypoint for your server.

```js title="index.js"
import fs from 'node:fs/promises'
import { Hono } from 'hono'
import { serveStatic } from 'hono/deno'
import { render } from './server/entry-server.js'

const templateHtml = await fs.readFile('./client/index.html', 'utf-8')

const app = new Hono()

app.get('*', serveStatic({}))

app.get('*', async c => {
  try {
    const url = c.req.url
    const template = templateHtml
    const rendered = render(url)

    const html = template
      .replace(`<!--app-head-->`, rendered.head ?? '')
      .replace(`<!--app-html-->`, rendered.html ?? '')

    return c.html(html)
  } catch (e) {
    console.log(e.stack)
    return c.text(e.stack, 500)
  }
})

Deno.serve(app.fetch)
```

## Deploying the App

### CLI

Install the Freestyle CLI.

```bash
npm i freestyle-sh
```

Now deploy it

```bash
npx freestyle deploy --domain some.style.dev --web index.js
```

### API

You can also deploy the app using the API.

Install the Freestyle API client.

```bash
npm i freestyle-sandboxes
```

Then you can use the following code to deploy the app:

```ts title="deploy.ts"
import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { prepareDirForDeploymentSync } from 'freestyle-sandboxes/utils'

// Create a sandboxes client
const sandboxes = new FreestyleSandboxes({
  apiKey: process.env.FREESTYLE_API_KEY!,
})

async function deploy() {
  await sandboxes.deployWeb(prepareDirForDeploymentSync('.'), {
    // put whatever domains you want here
    domains: ['example.style.dev'],
  })
}

deploy()
```

Finally, to make the deploy happen, run it

```bash
bun run deploy.ts
```

### Next Steps

- Now that you can deploy Vite apps to Freestyle, you'll probably want to deploy them to [custom domains](/Getting-Started/domains). To deploy to your own custom domains, you can use the UI in the [Freestyle dashboard](https://admin.freestyle.sh), and to start building self serve to deploy to your users domains you should check out [this guide](/Getting-Started/domains)

## === index.mdx ===

title: Welcome to Freestyle
description: So what is Freestyle...

---

## What is Freestyle?

Freestyle provides a set of tools to help you run code you didn't write. This can be for your users or for your AI. Running code you didn't write presents different challenges than running code you did write. We do this through sets of APIs for common ways you would want to manage code you didn't write.

They are:

- [Web](/Getting-Started/web): For deploying websites you didn't write
- [Domains](/Getting-Started/domains): For managing domains you don't own
- [Dev Servers](/API-Reference/dev--servers/handle_ephemeral_dev_server): For running development servers for live previews of code you didn't write
- [DNS](/API-Reference/domains/handle_create_domain_verification): For managing your users DNS records
- [Execute](/Getting-Started/run): For running code you didn't write
- [Git](/git): For managing Git repositories on your users' behalf

Together, these APIs provide baseline infrastructure for managing your users code.

## Why Freestyle?

- **Super Fast Deploys**: When you upload code to Freestyle you **never upload node modules**, instead, we have a cache of them that we share across all our projects. This system makes our deploys noticeably faster than other platforms or what is possible with a traditional deployment pipeline.
- **Multi Tenant Management**: Managing 1000s of other people's code, or 1000s of generated codebases from AI has many observability challenges that are not present when managing your own code. You might want to rate limit a user, or a specific deployment, or a specific job an AI does. Tracking these independently is a challenge, we make it easy.
- **Battle Tested APIs**: The APIs we provide here used to be our internal API, these docs are deployed through our Web API, and this domain is managed through our Domains API. We know these APIs work because we work with them every day.

## About Freestyle

Freestyle started out as a cloud for fullstack TypeScript apps. We had ideas about building fullstack reactivity primitives, but we never had time to build them. Instead, all of our time was sucked into scaling our users projects. We were forced unwillingly into becoming infrastructure experts, and became experts in running code we didn't write. Now, thats what we do.

## === integrations/gemini.mdx ===

title: Gemini Python SDK
description: Code execution for Gemini in Python

---

import { Steps, Step } from "fumadocs-ui/components/steps";
import { Callout } from "fumadocs-ui/components/callout";

<Steps>
  <Step>
    ### Install the required dependencies
    ```bash
    pip install google-genai freestyle
    ```
  </Step>
  <Step>
    Get your Freestyle API Key from the [Freestyle Dashboard](https://admin.freestyle.sh)
  </Step>
  <Step>
    ### Set up the Code Executor

    The simplest code executor looks like this:

    ```python
    import os
    import freestyle.gemini

    definition, runner = freestyle.gemini.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
    )
    ```

    #### Adding Node Modules
    When you want your AI code execution to have access to specific node modules, you can pass them in through the configuration parameter:

    ```python
    import os
    import freestyle.gemini
    import freestyle

    definition, runner = freestyle.gemini.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
        freestyle.FreestyleExecuteScriptParamsConfiguration(
            nodeModules={"mathjs": "14.3.1"}
        ),
      )
    ```

    #### Adding Environment Variables
    You can also pass in environment variables that your AI code execution will have access to:

    ```python
    import os
    import freestyle.gemini
    import freestyle

    definition, runner = freestyle.gemini.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
        freestyle.FreestyleExecuteScriptParamsConfiguration(
            envVars={"RESEND_API_KEY": os.environ.get("RESEND_API_KEY")},
            nodeModules={"resend": "4.1.2"}
        ),
      )
    ```

    #### Other Configuration Options
    - **timeout**: The maximum time in seconds that the code execution is allowed to run.
    - **networkPermissions**: A list of URLs that the code execution is allowed to access.
    - **peerDependencyResolution**: Configure if peer dependencies should be resolved — **do not use this unless you know what you are doing**.

  </Step>
  <Step>
    ## Set up the Gemini Python SDK

    ```python
    import google.genai as genai
    from google.genai import types
    import os
    import freestyle.gemini

    client = genai.Client(api_key=os.environ.get("GENERATIVEAI_API_KEY"))

    definition, runner = freestyle.gemini.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
    )

    chat = client.chats.create(
        model="gemini-2.0-flash",
        config=types.GenerateContentConfigDict(
            tools=[definition],
        ),
        history=[],
    )

    response = chat.send_message(
        "What is the sum of every number from 50 to 65 divided by 17"
    ).candidates[0]

    tool_result = runner(response.content)
    print("Answer: ", tool_result)
    ```
    <Callout>The `definition` and `runner` variables are from the code executor setup. The `runner` is a function that takes in a Gemini model response and returns the output of the code execution if there is one. `Runner` is made to be called on every response from the Gemini model, if there is no code execution then it returns `None` and does nothing.</Callout>

  </Step>
</Steps>

## === integrations/langgraph-js.mdx ===

title: Langgraph JS
description: Code execution for Langgraph in JavaScript

---

import { Steps, Step } from "fumadocs-ui/components/steps";
import { Callout } from "fumadocs-ui/components/callout";

<Steps>
  <Step>
    ### Install the required dependencies

    ```bash
    npm install freestyle-sandboxes @langchain/langgraph @langchain/core @langchain/openai
    ```
    <Callout>
      This walkthrough uses `@langgraph/openai`, however these exact steps should work for any of the langgraph providers like
      `@langgraph/anthropic`
    </Callout>

  </Step>
  <Step>
    Get your Freestyle API Key from the [Freestyle Dashboard](https://admin.freestyle.sh)
  </Step>
  <Step>
  ### Set up the Code Executor

```ts
import { executeTool } from 'freestyle-sandboxes/langgraph'

const codeExecutor = executeTool({
  apiKey: process.env.FREESTYLE_API_KEY!,
})
```

You can also pass in any **nodeModules**, **environment variables**, **timeout**, or **network restrictions** you need.

```ts
import { executeTool } from 'freestyle-sandboxes/langgraph'

const codeExecutor = executeTool({
  apiKey: process.env.FREESTYLE_API_KEY!,
  nodeModules: {
    mathjs: '14.3.1',
  },
  envVars: {
    MY_SUPER_SECRET_KEY: '1234567890',
  },
})
```

</Step>
<Step>
### Set up the Langgraph SDK Agent

```ts
const model = new ChatOpenAI({ model: 'gpt-4o' })

const agent = createReactAgent({
  llm: model,
  tools: [codeExecutor],
})
```

</Step>
<Step>
### Invoke the Agent

```ts
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What is the factorial of 13 divided by 55^2' }],
})
console.log(result.messages.at(-1)?.content)
```

🚀 Your AI can now execute code

</Step>
</Steps>

## === integrations/langgraph-py.mdx ===

title: Langgraph Python
description: Code execution for Langgraph Python SDK

---

import { Steps, Step } from "fumadocs-ui/components/steps";

<Steps>
  <Step>
    ### Install the required dependencies

    ```bash
    pip install langgraph langchain_anthropic freestyle
    ```

  </Step>
  <Step>
    Get your Freestyle API Key from the [Freestyle Dashboard](https://admin.freestyle.sh)
  </Step>
  <Step>
  ### Set up the Code Executor

The simplest code executor looks like this

```python
import os
from freestyle.langgraph import execute_tool

execute_tool(
  os.environ.get("FREESTYLE_API_KEY"),
)

```

If you want to add node modules & environment variables, you can do so like this

```python
import os
from freestyle.langgraph import execute_tool
import freestyle


(definition, runner) = freestyle.openai.execute_tool(
  os.environ.get("FREESTYLE_API_KEY"),
  freestyle.FreestyleExecuteScriptParamsConfiguration(
    nodeModules={"mathjs": "14.3.1"},
    envVars={"SUPER_SECRET_KEY": os.environ.get("SUPER_SECRET_KEY")},
  ),
)
```

</Step>
<Step>
### Add it to your Agent

```python
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(model="claude-3-5-sonnet-20240620")

llm_with_tools = llm.bind_tools([execute_tool])
```

</Step>
</Steps>

## === integrations/mastra.mdx ===

title: Mastra AI SDK
description: Code execution for Mastra AI SDK Agents

---

import { Steps, Step } from "fumadocs-ui/components/steps";

<Steps>
  <Step>
    ### Install the required dependencies

    ```bash
    npm install @mastra/core freestyle-sandboxes
    ```

  </Step>
    <Step>
    Get your Freestyle API Key from the [Freestyle Dashboard](https://admin.freestyle.sh)
  </Step>
  <Step>
  ### Set up the Code Executor
  The simplest code executor looks like this:
  ```typescript
  import { executeTool } from 'freestyle-sandboxes/mastra';
  const codeExecutor = executeTool({
    apiKey: process.env.FREESTYLE_API_KEY!,
  });
```

You can also pass in any **nodeModules**, **environment variables**, **timeout**, or **network restrictions** you need.

Here's an example with access to the `resend` and `octokit` node modules, and environment variables for `RESEND_API_KEY` and `GITHUB_PERSONAL_ACCESS_TOKEN`

```ts
import { executeTool } from 'freestyle-sandboxes/mastra'

const codeExecutor = executeTool({
  apiKey: process.env.FREESTYLE_API_KEY!,
  nodeModules: {
    resend: '4.0.1',
    octokit: '4.1.0',
  },
  envVars: {
    RESEND_API_KEY: process.env.RESEND_API_KEY!,
    GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
  },
})
```

</Step>
<Step>
### Set up the Mastra AI SDK Agent

```ts
import { createMastra } from '@mastra/core'

const mastra = new Mastra()

const modelConfig: ModelConfig = {
  provider: 'OPEN_AI',
  name: 'gpt-4',
}

const llm = mastra.LLM(modelConfig)

const response = await llm.generate(
  'Calculate the sum of every number between 13 and 19 divided by the sum of every number between 8 and 13',
  {
    tools: {
      codeExecutor,
    },
  },
)
```

</Step>
</Steps>

=== integrations/meta.json ===
{
"pages": [
"vercel",
"mastra",
"langgraph-js",
"langgraph-py",
"openai",
"gemini"
]
}

## === integrations/openai.mdx ===

title: OpenAI Python SDK
description: Code execution for OpenAI in Python

---

import { Steps, Step } from "fumadocs-ui/components/steps";
import { Callout } from "fumadocs-ui/components/callout";

<Steps>
  <Step>
    ### Install the required dependencies
    ```bash
    pip install openai freestyle
    ```
  </Step>
    <Step>
    Get your Freestyle API Key from the [Freestyle Dashboard](https://admin.freestyle.sh)
  </Step>
  <Step>
    ### Set up the Code Executor

    The simplest code executor looks like this:

    ```python
    import os
    from freestyle.openai import execute_tool

    (definition, runner) = freestyle.openai.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
    )
    ```

    #### Adding Node Modules
    When you want your AI code execution to have access to specific node modules, you can pass them in through the configuration parameter:

    ```python
    import os
    from freestyle.openai import execute_tool
    import freestyle

    (definition, runner) = freestyle.openai.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
        freestyle.FreestyleExecuteScriptParamsConfiguration(
            nodeModules={"mathjs": "14.3.1"}
        ),
      )
    ```

    #### Adding Environment Variables
    You can also pass in environment variables that your AI code execution will have access to:

    ```python
    import os
    from freestyle.openai import execute_tool
    import freestyle

    (definition, runner) = freestyle.openai.execute_tool(
        os.environ.get("FREESTYLE_API_KEY"),
        freestyle.FreestyleExecuteScriptParamsConfiguration(
            envVars={"RESEND_API_KEY": os.environ.get("RESEND_API_KEY")}
            nodeModules={"resend":"4.1.2"}
        ),
      )
    ```

    #### Other Configuration Options
    - **timeout**: The maximum time in seconds that the code execution is allowed to run.
    - **networkPermissions**: A list of URLs that the code execution is allowed to access.
    - **peerDependencyResolution**: Configure if peer dependencies should be resolved — **do not use this unless you know what you are doing**.

  </Step>
  <Step>
    ## Set up the OpenAI Python SDK

    ```python
      import openai

      client = openai.OpenAI(
          api_key=os.environ.get("OPENAI_API_KEY"),
      )

      query = "What is the sum of every number from 50 to 65 divided by 17"
      messages = [{"role": "user", "content": query}]

      res = client.chat.completions.create(
          model="gpt-4-turbo", messages=messages, tools=[definition]
      )

      result = runner(res.choices[0].message)
    ```
    <Callout>The `definition` and `runner` variables are from the code executor setup. The `definition` is an OpenAI compatible tool definition, and the `runner` is a function that takes in an OpenAI Compatible Model response and returns the output of the code execution if there is one. `Runner` is made to be called on every response from the OpenAI model, if there is no code execution then it returns `None` and does nothing.</Callout>

  </Step>
</Steps>

## === integrations/pipecat.mdx ===

title: PipeCat
description: Code execution for PipeCat Agents

---

## === integrations/vercel.mdx ===

title: Vercel AI SDK
description: Code execution for Vercel AI SDK Agents

---

import { Steps, Step } from "fumadocs-ui/components/steps";

<Steps>
<Step>
### Install the required dependencies
```bash
npm install ai @ai-sdk/openai freestyle-sandboxes
```
</Step>
<Step>
    Get your Freestyle API Key from the [Freestyle Dashboard](https://admin.freestyle.sh)
</Step>
<Step>
### Set up the Code Executor

The simplest code executor looks like this:

```ts
import { executeTool } from 'freestyle-sandboxes/ai'

const codeExecutor = executeTool({
  apiKey: process.env.FREESTYLE_API_KEY!,
})
```

You can also pass in any **nodeModules**, **environment variables**, **timeout**, or **network restrictions** you need.

Here's an example with access to the `resend` and `octokit` node modules, and environment variables for `RESEND_API_KEY` and `GITHUB_PERSONAL_ACCESS_TOKEN`:

```ts
import { executeTool } from 'freestyle-sandboxes/ai'

const codeExecutor = executeTool({
  apiKey: process.env.FREESTYLE_API_KEY!,
  nodeModules: {
    resend: '4.0.1',
    octokit: '4.1.0',
  },
  envVars: {
    RESEND_API_KEY: process.env.RESEND_API_KEY!,
    GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN!,
  },
})
```

</Step>
<Step>
### Set up the Vercel AI SDK Agent

```ts
const openai = createOpenAI({
  compatibility: 'strict',
  apiKey: process.env.OPENAI_API_KEY!,
})

const { text, steps } = await generateText({
  model: openai('gpt-4o'),
  tools: {
    codeExecutor,
  },
  maxSteps: 5,
  maxRetries: 0,
  prompt: 'Ask the AI to do whatever you want',
})
```

</Step>
</Steps>

### Notes

- You can actually give it multiple code executors with different node modules, different environment variables, and different network restrictions.
- When the AI writes invalid code, or the code gets errors they will be returned in the response. If the AI has steps left, it will try to fix the code and continue.
- If you add a node module we haven't seen before, the first time you run it it will take longer because we have to install the node module. After that, it will be cached and return to normal speed.

=== meta.json ===
{
"root": true,
"pages": [
"index",
"---Getting Started---",
"...Getting-Started",
"---Guides---",
"...guides",
"---Git---",
"...git",
"---Integrations---",
"...integrations",
"---API---",
"roadmap"
]
}

## === roadmap.mdx ===

title: Roadmap
description: Whats coming next for Freestyle

---

## What's coming next for Freestyle?

- [ ] **Usage/Metrics**: We are working on generalized metrics for all our API

- [x] **Git Triggers**: We are working on Git triggers to allow you to run code actions are taken on a Git repository you manage
- [x] **Python SDK**: We are working on a Python SDK to allow you to interact with Freestyle from Python more easily (Released, feature incomplete)
- [ ] **Better DNS**: We are working on improvements to our DNS API to make it more powerful, support more record types, be easier to delete records and have a UI in our Dashboard

- [ ] ~~**Hot Module Replacement**: We are working on a Serverless HMR solution to give instant deploys for those who can't wait for builds~~ (Cancelled in favor of dev servers)
- [ ] ~~**Firecracker Service**: We are working on a Firecracker service to give you the ability to run Firecrackers on your users behalf~~ (Cancelled in favor of dev servers)
- [x] **Dev Servers**: New service to run development servers, display their previews to your users, and give your AI Access to control them.

If you have any other ideas, we want to hear them, email [ben@freestyle.sh](mailto:ben@freestyle.sh) or [join our Discord](https://discord.gg/YTRprVkdnz) and let us know!
