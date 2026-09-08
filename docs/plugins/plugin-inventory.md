---
summary: "Generated inventory of Carapace plugins shipped in core, published externally, or kept source-only"
read_when:
  - You are deciding whether a plugin ships in the core npm package or installs separately
  - You are updating bundled plugin package metadata or release automation
  - You need the canonical internal vs external plugin list
title: "Plugin inventory"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. -->

This page lists every Carapace plugin with its package, install route, and
description. Operators use it to find a plugin and to see whether that plugin
needs a separate install. Maintainers use it to check bundled plugin metadata
and release automation.

## Definitions

- **Core npm package:** built into the `carapace` npm package and available without a separate plugin install.
- **Official external package:** Carapace-maintained plugin omitted from the core npm package, kept in this official inventory, and installed on demand through ClawHub and/or npm.
- **Source checkout only:** repo-local plugin omitted from published npm artifacts and not advertised as an installable package.

Source checkouts are different from npm installs: after `pnpm install`, bundled
plugins load from `extensions/<id>` so local edits and package-local workspace
dependencies are available.

## Install a plugin

Use the install route in each entry to decide whether install is needed. Plugins
that say `included in Carapace` are already present in the core package.
Official external packages need one install, then a Gateway restart.

For example, Discord is an official external package:

```bash
carapace plugins install @carapace/discord
carapace gateway restart
carapace plugins inspect discord --runtime --json
```

During the launch cutover, ordinary bare package specs still install from npm.
Use `clawhub:@carapace/discord` or `npm:@carapace/discord` when you need an
explicit source. After install, follow the plugin's setup doc, such as
[Discord](/channels/discord), to add credentials and channel config. See
[Manage plugins](/plugins/manage-plugins) for update, uninstall, and publishing
commands.

Each entry lists the package, distribution route, and description.

## Core npm package

59 plugins

- **[a2a](/plugins/reference/a2a)** (`@carapace/a2a`) - included in Carapace. A2A v1.0 Agent-to-Agent protocol channel plugin.

- **[active-memory](/plugins/reference/active-memory)** (`carapace`) - included in Carapace. Runs bounded pre-reply memory retrieval and implements per-agent Remember across conversations for eligible private conversations.

- **[admin-http-rpc](/plugins/reference/admin-http-rpc)** (`@carapace/admin-http-rpc`) - included in Carapace. Carapace admin HTTP RPC endpoint.

- **[alibaba](/plugins/reference/alibaba)** (`@carapace/alibaba-provider`) - included in Carapace. Adds video generation provider support.

- **[anthropic](/plugins/reference/anthropic)** (`@carapace/anthropic-provider`) - included in Carapace. Anthropic models, Claude CLI, and native Claude session catalog.

- **[azure-speech](/plugins/reference/azure-speech)** (`@carapace/azure-speech`) - included in Carapace. Azure AI Speech text-to-speech (MP3, native Ogg/Opus voice notes, PCM telephony).

- **[beam](/plugins/reference/beam)** (`@carapace/beam`) - included in Carapace. Read-only coding-session Beam receiver.

- **[bonjour](/plugins/reference/bonjour)** (`@carapace/bonjour`) - included in Carapace. Advertise the local Carapace gateway over Bonjour/mDNS.

- **[browser](/plugins/reference/browser)** (`@carapace/browser-plugin`) - included in Carapace. Adds agent-callable tools.

- **[canvas](/plugins/reference/canvas)** (`@carapace/canvas-plugin`) - included in Carapace. Presents hosted widget documents on paired macOS panels.

- **[clawrouter](/plugins/reference/clawrouter)** (`@carapace/clawrouter`) - included in Carapace. Adds ClawRouter model provider support to Carapace.

- **[copilot-proxy](/plugins/reference/copilot-proxy)** (`@carapace/copilot-proxy`) - included in Carapace. Adds Copilot Proxy model provider support to Carapace.

- **[crabbox](/plugins/reference/crabbox)** (`@carapace/crabbox-provider`) - included in Carapace. Cloud worker provider backed by the Crabbox CLI.

