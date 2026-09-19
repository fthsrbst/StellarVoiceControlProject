# Genesis Hackathon — Reality Check & Prior-Art Research

- **Date:** 2026-09-19
- **Author/Agent:** Research worker (opencode, deepseek-v4.1-flash)
- **Keywords:** genesis, stellar-pro-hackathon, rise-in, prior-art, voice-assistant, push-to-talk, touch-id, mpp, x402, anchor, sep-6, hackathon-scope
- **Method:** Web research (websearch/webfetch), Stellar Raven MCP (`scout.*`, `lumenloop.*`, `stellarDocs.*`), direct checks (`tr-mock-anchor.fly.dev/.well-known/stellar.toml`), project docs (`docs/architecture.md`, `sprints.md`, `notes.md`, `docs/interfaces.md`).
- **Scope of evidence:** All Raven results carry timestamps of 2026-09-19 (~09:50–09:52 UTC). Soft-empty search results are noted as inconclusive, not as absence.

---

## TL;DR Verdicts

| Question | Verdict | Confidence |
|---|---|---|
| **HACKATHON** | Real event: Rise In × Stellar "Stellar Pro Hackathon", 36 h in-person, Grand Pera (Beyoğlu, Istanbul), Sep 19–20 2026, 150 builders, $15,000 Genesis prize pool (1st $7k / 2nd $4k / 3rd $2.5k / 4th $1.5k). Genesis = from-scratch track. Submission is mandatory for all; only a shortlist presents live; the shortlisting criteria are promised "before the submission deadline" and are not public yet. The team's `docs/architecture.md` §2 already encodes the organizer handbook requirements (anchor/local payments highest weight in *Ecosystem Fit*, one eligible protocol integration, own Soroban contract(s) on testnet, real functionality, skills cited, README/demo/deck). The "20 Sep 12:00" deadline is **team-reported from the handbook**; it is not stated on any public page I could find. | High on event facts; Medium on exact submission checklist/time |
| **PRIOR ART** | Every *individual* building block of Polaris has prior art, several of them on Stellar and several as 2025–2026 production launches: voice→on-chain transactions (Voicely, TOMI), conversational wallet agents (Companeon, Verbex), approval-gated signing (Signet, MoonPay OWS, MetaMask Agent Wallet), agent spend-policy contracts (SpendGuard on Stellar), MPP/x402 agent payments (Nexa, Agentmesh, Payperintent, TollPay). I found **no voice-first product** in the Stellar hackathon-build index (1,348 builds; "voice" winners-only search = 0) or directory; the closest are text/chat assistants. |  High |
| **SCOPE** | The full architecture (voice + anchor + guard + protocol + MPP + P2P + developer mode + screen control + passkeys) is **not** achievable in ~23 h by 2 people from zero code. The defensible MVP is the already-planned vertical slice **plus** the anchor deposit and one deployed contract, with a hard cut list and a recorded demo. The highest-probability failure modes are macOS/Tauri permission plumbing, Touch-ID + code-signing, and Turkish STT quality — all spike-able in the first 2–3 h and all have fallbacks. | High |
| **NOVELTY** | Polaris is **not novel** as "voice control of money", "P2P ramp", "agent spending limit contract", or "MPP agent payments". It **is** novel (as far as search can establish) as the *combination* on Stellar: a desktop push-to-talk companion with local biometric approval, TRY→USDC anchor journey, own guard contract, and developer mode. Voice-first is the genuinely uncontested angle in the Stellar ecosystem; everything else is a wrapper risk if execution stays shallow. | Medium-high for "combination is uncontested on Stellar"; Medium for "novel outside Stellar search" |

---

## 1. Hackathon reality check

### 1.1 Event facts (public)

Source: <https://www.risein.com/programs/stellar-pro-hackathon> (fetched 2026-09-19):

> "Join the Rise In x Stellar Pro Hackathon — September 19–20, 2026 · Grand Pera, Beyoğlu, Istanbul. The Rise In x Stellar Pro Hackathon is a 36-hour, in-person hackathon for developers and builders creating real products on Stellar... brings together 150 builders..."

> "**Genesis Track** — open to builders who want to start from scratch... Projects are expected to meet the hackathon requirements and include a real Stellar integration."

