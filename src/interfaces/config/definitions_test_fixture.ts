interface DefinitionsConfigFixtureOptions {
  includePushRequestVariants?: boolean
}

export function buildDefinitionsConfigFixture(
  options: DefinitionsConfigFixtureOptions = {},
): string {
  const extraDeliveries = options.includePushRequestVariants
    ? `
  ping:
    push:
      http:
        url: https://example.com/ping
      request:
        type: query
        payload: ok
  default_body:
    push:
      http:
        url: https://example.com/default-body
      request:
        payload:
          text: '{{ entry.title }}'`
    : ''

  const extraRustDeliveries = options.includePushRequestVariants
    ? `
      ping: {}
      default_body: {}`
    : ''

  return `
deliveries:
  archive:
    file:
      path: outputs/archive.md
      content: '{{ entry.title }}'
  webhook:
    push:
      http:
        url: https://example.com/hook
      request:
        type: form
        payload:
          text: '{{ entry.title }}'${extraDeliveries}
  mailer:
    email:
      smtp:
        host: smtp.example.com
        port: 587
        security: starttls
      message:
        from: bot@example.com
        to:
          - ops@example.com
        subject: '[{{ source.title }}] {{ entry.title }}'
        text: '{{ entry.description }}'

sources:
  rust:
    http:
      url: https://example.com/feed.xml
    deliveries:
      archive:
        content: 'override {{ entry.id }}'
      webhook:
        payload:
          text: 'override {{ entry.id }}'${extraRustDeliveries}
      mailer:
        message:
          subject: '[override] {{ entry.title }}'

  digest:
    schedule: '0 * * * *'
    summary:
      sources:
        - rust
    deliveries:
      archive: {}
`
}
