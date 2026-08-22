# HuayuDSH product repository

This repository contains the DeepSeek Harness product overlay and Electron distribution layer. The official Harness source is an external `upstream` remote and is materialized only in the ignored `upstream/` checkout used by a build.

Read [product/README.md](product/README.md) and [product/AGENTS.md](product/AGENTS.md) before changing product code. Keep browser, Host, Electron, shared contracts, patch layers, build checks, and indexes in their owning product directories.

Every release requires clean product and `upstream/` worktrees, an exact product version, a pinned upstream commit/tree, and a release lock with SHA-256 artifact records. Do not commit `product/artifacts/`, `upstream/`, node modules, caches, or extracted Electron output.
