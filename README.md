# base-browser

One warm Chromium pool for the dev network. Every project and worktree
requests browsers here instead of installing headless Chrome locally —
verifier gates get a browser with zero local setup.

Status: **WIP design.** Decisions below are recorded; the service is not yet
deployed. Open questions are marked `TBD`.

## Decisions

- **Engine: Chromium, Playwright-driven.** Firefox deferred — gates verify our
  own work, where a second engine buys nothing. (If that changes, Playwright's
  own Firefox build through this same pattern, not a second platform.)
- **Server: Steel self-host** (`ghcr.io/steel-dev/steel-browser-api`),
  Apache-2.0. CDP-compatible WebSocket; any Playwright/puppeteer-core client.
- **Topology: one VM on the Xeon Proxmox host, dev VLAN.** 8 vCPU, 16 GB RAM,
  thin disk (stateless), static IP, start-at-boot, no ballooning. The gate
  must never share fate with a workstation or a box that powers down.
- **Clients: `playwright-core` only** — protocol client, never
  `playwright install`. Endpoint from env, one context per run,
  `close()` in a `finally`, backoff on 429/503.

## Rejected, with reasons

| Option | Verdict |
| --- | --- |
| Browserless self-host | **SSPL-1.0** (verified in LICENSE file) — unsafe for work use without a paid license |
| HeadlessX | **AGPL-3.0**, and it's a scraping *platform* (dashboard + queue + Postgres + Redis), not a browser pipe — no raw-Playwright endpoint. Its Firefox engine (Camoufox) is being phased out for a Chrome fork in v2.5 anyway |
| Raw `--remote-debugging-port` Chrome | No auth, no sessions, Playwright's lower-fidelity CDP caveats. Fallback only |
| Stagehand | Dropped entirely: an LLM call per action. Deterministic Playwright for gates; the jev loop (typed decisions, no text generation) for agentic browsing |
| Firefox day one | Deferred, see above |

## Sizing

20 concurrent sessions ≈ 6–10 GB RAM — headroom is ample on this host.
`CONCURRENT`-style depth plus a deep queue absorbs the thundering herd (N
worktrees verifying at once); clients treat 429/503 as retry-with-backoff,
never as gate failure. `TIMEOUT` kills leaked sessions; `finally`-close is
the plan, timeout the backstop.

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

Verifiers reach worktrees through per-host Traefik, never directly. Each dev
server stays on `127.0.0.1`; Traefik terminates TLS at the VLAN edge and
proxies to loopback. Certs (public wildcard via DNS-01) and wildcard DNS
(Unifi) are solved outside this repo — assumed present.

- **One file per worktree** in Traefik's watched directory
  (`/routes/<slug>.yml`), write-temp-then-rename, deleted on teardown.
  Never a shared file — no merge conflicts by construction.
- **Names derive from worktree identity**, sanitized to `[a-z0-9-]`.
  Router, service, and hostname all come from the same slug, so the verifier
  reconstructs `https://<slug>.dev.<domain>` with zero discovery.
- **The file is the port record** — whatever loopback port the dev server
  took goes in the service URL; nothing else needs to know it.

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

1. **Stale files lie.** A worktree that dies without cleanup leaves a route to
   a dead backend. Teardown hook deletes the file; a reaper (route files vs.
   live worktrees, on a timer) is the backstop.
2. **502 is infra, 500 is product.** The verifier pre-checks the URL and says
   "route missing?" on connection failure — a red gate must never mean a
   stale route.
3. **Allowed-hosts follows the hostname.** Traefik forwards the public name
   to loopback, so frameworks still need it in `allowedHosts`; binding
   localhost exempts nothing here.

## Client layers

The pool serves browsers; what drives them stratifies by need, fastest first:

1. **Deterministic Playwright** (`playwright-core`, `examples/verify.mjs`) —
   known-assertion gates. Zero model latency, zero token cost. Default choice.
2. **jev loop** (later) — planner LLM + ~300 ms typed decisions on DOM state
   for fast agentic flows. A local decision model removes the paid API.
3. **Midscene** (contender, MIT) — vision-driven `aiAct`/`aiAssert` on an
   *existing* Playwright page, for visual assertions and flows selectors
   can't reach (canvas, icon-only buttons, cross-origin iframes). It's a
   generative-VLM call per step, so slower and metered: scoped to where DOM
   fails, not a replacement for layer 1. Model TBD — mimo-compat to verify
   at wire time; price one real gate run before adopting.

## Open questions (TBD)

- Steel self-host auth model — the upstream compose shows no token; confirm
  before exposing beyond the dev VLAN (VLAN scoping is the auth until then).
- Steel session/timeout/concurrency knobs and observability endpoints
  (equivalents of `/pressure`, `/metrics`).
- Confirm image tag exists on first `docker compose pull` (fails fast, not silent).

## Related

- The agentic loop this serves: planner LLM (e.g. MiMo) plans, a Jev-style
  decision model picks operation + target in one ~300 ms request, this
  browser executes. See `jev-browser` (MCP blueprint) and `jev-ego`
  (warm-session latency numbers) in awesome-jev.
- Local Jev replacement work (Laya) removes the paid decision API from that
  loop; this repo removes the local browser installs.
