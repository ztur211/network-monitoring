# Local-First, Voice-Enabled AI — Design & Migration Plan

> Status: **Proposal / in-progress.** Authored as part of the AI-scope change: move off the hosted
> Claude API to a **local, domain-relevant model** that keeps working with no internet, and add a
> **two-way voice** mode so a network engineer can *talk through* a problem with the assistant.
>
> This document is the plan. The first safe code increments land alongside it; the model/voice
> runtime is deployed in the operator's environment (it can't run in CI/sandbox).

---

## 0. TL;DR — the decisions

1. **Don't rebuild the AI layer — it's already provider-agnostic.** `AiProviderAdapter`
   (`apps/api/src/ai/adapters/`) already has a `ClaudeAdapter` and an `OpenAICompatibleAdapter`,
   selected by `AI_PROVIDER`. The OpenAI-compatible adapter already defaults to
   `http://localhost:11434/v1` — i.e. **Ollama**. So "use a local model" is primarily configuration +
   the surrounding concerns below, not a new abstraction.
2. **Local runtime: Ollama** (wraps llama.cpp; exposes an OpenAI-compatible API; trivial model
   management). Alternatives: raw `llama.cpp` server, LM Studio, vLLM (GPU). All speak the same
   OpenAI-compatible API, so the adapter is unchanged.
3. **"A model geared to network troubleshooting" ≠ a magic specialized LLM** — there isn't a
   drop-in one. We get domain-relevance from **(a) a strong small open model + (b) RAG over network
   docs/runbooks/the org's own documented network + (c) a tight system prompt**, with an **optional
   LoRA fine-tune** later if we accumulate labelled troubleshooting transcripts.
4. **Voice is offline STT + TTS on the engineer's machine** (the Electron desktop app):
   **whisper.cpp** (speech→text) + **Piper** (text→speech), with VAD for turn-taking. **Wispr Flow is
   not suitable** — it's a cloud dictation product, not an offline, embeddable, two-way conversational
   engine. Alternatives below.
5. **RAG without the LangChain weight (at first):** we already run Postgres — use **pgvector** + a
   local embedding model (`nomic-embed-text` via Ollama) and a small retrieval service in the API.
   Reserve **LangChain/LangGraph** for genuinely agentic multi-step flows (tool use, plan-execute),
   where its orchestration earns its complexity. (LlamaIndex is the alternative if RAG grows.)

### Honest tradeoffs (so this is a clear-eyed decision)
- A local 7–8B model **will not out-reason Claude.** It is *faster per token*, *works offline*, *keeps
  data on-prem*, and *has no per-call cost or rate limit*. For network troubleshooting — bounded
  domain, RAG-grounded, short answers — that trade is reasonable. For open-ended reasoning it's a
  downgrade. Recommended posture: **local-first, with Claude as an optional online "escalation"
  provider** the operator can enable, never required.
- Local inference needs **hardware**: ~6–8 GB RAM for a 7–8B model quantized to Q4 (CPU works but is
  slow; a modest GPU / Apple Silicon is much better). Voice adds ~1–2 GB. This is a per-engineer
  workstation or an on-site box, documented in §10.

---

## 1. Current state (what already exists — don't reinvent it)

- **Provider seam:** `apps/api/src/ai/adapters/ai-provider.interface.ts` (`complete` / `stream`),
  `claude.adapter.ts`, `openai-compatible.adapter.ts`. Selected in `ai.module.ts` by
  `AI_PROVIDER` (`claude` | `openai-compatible`).
- **Context:** `context/` builds the system prompt from network/realtime/account/product providers —
  this is already our domain grounding hook (RAG plugs in here).
- **Rate limiting:** `rate-limiting/ai-rate-limiter.service.ts` (hourly/daily/monthly token budgets).
  Mostly irrelevant for a local model (no cost) but harmless; keep for the optional Claude provider.
- **Conversation:** Redis-backed history; token-budget trimming in `ai.service.ts`.
- **Streaming + graceful degradation:** answers stream over socket.io (`onToken`); a provider failure
  already falls back to a hardcoded, network-aware message. **This is the offline-tolerance seam.**
- **Clients:** web `components/ai/*`, desktop surfaces. Voice attaches at the desktop.

## 2. Goals & non-goals

**Goals**
- Default the assistant to a **local model**; no hosted API required to function.
- Keep working **with the internet down** (model + voice both local).
- **Two-way voice**: the AI speaks findings aloud; the engineer talks back; they troubleshoot as a team.
- **Domain relevance** for network operations (devices, links, circuits, monitoring, the BIM/GUID model).

**Non-goals (for now)**
- Training a foundation model from scratch. (We adapt, not pretrain.)
- Removing Claude entirely — it becomes an *optional* escalation provider, not a dependency.
- Cloud voice services (they break the offline requirement).

## 3. Target architecture

