- step 0 - create a freestyle vm snapshot with claude code installed, all the deps, daemon already started + connected up to cloud api - this can and just start the daemon cold, its small, connect to cloud api on startup

- step 1 - when people launch the wui, store a list of git repos the user wants to work with, locally on their machine
- step 2 - when launching a new task, they select a repo,command,
- step 3 - the WUI will make an api request to HL cloud to create a git repo on freestyle, get back the git url for pushing, and a token that can used for pushing
- step 4 - locally, WUI will add an upstream to the repo and push to the upstream returned by freestyle using the token
- step 5 - WUI makes a request to HLCloud to request a Dev Server for the repo, forking the vm snapshot created in step 0
- step 6 - HL Cloud gets back dev server request with: URL, ssh, web-terminal link
- step 7 - Once the VM launches, the daemon will start connect to HLCloud
- step 8 - HLCloud will stream events down to the WUI, like "launching", "ready", "started", "error"
- step 9 - HLCloud's job is to send a message to the daemon in the VM, to start the launched dev server specified in the request form the use in the WUI
- step 10 - once the VM session is ready and started, events will start to stream back to the cloud API from the VM daemon, and the cloud api wills tore them and stream them down to the WUI

## Other notes

### ports and proxying

Today Freestyle by default only supports proxying tcp traffic to port 3000, so either the application MUST listen on port 3000 or HLD needs to proxy traffic/routes to user-defined ports. They can in the future add support for other ports, user-selected ports, or detecting open ports.

### filesystem tools vs. freestyle filesystem mcp

Freestyle has a filesystem mcp that can be used, but I think for claude code, we can just use the built in filesystem tools.

There's also a SSE mcp server, so a local claude could submit edits to a claude in a cloud VM.

## future

- choose a coding agent during launch, not always claude code (codex, opencode, amp, etc)
- vm snapshot has daemon running, and a unix signal to force it to refresh the connection
- whitelabel the upstream git repo push target e.g. git.humanlayer.dev

## appendix audio recordings

Can it just work with the file system directly or should it always use the MCP?

I know, there are reason pros and cons to using both.

Oh yeah, we have the system promise.

So yeah, we designed ours to be the same basically. But all I'd say, like actually, we have an API that lets you run shit, so you have your snapshot. Your snapshot should probably just have an API on it that gives you enough control to be able to do this, like the RPC thing. Okay, so sorry, so... So, we have persistent URLs.

Yeah. So like the HL daemon will expose it for port 3000 where we would normally like we have a system d process that automatically keeps the dev server alive. But instead of a dev server we'll just be running this daemon to keep it alive. Okay, so the issue there is that the daemon is not serving the web app. But there is no web app serving because it's just used as a VM client. As long as it's an HTTP API that's alive, like system d will keep it out. Okay, maybe people can like proxy to in the VM can you do stuff like Docker? More specifically, what do you mean? Do you mean like can I take a Docker container? Can I run can my cloud code run Docker compose up -d? Oh yeah, in the VM. Yes. So maybe basically they just set a list of like basically the human layer daemon becomes the input thing and then they just set proxy ports and URLs. Yeah, and it can just proxy all that work. Yeah. Can you do multiple ports right now? We can't, but that's one of the things that we're going towards. Okay. But it's not that we can't do multiple ports. It's that we can't detect open ports. So to make our API simple, we just said 3000 for like v0. I see. Okay. So basically when I click the URL, which has no port on it, I'm getting forward to 3000. Exactly. Okay. Yeah. Okay. So maybe there's like a primary port or something. Yeah, like there's there needs to be more configuration there. We just have
