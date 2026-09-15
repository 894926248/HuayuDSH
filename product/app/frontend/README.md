# Frontend Product Layer

Browser-side product changes live under `source/` with their original upstream-relative paths. Only WebUI targets under `apps/web/` and `packages/client/` are valid. The overlay manifest records every file hash and its selected upstream base; the update tool performs a three-way merge in a temporary workspace and never edits the official checkout. Backend, Host, provider, workflow, persistence, and shared runtime files are not valid overlay targets.