- **[cua-computer](/plugins/reference/cua-computer)** (`@carapace/cua-computer`) - included in Carapace. Experimental CUA Driver computer control for macOS, Windows, and Linux node hosts.

- **[deepgram](/plugins/reference/deepgram)** (`@carapace/deepgram-provider`) - included in Carapace. Adds media understanding provider support. Adds realtime transcription provider support.

- **[device-pair](/plugins/reference/device-pair)** (`carapace`) - included in Carapace. Generate setup codes and approve device pairing requests.

- **[document-extract](/plugins/reference/document-extract)** (`@carapace/document-extract-plugin`) - included in Carapace. Extract text and fallback page images from local document attachments.

- **[elevenlabs](/plugins/reference/elevenlabs)** (`@carapace/elevenlabs-speech`) - included in Carapace. Adds media understanding provider support. Adds realtime transcription provider support. Adds text-to-speech provider support.

- **[fal](/plugins/reference/fal)** (`@carapace/fal-provider`) - included in Carapace. Adds fal model provider support to Carapace.

- **[file-transfer](/plugins/reference/file-transfer)** (`@carapace/file-transfer`) - included in Carapace. Fetch, list, and write files on paired nodes via dedicated node commands. Bypasses bash stdout truncation by using base64 over node.invoke for binaries up to 16 MB.

- **[geolocation](/plugins/reference/geolocation)** (`@carapace/geolocation-plugin`) - included in Carapace. Resolves client IP addresses to a coarse city using a locally cached IP-geolocation database.

- **[github-copilot](/plugins/reference/github-copilot)** (`@carapace/github-copilot-provider`) - included in Carapace. Adds GitHub Copilot model provider support to Carapace.

- **[google](/plugins/reference/google)** (`@carapace/google-plugin`) - included in Carapace. Adds Google, Google Gemini CLI, Google Vertex model provider support to Carapace.

- **[huggingface](/plugins/reference/huggingface)** (`@carapace/huggingface-provider`) - included in Carapace. Adds Hugging Face model provider support to Carapace.

- **[imap](/plugins/reference/imap)** (`@carapace/imap`) - included in Carapace. Watch IMAP mailboxes and dispatch authenticated incoming email to isolated agent sessions.

- **[linux-node](/plugins/reference/linux-node)** (`@carapace/linux-node`) - included in Carapace. Desktop notifications, camera capture, and location for Linux node hosts.

- **[litellm](/plugins/reference/litellm)** (`@carapace/litellm-provider`) - included in Carapace. Adds LiteLLM model provider support to Carapace.

- **[llm-task](/plugins/reference/llm-task)** (`@carapace/llm-task`) - included in Carapace. Generic JSON-only LLM tool for structured tasks callable from workflows.

- **[lmstudio](/plugins/reference/lmstudio)** (`@carapace/lmstudio-provider`) - included in Carapace. Adds LM Studio model provider support to Carapace.

- **[logbook](/plugins/reference/logbook)** (`@carapace/logbook`) - included in Carapace. Automatic work journal: captures periodic screen snapshots from a paired node and turns them into a reviewable timeline of your day.

- **[memory-core](/plugins/reference/memory-core)** (`@carapace/memory-core`) - included in Carapace. Adds agent-callable tools.

- **[memory-wiki](/plugins/reference/memory-wiki)** (`@carapace/memory-wiki`) - included in Carapace. Persistent wiki compiler and Obsidian-friendly knowledge vault for Carapace.

- **[microsoft](/plugins/reference/microsoft)** (`@carapace/microsoft-speech`) - included in Carapace. Adds text-to-speech provider support.

- **[microsoft-foundry](/plugins/reference/microsoft-foundry)** (`@carapace/microsoft-foundry`) - included in Carapace. Adds Microsoft Foundry model provider support to Carapace.

- **[migrate-claude](/plugins/reference/migrate-claude)** (`@carapace/migrate-claude`) - included in Carapace. Imports Claude Code and Claude Desktop instructions, MCP servers, skills, and safe configuration into Carapace.

