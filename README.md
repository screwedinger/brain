# Brain

Brain is a personal browser memory system. A Chrome extension captures browsing context locally, a backend turns meaningful activity into durable memory, and a web app provides the visual interface for exploring it.

## Architecture

```text
Chrome Extension (sensor)
  -> IndexedDB (local-first capture)
  -> sync boundary
  -> Supabase / PostgreSQL / pgvector (long-term memory)
  -> Next.js Web App (visual memory)
```

## Monorepo

- `apps/extension` — Chrome Manifest V3 extension
- `apps/web` — Next.js web application
- `packages/shared` — shared TypeScript memory/event contracts
- `docs` — architecture and roadmap notes

## First milestone

Capture browser activity locally without collecting passwords, cookies, form values, or keystrokes. Cloud sync and AI processing are deliberately separate layers.

## Development

The initial repository is intentionally dependency-light so the capture architecture can be validated before introducing the full frontend/backend toolchain.
