# Local-First, Voice-Enabled AI - Design & Migration Plan

> Status: **Proposal / in-progress.** Move the assistant off any hosted API to a local,
> domain-relevant model that keeps working with no internet, and add **two-way voice** so a
> network engineer can *talk through* a problem with the assistant.
>
> **Revised 2026-07-19.** Hosted providers are now removed rather than demoted, and the
> inference/voice runtime is placed on the engineer's workstation rather than left ambiguous.
> See [Changes from the original proposal](#changes-from-the-original-proposal) for what
> reversed and why. Companion doc:
> [`2026-07-19-systems-architecture-and-data-flows.md`](./2026-07-19-systems-architecture-and-data-flows.md),
> which holds the hosting decision and the WAN-egress inventory this doc now conforms to.

---

## 0. TL;DR - the decisions

1. **Hosted providers are gone, not optional.** `ClaudeAdapter` and `@anthropic-ai/sdk` were
   deleted on 2026-07-19. One adapter remains (`OpenAICompatibleAdapter`), and the runtime is
   chosen by pointing `AI_BASE_URL` at it. There is no `AI_PROVIDER` switch, because a switch
   is a leak one env var away from reopening.
2. **Local runtime: Ollama** (wraps llama.cpp; OpenAI-compatible API; trivial model management).
   Alternatives: raw `llama.cpp` server, LM Studio, vLLM (GPU). All speak the same wire format,
   so the adapter is unchanged in every case.
3. **Inference and voice run on the engineer's workstation. Context and retrieval run on the
   site appliance.** The API assembles a permission-scoped, grounded context and answers tool
   calls; the client owns the model, the voice loop, and turn-taking. Rationale in §3.
4. **"A model geared to network troubleshooting" is not a magic specialized LLM** - there isn't
   a drop-in one. Domain relevance comes from **(a)** a strong small open model, **(b)**
   **tool-calling against live network state**, **(c)** RAG over runbooks and docs, and **(d)**
   a tight system prompt. An optional LoRA fine-tune comes much later, if ever.
5. **Voice is offline STT + TTS on the engineer's machine:** **whisper.cpp** (speech to text) +
   **Piper** (text to speech), with VAD for turn-taking. **Wispr Flow is not suitable** - it is
   a cloud dictation product, not an offline, embeddable, two-way conversational engine.
6. **RAG without the LangChain weight:** we already run Postgres, so **pgvector** + a local
   embedding model (`nomic-embed-text` via Ollama) + a small retrieval service in the API.
   Reserve LangGraph for genuinely agentic orchestration if a hand-rolled loop stops scaling.

### Honest tradeoffs (so this is a clear-eyed decision)

- **A local 7-8B model will not out-reason a frontier hosted model.** It is *faster per token*,
  *works offline*, *keeps data on-prem*, and *has no per-call cost or rate limit*. For network
  troubleshooting - bounded domain, tool-grounded, short answers - that trade is reasonable.
  For open-ended reasoning it is a downgrade, and we are accepting that downgrade deliberately
  rather than keeping an escape hatch that leaks topology.
- **Local inference needs hardware**, and voice makes that non-negotiable: see §6 for the
  latency budget that forces a GPU. Roughly 6-8 GB RAM for a 7-8B model at Q4, plus ~1-2 GB for
  voice. This is a **workstation** requirement, not an appliance one (§10).

---

## 1. Current state (what already exists - don't reinvent it)

- **Provider seam:** `apps/api/src/ai/adapters/ai-provider.interface.ts` (`complete` / `stream`)
  and `openai-compatible.adapter.ts`. One implementation, bound directly in `ai.module.ts` with
  no env-based selection. `AI_PROVIDER_TOKEN` remains as the DI token, which is also the
  override point every test uses.
- **Context:** `context/` builds the system prompt from network / realtime / account / product
  providers, with permission scoping already applied. This is the domain-grounding hook.
- **Rate limiting:** `rate-limiting/ai-rate-limiter.service.ts` (hourly/daily/monthly budgets).
  Largely irrelevant for local inference (no cost); retained as abuse protection on the
  shared appliance, since context assembly and tool calls still cost database work.
- **Conversation:** Redis-backed history (24h TTL, last 40 messages); token-budget trimming in
  `ai.service.ts`.
- **Streaming + graceful degradation:** answers stream over socket.io (`onToken`); a provider
  failure falls back to a canned, network-aware message. **This is the offline-tolerance seam**,
  and it is also what an unconfigured `AI_BASE_URL` now lands on.
- **Not built, despite reading as built:** pgvector/RAG in any form (there is a
  `RagContextProvider` seam bound to a no-op returning `''`), and `isAvailable()`, which is
  written but never called.

## 2. Goals & non-goals

**Goals**
- The assistant runs on a **local model**; no hosted API is reachable, let alone required.
- Keep working **with the internet down** (model + voice both local).
- **Two-way voice**: the AI speaks findings aloud; the engineer talks back.
- **Reason within the live network context** - not a truncated snapshot (§4).

**Non-goals**
- Training a foundation model from scratch. We adapt, not pretrain.
- Cloud voice services (they break the offline requirement).
- ~~Removing Claude entirely - it becomes an optional escalation provider.~~ **Reversed
  2026-07-19: Claude is removed entirely. See [Changes](#changes-from-the-original-proposal).**

## 3. Target architecture

```
 ┌──────────── Engineer workstation (offline-capable, GPU) ────────────┐
 │  Native desktop client (C# after the migration; Electron today)      │
 │   ├─ 3D BIM viewport + network ops UI                                │
 │   └─ Voice loop:  mic → VAD → whisper.cpp (STT) → text               │
 │                    answer text → Piper (TTS) → speaker               │
 │                    push-to-talk / barge-in control                   │
 │            │ (localhost HTTP)                                         │
 │            ▼                                                          │
 │  Local model runtime: Ollama (chat model)                            │
 └──────────────────────────────┬───────────────────────────────────────┘
                                │ LAN: context, tool calls, history
                                ▼
   Site appliance API                                                    
     ContextBuilder  → permission-scoped grounding                       
     Tool endpoints  → live device/link/circuit/monitoring queries        
     RAG retrieval   → pgvector + nomic-embed over runbooks              
```

**Why inference sits on the workstation**, given the local-first doc says clients are thin:

1. **Voice is a latency budget and it picks the host.** Natural turn-taking needs roughly under
   500 ms from end-of-speech to first audio. VAD + STT costs ~150-300 ms and TTS ~50-100 ms,
   leaving very little for time-to-first-token. A 7-8B model runs ~5-15 tok/s on CPU versus
   50-100+ on a GPU, so conversational voice needs a GPU wherever it runs.
2. **Once a GPU is mandatory, a shared one is the wrong place for it.** Concurrent voice
   sessions contend on exactly the latency-critical resource.
3. **The workstation already has a GPU** - it is running the 3D BIM viewport.
4. **The appliance keeps no GPU requirement**, preserving "runs on any Linux box" and the
   per-site MSP economics.
5. **Off-LAN engineers still get an assistant**, which appliance-hosting cannot offer.

**This does not violate "clients are thin, not authoritative."** That principle governs
*authority over data*, not where computation happens. The appliance remains the source of
truth; the workstation runs a model over data the user is already authorized to see.

**Interim note.** The AI surface today is web-only (`apps/web/components/ai/*`); the desktop
app has no AI UI and no audio code at all. Until the native client ships, the assistant is
either dark or served by a **CPU** Ollama on the appliance via `AI_BASE_URL` - acceptable
because text chat tolerates slow inference in a way voice does not.

## 4. Reasoning within the context: tool-calling, not a bigger prompt

The current context is a static dump: up to 200 devices ordered `createdAt DESC`
(`network-context.repository.ts:22-25`), truncated to 40% of an 8000-token budget
(`network-context.provider.ts:7,16`), so roughly 3200 tokens. For a real network that is an
arbitrary slice of the newest records, and any question about something outside the cap is
unanswerable. Moving the model does not fix this.

**The assistant must query the API mid-turn.** The API exposes a small set of read tools
(devices by property/floor/category, link and circuit lookup, recent monitoring status,
property tree navigation), each **permission-scoped server-side exactly as the HTTP endpoints
are** - the model gets no ambient authority the user lacks. The static context shrinks to an
orientation summary plus whatever the model pulls.

This promotes agentic tool use from "optional Phase 5" to load-bearing, and it changes model
selection: **structured-output and tool-use strength now matter more than general reasoning.**

- **Candidate chat models** (Q4_K_M quant, ~4-6 GB), reordered accordingly:

  | Model | Why | Notes |
  |---|---|---|
  | **Qwen2.5 7B Instruct** | excellent structured/tool output, strong technical | **preferred default** now that tool-calling is central |
  | Llama 3.1 8B Instruct | strong general reasoning, good instruction-following | solid alternative |
  | Mistral 7B Instruct | fast, lean | weaker reasoning and tool use |
  | Phi-3.5-mini (3.8B) | runs on thin hardware | RAM-constrained fallback |

  Keep it `AI_MODEL`-configurable and benchmark on real tickets before standardizing.

- **Domain relevance, in priority order of effort/payoff:**
  1. **Tool-calling** (above) - the largest single win, because it removes the truncation
     ceiling entirely.
  2. **System prompt** - tighten for a network-ops persona, terse troubleshooting style, and
     the device/link/circuit/monitoring vocabulary.
  3. **RAG** (§5) - runbooks, device manuals, past incidents.
  4. **LoRA fine-tune** (later, optional) - only once labelled transcripts accumulate and
     tool-calling + prompt + RAG are exhausted.

## 5. Domain grounding - RAG

- **Vector store: pgvector.** We already run Postgres; add the extension and an embeddings
  table. No new infra. External Qdrant/Chroma only if scale demands.
- **Embeddings: `nomic-embed-text`**, 768-dim, embedded at ingest time. **Runs on the
  appliance**, not the workstation: ingest is a background server-side job over org data, and
  the vectors live next to the rows they describe.
- **Corpus:** operator-supplied runbooks / SOPs / device manuals / vendor KB exports (uploaded,
  org-scoped); summaries of the org's own documented network; resolved-incident transcripts.
- **Where it plugs in:** replace `NoopRagContextProvider` with a real retriever in the existing
  `context/` chain. Retrieval stays server-side because that is where the data and the
  permission scoping live; the client receives chunks, never the corpus.
- **LangChain / LangGraph / LlamaIndex:** don't adopt LangChain just for RAG - embeddings +
  pgvector + a ~150-line retrieval service is simpler, faster, and easier to secure. Reach for
  **LangGraph** (or a small custom state machine) only if the hand-rolled plan/act/observe loop
  from §4 stops scaling. LlamaIndex is the alternative if retrieval logic grows complex.

## 6. Voice (offline, two-way)

The engineer's machine runs the whole loop locally.

- **STT: whisper.cpp** (`base.en`/`small.en` for low latency; `medium` if accuracy demands).
  Alternatives: **faster-whisper** (CTranslate2, strong on GPU), **Vosk** (tiny, lower accuracy).
- **TTS: Piper** - fast, natural, fully offline, tiny. Alternatives: **Kokoro** (very natural,
  newer), **Coqui XTTS-v2** (voice cloning, heavier).
- **Turn-taking:** VAD (Silero or webrtcvad) for speech start/stop; **push-to-talk** as the
  reliable default, **barge-in** (interrupt TTS when the engineer speaks) as a follow-up.
- **The latency budget**, which is the constraint that drove §3:

  | Stage | Budget |
  |---|---|
  | VAD + whisper.cpp STT | ~150-300 ms |
  | Model time-to-first-token | whatever remains |
  | Piper TTS first audio | ~50-100 ms |
  | **Total target** | **< 500 ms end-of-speech to first audio** |

  TTS is sentence-chunked so speech begins while the model is still generating.
- **Where it runs:** bundled binaries invoked by the desktop client is the lean default; a small
  local sidecar exposing `/stt` and `/tts` is the alternative if updating bundled binaries
  becomes painful. **Lean bundled-first.**
- **Implementation target is the C# native client**, not Electron. `Whisper.net` and Piper both
  have usable .NET paths; this should be weighed when choosing Avalonia vs WPF (migration
  decision 14), because it lands on top of the Mapsui and xBIM spikes.
- **Why not Wispr Flow:** it is a cloud dictation/typing assistant - one-way, not embeddable,
  and it requires the internet. It fails the offline, two-way, and on-prem-data requirements.

## 7. Offline-first

- **What must work with no internet:** the assistant (local model), voice (local STT/TTS), and
  the client's read/operate views against the LAN appliance. With no hosted provider in the
  picture, "provider unavailable" now means only that the local runtime is down.
- **Degradation is already wired.** An unreachable `AI_BASE_URL` surfaces as the canned
  network-aware fallback rather than an error, which is also the shipped appliance default
  (`AI_BASE_URL=""`).
- **`isAvailable()` remains uncalled.** Wire it up only if the UI needs to distinguish "no model
  configured" from "model is down"; the fallback covers both today.
- **The desktop "local mode"** - operating on last-synced data and reconciling on reconnect -
  is still the largest net-new effort and still needs its own design.

## 8. Security & privacy

- **Win:** local inference means network data never leaves the premises. This is now enforced
  structurally rather than by configuration: there is no hosted adapter to switch back on.
- **New surface to guard:**
  - Model and voice ports are **localhost-only** on the workstation (never bind `0.0.0.0`).
  - **Prompt injection from network data**: device names, notes, and uploaded runbooks flow
    into the prompt. Treat all retrieved and user-authored content as untrusted.
  - **Tool execution** (§4) is the sharp edge: read-only tools first, explicit allow-lists,
    server-side permission scoping on every call, and confirmation before anything mutating.
    Model output must never trigger a privileged action unguarded.
  - Uploaded RAG documents: validate type and size, scan, store org-scoped.

## 9. Staged plan

1. **Phase 1 - Hosted providers removed.** *Done 2026-07-19.* `ClaudeAdapter` and
   `@anthropic-ai/sdk` deleted, `AI_PROVIDER` selection removed, empty `AI_BASE_URL` handled,
   env/compose/docs updated.
2. **Phase 2 - Tool-calling.** Read-only tool endpoints, permission-scoped; a plan/act/observe
   loop; shrink the static context to an orientation summary. **Highest leverage** - this is
   what "reason within the context" actually requires.
3. **Phase 3 - RAG grounding.** pgvector migration + embeddings table, `nomic-embed-text`
   ingest, a real `RagContextProvider`, org-scoped document upload.
4. **Phase 4 - Voice loop.** Bundle whisper.cpp + Piper in the native client; push-to-talk →
   STT → stream → sentence-chunked TTS; transcript in the chat UI. Behind a flag.
5. **Phase 5 - Offline client mode.** Local-only operation and reconcile-on-reconnect. Largest
   net-new effort; design separately.
6. **Phase 6 - LoRA fine-tune (optional).** Only after labelled transcripts accumulate.

**Sequencing caveat:** phases 2 and 3 are server-side and can land on the NestJS API or wait
for the C# port. Phases 4 and 5 are client-side and should target the **native client**, not
Electron, to avoid building the voice loop twice.

## 10. Hardware & ops

- **Engineer workstation:** 16 GB RAM recommended (8 GB workable with a 3-4B model). **A GPU or
  Apple Silicon is effectively required for voice** per the §6 budget; CPU-only is fine for
  text chat but will not sustain conversation. Disk: ~10 GB for models plus voice.
- **Site appliance:** unchanged. No GPU, no model runtime. It gains only pgvector and the
  embedding ingest job in Phase 3, both modest.
- **Ollama** runs as a local service on the workstation; models pulled once and cached. Voice
  binaries ship with the client.
- **Benchmark** candidate models on real tickets for latency and answer quality, specifically
  measuring end-of-speech to first audio, not just tokens per second.

## Changes from the original proposal

Recorded because the reasoning matters more than the document appearing consistent.

| Original claim | Change |
|---|---|
| "Removing Claude entirely" is a **non-goal**; it becomes an optional online escalation provider | **Reversed 2026-07-19.** An opt-in hosted provider is a topology leak one env var away from reopening, and the shipped default was in fact `AI_PROVIDER=claude`, so the appliance was sending device IPs, notes, and circuit IDs to Anthropic out of the box. Removed entirely. |
| §3 placed Ollama on the engineer's workstation *and* had the API call it | Those are different machines, and `AI_BASE_URL` defaulted to a localhost that resolves to the API container. The split is now explicit: inference and voice on the workstation, context and retrieval on the appliance. |
| "Don't rebuild the AI layer - it's already provider-agnostic" | Still true, and it is why removal was cheap. But the two-adapter seam was itself unnecessary: Ollama, llama.cpp, vLLM, and LM Studio all speak the OpenAI-compatible format, so one adapter plus `AI_BASE_URL` covers every realistic runtime. |
| Agentic tool use is optional Phase 5 | **Promoted to Phase 2 and load-bearing.** "Reason within the context" cannot be met by a 3200-token snapshot of the 200 newest devices, regardless of which model reads it. |
| Llama 3.1 8B or Qwen2.5 7B, either as default | **Qwen2.5 preferred**, because tool-use and structured-output strength now matter more than general reasoning. |
| "Provider selection becomes availability-aware" via `isAvailable()` | Moot with one provider. The probe stays written but uncalled; graceful degradation covers the unreachable case. |
| Voice targets the Electron desktop app | Targets the **C# native client**. Building it on Electron would be throwaway work, since `apps/desktop` is deleted at the end of the migration. |