- **[migrate-hermes](/plugins/reference/migrate-hermes)** (`@carapace/migrate-hermes`) - included in Carapace. Imports Hermes configuration, memories, skills, and supported credentials into Carapace.

- **[minimax](/plugins/reference/minimax)** (`@carapace/minimax-provider`) - included in Carapace. Adds MiniMax, MiniMax Portal model provider support to Carapace.

- **[nvidia](/plugins/reference/nvidia)** (`@carapace/nvidia-provider`) - included in Carapace. Adds NVIDIA model provider support to Carapace.

- **[oc-path](/plugins/reference/oc-path)** (`@carapace/oc-path`) - included in Carapace. Adds the carapace path CLI for oc:// workspace file addressing.

- **[ollama](/plugins/reference/ollama)** (`@carapace/ollama-provider`) - included in Carapace. Adds Ollama, Ollama Cloud model provider support to Carapace.

- **[onepassword](/plugins/reference/onepassword)** (`@carapace/onepassword`) - included in Carapace. 1Password SecretRef resolver and curated agent broker with approval policy and SQLite audit history.

- **[openai](/plugins/reference/openai)** (`@carapace/openai-provider`) - included in Carapace. Adds OpenAI model provider support to Carapace.

- **[opencode-go](/plugins/reference/opencode-go)** (`@carapace/opencode-go-provider`) - included in Carapace. Adds OpenCode Go model provider support to Carapace.

- **[openrouter](/plugins/reference/openrouter)** (`@carapace/openrouter-provider`) - included in Carapace. Adds OpenRouter model provider support to Carapace.

- **[policy](/plugins/reference/policy)** (`@carapace/policy`) - included in Carapace. Adds policy-backed doctor checks for workspace conformance.

- **[reef](/plugins/reference/reef)** (`@carapace/reef`) - included in Carapace. Guarded end-to-end encrypted claw channel.

- **[runway](/plugins/reference/runway)** (`@carapace/runway-provider`) - included in Carapace. Adds video generation provider support.

- **[senseaudio](/plugins/reference/senseaudio)** (`@carapace/senseaudio-provider`) - included in Carapace. Adds media understanding provider support.

- **[sglang](/plugins/reference/sglang)** (`@carapace/sglang-provider`) - included in Carapace. Adds SGLang model provider support to Carapace.

- **[talk-voice](/plugins/reference/talk-voice)** (`carapace`) - included in Carapace. Manage Talk voice selection (list/set).

- **[telegram](/plugins/reference/telegram)** (`@carapace/telegram`) - included in Carapace. Carapace Telegram channel plugin.

- **[together](/plugins/reference/together)** (`@carapace/together-provider`) - included in Carapace. Adds Together model provider support to Carapace.

- **[tts-local-cli](/plugins/reference/tts-local-cli)** (`@carapace/tts-local-cli`) - included in Carapace. Adds text-to-speech provider support.

- **[vault](/plugins/reference/vault)** (`@carapace/vault`) - included in Carapace. HashiCorp Vault SecretRef provider integration.

- **[vllm](/plugins/reference/vllm)** (`@carapace/vllm-provider`) - included in Carapace. Adds vLLM model provider support to Carapace.

- **[web-readability](/plugins/reference/web-readability)** (`@carapace/web-readability-plugin`) - included in Carapace. Extract readable article content from local HTML web fetch responses.

- **[webhooks](/plugins/reference/webhooks)** (`@carapace/webhooks`) - included in Carapace. Authenticated inbound webhooks that bind external automation to Carapace TaskFlows.

- **[workboard](/plugins/reference/workboard)** (`@carapace/workboard`) - included in Carapace. Dashboard workboard for agent-owned issues and sessions.

- **[xai](/plugins/reference/xai)** (`@carapace/xai-plugin`) - included in Carapace. Adds xAI model provider support to Carapace.

## Official external packages

91 plugins

- **[acpx](/plugins/reference/acpx)** (`@carapace/acpx`) - npm or ClawHub. Carapace ACP runtime backend with plugin-owned session and transport management.