```
 ┌─────────────────────────── Engineer's workstation (offline-capable) ───────────────────────────┐
 │  Electron desktop app                                                                           │
 │   ├─ 3D BIM viewport + network ops UI (existing)                                                 │
 │   └─ Voice loop (NEW):  mic → VAD → whisper.cpp (STT) → text                                     │
 │                          AI answer text → Piper (TTS) → speaker                                  │
 │                          push-to-talk / barge-in control                                         │
 │            │ (local HTTP)                                                                         │
 │            ▼                                                                                      │
 │  Local AI sidecar(s):  Ollama  (chat model + nomic-embed-text)   ── all on localhost ──         │
 └─────────────────────────────────────────────────────────────────────────────────────────────────┘
            │ (when online: sync; when offline: local-only mode)
            ▼
   NestJS API  ──  AiService → AiProviderAdapter → OpenAICompatibleAdapter → Ollama
                   ContextBuilder → RAG retrieval (pgvector) → grounded system prompt
                   (Claude adapter remains as optional online escalation)
```

Key idea: **the API's AI path already points at a local OpenAI-compatible server.** The new work is
(a) RAG grounding in the context builder, (b) the voice loop in the desktop app, and (c) making the
whole thing degrade to a fully-local mode when offline.

## 4. The local model

- **Runtime:** Ollama (default `AI_BASE_URL=http://localhost:11434/v1`). One process, OpenAI-compatible,
  pull-models-by-name. GPU/Apple-Silicon accelerated automatically; CPU fallback works (slower).
- **Candidate chat models** (Q4_K_M quant, ~4–6 GB):
  | Model | Why | Notes |
  |---|---|---|
  | **Llama 3.1 8B Instruct** | strong general reasoning at 8B, good instruction-following | solid default |
  | **Qwen2.5 7B Instruct** | excellent at structured/tool output, strong technical | good for JSON/tooling |
  | **Mistral 7B Instruct** | fast, lean | weaker reasoning than the above |
  | Phi-3.5-mini (3.8B) | runs on thin hardware | use when RAM-constrained |
  - Start with **Llama 3.1 8B** or **Qwen2.5 7B**; make it `AI_MODEL`-configurable and benchmark on real
    tickets.
- **Domain relevance** (in priority order of effort/payoff):
  1. **System prompt** — already assembled from the org's documented network; tighten it for a
     network-ops persona, terse troubleshooting style, and the device/link/circuit/monitoring vocabulary.
  2. **RAG** (§5) — retrieve relevant runbooks / device manuals / past incidents and inject them. This
     is where most of the "geared for networks" value comes from, cheaply.
  3. **LoRA fine-tune** (later) — once we log labelled troubleshooting transcripts, a small LoRA on
     top of the base model sharpens tone/format/recall. Train offline (e.g. Unsloth/axolotl), export to
     GGUF, serve via Ollama. Only worth it after RAG + prompt are exhausted.

## 5. Domain grounding — RAG

- **Vector store: pgvector** (we already run Postgres). Add a `pgvector` extension + an embeddings
  table; no new infra. (External Qdrant/Chroma only if scale demands.)
- **Embeddings: `nomic-embed-text`** served by the same Ollama — fully local, 768-dim, strong for
  retrieval. Embed at ingest time.
- **Corpus:**
  - the org's own documented network (devices, links, circuits, monitoring history) — structured,
    already available; index summaries.
  - operator-supplied **runbooks / SOPs / device manuals / vendor KB exports** (uploaded docs).
  - resolved-incident transcripts (closes the loop toward a future fine-tune).
- **Where it plugs in:** a `RagContextProvider` added to the existing `context/` chain — retrieve
  top-k chunks for the user's question and the active device(s), inject under a `## Relevant runbooks`
  section. Zero change to the adapter/streaming path.
- **LangChain / LangGraph / LlamaIndex:**
  - *Recommendation:* **don't adopt LangChain just for RAG** — embeddings + pgvector + a ~150-line
    retrieval service is simpler, faster, and easier to secure in a NestJS service. LangChain adds a
    large dependency surface and abstraction tax.
  - *Do reach for **LangGraph** (or a small custom state machine)* when we want **agentic** behavior:
    multi-step plans, tool calls (query device status, run a probe, open a BCF issue), and
    plan→act→observe loops. That's where graph orchestration earns its keep. Revisit once single-shot
    RAG answers aren't enough.
  - *LlamaIndex* is the alternative to a hand-rolled RAG if the corpus/retrieval logic grows complex.

## 6. Voice (offline, two-way)

The engineer's machine runs the whole loop locally:

- **STT (speech → text): whisper.cpp** (`base.en`/`small.en` for low latency; `medium` if accuracy
  needs it). Alternatives: **faster-whisper** (CTranslate2, great on GPU), **Vosk** (tiny, lower
  accuracy, ultra-low-resource).
