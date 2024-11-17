# Documentation System

## Version Control and Releases

### Release Process

- Version tags follow semver (vX.Y.Z)
- Features added in main branch
- Examples updated alongside feature development
- Changelog maintained for each version
- Both Python and TypeScript packages versioned together
- Generate release notes using git commands:
  - Use `git diff v0.5.11..v0.6.0` to see file changes between versions
  - Use `git log --oneline v0.5.11..v0.6.0` to see commit messages
  - Use `git diff v0.5.11..v0.6.0 --name-only` to list changed files
  - Always verify changes from git before updating CHANGELOG.md
- Changelog priorities:
  - Document API changes first, especially new fields and parameters
  - Note experimental features and fields explicitly (e.g. experimental_subject_line)
  - Include interface/model changes even if not visible in git diff
  - Internal changes (testing, docs, etc) are lower priority
  - Always document experimental parameters with their exact names
  - Link to relevant documentation when adding new features
- Changelog organization:
  - Document features in their final release version, not in prep/RC versions
  - Prep/RC versions should have minimal changelog entries pointing to their final version
  - Link to docs using humanlayer.dev/docs/... format
  - Link to examples using full GitHub paths (https://github.com/humanlayer/humanlayer/tree/main/examples/...)
- Generate release notes using git commands:
  - Use `git diff v0.5.11..v0.6.0` to see file changes between versions
  - Use `git log --oneline v0.5.11..v0.6.0` to see commit messages
  - Use `git diff v0.5.11..v0.6.0 --name-only` to list changed files
  - Always verify changes from git before updating CHANGELOG.md
- Generate release notes using git diff between version tags: `git diff v0.5.11..v0.6.0`

### Feature Development Pattern

- New features accompanied by examples
- Examples directory organized by framework integration
- Changes coordinated across Python/TypeScript implementations
- Email channel example: subject lines, threading, and framework-specific implementations

## Version Control and Releases

### Release Process

- Version tags follow semver (vX.Y.Z)
- Features added in main branch
- Examples updated alongside feature development
- Changelog maintained for each version
- Both Python and TypeScript packages versioned together

### Feature Development Pattern

- New features accompanied by examples
- Examples directory organized by framework integration
- Changes coordinated across Python/TypeScript implementations
- Email channel example: subject lines, threading, and framework-specific implementations

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

### Asset Management

When creating new documentation:

- Copy images from docs-md/images/ to docs/images/ before referencing them
- Ensure image paths in .mdx files match the docs/images/ location
- Verify images are < 5MB before copying
- For images hosted on humanlayer.dev, use full URLs (e.g., https://humanlayer.dev/img-approval-social.png)
- For local images, use relative paths from the docs/images/ directory

The project is transitioning from Metalytics to Humanlayer branding - ensure new documentation uses Humanlayer assets.

## Documentation Structure

### Link Management

Documentation links follow these rules:

- Keep external package/tool links (npm, pip) pointing to their original sources
- Documentation links should use humanlayer.dev/docs/... format (e.g., humanlayer.dev/docs/channels/email)
- Use relative links for internal navigation between doc pages
- Example links should point to GitHub repository with full path (e.g., https://github.com/humanlayer/humanlayer/tree/main/examples/langchain)
- Framework documentation must link to examples repository (https://github.com/humanlayer/humanlayer/tree/main/examples)

The documentation is organized around AI framework integrations:

- OpenAI integration
- Langchain integration
- CrewAI integration
- ControlFlow integration (supports function calling and human approvals)

Style guidelines for framework documentation:

- Use concise titles (e.g. "LangChain" not "LangChain Integration")
- Focus on practical, real-world examples
- Follow consistent structure: Overview, Installation, Basic Example, How it Works, Running the Example, Next Steps

Documentation structure for framework integrations:

- Overview: Brief introduction to the framework and Humanlayer integration
- Installation: Required packages with pip install commands
- Basic Example: Complete working example with environment setup
- How it Works: Step-by-step breakdown of the example
- Running the Example: Clear steps to execute the code
- Next Steps: Links to core concepts (require_approval, contact channels, etc.)

Example patterns:

- Math operations for simple demonstrations
- Customer onboarding for real-world use cases

Focus documentation on framework integration patterns and examples rather than basic features.

## Contact Channel System

Core concepts around contact channels:

### Channel Types

- Slack: Real-time team communication
- Email: Asynchronous communication with threading
- Web: React embeds for custom UIs and in-app approval flows
  - Requires backend proxy to handle authentication and API keys
  - Frontend components communicate through backend proxy
  - Never expose HumanLayer API key to frontend
  - Use JWT-based authentication for web embeds:
    - Frontend should pass JWTs that encode tenant/user context
    - Backend validates JWTs before proxying to HumanLayer
    - Keep authentication simple and stateless where possible
    - Prefer tenant-based authorization over user-based
  - Security principles:
    - API keys stay in backend only
    - Frontend uses short-lived JWTs
    - Tenant isolation is enforced at proxy layer
- SMS/WhatsApp: Mobile-first communication (beta)

### Channel Selection Guidelines

- Slack for team collaboration and real-time approvals
- Email for external communication and formal approvals
- Web embeds for custom workflows and UIs
- Mobile channels for field operations

### Channel Architecture

- Channels are composable - can be combined for multi-channel approval flows
- Each channel has unique properties (context, threading, etc)
- Implementation patterns:

  - Python is the primary implementation language, TypeScript/JavaScript examples should be secondary
  - Use full ContactChannel objects in examples rather than simplified primitives
  - Examples should match actual implementation patterns used in production code
  - Composite channels feature is in active development:
    - Community feedback welcome on the design
    - Contact team to participate in feature development
    - Current direction favors nested ContactChannel objects over separate policy types
  - Composite channels are created by nesting ContactChannel objects:

    ```python
    # Single channel
    channel = ContactChannel(slack=SlackContactChannel(...))

    # Multiple required channels
    channel = ContactChannel(all_of=[
        ContactChannel(email=EmailContactChannel(...)),
        ContactChannel(slack=SlackContactChannel(...))
    ])

    # Alternative channels
    channel = ContactChannel(any_of=[
        ContactChannel(email=EmailContactChannel(...)),
        ContactChannel(slack=SlackContactChannel(...))
    ])
    ```

- Three-level configuration hierarchy:
  1. Operation Level: Configured per-function via require_approval() or human_as_tool()
  2. SDK Level: Configured on HumanLayer instance creation
  3. Project Level: Configured in HumanLayer dashboard as project defaults
- Configuration precedence follows hierarchy (operation overrides SDK overrides project)
- Default channel fallback based on project settings

### Framework Integration Principles

- Provide first-class support for major web frameworks (FastAPI, Django, Express)
- Framework-specific packages preferred over generic implementations
- React integration features:
  - Hooks-first approach for data fetching and state management
  - Components handle their own authentication flow
  - Minimal configuration required in parent components
  - Keep token management internal to components where possible
- Authentication handled at multiple levels:
  - JWT token generation in framework-specific auth endpoints
  - Signing key configuration in HumanLayer dashboard
  - Framework-specific middleware and request handling
- Each framework integration includes:
  - Framework-specific package (e.g. humanlayer-embed[fastapi])
  - Dedicated request handlers
  - Authentication middleware examples
  - Type-safe interfaces where possible

### Channel Selection Guidelines

- Slack for team collaboration and real-time approvals
- Email for external communication and formal approvals
- Web embeds for custom workflows and UIs
- Mobile channels for field operations

## Tool Calling Concepts

Core concepts around LLM tool calling and human oversight:

### Function Stakes Framework

Categorize functions by risk level:

- Low Stakes: Read-only access to public data
- Medium Stakes: Read-only access to private data, templated communication
- High Stakes: Write access to systems, free-form communication on behalf of users/company

### Human Oversight Philosophy

- Even with advanced LLMs, high-stakes functions require human oversight
- 90% accuracy is insufficient for critical operations
- Oversight must be deterministic, not probabilistic
- Human feedback can be used for evaluation/fine-tuning

### LLM Application Evolution

Document the progression of LLM applications:

- Gen 1: Chat - human-initiated question / response interface
- Gen 2: Agentic Assistants - frameworks drive prompt routing, tool calling, chain of thought, and context window management. Most workflows are initiated by humans in single-shot "here's a task, go do it" or rolling chat interfaces.
- Gen 3: Autonomous Agents - no longer human initiated, agents live in the "outer loop" driving toward their goals using various tools and functions. Human/Agent communication is Agent-initiated rather than human-initiated.

#### Autonomous Agent Requirements

Gen 3 autonomous agents need:

- Ways to consult humans for input on various tasks
- Human oversight for sensitive operations
- Contact channels across chat, email, sms, etc.
- Self-managed scheduling and cost management
- Durable serialization and resumption of workflows across long-running tool calls
- Context window management by a "manager LLM"
- Ability to fork sub-chains for specialized tasks and roles

Example use cases:

- LinkedIn inbox assistant
- Customer onboarding assistant

## Response Option Patterns

Common patterns for structuring response options:

- Detecting user frustration/emotion - Use response options to guide agent responses to emotional states
- Approval flows - Provide clear approve/reject options with descriptions
- Guided responses - Use response options to structure human feedback into actionable formats
- Multi-step workflows - Chain response options across multiple human interactions

Example: When detecting user frustration, provide response options that:

- Acknowledge the emotion ("User sounds frustrated")
- Suggest concrete next steps ("Offer discount", "Escalate to manager")
- Include context in descriptions

## Core Architecture

### Run IDs and Call IDs

- Run IDs track a single agent execution/conversation
- Call IDs uniquely identify individual function calls or human contacts
- Hierarchy: One run can have many calls
- Run IDs help group related approvals/contacts
- Call IDs enable tracking individual request status
- Both IDs are used for:
  - Audit trails
  - Status lookups
  - Response routing
  - Request deduplication
  - Dashboard organization

## Documentation Style

Documentation should follow these principles:

- Use precise technical terminology (e.g. "HumanLayer SDK" not just "HumanLayer")
- Provide complete, working examples that can be copy-pasted
- Include both the happy path and error handling in examples
- Show full context around async operations (polling, webhooks, etc)
- Distinguish between SDK operations and backend operations
- Use consistent terminology across all docs

## Community

- Primary community engagement through Discord
- Documentation should link to Discord for community support
- GitHub repository serves as secondary community hub