- **[amazon-bedrock](/plugins/reference/amazon-bedrock)** (`@carapace/amazon-bedrock-provider`) - npm or ClawHub. Carapace Amazon Bedrock provider plugin with model discovery, embeddings, and guardrail support.

- **[amazon-bedrock-mantle](/plugins/reference/amazon-bedrock-mantle)** (`@carapace/amazon-bedrock-mantle-provider`) - npm or ClawHub. Carapace Amazon Bedrock Mantle provider plugin for OpenAI-compatible model routing.

- **[anthropic-vertex](/plugins/reference/anthropic-vertex)** (`@carapace/anthropic-vertex-provider`) - npm or ClawHub. Carapace Anthropic Vertex provider plugin for Claude models on Google Vertex AI.

- **[arcee](/plugins/reference/arcee)** (`@carapace/arcee-provider`) - npm or ClawHub: `clawhub:@carapace/arcee-provider`. Adds Arcee model provider support to Carapace.

- **[baseten](/plugins/reference/baseten)** (`@carapace/baseten-provider`) - npm or ClawHub: `clawhub:@carapace/baseten-provider`. Carapace Baseten provider plugin.

- **[brave](/plugins/reference/brave)** (`@carapace/brave-plugin`) - npm or ClawHub. Carapace Brave Search provider plugin for web search.

- **[buzz](/plugins/reference/buzz)** (`@carapace/buzz`) - npm or ClawHub: `clawhub:@carapace/buzz`. Connect Carapace agents to Buzz rooms.

- **[byteplus](/plugins/reference/byteplus)** (`@carapace/byteplus-provider`) - npm or ClawHub: `clawhub:@carapace/byteplus-provider`. Adds BytePlus, BytePlus Plan model provider support to Carapace.

- **[cerebras](/plugins/reference/cerebras)** (`@carapace/cerebras-provider`) - npm or ClawHub: `clawhub:@carapace/cerebras-provider`. Adds Cerebras model provider support to Carapace.

- **[chutes](/plugins/reference/chutes)** (`@carapace/chutes-provider`) - npm or ClawHub: `clawhub:@carapace/chutes-provider`. Adds Chutes model provider support to Carapace.

- **[clickclack](/plugins/reference/clickclack)** (`@carapace/clickclack`) - npm or ClawHub: `clawhub:@carapace/clickclack`. Carapace ClickClack channel plugin.

- **[cloudflare-ai-gateway](/plugins/reference/cloudflare-ai-gateway)** (`@carapace/cloudflare-ai-gateway-provider`) - npm or ClawHub: `clawhub:@carapace/cloudflare-ai-gateway-provider`. Adds Cloudflare AI Gateway model provider support to Carapace.

- **[codex](/plugins/reference/codex)** (`@carapace/codex`) - npm or ClawHub. Codex app-server harness and native session catalog.

- **[cohere](/plugins/reference/cohere)** (`@carapace/cohere-provider`) - npm or ClawHub: `clawhub:@carapace/cohere-provider`. Carapace Cohere provider plugin.

- **[comfy](/plugins/reference/comfy)** (`@carapace/comfy-provider`) - npm or ClawHub: `clawhub:@carapace/comfy-provider`. Adds ComfyUI model provider support to Carapace.

- **[copilot](/plugins/reference/copilot)** (`@carapace/copilot`) - npm or ClawHub: `clawhub:@carapace/copilot`. Registers the GitHub Copilot agent runtime.

- **[deepinfra](/plugins/reference/deepinfra)** (`@carapace/deepinfra-provider`) - npm or ClawHub: `clawhub:@carapace/deepinfra-provider`. Adds DeepInfra model provider support to Carapace.

- **[deepseek](/plugins/reference/deepseek)** (`@carapace/deepseek-provider`) - npm or ClawHub: `clawhub:@carapace/deepseek-provider`. Adds DeepSeek model provider support to Carapace.

