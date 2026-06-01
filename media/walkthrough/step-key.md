## Bring your own API key

FlowCraft is **BYOK** — it generates diagrams using *your* AI provider key
(OpenAI, Anthropic, Google, or a FlowCraft token). Your key is stored in VS
Code's secret storage and your prompts never route through FlowCraft's servers.

Click **Set Up API Key**, pick your provider, and paste your key. FlowCraft
validates the format before saving.

- OpenAI keys start with `sk-`
- Anthropic keys start with `sk-ant-`
- Google (Gemini) keys start with `AIza`
- FlowCraft tokens start with `fc_`
