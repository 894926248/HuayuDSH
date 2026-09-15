# dsh-commandcode-provider

Built-in Command Code provider for DeepSeek Harness.

This product-local plugin registers the `commandcode` route and its
`llm-commandcode` settings namespace. It intentionally has no dedicated
Command Code settings page: API keys, endpoint settings, and model selection
are handled by the product's generic Models settings plugin.

The provider uses Command Code's public model directory and generation API,
with credential storage through the standard DSH credentials service.