- **[diagnostics-otel](/plugins/reference/diagnostics-otel)** (`@carapace/diagnostics-otel`) - npm or ClawHub: `clawhub:@carapace/diagnostics-otel`. Carapace diagnostics OpenTelemetry exporter for metrics, traces, and logs.

- **[diagnostics-prometheus](/plugins/reference/diagnostics-prometheus)** (`@carapace/diagnostics-prometheus`) - npm or ClawHub: `clawhub:@carapace/diagnostics-prometheus`. Carapace diagnostics Prometheus exporter for runtime metrics.

- **[diffs](/plugins/reference/diffs)** (`@carapace/diffs`) - npm or ClawHub: `clawhub:@carapace/diffs`. Carapace read-only diff viewer plugin and file renderer for agents.

- **[diffs-language-pack](/plugins/reference/diffs-language-pack)** (`@carapace/diffs-language-pack`) - npm or ClawHub: `clawhub:@carapace/diffs-language-pack`. Adds syntax highlighting for languages outside the default diffs viewer set.

- **[discord](/plugins/reference/discord)** (`@carapace/discord`) - npm or ClawHub. Carapace Discord channel plugin for channels, DMs, commands, and app events.

- **[duckduckgo](/plugins/reference/duckduckgo)** (`@carapace/duckduckgo-plugin`) - npm or ClawHub: `clawhub:@carapace/duckduckgo-plugin`. Adds web search provider support.

- **[exa](/plugins/reference/exa)** (`@carapace/exa-plugin`) - npm or ClawHub: `clawhub:@carapace/exa-plugin`. Adds web search provider support.

- **[featherless](/plugins/reference/featherless)** (`@carapace/featherless-provider`) - npm or ClawHub: `clawhub:@carapace/featherless-provider`. Carapace Featherless AI provider plugin.

- **[feishu](/plugins/reference/feishu)** (`@carapace/feishu`) - npm or ClawHub. Carapace Feishu/Lark channel plugin for chats and workplace tools (community maintained by @m1heng).

- **[firecrawl](/plugins/reference/firecrawl)** (`@carapace/firecrawl-plugin`) - npm or ClawHub: `clawhub:@carapace/firecrawl-plugin`. Adds agent-callable tools. Adds web fetch provider support. Adds web search provider support.

- **[fireworks](/plugins/reference/fireworks)** (`@carapace/fireworks-provider`) - npm or ClawHub: `clawhub:@carapace/fireworks-provider`. Adds Fireworks model provider support to Carapace.

- **[fish-audio-speech](/plugins/reference/fish-audio-speech)** (`@carapace/fish-audio-speech`) - npm or ClawHub: `clawhub:@carapace/fish-audio-speech`. Fish Audio S2.1 hosted text-to-speech with streaming, voice notes, and telephony output.

- **[gmi](/plugins/reference/gmi)** (`@carapace/gmi-provider`) - npm or ClawHub: `clawhub:@carapace/gmi-provider`. Carapace GMI Cloud provider plugin.

- **[google-meet](/plugins/reference/google-meet)** (`@carapace/google-meet`) - npm or ClawHub. Carapace Google Meet participant plugin for joining calls through Chrome or Twilio transports.

- **[googlechat](/plugins/reference/googlechat)** (`@carapace/googlechat`) - npm or ClawHub. Carapace Google Chat channel plugin for spaces and direct messages.

- **[gradium](/plugins/reference/gradium)** (`@carapace/gradium-speech`) - npm or ClawHub: `clawhub:@carapace/gradium-speech`. Adds text-to-speech provider support.

- **[groq](/plugins/reference/groq)** (`@carapace/groq-provider`) - npm or ClawHub: `clawhub:@carapace/groq-provider`. Adds Groq model provider support to Carapace.

- **[imessage](/plugins/reference/imessage)** (`@carapace/imessage`) - npm or ClawHub: `clawhub:@carapace/imessage`. Carapace iMessage channel plugin using imsg on a signed-in Mac.

