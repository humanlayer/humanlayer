# Email Templates Example

This example shows how to use custom email templates with HumanLayer for both function calls and human-as-tool contacts.

### Running the example

```bash
npm install humanlayer
bun email_templates.ts # or whatever ts env you prefer
```

You'll need to set these environment variables:

- `HUMANLAYER_API_KEY` - Get one at [app.humanlayer.dev](https://app.humanlayer.dev)

The example demonstrates:

- Custom HTML templates for function call approvals
- Custom HTML templates for human-as-tool contacts
- Template variables like `event.spec.fn` and `event.spec.msg`
- Using the `urls.base_url` variable for approval/response links
