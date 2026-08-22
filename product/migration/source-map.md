# Product relocation map

This map assigns product behavior to its final owner. The official source plane remains the reference implementation; moving a file means reimplementing its product behavior against public plugin, Slot, event, or bridge APIs rather than copying the file into the overlay.

| Current location | Final owner | Boundary |
| --- | --- | --- |
| `apps/desktop/` | `product/current/desktop/` | Electron window, preload bridge, native menu, notification, icon, and packaging |
| `plugins/` | `product/current/frontend/` or the Electron shell | Client plugins and native shell code are product-owned; Host plugins are excluded from the release composition |
| `apps/web/src/desktop-chrome.*` | `product/current/frontend/source/` | Desktop renderer chrome is the product frontend source plane |
| Direct changes under `packages/client/` | `product/current/frontend/source/` only when the change is presentation-only | Client files must use official Host/API contracts; unsupported backend features are omitted from the product UI |
| Direct changes under `packages/attachment/`, `packages/host/`, or `packages/api/` | `upstream/` | Backend and wire source is upstream-only and fails the product source check if overlaid |
| Direct changes under `apps/cli/` | `upstream/` | The desktop mounts the official CLI Web Profile in the Electron main process |

Features that require a missing upstream extension point remain explicit source patches with a clean-apply gate. The next migration step can replace an individual patch with a public `dsh.client` or Cordis plugin without changing the product repository or release lock model.