- **[inworld](/plugins/reference/inworld)** (`@carapace/inworld-speech`) - npm or ClawHub: `clawhub:@carapace/inworld-speech`. Inworld streaming text-to-speech (MP3, OGG_OPUS, PCM telephony).

- **[irc](/plugins/reference/irc)** (`@carapace/irc`) - npm or ClawHub: `clawhub:@carapace/irc`. Carapace IRC channel plugin.

- **[kilocode](/plugins/reference/kilocode)** (`@carapace/kilocode-provider`) - npm or ClawHub: `clawhub:@carapace/kilocode-provider`. Adds Kilocode model provider support to Carapace.

- **[kimi](/plugins/reference/kimi)** (`@carapace/kimi-provider`) - npm or ClawHub: `clawhub:@carapace/kimi-provider`. Adds Kimi, Kimi Coding model provider support to Carapace.

- **[line](/plugins/reference/line)** (`@carapace/line`) - npm or ClawHub. Carapace LINE channel plugin for LINE Bot API chats.

- **[llama-cpp](/plugins/reference/llama-cpp)** (`@carapace/llama-cpp-provider`) - npm or ClawHub. Managed and external llama.cpp servers for GGUF chat and embeddings.

- **[lobster](/plugins/reference/lobster)** (`@carapace/lobster`) - npm or ClawHub. Lobster workflow tool plugin for typed pipelines and resumable approvals.

- **[longcat](/plugins/reference/longcat)** (`@carapace/longcat-provider`) - npm or ClawHub: `clawhub:@carapace/longcat-provider`. Carapace LongCat provider plugin.

- **[matrix](/plugins/reference/matrix)** (`@carapace/matrix`) - npm or ClawHub: `clawhub:@carapace/matrix`. Carapace Matrix channel plugin for rooms and direct messages.

- **[mattermost](/plugins/reference/mattermost)** (`@carapace/mattermost`) - npm or ClawHub: `clawhub:@carapace/mattermost`. Carapace Mattermost channel plugin.

- **[memory-lancedb](/plugins/reference/memory-lancedb)** (`@carapace/memory-lancedb`) - npm or ClawHub. Carapace LanceDB-backed long-term memory plugin with auto-recall, auto-capture, and vector search.

- **[meta](/plugins/reference/meta)** (`@carapace/meta-provider`) - npm or ClawHub: `clawhub:@carapace/meta-provider`. Adds Meta model provider support to Carapace.

- **[mistral](/plugins/reference/mistral)** (`@carapace/mistral-provider`) - npm or ClawHub: `clawhub:@carapace/mistral-provider`. Adds Mistral model provider support to Carapace.

- **[moonshot](/plugins/reference/moonshot)** (`@carapace/moonshot-provider`) - npm or ClawHub: `clawhub:@carapace/moonshot-provider`. Adds Moonshot model provider support to Carapace.

- **[msteams](/plugins/reference/msteams)** (`@carapace/msteams`) - npm or ClawHub. Carapace Microsoft Teams channel plugin for bot conversations.

- **[mxc](/plugins/reference/mxc)** (`@carapace/mxc-sandbox`) - npm or ClawHub. OS-level sandboxed tool execution via MXC: runs commands in a Windows ProcessContainer with configured MXC policy files.

- **[nextcloud-talk](/plugins/reference/nextcloud-talk)** (`@carapace/nextcloud-talk`) - npm or ClawHub. Carapace Nextcloud Talk channel plugin for conversations.

- **[nostr](/plugins/reference/nostr)** (`@carapace/nostr`) - npm or ClawHub. Carapace Nostr channel plugin for NIP-04 encrypted direct messages.

- **[novita](/plugins/reference/novita)** (`@carapace/novita-provider`) - npm or ClawHub: `clawhub:@carapace/novita-provider`. Adds Novita, Novita AI, Novitaai model provider support to Carapace.

- **[opencode](/plugins/reference/opencode)** (`@carapace/opencode-provider`) - npm or ClawHub: `clawhub:@carapace/opencode-provider`. Adds OpenCode model provider support to Carapace.

