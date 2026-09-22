# base-browser

One warm Chromium pool for the dev network. Every project and worktree requests browsers here instead of installing headless Chrome locally — verifier gates get a browser with zero local setup.

Status: **WIP design.** Decisions below are recorded; the service is not yet deployed. Open questions are marked `TBD`. Tools assessed along the way — adopted, contenders, rejected with reasons — live in references.md; read it before proposing a different one.

## Decisions

- **Engine: Chromium, Playwright-driven.** Firefox deferred — gates verify our own work, where a second engine buys nothing. (If that changes, Playwright's own Firefox build through this same pattern, not a second platform.)
- **Server: [Steel self-host](https://github.com/steel-dev/steel-browser)** (`ghcr.io/steel-dev/steel-browser-api`), Apache-2.0. CDP-compatible WebSocket; any Playwright/puppeteer-core client.
- **Topology: one dedicated, always-on VM on the private network.** 8 vCPU, 16 GB RAM, thin disk (stateless), static IP, start-at-boot, no ballooning. The gate must never share fate with a workstation or a box that powers down. It shares its host with the execution plane and initiates outbound HTTPS to tested URLs only.
- **Clients: [`playwright-core`](https://github.com/microsoft/playwright) only** — protocol client, never `playwright install`. Endpoint from env, one context per run, `close()` in a `finally`, backoff on 429/503.

## Sizing

20 concurrent sessions ≈ 6–10 GB RAM — headroom is ample on this host. `CONCURRENT`-style depth plus a deep queue absorbs the thundering herd (N worktrees verifying at once); clients treat 429/503 as retry-with-backoff, never as gate failure. `TIMEOUT` kills leaked sessions; `finally`-close is the plan, timeout the backstop.

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

## Worktree routing (Traefik)

Verifiers reach worktrees through per-host Traefik, never directly. Each dev server stays on `127.0.0.1`; Traefik terminates TLS at the network edge and proxies to loopback. Certs (public wildcard via DNS-01) and wildcard DNS are solved outside this repo — assumed present.

- **One file per worktree** in Traefik's watched directory (`/routes/<slug>.yml`), write-temp-then-rename, deleted on teardown. Never a shared file — no merge conflicts by construction.
- **Names derive from worktree identity**, sanitized to `[a-z0-9-]`. Router, service, and hostname all come from the same slug, so the verifier reconstructs `https://<slug>.dev.<domain>` with zero discovery.
- **The file is the port record** — whatever loopback port the dev server took goes in the service URL; nothing else needs to know it.

```yaml
http:
  routers:
    wt-feature-x:
      rule: "Host(`feature-x.dev.example.com`)"
      service: wt-feature-x
      entryPoints: [websecure]
      tls: {} # wildcard cert is the default
  services:
    wt-feature-x:
      loadBalancer:
        servers: [{ url: "http://127.0.0.1:5173" }]
```

Rules that keep 20 worktrees honest:

1. **Stale files lie.** A worktree that dies without cleanup leaves a route to a dead backend. Teardown hook deletes the file; a reaper (route files vs. live worktrees, on a timer) is the backstop.
2. **502 is infra, 500 is product.** The verifier pre-checks the URL and says "route missing?" on connection failure — a red gate must never mean a stale route.
3. **Allowed-hosts follows the hostname.** Traefik forwards the public name to loopback, so frameworks still need it in `allowedHosts`; binding localhost exempts nothing here.

## Client layers

The pool serves browsers; what drives them stratifies by need, fastest first:

1. **Deterministic Playwright** (`playwright-core`, `examples/verify.mjs`) — known-assertion gates. Zero model latency, zero token cost. Default choice.
2. **Jev loop** (later, [jev-browser](https://github.com/Ying-Kai-Liao/jev-browser) blueprint) — planner LLM + ~300 ms typed decisions on DOM state for fast agentic flows. A local decision model removes the paid API.
3. **[midscene](https://github.com/web-infra-dev/midscene)** (contender, MIT) — vision-driven actions and assertions on the same page, scoped to where DOM fails. Assessment in references.md.

## Open questions (TBD)

- Steel self-host auth model — the upstream compose shows no token; confirm before exposing beyond the private network (network scoping is the auth until then).
- Steel session/timeout/concurrency knobs and observability endpoints (equivalents of `/pressure`, `/metrics`).
- Confirm image tag exists on first `docker compose pull` (fails fast, not silent).
