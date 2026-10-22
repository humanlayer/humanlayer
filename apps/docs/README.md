# @humanlayer/docs

VitePress static site for **docs.humanlayer.com**, served from S3 + CloudFront
(Origin Access Control) via the Pulumi program in `pulumi.ts`.

## Deployment

> **Note:** Unlike the rest of the stack, this docs site is **not** continuously
> deployed. There is no CI pipeline that ships it on merge — deploys are manual.

To deploy for local / one-off testing, run a Pulumi update against a stack:

```bash
# dev (docs.dev.codelayer.gg)
AWS_PROFILE=dev pulumi up --stack dev

# prod (docs.humanlayer.com)
pulumi up --stack prod
```

`pulumi up` runs `bun run docs:build`, uploads the built site to S3, and
invalidates the CloudFront distribution.

## Clean URLs

`cleanUrls: true` in `.vitepress/config.ts` makes VitePress emit extensionless
links (e.g. `/guide/remote-daemons` instead of `/guide/remote-daemons.html`).
Because the CloudFront origin uses OAC against the S3 REST endpoint (which does
not resolve extensionless paths on its own), a `viewer-request` CloudFront
Function (`docs-url-rewrite` in `pulumi.ts`) rewrites `/foo` → `/foo.html` and
`/dir/` → `/dir/index.html`.

## Local development

```bash
bun run docs:dev   # vitepress dev server on http://localhost:5175
```