- **[openshell](/plugins/reference/openshell)** (`@carapace/openshell-sandbox`) - npm or ClawHub. Carapace sandbox backend for the NVIDIA OpenShell CLI with mirrored local workspaces and SSH command execution.

- **[parallel](/tools/parallel-search)** (`@carapace/parallel-plugin`) - npm or ClawHub: `clawhub:@carapace/parallel-plugin`. Adds web search provider support.

- **[perplexity](/plugins/reference/perplexity)** (`@carapace/perplexity-plugin`) - npm or ClawHub: `clawhub:@carapace/perplexity-plugin`. Adds web search provider support.

- **[pixverse](/plugins/reference/pixverse)** (`@carapace/pixverse-provider`) - npm or ClawHub: `clawhub:@carapace/pixverse-provider`. Carapace PixVerse video generation provider plugin.

- **[qianfan](/plugins/reference/qianfan)** (`@carapace/qianfan-provider`) - npm or ClawHub: `clawhub:@carapace/qianfan-provider`. Adds Qianfan model provider support to Carapace.

- **[qqbot](/plugins/reference/qqbot)** (`@tencent-connect/carapace-qqbot`) - npm. Carapace QQ Bot channel plugin for group and direct-message workflows.

- **[qwen](/plugins/reference/qwen)** (`@carapace/qwen-provider`) - npm or ClawHub: `clawhub:@carapace/qwen-provider`. Adds Qwen, Qwen Cloud, Model Studio, DashScope, Qwen Token Plan, Bailian Token Plan model provider support to Carapace.

- **[raft](/plugins/reference/raft)** (`@carapace/raft`) - npm or ClawHub. Carapace Raft channel plugin for secure CLI wake bridges.

- **[searxng](/plugins/reference/searxng)** (`@carapace/searxng-plugin`) - npm or ClawHub: `clawhub:@carapace/searxng-plugin`. Adds web search provider support.

- **[signal](/plugins/reference/signal)** (`@carapace/signal`) - npm or ClawHub: `clawhub:@carapace/signal`. Carapace Signal channel plugin.

- **[slack](/plugins/reference/slack)** (`@carapace/slack`) - npm or ClawHub. Carapace Slack channel plugin for channels, DMs, commands, and app events.

- **[sms](/plugins/reference/sms)** (`@carapace/sms`) - npm or ClawHub: `clawhub:@carapace/sms`. Twilio SMS/MMS channel plugin for Carapace messages.

- **[stepfun](/plugins/reference/stepfun)** (`@carapace/stepfun-provider`) - npm or ClawHub: `clawhub:@carapace/stepfun-provider`. Adds StepFun, StepFun Plan model provider support to Carapace.

- **[synology-chat](/plugins/reference/synology-chat)** (`@carapace/synology-chat`) - npm or ClawHub. Synology Chat channel plugin for Carapace channels and direct messages.

- **[synthetic](/plugins/reference/synthetic)** (`@carapace/synthetic-provider`) - npm or ClawHub: `clawhub:@carapace/synthetic-provider`. Adds Synthetic model provider support to Carapace.

- **[tavily](/plugins/reference/tavily)** (`@carapace/tavily-plugin`) - npm or ClawHub: `clawhub:@carapace/tavily-plugin`. Adds agent-callable tools. Adds web search provider support.

- **[team-reports](/plugins/reference/team-reports)** (`@carapace/team-reports`) - npm or ClawHub: `clawhub:@carapace/team-reports`. Daily, weekly, and monthly team activity reports from GitHub and Discord, with model-written summaries, served in the Control UI.

- **[teams-meetings](/plugins/reference/teams-meetings)** (`@carapace/teams-meetings`) - npm or ClawHub: `clawhub:@carapace/teams-meetings`. Join Microsoft Teams meetings as a Chrome browser guest.

- **[tencent](/plugins/reference/tencent)** (`@carapace/tencent-provider`) - npm or ClawHub: `clawhub:@carapace/tencent-provider`. Adds Tencent TokenHub, Tencent Tokenplan model provider support to Carapace.

