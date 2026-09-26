# base-browser

The browser space: one warm Chromium pool per trust class. Verifier gates, browsing agents, staging smoke, and R&D request browsers here instead of installing headless Chrome locally — zero local setup for any of them.

Status: **WIP design.** Decisions below are recorded; the service is not yet deployed. Open questions are marked `TBD`. Tools assessed along the way — adopted, contenders, rejected with reasons — live in references.md; read it before proposing a different one.

Sibling to [base-runner](https://github.com/mihado/base-runner): runners execute the work, browsers prove it — and explore.

## Decisions

- **Engine: Chromium, Playwright-driven.** Firefox deferred — gates verify our own work, where a second engine buys nothing; agentic layers drive the same CDP endpoint. (If that changes, Playwright's own Firefox build through this same pattern, not a second platform.)
- **Server: [Steel self-host](https://github.com/steel-dev/steel-browser)** (`ghcr.io/steel-dev/steel-browser-api`), Apache-2.0. CDP-compatible WebSocket; any Playwright/puppeteer-core client. Fronted by the edge with a token — see Instances.
- **Instances: one pool per trust class, the same design.** Two postures, never mixed:
  - **Gate** — verifies internal work: allowlisted internal origins through the edge (the dev zone), nothing else. Consumers: verifier gates.
  - **Lab** — renders the open web and drives staging smoke, browser-use and agent-harness trials, scraping, and R&D; it hosts the authorized red-team tools. Egress: the public web plus the edge with per-purpose scoped tokens; never core-direct.
  - Invariants for every instance: a dedicated, always-on VM (never a workstation, never a box that powers down), thin/stateless disk, start-at-boot, no ballooning, outbound-only except the client port. Instances never share a VM, a network zone, or a profile.
  - Placement specifics — VLANs, hosts, token names — live in the private conducta inventory, never in this repo.
  - **Targets are URLs.** Naming, DNS, and proxying belong to whatever runs the target; this repo needs only the resulting URL and a matching egress allowlist.
- **Clients: [`playwright-core`](https://github.com/microsoft/playwright) only** — protocol client, never `playwright install`. Endpoint from env, one context per run, no persistent profiles, `close()` in a `finally`, backoff on 429/503. Credentials are added by the client's own HTTP layer at request time: never stored in the browser, never reachable by page JS.

## Uses

- **Verifier gates** — deterministic Playwright against a preview or staging URL; the original job.
- **Browsing agents** — planner → Jev-style decider → this browser: staging smoke after CI, page-interaction R&D, scraping, agent-harness trials.
- **Red-team and adversarial testing** — authorized scans, and anything that must render untrusted content far from internal services.
- **Not the pool's job: a job's own preview server.** Job-owned previews get an in-sandbox browser — Chromium inside the job's microVM (microsandbox ships a Playwright example; wrap's desktop image runs Chrome + CDP + noVNC loopback-only) — loopback, no DNS, no TLS, isolation by construction. The pool is for shared targets.

## Sizing

20 concurrent sessions ≈ 6–10 GB RAM per instance — headroom is ample on this host. `CONCURRENT`-style depth plus a deep queue absorbs the thundering herd (N verifiers at once); clients treat 429/503 as retry-with-backoff, never as gate failure. `TIMEOUT` kills leaked sessions; `finally`-close is the plan, timeout the backstop.

## Client contract

```js
import { chromium } from "playwright-core"; // client only, no browser download
const browser = await chromium.connectOverCDP(process.env.BROWSER_WS_URL);
const context = await browser.newContext(); // fresh profile per run
try {
  const page = await context.newPage();
  // ... verifier assertions ...
} finally {
  await browser.close(); // frees the session; shared browser keeps running
}
```

Pin the `playwright-core` version with the server image tag; bump as one change.

## Client layers

The pool serves browsers; what drives them stratifies by need, fastest first:

1. **Deterministic Playwright** (`playwright-core`, `examples/verify.mjs`) — known-assertion gates. Zero model latency, zero token cost. Default choice.
2. **Jev loop** (later, [jev-browser](https://github.com/Ying-Kai-Liao/jev-browser) blueprint) — planner LLM + ~300 ms typed decisions on DOM state for fast agentic flows. A local decision model removes the paid API.
3. **[midscene](https://github.com/web-infra-dev/midscene)** (contender, MIT) — vision-driven actions and assertions on the same page, scoped to where DOM fails. Assessment in references.md.

Agent frameworks that drive a browser themselves (browser-use and friends) attach to the same CDP endpoint as lab consumers; the assessment lives in references.md.

## Open questions (TBD)

- Steel self-host auth model — now blocking: a lab instance is reachable across zones and egresses the public web, so the endpoint gets a bearer/service token at the edge until upstream ships its own. Confirm the moment it lands.
- Access tokens for non-public targets: which purpose gets which, rotation, where they live.
- One lab instance doing both open-web R&D and staging verification under these hygiene rules (the intended start) vs two instances; split when a gate needs direct dev-zone reachability, or when the lab workload goes long-running.
- Steel session/timeout/concurrency knobs and observability endpoints (equivalents of `/pressure`, `/metrics`).
- Confirm image tag exists on first `docker compose pull` (fails fast, not silent).