- **TTS (text → speech): Piper** — fast, natural, fully offline, tiny. Alternatives: **Coqui XTTS-v2**
  (voice cloning, heavier), **Kokoro** (very natural, newer).
- **Turn-taking:** **VAD** (Silero VAD or webrtcvad) to detect speech start/stop; **push-to-talk** as
  the reliable default, **barge-in** (interrupt TTS when the engineer starts speaking) as a follow-up.
- **Where it runs:** the **Electron desktop app** is the natural home (the engineer is at a workstation
  with the 3D viewer). Two options:
  - **Bundled binaries** (whisper.cpp + Piper shipped with the app) invoked from the main process — best
    UX, larger installer.
  - **Local voice sidecar** (a small local HTTP service exposing `/stt` and `/tts`) — easier to update
    and reuse from web, slightly more moving parts. *Lean bundled-first.*
- **Why not Wispr Flow:** it's a **cloud** dictation/typing assistant — one-way (speech→text only),
  not embeddable as a library, and it requires the internet. It fails the offline + two-way +
  on-prem-data requirements. The whisper.cpp + Piper stack is the offline-native equivalent.
- **Conversational shape:** push-to-talk → STT → AI (streaming) → TTS speaks the answer as it streams
  (sentence-chunked for low latency) → engineer can interrupt. The transcript also shows in the chat UI
  so it's reviewable.

## 7. Offline-first

- **What must work with no internet:** the AI assistant (local model), voice (local STT/TTS), and the
  desktop app's read/operate views on already-synced data. The existing **graceful-degradation
  fallback** in `ai.service.ts` is the seam; with a local provider the "provider unavailable" path
  becomes rare (only if Ollama itself is down).
- **The desktop "local mode":** today auth/realtime assume the server. Define an offline mode where the
  desktop talks to the local model + voice + last-synced data, and reconciles when connectivity
  returns. (Detailed in a follow-up; flagged as the largest net-new effort.)
- **Provider selection becomes availability-aware:** prefer local; only use Claude if explicitly
  enabled *and* online. A lightweight `isAvailable()` probe on the adapter supports this.

## 8. Security & privacy

- **Win:** local inference means **network data never leaves the premises** — strictly better for a
  tool full of infrastructure topology and IPs. (Mirrors the existing IFC-export data-isolation stance.)
- **New surface to guard:**
  - the local model/voice ports are **localhost-only** (never bind 0.0.0.0); document firewalling.
  - **prompt injection from network data**: device names / notes / runbook docs flow into the prompt —
    treat retrieved/user content as untrusted, keep tool-execution (if/when agentic) behind explicit
    allow-lists and confirmation, never let model output trigger privileged actions unguarded.
  - uploaded RAG documents: validate type/size, scan, store scoped to the org (multi-tenant isolation
    applies to the corpus too).

## 9. Staged migration plan (each phase independently shippable + verifiable)

1. **Phase 1 — Local-first config & adapter hardening** *(started in this PR)*
   - Make the local/OpenAI-compatible provider a first-class, documented default; add request
     **timeout**, clearer errors, and an `isAvailable()` probe to the adapter. Document
     `AI_PROVIDER`/`AI_BASE_URL`/`AI_MODEL` in `.env.example`. Verifiable now (api unit + nest build).
2. **Phase 2 — RAG grounding**
   - pgvector migration + embeddings table; `nomic-embed-text` ingest; `RagContextProvider` in the
     context chain; document-upload endpoint (org-scoped). Unit + integration tests.
3. **Phase 3 — Voice loop (desktop)**
   - Bundle whisper.cpp + Piper; push-to-talk → STT → stream → TTS; transcript in chat. Behind a flag.
4. **Phase 4 — Offline desktop mode**
   - Local-only operation + reconcile-on-reconnect. The largest net-new effort; design separately.
5. **Phase 5 — Agentic troubleshooting (optional)**
   - LangGraph/state-machine: tool calls (device status, probe, BCF), plan→act→observe, with guardrails.
6. **Phase 6 — LoRA fine-tune (optional)**
   - Only after labelled transcripts accumulate and RAG+prompt are exhausted.

## 10. Hardware & ops

- **Per-engineer / on-site box:** 16 GB RAM recommended (8 GB workable with a 3–4B model); a GPU or
  Apple Silicon strongly improves latency. Disk: ~10 GB for models + voice.
- **Ollama** runs as a local service; models pulled once and cached. Voice binaries bundled with the
  desktop app.
- **Benchmark** candidate models on real tickets for latency + answer quality before standardizing.

## 11. What changed in the first increment + next steps

- See the PR: local/OpenAI-compatible adapter hardened (timeout, error detail, availability probe) and
  documented as the local-first path; `.env.example` updated. Claude retained as optional escalation.
- **Next:** Phase 2 (RAG over pgvector) is the highest-leverage follow-up for "geared to network
  troubleshooting." Phase 3 (voice) is the headline UX. Both are scoped above.