- **[tlon](/plugins/reference/tlon)** (`@carapace/tlon`) - npm or ClawHub. Carapace Tlon/Urbit channel plugin for chat workflows.

- **[tokenjuice](/plugins/reference/tokenjuice)** (`@carapace/tokenjuice`) - npm or ClawHub: `clawhub:@carapace/tokenjuice`. Compacts exec and bash tool results with tokenjuice reducers.

- **[twitch](/plugins/reference/twitch)** (`@carapace/twitch`) - npm or ClawHub. Carapace Twitch channel plugin for chat and moderation workflows.

- **[venice](/plugins/reference/venice)** (`@carapace/venice-provider`) - npm or ClawHub: `clawhub:@carapace/venice-provider`. Adds Venice model provider support to Carapace.

- **[vercel-ai-gateway](/plugins/reference/vercel-ai-gateway)** (`@carapace/vercel-ai-gateway-provider`) - npm or ClawHub: `clawhub:@carapace/vercel-ai-gateway-provider`. Adds Vercel AI Gateway model provider support to Carapace.

- **[voice-call](/plugins/reference/voice-call)** (`@carapace/voice-call`) - npm or ClawHub. Carapace voice-call plugin for Twilio, Telnyx, and Plivo phone calls.

- **[volcengine](/plugins/reference/volcengine)** (`@carapace/volcengine-provider`) - npm or ClawHub: `clawhub:@carapace/volcengine-provider`. Adds Volcengine, Volcengine Plan model provider support to Carapace.

- **[voyage](/plugins/reference/voyage)** (`@carapace/voyage-provider`) - npm or ClawHub: `clawhub:@carapace/voyage-provider`. Adds embedding provider support, including memory search.

- **[vydra](/plugins/reference/vydra)** (`@carapace/vydra-provider`) - npm or ClawHub: `clawhub:@carapace/vydra-provider`. Adds Vydra model provider support to Carapace.

- **[whatsapp](/plugins/reference/whatsapp)** (`@carapace/whatsapp`) - npm or ClawHub: `clawhub:@carapace/whatsapp`. Carapace WhatsApp channel plugin for WhatsApp Web chats.

- **[xiaomi](/plugins/reference/xiaomi)** (`@carapace/xiaomi-provider`) - npm or ClawHub: `clawhub:@carapace/xiaomi-provider`. Adds Xiaomi, Xiaomi Token Plan model provider support to Carapace.

- **[zai](/plugins/reference/zai)** (`@carapace/zai-provider`) - npm or ClawHub: `clawhub:@carapace/zai-provider`. Adds Z.AI model provider support to Carapace.

- **[zalo](/plugins/reference/zalo)** (`@carapace/zalo`) - npm or ClawHub. Carapace Zalo channel plugin for bot and webhook chats.

- **[zalouser](/plugins/reference/zalouser)** (`@carapace/zalouser`) - npm or ClawHub. Carapace Zalo Personal Account plugin via native zca-js integration.

- **[zoom-meetings](/plugins/reference/zoom-meetings)** (`@carapace/zoom-meetings`) - npm or ClawHub: `clawhub:@carapace/zoom-meetings`. Join Zoom meetings as a Chrome browser guest.

## Source checkout only

3 plugins

- **[qa-channel](/plugins/reference/qa-channel)** (`@carapace/qa-channel`) - source checkout only. Carapace QA synthetic channel plugin.

- **[qa-lab](/plugins/reference/qa-lab)** (`@carapace/qa-lab`) - source checkout only. Carapace QA lab plugin with private debugger UI and scenario runner.

- **[visitor-access](/plugins/reference/visitor-access)** (`@carapace/visitor-access`) - source checkout only. Manage expiring visitor grants through one Cloudflare Access email policy.

## How this page is built

Carapace generates this page from the top-level
`extensions/*/carapace.plugin.json` manifests and the root npm package
`files` exclusions. Optional `package.json` metadata enriches package and
distribution details. Regenerate the page with:

```bash
pnpm plugins:inventory:gen
```
