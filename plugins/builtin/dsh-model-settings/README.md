# dsh-model-settings

Generic model settings for every provider.

The plugin replaces the stock Models section and keeps the official settings,
credential, provider-directory, and model-discovery APIs as its only data
source. It does not read a provider-specific model table and does not create a
second model configuration file.

For an existing provider route with a `baseURL`, the Host half asks the same
official discovery seam without the route's static-catalog short-circuit first.
That makes the provider's current `/models` directory visible, while falling
back to the installed catalog when the live directory is unavailable. The
stored credential is resolved from that route's `apiKeyEnv` setting only for
the request.

When a provider model catalog is fetched, every model returned by the provider
is shown. Only model ids already present in that provider profile's `models`
array are checked initially. New models enter the saved configuration only
after the user checks them and applies the provider card.

Install into the active Web profile:

```powershell
node .workspace/artifacts/staging/runtime/apps/cli/lib/bin.js plugin --profile web add "C:/Users/89492/Desktop/deepseek-harness/plugins/dsh-model-settings"
```
