# DeepSeek Harness Product

This repository is the product control layer for the portable DeepSeek Harness desktop application.

```text
upstream/  Pinned, clean official source
product/   Product overlay, Electron shell, release tooling, and artifacts
plugins/   Local and third-party DSH plugins
```

The desktop executable embeds the official runtime from `upstream/` and applies only the indexed product frontend overlay. Product backend code is prohibited.

```powershell
pnpm run product:validate
pnpm run product:source-check
pnpm run desktop:build
```

See [product/README.md](product/README.md) for release and source ownership rules.
