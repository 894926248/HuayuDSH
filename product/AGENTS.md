# Product layer instructions

`product/` contains DeepSeek Harness product code that is layered over the upstream Harness source. It is additive: the product layer may import public upstream packages and register Cordis plugins, but it does not edit upstream implementation files.

## Directory ownership

- `current/frontend/` contains browser client plugins, React components, and CSS.
- `current/backend/` contains Host-side Cordis plugins, RPC adapters, and persistence adapters.
- `current/desktop/` contains Electron main, preload, native menus, notifications, and packaging glue.
- `current/shared/` contains types and protocol definitions shared by product faces.
- `current/patch/` contains product-only Cordis patch layers.
- `checks/` contains source-plane and artifact-plane verification scripts.
- `manifests/` contains build inputs and output hashes.
- `index/` contains the hand-edited product change registry and its query tools.
- `migration/` records the source-to-product relocation map.

Keep browser, Host, Electron, and shared code in their owning directory. A feature that crosses faces gets one package or module per face plus a shared contract; do not create a single renderer script that reaches through private upstream modules.

The current `apps/desktop/` and `plugins/` trees are migration inputs until their files have moved into this layout. Do not add new product files to those temporary locations.

`index/registry.json` is the only editable change index. Generated release locks, hashes, staging files, caches, and active copies belong under the ignored `product/artifacts/` tree. Release commands must reject a dirty product or upstream worktree; local experiments use a non-release staging command and never become release records.
