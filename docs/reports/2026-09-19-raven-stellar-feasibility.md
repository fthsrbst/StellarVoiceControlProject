# Polaris — Raven / Stellar-side / Prior-art Feasibility

> **Date:** 2026-09-19 · **Author:** research worker (read-only outside this file)
> **Context:** "Polaris" — push-to-talk voice assistant for Stellar, Genesis Stellar Pro Hackathon,
> submission deadline 2026-09-20 12:00 (~23h at time of research). Grounded against
> `docs/architecture.md`, `docs/interfaces.md`, `sprints.md`.
> **Method:** live Raven MCP calls via `~/.local/bin/raven-call.sh` (endpoint `https://raven.stellar.buzz/mcp`),
> direct HTTP probes (anchor, Horizon, npm, OAuth metadata), and web fetches. Every load-bearing claim
> below names the exact tool call or URL that produced it. Uncertainty is listed explicitly in §5.

---

## 1. TL;DR verdicts

| # | Question | Verdict | Confidence |
|---|---|---|---|
| 1 | **Consuming Raven MCP inside a Tauri app at hackathon time** | **Feasible, but budget ~2–4h of work and keep it off the demo critical path.** Raven's OAuth is a standard code+PKCE flow with dynamic client registration; a probe confirmed it accepts a `http://127.0.0.1:...` loopback redirect with a public client. No app-level rate caps on the MCP lane. Two viable routes: custom loopback listener (community `tauri-plugin-oauth`) or spawning `npx mcp-remote` as a sidecar. Operator-issued named API key exists as an escape hatch but must be *requested* (Discord #raven) — do not depend on it. | High on mechanics (all verified live); Medium on in-app delivery in 23h |
| 2 | **Stellar-side plan (M2 slice + anchor + guard) in ~23h for 2 people** | **The vertical slice is achievable if scope is cut to: voice → agent → send-USDC → Touch ID → testnet tx, plus anchor deposit and `polaris_guard` deploy.** The mock anchor is live and the treasury is funded (26.6k USDC). Both Soroswap and DeFindex are testnet-deployed, but both SDKs want API keys — plan direct-contract fallback. Several `architecture.md` facts are stale (see §4). | Medium-high |
| 3 | **Prior art in the Stellar ecosystem** | **(b) conversational/LLM agents that execute Stellar actions and (c) MCP/AI tooling are crowded** — Verbex, Stellar Studio, BlendMCP, StellarSwap MCP, StellarMCP, x402/MPP agent stack, plus the official Raven/LumenLoop/Scout/Stellar AI Agent Kit. **(a) voice-controlled wallets are thin:** no direct push-to-talk wallet found; nearest are a conversational MCP DeFi assistant (Verbex), a "voice-activated financial assistance" fintech (RemittEase AI), agent-voice infrastructure (Eleventts), and an SDF video showing voice-controlled deployment via MCP (kalepail). Voice-specific AV searches returned empty (inconclusive, not absence). | High for (b)/(c); Medium for (a) |

**One-line recommendation:** treat Raven as *dev-time knowledge + in-app optional enhancement*; make the demo
work with `lumenloop.*`/`scout.*` via Raven **or** direct docs, and never block the money path on MCP availability.

---

## 2. Findings — Q1: Raven integration

### 2.1 Identity, endpoint, ownership

