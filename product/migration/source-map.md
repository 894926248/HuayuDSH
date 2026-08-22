# Product relocation map

This map assigns product behavior to its final owner. The official source plane remains the reference implementation; moving a file means reimplementing its product behavior against public plugin, Slot, event, or bridge APIs rather than copying the file into the overlay.

| Current location | Final owner | Boundary |
| --- | --- | --- |
| `apps/desktop/` | `product/current/desktop/` | Electron window, preload bridge, native menu, notification, icon, and packaging |
| `plugins/` | `product/current/frontend/` or `product/current/backend/` | Split by `dsh.client` browser entry and Host Cordis entry |
| `apps/web/src/desktop-chrome.*` | `product/current/frontend/` | Desktop chrome client plugin; no import from the official web entry |
| Direct changes under `packages/client/` | `product/current/frontend/` | Rebuild through Slots, public services, and typed runtime faces |
| Direct changes under `packages/attachment/`, `packages/host/`, or `packages/api/` | `product/current/backend/` or an upstream contribution | Keep model-visible and durable attachment behavior on a typed Host/API path |
| Direct changes under `apps/cli/` | `product/current/desktop/` or `product/current/backend/` | Use the CLI's public launch and patch interfaces; do not edit the official launcher |

Features that require a missing upstream extension point are recorded as compatibility work, not hidden in DOM or private-module adapters. The attachment content contract and the sidebar layout policy are the first such checks for this product.
