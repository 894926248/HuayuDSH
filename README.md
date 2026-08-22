# HuayuDSH

HuayuDSH is the product overlay and desktop distribution repository for DeepSeek Harness. Its portable Electron application embeds the locked official Harness runtime and mounts the official Web Profile in-process; users do not manage a separate backend application. It deliberately does not copy the official Harness source into Git. The source is fetched from the `upstream` remote at the commit recorded by each release lock.

The editable product index is [product/index/registry.json](product/index/registry.json). Product code belongs under [product/current](product/current), and all local build output belongs under the ignored `product/artifacts/` directory.

Bootstrap the external source checkout before a build:

```powershell
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream master
git clone --filter=blob:none --branch master https://github.com/deepseek-ai/deepseek-harness.git upstream
```

Then validate the product layer:

```powershell
node product/checks/verify-upstream-clean.mjs
node product/checks/validate-product-index.mjs validate
node product/checks/verify-product-source.mjs
```

The product repository is separate from the upstream checkout. Do not create a nested `.git` directory inside `product/`.
