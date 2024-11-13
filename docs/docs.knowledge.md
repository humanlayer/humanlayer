# Documentation System

## Platform Choice

Mintlify is the chosen documentation platform. It provides:

- MDX support for interactive documentation
- API documentation features
- Local preview capabilities
- Vercel deployment integration

## Local Development

Run documentation locally using either:

1. Mintlify CLI (recommended)

```bash
npm i -g mintlify
mintlify dev
```

2. Docker container (alternative)

```bash
# TODO: Dockerfile to be added
```

## Deployment

Documentation is automatically deployed to docs.humanlayer.dev via Vercel integration.

## DNS Configuration

The docs site is served from docs.humanlayer.dev, configured as a CNAME record pointing to Vercel's DNS.

## Branding Requirements

Documentation uses Humanlayer branding. Required assets:

- Light/dark theme variants required for logos
- Images stored in docs/images/
- Logo variants in docs/logo/
- All images must be < 5MB

The project is transitioning from Metalytics to Humanlayer branding - ensure new documentation uses Humanlayer assets.

## Documentation Structure

The documentation is organized around AI framework integrations:

- OpenAI integration
- Langchain integration
- CrewAI integration
- ControlFlow integration

Focus documentation on framework integration patterns and examples rather than basic features.

## Community

- Primary community engagement through Discord
- Documentation should link to Discord for community support
- GitHub repository serves as secondary community hub
