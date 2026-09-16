# secThing

## Development Changelog

**Prepared:** 2026-09-16  
**Project:** secThing, a local-first SEC filing research workbench  
**Purpose:** This short continuity entry records the Docker Compose correction required after the Next.js frontend migration in `dev_log_0002.md`.

---

## Compose Dependency-Volume Correction

The new frontend service initially exited with `sh: next: not found` despite `next` being present in `apps/frontend/package.json` and the repository lockfile.

### Cause

The development Compose stack bind-mounts a persistent named volume at `/app/node_modules`. That volume had been created during the earlier Vite-only foundation and therefore masked the newer image dependency directory with a stale dependency set that did not contain Next.js.

### Resolution

The frontend Compose command now runs:

```text
npm install --no-audit --no-fund && npm run dev --workspace=@secthing/frontend
```

before starting Next. This reconciles the durable development dependency volume against the committed lockfile whenever the frontend service starts. It avoids requiring users to manually delete a named volume after a workspace dependency is added.

### Validation

- Recreated the frontend against the existing stale dependency volume.
- Confirmed `node_modules/.bin/next` is then present in the container.
- Confirmed Next.js 16.3.5 starts successfully with Turbopack.
- Confirmed `http://localhost:3000/` renders the company-intake page.
- Confirmed same-origin `http://localhost:3000/api/v1/companies` reaches Fastify and returns the company library.
- `npm run check`, Compose configuration validation, and whitespace validation pass.

### Current Direction

The Compose frontend is again runnable after the Next migration. Continue from `dev_log_0002.md` for SEC identity/metadata work; this entry only corrects the development dependency lifecycle.