> "**Submission (required for everyone):** Every team in both the Genesis and Scale Tracks must submit their project by the deadline. **Shortlisting:** The Stellar team will review all submissions based on the hackathon criteria and the quality and progress of each project. A shortlist of teams from each track will be selected to move forward. **Final presentation:** Only shortlisted teams will present live to the jury... The shortlisting criteria will be shared with participants before the submission deadline."

Prize breakdown (LumenLoop events page, <https://lumenloop.com/events>):

> "Genesis teams will compete for a $15,000 prize pool: 1st $7,000 · 2nd $4,000 · 3rd $2,500 · 4th $1,500. Scale Track is invite-only..."

Other observed facts:
- Organizer is **Rise In** (community partner) with **Stellar/SDF** presenting; registration closed Sep 18; event is in-person (no online track for Genesis).
- "Live project demos" and "Mentors and ecosystem experts" are on-site; follow-on funding paths mentioned: SCF and InstAward.
- The event is part of an active Istanbul Stellar calendar (Build on Stellar IBW, June 2026; HackStellar Istanbul, Dec 2025; Build on Stellar Hackathon, Jun 2026), so the jury pool has seen many Stellar demos.

### 1.2 Submission requirements / deliverables

- **Public pages do not publish the Genesis submission checklist.** The Rise In page states only: submission required, shortlisting by the Stellar team, shortlisted teams present live, criteria to be shared before the deadline.
- **What the team's handbook notes say (docs/architecture.md §2, lines 33–45)** — the best available rubric until organizers publish:
  - Anchor / local payments (TRY in → usable balance) — *highest weight in Ecosystem Fit* (§2, line 35)
  - Integration with an eligible protocol, load-bearing (Soroswap / DeFindex) — line 36
  - Own Soroban contract(s) deployed on testnet with documented IDs (`polaris_guard`) — line 37
  - Real functionality, not mocked; real testnet transactions — line 38
  - Soroban auth & storage patterns (`require_auth`, persistent storage) — line 39
  - Cite Stellar Skills used **by path** — line 40
  - README, architecture doc, demo, pitch deck — line 41
  - Bonuses: passkeys/smart wallets; agentic payments (MPP) workshop theme (line 42–43); P2P ramp is *extra* (line 44); developer mode is a product requirement (line 45).
- **Precedent from the immediately preceding Stellar hackathon** (DoraHacks, "Stellar Hacks: Agents", Mar 30–Apr 13 2026, $10k, 262 BUIDLs) — submission requirements were explicit and are a good proxy for what SDF judges expect:
  - "1. Open-source repo — public GitHub/GitLab repo with a clear README.md... 2. Video demo — a 2–3 minute video walkthrough... 3. Stellar testnet/mainnet interaction — your project must submit, consume, or otherwise integrate real Stellar testnet or mainnet transactions." (<https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail>)
- **What winners did** (adjacent events; winners of *this* event do not exist yet — event is in progress):
  - Stellar Hacks: Agents 2026: **1st Cards402** ("Stellar powered OWS wallets for Agents with full spend management and instant real Visa card issuance", $5k), **2nd clevercon** ("Stellar marketplace where Soroban contracts secure USDC & enforce on-chain budgets"), **3rd RenderGate** ("Pay-per-render headless browser API for agents powered by x402 micropayments on Stellar"). Source: <https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/winner>, scout build index.
  - Stellar Build Better 2025: a Soroban→MCP server generator took 3rd in "Better Finance" ("What if EVERY Stellar Smart Contract was instantly AI-accessible? Our tool turns Soroban contracts into AI-ready MCP servers..." — <https://dorahacks.io/buidl/25271>).
  - Pattern: **working end-to-end money movement + on-chain artifacts (contract IDs, tx hashes) + a clear README beat breadth.** "Quality and progress" language on the Rise In page points the same way.

### 1.3 Deadline

- Public pages: event Sep 19–20; no clock time. The team's docs consistently use **20 Sep 12:00** (architecture.md:21, sprints.md:78). Treat as handbook-derived; **re-confirm with organizers** because the shortlist presentation likely follows soon after (the demo must exist before the deadline regardless).

---

## 2. Prior art — Stellar ecosystem (Raven MCP)

Queries used: `scout.searchHackathonBuilds` (topic/winner filters over 1,348 indexed builds), `scout.vetIdea`, `scout.searchProjects`, `lumenloop.search_directory`, `lumenloop.search_content_semantic`. As of 2026-09-19.

### 2.1 The uncomfortable ones (closest to Polaris components)

| Project | What it is | Shares | Differs |
|---|---|---|---|
| **SpendGuard** — <https://dorahacks.io/buidl/42759> (Stellar Hacks: Agents, Apr 2026) | "On-chain spending governance for autonomous AI agents on Stellar. SpendGuard is a Soroban policy contract that enforces daily caps, per-tx limits..." (`github.com/deegalabs/stellar-402-spendguard`) | Almost exactly the `polaris_guard` concept (per-tx + daily caps on-chain) | No voice, no biometric approval UX; agent-autonomy framing, not user-facing guard |
| **Verbex** — <https://dorahacks.io/buidl/30677> (Stellar LATAM Ideathon 2, Oct 2025) | "Agentic DeFi assistants powered by MCP — where conversations become transactions powered by blend, soroswap and defindex" | Conversation→Stellar DeFi transactions via MCP; same protocol set Polaris plans | Text chat, no voice, no anchor, no biometric gate, no policy contract |
| **Nexa** — <https://dorahacks.io/buidl/42645> (Agents, Apr 2026) | "Autonomous AI bridge on Stellar using MPP & HTTP 402... agents pay for services with zero gas friction" | MPP on Stellar, agent payments story | Agent-to-machine, not human voice; no approval UX |
| **Stellar Autopay X402** — <https://dorahacks.io/buidl/42724> | "Natural language to on-chain payments. Tell an agent 'hire Alice 3 days at $5/hr'..." | Natural-language → scheduled on-chain payments | Text; scheduling use case; no voice/biometrics |
| **Payperintent** — <https://dorahacks.io/buidl/42709> (Agents, Apr 2026) | "PayPerIntent turns natural-language intents into paid x402/MPP actions on Stellar" | Intent→transaction, MPP/x402 | Agent-facing payments, not consumer voice |
| **Stellar Studio** — <https://dorahacks.io/buidl/36219> (Scaffold Stellar, Nov 2025) | "Deploy and command Stellar tokens, NFTs, and DAOs through conversation" | Conversational control of Stellar actions | Tokens/NFT/DAOs, no payments-first voice loop |
| **OlivIA** — <https://dorahacks.io/buidl/25260> (Build Better, Mar 2025) | "Lets users execute blockchain transactions using natural language" | NL transaction execution (chatbot) | Text; no anchor, weak execution maturity |
| **Agentmesh** — <https://dorahacks.io/buidl/42733> | Agents discover services, pay via x402 & MPP | MPP/x402 | Machine-to-machine |
| **REAPP** — directory slug `reapp` | "REAPP (Real Agentic Payment Protocol) is the authorization layer for agentic commerce on Stellar. It composes x402 HTTP..." | Authorization/permission layer for agent payments | Protocol/infra play, no consumer assistant |
| **XBid AI** — directory slug `xbid-ai` | "multi-LLM AI agent, staked onchain on Stellar... autonomously executes real strategies" | AI agent executing Stellar transactions | Autonomy (no human approval); trading, not voice |
| **Soroban Assistant / Stroopy.AI** — directory slugs `soroban-assistant`, `stroopy-ai` | AI assistants for Soroban Q&A / Stellar navigation | Stellar + AI assistant | Knowledge Q&A, not transaction execution |
| **Stellar AI Agent Kit** — directory slug `stellar-ai-agent-kit` | "toolkit enabling AI agents to interact with Stellar smart contracts... MCP integration and CLI" | Agent ↔ Stellar tooling | Toolkit, no end-user experience |

### 2.2 Voice-specific search (the key gap)

- `scout.searchHackathonBuilds {q:"voice", winnersOnly:"1"}` → **0 matches** (of 1,348 indexed builds). Non-winner "voice" substring hits were invoice/privacy projects using the word "voices" in prose.
- `lumenloop.search_directory "voice"` → only BorderDollar and Public Node (both false positives on the word "voice").
- `lumenloop.search_content_semantic "voice assistant executes crypto payments"` → x402/MPP content (Day Zero x402 tutorial, x402 Foundation) — no voice product.
- **Interpretation (with the soft-empty caveat):** no voice-first assistant appears in the Stellar hackathon or directory indexes. Search absence is not proof of no such project, but for a hackathon novelty claim it is the best available evidence.

### 2.3 P2P ramp prior art (team's own list, spot-checked)

`docs/architecture.md` §5.6 names Pacto, MicoPay, AnyRamp, Mammon, PeerPesa as Scout-verified prior art. My spot-check today: **PeerPesa** confirmed in the directory ("P2P blockchain-based remittance platform"); **MicoPay** confirmed as a live hackathon build ("Micopay — Private Resource Access for AI Agents", x402 on Base); **Pacto / AnyRamp / Mammon** did not resolve in a single directory pass this session (inconclusive, not absence). Conclusion unchanged: **a plain P2P ramp is not novel**.

---

## 3. Prior art — outside Stellar (web)

### 3.1 Voice + crypto/payments

| Project | One-liner | Shares | Differs |
|---|---|---|---|
| **Voicely** (ETHGlobal Bangkok) — <https://ethglobal.com/showcase/voicely-q394k> | "an AI agent that enables voice-based blockchain transactions... voiceprint signatures and on-chain key voice recording snippets" | Voice → on-chain transfers; agent extracts tx details; security-focused (ZK voiceprint) | EVM/L2s; voiceprint as identity vs Touch ID; hackathon prototype |
| **TOMI Wallet AI voice assistant** (Mar 2025) — <https://dailycoin.com/crypto-gets-hands-free-tomi-introduces-ai-voice-assistant-in-wallet> | "first crypto wallet with AI voice assistant... send funds and, soon, swap tokens... entirely via voice commands" | Voice commands for wallet actions | Mobile; assistant features, not a push-to-talk OS companion; no Stellar |
| **Resona** (ETHGlobal NY 2025) — <https://ethglobal.com/showcase/resona-848as> | Voice-based wallet **recovery** with ZK proofs | Voice + wallet | Recovery, not transactions |
| **AIlice** (ETHGlobal Bangkok 2024) — <https://github.com/RezaRahtemola/ETHGlobal-Bangkok2024> | "Manage wallets from multiple chains with an AI agent, in a secure & non-custodial way" via chat | Chat → multi-chain wallet ops | Text, not voice; no approval ceremony |
| **HeyClickey-style notch assistants** (UX reference in notes.md) | macOS notch/PTT assistants | PTT UX + notch UI | General assistants, not financial action agents |

### 3.2 Conversational/agent wallets and approval-gated signing (the 2026 production wave)

| Project | One-liner | Shares | Differs |
|---|---|---|---|
| **Companeon AI** — 1st place, MetaMask Advanced Permissions Hackathon — <https://github.com/richardjaee/companeon-ai> | "wallet-native AI agent that turns conversational prompts into on-chain transactions using ERC-7715 Advanced Permissions" | Conversation → on-chain tx with scoped, revocable spending limits (direct analog of `polaris_guard`) | EVM; text; no voice/biometrics; hackathon |
| **Trust Wallet Agent Kit (TWAK)** (Mar 2026) — <https://portal.trustwallet.com/> + <https://www.theblock.co/post/395286/cz-owned-trust-wallet-launches-ai-agents-that-can-execute-crypto-trades> | AI agents execute crypto transactions across 25+ chains "within rules that users define and control"; WalletConnect mode proposes, user approves | Agent transactions with user-defined rules; user-approval mode | No voice; agent-first; 25+ chains but not Stellar |
| **Coinbase Agentic Wallets + x402** (Feb 2026) — <https://www.theblock.co/news/business/2026-02-11-coinbase-rolls-out-ai-tool-to-give-any-agent-a-wallet-389524> | "give any agent a wallet... spend, earn, and trade autonomously" with session caps; keys in secure infra | Agent payments, spending limits | Autonomy-first; no voice; no human Touch-ID step |
| **MetaMask Agent Wallet** (Jun 2026) — <https://metamask.io/news/metamask-launches-agent-wallet-giving-ai-agents-full-defi-access-with-default-security-on-every-transaction> | Self-custodial agent wallet; every tx simulated/scanned; "any transaction... that falls outside the user's policy requires human approval via 2FA" | Guardrails + human approval on risky tx | No voice; DeFi trading focus; not Stellar |
| **Signet** — <https://signet.aitos.io/> | "The agent constructs transactions — Signet signs them only after your approval"; MCP-native, guardrail rules, parsed tx preview | Agent builds tx → human approves → signed; MCP | EVM/Solana; no voice; separate wallet product |
| **MoonPay Open Wallet Standard** (Mar 2026) — <https://www.moonpay.com/newsroom/open-wallet-standard> | Policy-gated signing, key never exposed to agent/LLM; local vault | Policy engine before signing | Standard/infra, not an assistant |
| **XRPL Agent Wallet Skill** — <https://xrpl.org/docs/agents/xrpl-agent-wallet-skill> | Skill file: rigid 6-step "signing ceremony" with human preview before sign | Human-confirmed signing; agent tooling | Docs/skill only; XRPL |
| **Circle OOAK `@secure_tool`** — <https://www.circle.com/blog/building-secure-ai-tools-for-blockchain> | Decorator that routes every agent wallet call through WorkflowManager for user approval | Intent-approval-before-signing pattern | Framework, no product |
| **SoK: Security of Autonomous LLM Agents in Agentic Commerce** — <https://arxiv.org/pdf/2604.15367v2> | Taxonomy of agentic-commerce threats; Level 0 Advisory / Level 1 Supervised autonomy | Justifies Polaris's "user disposes" model in academic terms | Research |

**Takeaway:** the *pattern* "agent proposes → user approves → wallet signs → chain executes" is now industry consensus (MetaMask, Trust, Signet, MoonPay, Circle, XRPL all ship a variant). Polaris cannot claim the pattern; it can claim the **voice-first, desktop, biometric (Touch ID), Stellar-native** instantiation.

### 3.3 Agentic payments (MPP/x402) — verified status

- MPP on Stellar is **live and documented**: "MPP is an open protocol... extends the 402 Payment Required HTTP status... On Stellar, MPP works with Soroban SAC token transfers... without an external facilitator. Supported MPP Intents: Charge (immediate one-time; Push/Pull credential modes) and Session (unidirectional payment channels; off-chain cumulative commitments; server closes later)." — <https://developers.stellar.org/docs/build/agentic-payments/mpp>
- Attribution: "Stellar now supports the Machine Payments Protocol (MPP), the open standard by @stripe and @tempo..." — @StellarOrg, Apr 3 2026 (<https://x.com/StellarOrg/status/2040148969104318658>); SDK `@stellar/mpp`, `mppx`, demo at `mpp.stellar.buzz`, 0.01 USDC/request.
- x402 on Stellar also exists (Coinbase protocol, facilitator-based, OZ Channels) — <https://developers.stellar.org/docs/build/agentic-payments/x402>. The architecture doc's choice of MPP over x402 is defensible (no third-party facilitator, SAC settlement).
- **MPP is not novel for Stellar hackathons**: it was the explicit theme of Stellar Hacks: Agents (Apr 2026) with several builds (Nexa, Agentmesh, Payperintent, TollPay, RenderGate). Using it is table stakes, not differentiation.

---

## 4. Scope & feasibility for ~23 h, 2 people, zero code

### 4.1 The arithmetic

- Remaining time to the team's deadline (20 Sep 12:00) at the time of this research (~09:50 UTC): **~26 h wall clock**, of which sleep, travel, food, submission admin (README/deck/video/edit) consume realistically 6–8 h. **Effective build time: ~16–18 person-hours × 2 people ≈ 32–36 person-hours.**
- The architecture doc's own build order (A → A2 → B → C → C2 → C3 → D → E → F) estimates 8 milestones, each non-trivial. Even ignoring MPP/P2P/developer mode/screen control, the must-have set (voice loop + agent + anchor + guard + approval + submission artifacts) is a 3–4 person-day job for experienced devs.
- The repository today contains **docs only** (verified: `ls` shows no `app/`, `agent/`, `stellar/`, `contracts/`).

### 4.2 Realistic MVP demo (what "done" must look like on stage)

One continuous, rehearsed 3–5 minute scene:

1. User holds the hotkey, speaks Turkish: *"Anchor'dan 500 lira yatır"* → transcript appears in the panel.
2. Agent calls anchor tools (SEP-1 → SEP-10 → SEP-38 quote → SEP-6 deposit) and drives the simulated bank step; USDC lands in the testnet account; **tx hash + Stellar.Expert link** shown.
3. User speaks: *"Ahmet'e 10 USDC gönder"* → agent builds an unsigned XDR that routes through **`polaris_guard.pay`** (alias book + per-tx/daily limit) → approval card decoded from the XDR → read-back → **Touch ID** → signed → submitted → explorer link.
4. (If time) one Soroswap swap or DeFindex vault deposit as the required "load-bearing integration".
5. A deliberately failing case: an over-limit payment **rejected on-chain by the guard** — this single 20-second scene demonstrates Soroban auth/storage, real functionality, and the safety story better than any slide.

Artifacts: public repo + README (setup, architecture, contract IDs, skills paths, known limitations), 2–3 min recorded demo video, short deck, and the live demo above.

### 4.3 Ordered cut list (cut from the top until the must-haves fit)

1. **P2P escrow (`polaris_p2p_escrow`)** — medium contract + UI; zero novelty value (see §5); purely extra.
2. **Developer mode** (workspace sandbox, agent SDK sidecar, CLI allow-list) — a second product; the pitch can mention it as roadmap with a mock screenshot.
3. **Screen awareness / computer use** (screenshot → vision, CDP/Playwright fill) — nice demo garnish; cuts deep into time and permissions budget.
4. **Mute/polish of the notch UI** — implement the simplest panel that can hold transcript + approval card; the six-feature notch vision (notes.md) is a post-hackathon design project.
5. **MPP pay-per-command** — only if organizers confirm MPP counts as the required "Integration" **and** the anchor is already green; otherwise it is a second, independent integration to build for a judge who may not weight it.
6. **TTS premium voice / bilingual polish** — `say -v Yelda` is enough on stage.
7. **Passkey wallet** — explicitly bonus; drop.
8. **Screen recording fidelity extras / automatic demo automation** — manual OBS recording is fine.

**Never cut:** the voice loop (hotkey → STT → answer), **anchor deposit** (highest-weight handbook item), **approval card + Touch ID**, **one own deployed Soroban contract with documented ID**, real testnet transactions, README + demo video + deck.

### 4.4 Top failure modes (with evidence and mitigation)

| # | Failure mode | Evidence | Mitigation |
|---|---|---|---|
| 1 | **Tauri/macOS permission plumbing** — mic/screen/accessibility attributed to the parent terminal in unbundled dev builds | Team's own §7 spike gate flags this | Run the 2 h shell spike *first* (hotkey, mic, Touch ID, screenshot). If it fails, flip to Electron with the same TS brain (fallback already decided, §7) — but decide within hour 3, not hour 12 |
| 2 | **Touch ID + Keychain in an unsigned dev build** | Community plugin docs: "Important: The app must be properly code-signed to use keychain data storage. Without proper signing, data storage operations may fail with errors" (<https://docs.rs/crate/tauri-plugin-biometry/latest>). The *official* Tauri biometric plugin supports "Android and iOS" only (macOS not listed, <https://v2.tauri.app/plugin/biometric>) | Use `tauri-plugin-biometry` (v0.2.8, supports macOS Touch ID). Have a signing identity ready, or fall back to `LocalAuthentication` prompt + key held in memory for the demo (testnet only). Test on the demo machine, not a fresh one |
| 3 | **Turkish STT quality/latency** | whisper-small fine-tuned on Common Voice 11 reached WER 0.16 in one Turkish study (<https://arxiv.org/abs/2307.04765>); a dedicated `whisper-large-v3-turbo-turkish` fine-tune exists (<https://huggingface.co/OpenVoiceOS/whisper-large-v3-turbo-turkish-onnx>); whisper.cpp Metal runs on Apple Silicon but historically trails OpenAI decoding on WER and is weaker on short segments (<https://github.com/ggml-org/whisper.cpp/discussions/3890>) | Spike local whisper.cpp with the Turkish fine-tune at 16 kHz on the actual demo mic; constrain the command grammar (fixed aliases, digit amounts); always read back amount+recipient; keep a cloud STT fallback key ready |
| 4 | **Anchor liquidity/treasury** | The mock anchor is shared; 3000 TRY/deposit cap; "treasury... has already been drained once: be gentle" (architecture.md §13); stellar.toml: "Not a real financial service. No real money moves." (verified live today) | Do **not** e2e-test the deposit repeatedly. Build the client against a recorded/replayed SEP-6 flow, run it live once or twice, keep a pre-recorded successful deposit as demo fallback |
| 5 | **Raven OAuth inside the app** | Remote MCP + OAuth PKCE + localhost callback = a day of work (architecture.md §4.2) | Use LumenLoop (no auth) + direct docs search at runtime; keep Raven for dev-time tools only. Do not let this block the money path |
| 6 | **LLM provider assumptions** | Architecture doc concedes Claude audio input is *unverified* (§4.1) | Keep STT and LLM decoupled (already the design); pin a known-good model; cache a fallback scripted agent response for demo safety |
| 7 | **Venue Wi-Fi / network flakiness** | In-person 36 h event; testnet RPC + anchor are remote | Pre-flight the full flow on venue network; have a phone hotspot; record a backup demo video early |
| 8 | **Scope creep / integration at the end** | 2 people, no code, 8-milestone plan | Vertical slice first (already the plan); feature-freeze ~4 h before deadline; submission artifacts drafted in parallel by the non-coding hand |
| 9 | **Missing LICENSE / public repo** | architecture.md §10 open item | Add MIT license and make repo public before submission |
| 10 | **Soroban/toolchain** | Low risk: smoke test already passed (identity → fund → build → deploy → invoke; §11) | Keep `wasm32v1-none` path note handy; don't upgrade toolchains mid-hackathon |

### 4.5 What judges most likely reward

Per the best available rubric (handbook notes in architecture.md §2): the anchor/local-payments item carries the *highest weight in Ecosystem Fit*; then real functionality, own contracts, Soroban auth/storage, cited skills, docs, bonuses. The Rise In shortlist language ("quality and progress of each project") and the adjacent-event winners (Cards402: real wallets + spend management + a Visa card story; RenderGate: a *working* paid API) point to the same conclusion:

- **Reward:** a live, real-transaction demo with an on-chain artifact the judge can verify (tx hash, contract ID), a clear user story ("500 lira → USDC by voice"), and honest documentation.
- **Not rewarded:** breadth of half-built features; mock data presented as real; pitch-only MPP/P2P slides.
- **Voice-first is the differentiation lever** for the "product/UX" and "presentation" parts of any scorecard — it is what makes the demo memorable and it is currently uncontested on Stellar (§2.2).

---

## 5. Novelty verdict

**What is NOT novel (do not claim these):**

1. **P2P ramps on Stellar** — Pacto, MicoPay, AnyRamp, Mammon, PeerPesa (team's own Scout-verified list; PeerPesa and MicoPay spot-checked today), plus directory players like TuCambio/Ripio offering on/off-ramps. A Soroban escrow P2P ramp is a well-worn Stellar pattern with winners.
2. **Agent spend-policy contracts** — SpendGuard already enforces "daily caps, per-tx limits" on Stellar for AI agents. `polaris_guard` is a better-executed version of an existing idea, not a new one.
3. **Conversational/LLM → Stellar transactions** — Verbex, Stellar Studio, OlivIA, Stellar Autopay, Payperintent, Soroban Assistant/Stroopy.AI already cover chat/NL → chain actions.
4. **MPP/x402 agent payments on Stellar** — the entire theme of the previous SDF hackathon; multiple winners/builds. MPP is a *checklist item*, not a differentiator.
5. **Voice + crypto transactions** — Voicely (ETHGlobal, voice + voiceprint), TOMI Wallet, and mainstream wallet vendors are all moving this direction; approval-gated signing is shipped by MetaMask/Signet/MoonPay/Trust.
6. **Biometric/passkey-gated signing** — standard industry pattern (and Touch ID on macOS is an OS feature, not an innovation by itself).

**What differentiates Polaris (and the confidence level):**

- **Voice-first, desktop, push-to-talk OS companion for Stellar** — no voice-first project found in the Stellar hackathon index (1,348 builds) or directory; no such product among the Stellar ecosystem tools reviewed. Confidence: **medium-high** (search-based; DoraHacks indexing may miss projects without surviving repos).
- **TR-localized anchor journey (TRY → USDC) driven end-to-end by Turkish voice, with read-back + Touch ID approval** — the TR Mock Anchor is unique to this event; no indexed project drives it by voice. Confidence: **high** for the combination being unique in this ecosystem context.
- **On-chain guard as the enforcement layer of a *human-approved* assistant (not an autonomous agent)** — SpendGuard targets autonomous agents with programmatic control; Polaris uses the same contract class to protect a human-in-the-loop companion. This inversion (policy contract as the *user's* safety net, not the agent's leash) is a defensible framing difference. Confidence: **medium** — it is framing as much as engineering.
- **Developer mode + screen awareness in the same assistant** — no prior art found in Stellar; but it will not ship in 23 h, so it should be pitched as roadmap, not claimed as built.

**One-line novelty statement for the pitch:** *"Not a new ramp, not a new agent wallet — the first voice-first Stellar companion: speak Turkish, anchor lira to USDC, and let the chain's guard contract plus your fingerprint decide whether money moves."*

---

## 6. Uncertainty list

1. **Exact Genesis submission checklist and shortlist criteria are unpublished** — the team's handbook is the only source; confirm the exact deliverable list and the 12:00 deadline with organizers (and whether presentation slides are required at submission or only for the shortlist).
2. **Shortlist mechanics matter for scope:** if only shortlisted teams present, the *submission artifact* (repo + video + README) may be judged before any live demo; if the shortlist is generated from submissions, the recorded demo video quality is disproportionately important. Unconfirmed.
3. **Prize breakdown** ($7k/$4k/$2.5k/$1.5k) comes from LumenLoop's event mirror, not from the Rise In page directly.
4. **Voice-first absence on Stellar is search-based.** DoraHacks indexes 1,348 builds but the index may be incomplete; a private/unindexed voice project could exist. Soft-empty searches are inconclusive by policy.
5. **Pacto / AnyRamp / Mammon** were not re-confirmed in today's single directory pass (attributed to the team's earlier Scout verification in architecture.md §5.6).
6. **Touch ID viability on the actual demo Mac** — depends on code-signing state and macOS version; must be proven in the spike. The official Tauri plugin does not support macOS; the community plugin's keychain storage may fail unsigned.
7. **Whisper Turkish accuracy on the venue mic** is unknown until spiked; WER figures from Common Voice do not predict command-phrase accuracy with numbers and proper nouns. Cloud STT availability on venue Wi-Fi is a second variable.
8. **Anchor SEP-6 flow details** are assumed from `tr-mock-anchor.fly.dev/sep` + stellar.toml (verified live today); the actual deposit UX (simulated bank step) may differ from the documented sequence.
9. **Whether MPP counts as the required "Integration"** — architecture.md §5.5 says organizers must confirm; unconfirmed as of today. Soroswap/DeFindex remains the safe pick.
10. **MPP Session mode on testnet** (channel contract, settlement timing) is documented but was not exercised in this research; treat as unproven for demo purposes.
11. **This report's prior-art sweep is a snapshot** (2026-09-19 ~10:00 UTC); the event is in progress and other teams may be building adjacent ideas right now.

---

## Sources

- Event: <https://www.risein.com/programs/stellar-pro-hackathon> · <https://lumenloop.com/events> · <https://www.risein.com/programs/hackathon-project-submission-stellar>
- Submission precedent: <https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail> · <https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/winner>
- Stellar prior art: Raven MCP `scout.searchHackathonBuilds`, `scout.vetIdea`, `scout.searchProjects`, `lumenloop.search_directory` (2026-09-19); build pages listed inline in §2.
- MPP: <https://developers.stellar.org/docs/build/agentic-payments/mpp> · <https://developers.stellar.org/meetings/2026/05/07> · <https://x.com/StellarOrg/status/2040148969104318658>
- x402: <https://developers.stellar.org/docs/build/agentic-payments/x402>
- Anchor: <https://tr-mock-anchor.fly.dev/.well-known/stellar.toml> (fetched 2026-09-19)
- Outside-Stellar prior art: links inline in §3.
- Feasibility: <https://v2.tauri.app/plugin/biometric> · <https://docs.rs/crate/tauri-plugin-biometry/latest> · <https://arxiv.org/abs/2307.04765> · <https://huggingface.co/OpenVoiceOS/whisper-large-v3-turbo-turkish-onnx> · <https://github.com/ggml-org/whisper.cpp/discussions/3890>
- Protocol integration availability: <https://api.soroswap.finance/docs> (testnet protocols: soroswap, aqua; testnet token faucet) · <https://www.defindex.io/> (SDK supports TESTNET) · <https://testnet.rgstry.xyz/contracts/defindex/factory>