- Two hostnames serve the same service: `raven.stellar.buzz` (used by our helper, and the URL in the current
  official docs page) and `raven.stellar.org` (canonical per the repo README: "canonical since 2026-08-04;
  service live since 2026-07-02"). Both OAuth metadata documents are identical in shape and point to their own
  issuer (`issuer`, `/authorize`, `/token`, `/register`).
- **Not a community project.** The Terms of Service page ("Effective September 11, 2026") names the operator:
  "operated by the Stellar Development Foundation ('SDF')". The official docs call it "the recommended path"
  (`https://developers.stellar.org/docs/build/building-with-ai` → "Raven (MCP server) ... This is the
  recommended path"). Source lives in `stellar-experimental/stellar-raven`, Apache-2.0.
- `architecture.md` §4.2 currently says "Community project, listed by Stellar docs" — half wrong on both counts
  (see §4 corrections).

### 2.2 OAuth model (what a Tauri app must implement)

From `curl https://raven.stellar.buzz/.well-known/oauth-authorization-server`:

```json
{"issuer":"https://raven.stellar.buzz",
 "authorization_endpoint":"https://raven.stellar.buzz/authorize",
 "token_endpoint":"https://raven.stellar.buzz/token",
 "registration_endpoint":"https://raven.stellar.buzz/register",
 "scopes_supported":["mcp"], "response_types_supported":["code"],
 "grant_types_supported":["authorization_code","refresh_token"],
 "token_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none"],
 "revocation_endpoint":"https://raven.stellar.buzz/token",
 "code_challenge_methods_supported":["S256"],
 "client_id_metadata_document_supported":true}
```

- **PKCE:** `S256` only — correct for a desktop app (no client secret; `none` auth method supported).
- **Dynamic Client Registration:** present at `/register`. I probed it with a loopback redirect and a public
  client and it succeeded:
  `POST /register {"client_name":"polaris-feasibility-probe","redirect_uris":["http://127.0.0.1:17421/callback"],
  ... "token_endpoint_auth_method":"none"}` → `{"client_id":"12L5_5y-dTv_y3V-", ...}`.
  **This is the key Tauri fact: a localhost redirect URI is accepted, so the standard "open system browser +
  localhost callback listener" desktop flow works. No custom scheme needed.**
- **Sign-in provider:** WorkOS AuthKit (docs: "The sign-in happens in your browser through WorkOS AuthKit;
  approve the Terms acknowledgement checkbox on the consent screen"). One manual browser sign-in per 90 days.
- **Tauri implementation options (both viable):**
  1. Loopback listener in-app. A maintained community plugin exists: `tauri-plugin-oauth` v2.1.0
     (`@fabianlars/tauri-plugin-oauth`, MIT/Apache-2.0, "spawns a temporary localhost server to capture OAuth
     redirects"). Token exchange/refresh can live in Rust or the webview. Estimated 2–4h including token
     persistence and refresh.
  2. Spawn `npx mcp-remote@latest https://raven.stellar.org/mcp --transport http-only` as a stdio MCP bridge —
     the official Raven docs list exactly this for "clients without native remote or OAuth support". If the
     team already plans a Node sidecar for the Claude Agent SDK, this is the cheapest path (no OAuth code at all).
- **Escape hatch:** "If a client cannot complete OAuth at all, ask the operator for a named API key and send
  `Authorization: Bearer name:token`." Repo README confirms operator-managed "non-expiring, full-access named
  credentials". Request via #raven Discord or `frontier@stellar.org` — **unknown lead time; do not block on it.**

### 2.3 Token lifetime, rate limits, sandbox limits

- **Tokens:** "Access tokens last **1 hour**; compatible clients refresh them automatically within a fixed
  **90-day** authorization window before you sign in again." DCR registration TTL is **365 days**
  (ARCHITECTURE.md §7). Our helper (`raven-call.sh`) refreshed tokens repeatedly during this research with no
  re-auth — the refresh_token grant works.
- **Rate limits:** ARCHITECTURE.md §7 "MCP-only `/mcp`" lane: top-level `search` default 10 / max 50; **"No
  app-level per-session count cap"** for execute/search; `execute.code` has no app-level max. So there is no
  documented per-user request quota for the MCP lane. The usual acceptable-use clause applies ("do not
  overload, disrupt, or interfere"). Cloudflare-side AI-Gateway limits are documented as *playground-only*.
- **Sandbox:** each `execute` runs in a fresh isolate with `globalOutbound: null` (no network), 60s wall-clock
  timeout, results truncated at ~6,000 tokens by default (larger payloads readable via artifacts for 7 days).
  This matters for Polaris: **Raven cannot make network calls of your choosing** — you can only call the
  catalogued operations, and you must compose them in JS.

### 2.4 ToS / attribution / intended use

- ToS §3 "Eligibility and permitted use": *"Notwithstanding the 'personal, non-commercial use only' limitation
  in the Stellar ToS, you may use the Service for developer and commercial purposes, including building,
  testing, and deploying applications on Stellar…"* → **third-party apps are an intended use.**
- The Service is explicitly **read-only**: "does not sign, authorize, or submit transactions, custody assets or
  keys, or move value on any network." Perfect fit for Polaris's "read-only knowledge in the agent loop".
- **No explicit attribution requirement** was found for API consumers. SDF-authored content is Apache-2.0;
  third-party content keeps its upstream license (`THIRD-PARTY-NOTICES.md`). Best practice: add a "data sources:
  Raven / LumenLoop / Scout / Stellar Docs" note in the README — cheap, zero risk.
- Privacy note relevant to a voice app: ToS §8 forbids submitting "personal data … credentials, private keys";
  ToS §9 says queries are stored for 30 days for quality. **Do not send transcripts containing wallet secrets
  or personal data to Raven**; send only the knowledge-query text.

### 2.5 What the tools actually expose

`tools/list` returns exactly **two tools**: `search` and `execute`. Inside `execute`, the sandbox globals are
`lumenloop`, `scout`, `stellarDocs`, `codemode` (+ standard JS) — confirmed by an error message when a script
referenced a non-existent global. `codemode.catalog()` (call: `execute {"code":"const c=await codemode.catalog(); return c.entries.map(...)"}`)
enumerated **60 operations + 20 skills**:

- `lumenloop.*` (18 ops): directory, project details, semantic content/AV search, `find_av_passages`,
  `find_similar_projects_semantic`, SCF submissions, vocabulary.
- `scout.*` (30 ops): `searchHackathonBuilds`, `searchProjects`, `searchResearch`, `searchRepos`, `getHackathon(s)`,
  `vetIdea`, `hackathonBrief`, `getStablecoins`, `explainRepo`, `listContracts`, audits, builders, partners, skills.
- `stellarDocs.*` (12 ops) — including `stellarDocs.search_anchor_sep_docs` (as `architecture.md` already notes),
  `search_docs`, `search_doc_titles`, `search_meeting_notes`, wallet/dapp and Soroban-specific searches.
- `skills.*` (20 playbooks) — including `skills.stellar-dev.agentic-payments`, `standards`, `smart-contracts`,
  `dapp`, plus OpenZeppelin, Trustless Work, LumenLoop and Stellar-Light skills. **`architecture.md` omits the
  `skills.*` family entirely** (see §4).

### 2.6 Can Raven answer questions about Raven itself?

**Not directly.** `codemode.search({query:"raven mcp server oauth"})` returned only generic catalog hits
(skills/ops), never a Raven-docs entry; `lumenloop.find_content_about_project({slug:"raven"})` returned empty.
The only self-referential knowledge is indirect: the official docs page `developers.stellar.org/docs/build/building-with-ai#raven-mcp-server`
("Raven is a remote MCP server … hosted at raven.stellar.buzz") is in the `stellarDocs` index, and the directory
has a Raven project record (description only, no OAuth mechanics). **Do not plan to demo "ask Raven about Raven" —
it works only via the official-docs page that documents it.**

### 2.7 Alternatives (standalone MCPs / direct HTTP)

| Option | Status (verified 2026-09-19) | Consumability vs Raven |
|---|---|---|
| **LumenLoop MCP** `https://mcp.lumenloop.com` | **Live but NOT auth-free anymore.** `/.well-known/oauth-protected-resource` → `{"resource":"https://mcp.lumenloop.com","scopes_supported":["openid","profile","email","offline_access"],"authorization_servers":["https://palatial-egg-31.authkit.app"]}` (WorkOS AuthKit). `POST /` → `{"error":…"No valid session ID provided"}`; response headers carry `x-ratelimit-limit: 2000`. `architecture.md` §4.2's "no auth" is **stale**. | **More work than Raven**, not less: another OAuth (WorkOS) + session/SSE transport; it does not remove the OAuth problem. |
| **Scout MCP** `npx -y @stellar-light/scout-mcp` | Exists, latest **1.2.1** (npm, modified 2026-08-31), matching `architecture.md`. Source header says it "Exposes stellarlight.xyz's **19** public APIs as MCP tools" — `architecture.md`'s "21 tools" is likely stale. stdio, no OAuth. | Easiest *local* option (no auth), but only Scout data — no docs, no LumenLoop. Fine as a dev-time tool; 19 tools crowd the agent context less than it sounds. |
| **Direct HTTP** `stellarlight.xyz` APIs (34 endpoints per its site) | Public JSON APIs behind Scout. | Useful as a serverless fallback; needs custom client code. |
| **Raven** | One OAuth, all four families, `skills.*` included. | **Best ratio if you accept ~2–4h of integration; otherwise use it dev-time only.** |

Prior-art note that cuts the other way: the ecosystem already has several *transactional* MCP servers
(e.g. `JulioMCruz/Stellar-mcp` exposes `stellar_sep10_auth` and `stellar_sep6_transfer`; BlendMCP; StellarSwap
MCP). Polaris should not try to compete on "MCP for Stellar" — its angle is the *voice + approval + guard* UX.

---

## 3. Findings — Q2: Stellar-side plan and risk

### 3.1 Mock anchor — live and healthy

Direct probes (no Raven involvement; this is the organizers' service):

- `GET https://tr-mock-anchor.fly.dev/.well-known/stellar.toml` (200): VERSION 2.7.0; network passphrase
  `Test SDF Network ; September 2015`; `WEB_AUTH_ENDPOINT /auth` (SEP-10); `TRANSFER_SERVER /sep6`;
  `KYC_SERVER /sep12`; `ANCHOR_QUOTE_SERVER /sep38`; `USDC` issuer
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; `anchor_asset="TRY"`. **No SEP-24, no
  `WEB_AUTH_FOR_CONTRACTS_ENDPOINT` (no SEP-45)** — matches `architecture.md`.
- `GET /sep6/info` (200): deposit/withdraw USDC enabled, `authentication_required: true`,
  `min_amount: 0.5`, `max_amount: 300`, `fee_percent: 0.5`, `funding_methods:["bank_account"]`.
  **Inconsistency alert:** the `/sep` guide and `/llms-full.txt` say "min 50 / max 3000 **TRY** per deposit ·
  fee 0.5% spread". The units are almost certainly USDC in `/sep6/info` vs TRY in the guide, but this is
  **not confirmed** — validate with a real quote before demoing a specific amount (see §5).
- **Treasury balance (Horizon, live):** `GCLCZEQZ2THTEDAOFI66LACNPLY4OBKN7VKLEZFMBIHYKYQOW2W7T3Z6`
  holds **26,666.96 USDC** (Circle issuer) + ~999,983 of a second USDC issuer (GDGW3J…) + 9,999.99 XLM.
  The "treasury was drained once" story in `architecture.md` §13 is **not externally verifiable**, but the
  current balance means deposits should not fail for lack of treasury funds **right now**.
- Flow details confirmed by `/sep` guide: SEP-10 → JWT; SEP-6 deposit returns instructions; "you play the bank"
  via `POST /sep6/tx/<ID>/simulate-bank-transfer`; poll `/sep6/transaction`; withdrawal returns a treasury
  address + memo. Trustline required, else status `pending_trust` (or claimable balance if opted in).
- SEP-38 endpoint uses **`sell_asset`/`buy_asset`** field names (a probe with `source_asset`/`destination_asset`
  returned `'sell_asset' and 'buy_asset' are required`). Any SEP-38 client must account for that.
- SEP-12 `GET /customer` without JWT → 403 (auth required, as expected).

### 3.2 Testnet USDC + faucet/deploy economics

- USDC issuer account exists on testnet (Horizon 200), matching the anchor's toml. Circle's testnet USDC is the
  canonical asset; Circle's faucet needs a manual captcha (`architecture.md` §5.5 — unchanged).
- **Friendbot:** official docs (`/docs/build/smart-contracts/getting-started/deploy-to-testnet`):
  `stellar keys generate alice --network testnet --fund` funds via Friendbot. Docs networks table:
  "Friendbot Available … Yes (10,000 XLM)" (testnet). **XLM on testnet is free; contract deploy cost is
  therefore not a budget risk.** The repo's own smoke test (architecture §11) already deployed a contract on
  testnet with this toolchain, which is stronger evidence than any cost estimate.
- **No testnet reset before the deadline:** scheduled 2026 resets list only **December 16, 2026**.
- Deploy command shape (same docs page): `stellar contract deploy --wasm target/wasm32v1-none/release/<name>.wasm
  --source-account alice --network testnet --alias <name>`.

### 3.3 Soroswap vs DeFindex — testnet availability

| | DeFindex | Soroswap |
|---|---|---|
| Directory status | `scout.searchProjects({q:"defindex"})` → **Live**, types `[Infrastructure, SDK, Yield]`; `lumenloop.get_project({slug:"defindex"})` → "DeFindex helps wallet providers to offer savings accounts…" | `scout.searchProjects({q:"soroswap"})` → **Live**, type `[DEX]`, SCF-awarded |
| Testnet evidence | `paltalabs/defindex-sdk` README: "The DeFindex API is now fully operational on testnet … Factory deployed and working on testnet … Full deposit, withdrawal, and balance operations". Testnet registry shows a deployed `defindex/xlm-vault` (`CCLV4H7WTLJQ7ATLHBBQV2WW3OINF3FOY5XZ7VPHZO7NH3D2ZS4GFSF6`, 2026-04-24) | `soroswap/core/public/testnet.contracts.json` router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`, factory `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY`; testnet registry shows a newer router deploy (2026-07-07). SDK supports `SupportedNetworks.TESTNET` |
| Friction | SDK requires **API key** ("API key from DeFindex"); server-side access focus | SDK requires **API key** (`apiKey: string // starts with 'sk_'`) |
| Watch-outs | Vault liquidity/APY not verified; API key lead time unknown | **Two factory generations differ between sources** (`CDP3HMUH…` in core JSON vs `CA4HEQTL2WPE…` in registry) — pin the right one before building; pool liquidity not verified |

**Implication for the 23h budget:** both protocol paths add an API-key dependency that could stall a 2-person
team overnight. Prefer (a) direct contract calls with the official SDK if a key is already at hand, or (b) keep
the protocol action as the *last* integration and cut it before the anchor/guard/approval if time runs out
(consistent with `sprints.md` M3, which already says "pick ONE").

### 3.4 SEP-45 / passkeys

`scout.searchResearch({q:"SEP-45 contract accounts", source:"sep"})` + raw spec
(`stellar/stellar-protocol/ecosystem/sep-0045.md`): **Status: Draft, Version 0.1.1, Updated 2025-12-16**
(changelog: 0.1.1 handles archived contract instances). Reference contract is listed for **Pubnet only**
(`CALI6JC3MSNDGFRP7Z2OKUEPREHOJRRXKMJEWQDEFZPFGXALA45RAUTH`). The mock anchor does not advertise SEP-45.
→ `architecture.md` §5.4's reasoning stands: SEP-10 with a `G` account remains the anchor identity; passkeys
stay bonus-only.

### 3.5 23h implementation-risk assessment (2 people)

**Already de-risked (evidence above):** anchor up + funded; USDC issuer live; no testnet reset; contract
deploy smoke test passed on this machine; Raven consumable (if given 2–4h); both protocols testnet-deployed.

**Top risks, in order:**
1. **Tauri shell spike** (hotkey + mic + Touch ID + screenshot, ~2h gate per §7) — unchanged; if it fails,
   Electron fallback costs a day for a 2-person team. Run it first.
2. **Turkish STT undecided** (`architecture.md` §4.1) — the vertical slice's acceptance ("speak 5 commands,
   transcribe correctly") is the highest-variance item. Decide by spike within the first hours.
3. **Anchor SEP-6 details**: units discrepancy (0.5–300 vs 50–3000), trustline-first requirement, "simulate
   bank transfer" step, SEP-38 `sell_asset`/`buy_asset`. All implementable but must be coded against the live
   guide, not assumptions. Budget 2–3h for a working deposit.
4. **Touch-ID approval + key custody**: community `tauri-plugin-biometry` is unproven here; if it fails, fall
   back to an explicit in-app confirm for the demo (document the downgrade).
5. **Protocol integration (Soroswap/DeFindex)**: API-key dependency; cuttable.
6. **`polaris_guard`**: small, well-understood (policy + alias + guarded SEP-41 transfer). With the passing
   smoke test, ~1–2h to implement + deploy. Keep as the "own contract" requirement. P2P escrow is a second
   contract — cut it (prior art already covers P2P: Pacto etc.).

---

## 4. corrections for `docs/architecture.md` (stale/wrong vs live data)

| Location | Current text | Live finding |
|---|---|---|
| §4.2 table, Raven row | endpoint `https://raven.stellar.buzz/mcp`; "Community project, listed by Stellar docs" | Two mirror hosts; **canonical is `https://raven.stellar.org/mcp` since 2026-08-04** (homepage + README); `.buzz` works and is what official docs show. Raven is **SDF-operated** (ToS) and the **official docs' recommended path** — not merely a community project. |
| §4.2 Raven row | "2 tools: search, execute (… calls stellarDocs.*, lumenloop.*, scout.*)" | Correct on 2 tools, but the catalog also has a fourth family: **`skills.*` (20 playbooks, 202 sections)**, incl. `stellar-dev.agentic-payments`. Catalog total: 60 ops + 20 skills. |
| §4.2 LumenLoop row | "remote HTTP, **no auth**" | **Now OAuth/WorkOS AuthKit-protected** (`/.well-known/oauth-protected-resource` → authkit issuer) with rate-limit headers (`x-ratelimit-limit: 2000`). The fallback is not "free access" anymore. |
| §4.2 Scout row | "v1.2.1, **21 tools**" | v1.2.1 confirmed (npm), but its source says **19 public APIs**. Minor, correct at submission time. |
| §4.2 note | "Raven's OAuth … needs a localhost/deep-link callback → real work" | Confirmed but quantified: loopback redirect is **accepted by Raven's DCR**; community `tauri-plugin-oauth` exists; or use `npx mcp-remote` sidecar. ~2–4h. |
| §5.1 | flow sketch uses "SEP-38 quote" without field names | Live endpoint expects **`sell_asset`/`buy_asset`** (not source/destination). |
| §5.1 / §13 | "3000 TRY cap per deposit" | Guide says 50–3000 TRY; `/sep6/info` reports 0.5–300 (units ambiguous). Reconcile before choosing demo amounts. |
| §13 | "treasury … has already been drained once: be gentle" | Cannot verify history; **currently funded with 26.6k USDC + 10k XLM** — still be gentle (shared). |
| §5.5 | "Circle's testnet faucet needs a manual captcha" | Still true; also note **Friendbot gives 10,000 free testnet XLM** for fees/deploy. |
| §11 | smoke test passed | Consistent with live deploy docs; no change. |

---

## 5. Uncertainties and things that could NOT be verified

1. **No browser end-to-end OAuth run.** I verified discovery metadata, DCR acceptance of a loopback URI, and
   refresh-grant reuse (our helper refreshed tokens repeatedly), but did **not** drive `/authorize` + WorkOS
   consent + code exchange in a browser. The consent screen ("approve the Terms acknowledgement") may need one
   manual click; automatic completion is claimed in docs but untested here.
2. **Custom URI scheme redirects were not tested** (`polaris://callback`). Loopback is verified; if the team
   prefers deep links, test before committing.
3. **Raven rate limits at the platform edge** (Cloudflare) are not documented in the repo; only app-level limits
   are listed (none for the MCP lane beyond the 60s sandbox timeout and result cap). Acceptable-use terms bind.
4. **Named API key availability** is operator-mediated ("ask the operator"); lead time and approval unknown.
5. **LumenLoop MCP proper message path:** `POST /mcp` → "Cannot POST /mcp", `POST /` requires a session id,
   `GET /` is an SSE stream (headers observed, body not). Its OAuth + transport means it is *not* a simpler
   fallback; exact session mechanics were not reverse-engineered (out of scope).
6. **Anchor `/sep6/info` vs `/sep` guide amount discrepancy** (0.5–300 vs 50–3000) — units unconfirmed.
7. **"Treasury drained once"** — cannot verify; current balance is funded.
8. **Testnet liquidity** for Soroswap pools / DeFindex vaults is **not verified** — only deployments and SDK
   claims. Check with a live quote before betting the demo on a swap/vault.
9. **Soroswap factory ID divergence** between `soroswap/core`'s testnet JSON (`CDP3HMUH…`) and the registry's
   July 2026 deploy (`CA4HEQTL2WPE…`) — pin the correct generation.
10. **Voice prior art searches are inconclusive:** `lumenloop.find_av_passages` returned empty for 4 distinct
    queries ("voice", "voice controlled wallet demo", "AI agent signs transaction", "MCP server Stellar agent");
    per Raven's contract `soft-empty` means *inconclusive, not absence*. `scout.searchHackathonBuilds({q:"speech"})`
    was empty; `{q:"voice"}` matched 12 builds but many were word-matches (invoices) rather than voice UI.
11. **Prior art from `architecture.md` (NextForge, Pacto, MicoPay, AnyRamp, Mammon, PeerPesa)** was not
    re-verified in this pass — carried over from the earlier report on trust.
12. The DCR probe created a real (harmless, 365-day TTL) client registration named
    `polaris-feasibility-probe` on Raven's OAuth server.

---

## 6. Raven calls made (reproducibility)

All via `~/.local/bin/raven-call.sh` against `https://raven.stellar.buzz/mcp`:

1. `tools/list` — returned exactly 2 tools (`search`, `execute`).
2. `execute` `codemode.catalog()` — full operation/skill enumeration (60 ops, 20 skills, `generatedAt` 2026-09-16).
3. `execute` `codemode.describe(...)` over 27 op ids — input schemas/signatures (load-bearing for every call below).
4. `execute` batch **B** — `stellarDocs.search_docs` (SEP-45), `search_anchor_sep_docs`, `search_asset_token_docs`,
   `search_soroban_contract_docs` (deploy/fees).
5. `execute` batch **C** — `scout.searchProjects` (soroswap/defindex/yield), `lumenloop.search_directory`,
   `scout.getStablecoins`.
6. `execute` batch **D/E/K** — `scout.searchHackathonBuilds` × 12 queries (voice, voice assistant, AI agent, MCP,
   conversational, chatbot, speech, voice command, hands-free), `scout.searchProjects` (voice/assistant/MCP).
7. `execute` batch **F** — `stellarDocs.search_docs` (SEP-45, friendbot, deploy), `scout.searchResearch`
   (SEP-45 source=sep, passkey status).
8. `execute` batch **G/H** — `lumenloop.search_directory` (voice/assistant/MCP), `search_content_semantic`
   (voice wallet, MCP agents), `find_av_passages` × 4, `stellarDocs.search_docs` (MCP/AI).
9. `execute` batch **I/J** — `codemode.search` (Raven self-knowledge, defindex/soroswap), `lumenloop.get_project`
   (raven/defindex), `find_content_about_project(raven)`, `find_similar_projects_semantic(raven)`.
10. Direct probes outside Raven: OAuth metadata `/.well-known/oauth-authorization-server` both hosts; DCR `POST /register`
    (loopback); `GET /health`; anchor `stellar.toml`, `/sep`, `/llms-full.txt`, `/sep6/info`, SEP-38/SEP-12 probes;
    Horizon treasury/issuer accounts; npm registry `@stellar-light/scout-mcp`; `mcp.lumenloop.com` OAuth/transport probes;
    web fetches listed inline above.

---

*End of report. Only this file was written; `docs/reports/INDEX.md` deliberately untouched.*
