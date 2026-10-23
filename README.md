# base-browser

The browser space: one warm Chromium pool per trust class. Verifier gates, browsing agents, staging smoke, and R&D request browsers here instead of installing headless Chrome locally — zero local setup for any of them.

Status: **WIP design.** Decisions below are recorded; the service is not yet deployed. Open questions are marked `TBD`. Tools assessed along the way — adopted, contenders, rejected with reasons — live in references.md; read it before proposing a different one. The measurements behind them: [survey/2026-10-23.md](survey/2026-10-23.md).

Sibling to [base-runner](https://github.com/mihado/base-runner): runners execute the work, browsers prove it — and explore.

## Decisions

- **Engine: Chromium, Playwright-driven** — the pool's only engine. Firefox is not a second platform; the one Firefox-class path is the camofox escalation below. (If Chromium itself ever needs replacing, Playwright's own build through this same pattern.)
- **Server: each instance is a pool of official Playwright Chromium containers** (`mcr.microsoft.com/playwright`, pinned) — **one container per session, recycled after each session**, fronted by the edge with a token. A small orchestrator of ours handles lease, health, recycle, limits and reaping; no vendor ships that. A proxy is set per context, and Steel's anti-bot defaults are copied across (a browser UA, `--disable-blink-features=AutomationControlled`, no `--enable-automation`, headful under Xvfb where a site needs it).
- **Instances: one pool per trust class, the same design.** Two postures, never mixed:
  - **Gate** — verifies internal work: allowlisted internal origins through the edge (the dev zone), nothing else. Consumers: verifier gates.
  - **Lab** — renders the open web and drives staging smoke, browser-use and agent-harness trials, scraping, and R&D; it hosts the authorized red-team tools. Egress: the public web plus the edge with per-purpose scoped tokens; never core-direct.
  - Invariants for every instance: a dedicated, always-on VM (never a workstation, never a box that powers down), thin/stateless disk, start-at-boot, no ballooning, outbound-only except the client port. Instances never share a VM, a network zone, or a profile.
  - Placement specifics — VLANs, hosts, token names — live in the private conducta inventory, never in this repo.
  - **Targets are URLs.** Naming, DNS, and proxying belong to whatever runs the target; this repo needs only the resulting URL and a matching egress allowlist.
- **Profiles: none in the gate, scoped restoration in the lab.** The gate never uses a persistent profile, ever — credentials reach it only through the client's HTTP layer, at request time. The lab may restore `storageState` for an agent session that must be signed in to a site; the orchestrator keeps each state per purpose and never shares one across purposes.
- **Escalation for hostile sites: [camofox-browser](https://github.com/jo-inc/camofox-browser), lab only** (MIT; Camoufox/Firefox behind REST) — for a source that only yields to a Firefox-class fingerprint, and never from the gate. Run it with `CAMOFOX_ACCESS_KEY` set and its crash telemetry off (`CAMOFOX_CRASH_REPORT_ENABLED=false`). Verdict: references.md.
- **Steel rejected: single-session self-host.** Three parallel sessions kill the process and the API has no auth. Evidence, and the Playwright calls that replace its session API: [survey/2026-10-23.md](survey/2026-10-23.md).
- **Principle: reliable, boring primitives composed to do the work; a tool earns its place by evidence.**
- **Clients: [`playwright-core`](https://github.com/microsoft/playwright) only** — protocol client, never `playwright install`. Endpoint per instance from env, one context per run, `close()` in a `finally`, backoff on 429/503. Credentials are added by the client's own HTTP layer at request time: never stored in the browser, never reachable by page JS.

## Uses

- **Verifier gates** — deterministic Playwright against a preview or staging URL; the original job.
- **Browsing agents** — planner → Jev-style decider → this browser: staging smoke after CI, page-interaction R&D, scraping, agent-harness trials.
- **Red-team and adversarial testing** — authorized scans, and anything that must render untrusted content far from internal services.
- **Not the pool's job: a job's own preview server.** Job-owned previews get an in-sandbox browser — Chromium inside the job's microVM (microsandbox ships a Playwright example; wrap's desktop image runs Chrome + CDP + noVNC loopback-only) — loopback, no DNS, no TLS, isolation by construction. Same image, same protocol, none of the pool's machinery: no anti-bot flags, no proxy, no token, because loopback is the boundary. Assessment: references.md.

## Sizing

**TBD per instance — measure per-container CPU/RAM and recycle time first.** The old "20 concurrent sessions ≈ 6–10 GB" assumed one Steel process, which serves one session and dies at three; ignore it. What holds regardless: `CONCURRENT`-style depth plus a deep queue absorbs the thundering herd (N verifiers at once); clients treat 429/503 as retry-with-backoff, never as gate failure; `TIMEOUT` kills leaked sessions, `finally`-close is the plan, timeout the backstop.

## Client contract

```js
import { chromium } from "playwright-core"; // client only, no browser download
const browser = await chromium.connect(process.env.BROWSER_WS_URL);
const context = await browser.newContext(); // fresh profile per run, unless the lab restores one
try {
  const page = await context.newPage();
  // ... verifier assertions ...
} finally {
  await browser.close(); // ends the session; the orchestrator recycles the container
}
```

The orchestrator hands out the `wsEndpoint` of a `launchServer` inside the leased container, so `connect()` is the default path and the client/image version pin is what keeps it valid. A container that also exposes CDP is reachable with `connectOverCDP()` — that is the path `chrome-devtools-mcp --browserUrl` takes for live inspection. Pin the `playwright-core` version with the server image tag; bump as one change.

## Client layers

The pool serves browsers; what drives them stratifies by need, fastest first:

1. **Deterministic Playwright** (`playwright-core`, `examples/verify.mjs`) — known-assertion gates. Zero model latency, zero token cost. Default choice.
2. **Jev loop** (later, [jev-browser](https://github.com/Ying-Kai-Liao/jev-browser) blueprint) — planner LLM + ~300 ms typed decisions on DOM state for fast agentic flows. A local decision model removes the paid API.
3. **[midscene](https://github.com/web-infra-dev/midscene)** (contender, MIT) — vision-driven actions and assertions on the same page, scoped to where DOM fails. Assessment in references.md.

Agent frameworks that drive a browser themselves (browser-use and friends) attach to the same endpoint as lab consumers; the assessment lives in references.md.

## Open questions (TBD)

- Peak concurrency per instance — what each pool gets sized and capped against.
- Whether a live viewer is needed. The pool has none built in: headful under Xvfb, a CDP screencast, or video and trace after the fact. The sandbox's noVNC is loopback-only and not a substitute.
- Recycle cost per session — cold container start against context reset, measured before the recycle policy is fixed.
- Where the orchestrator lives: on each pool VM, or with the execution plane that already holds the queue; one orchestrator for both instances, or one each.
- One lab instance doing both open-web R&D and staging verification (the intended start) vs two; split when a gate needs direct dev-zone reachability, or when the lab workload goes long-running.
- Access tokens for non-public targets: which purpose gets which, rotation, where they live.
