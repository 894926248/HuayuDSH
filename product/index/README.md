# Product change index

`registry.json` is the single editable index for product-owned behavior. It records the feature owner, current source locations, final product location, upstream dependency, update rule, and verification entry. It does not copy source code or replace Git history.

The index follows the useful part of `C:\FileServer`: structured source data is edited once, while checks and query commands consume it. Harness keeps the registry as JSON because the product change set is small; a generated SQLite database would add another derived artifact without improving the current workflow. A database can be added later without changing the registry contract.

Use:

```powershell
node product/checks/validate-product-index.mjs validate
node product/checks/validate-product-index.mjs list
node product/checks/validate-product-index.mjs list --area frontend
```

Every release lock stores the product Git commit/tree, the pinned upstream commit/tree, the product version, and SHA-256 records for release files. The registry describes ownership; Git tags and release locks describe exact versions.
