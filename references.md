# References — every browser tool assessed, one verdict each

Read this before proposing a different tool: each entry holds the verdict and the reason, with upstream links. The live design stays in README.md; this file is the memory. Context for all of it: the agentic loop this pool serves is planner LLM → Jev-style decider → this browser executes; local decision models remove the paid decision API, this pool removes the local browser installs.

## Deployed: the pool

- **Steel self-host** ([steel-dev/steel-browser](https://github.com/steel-dev/steel-browser), Apache-2.0) — the server. CDP-compatible WebSocket any Playwright client can drive. Self-host wiring: [self-hosting guide](https://steel.dev/blog/self-hosting-steel-browser). Open: auth model, session/timeout knobs, observability, image-tag confirmation.

## Client layers: what drives the pool

- **Deterministic Playwright** ([microsoft/playwright](https://github.com/microsoft/playwright), Apache-2.0) — `playwright-core` client only, no browser download. Default for known-assertion gates: zero model latency, zero token cost.
- **Jev loop** (later) — planner LLM + ~300 ms typed decisions on DOM state for fast agentic flows. Blueprints: [jev-browser](https://github.com/Ying-Kai-Liao/jev-browser) (MCP tools, LLM plans, Jev decides, Playwright acts; 40/42 live tasks) and [jev-ego](https://github.com/romaluev/jev-ego) (same policy minus Playwright, warm-session numbers: observe 0.11 s, act 0.17–0.27 s). Reference policy: [jev-ultrafast](https://github.com/browser-use/jev-ultrafast). Project list (our fork): [awesome-jev](https://github.com/mihado/awesome-jev). Local decision models remove the paid API: [Laya](https://github.com/NandhaKishorM/laya) ([weights](https://huggingface.co/convaiinnovations/laya)) and [agent-jev](https://github.com/malevrigns/agent-jev) ([weights](https://huggingface.co/aimeigaoshou/agent-jev)), both Apache-2.0. Planner candidate: MiMo-V2.6-Flash ([weights](https://huggingface.co/XiaomiMiMo), MIT, $0.14/$0.28 per MTok) — endpoint compat still to verify at wire time.
- **midscene** (contender, [web-infra-dev/midscene](https://github.com/web-infra-dev/midscene), MIT) — vision-driven `aiAct`/`aiAssert` on an existing Playwright page: visual assertions and flows selectors can't reach (canvas, icon-only buttons, cross-origin iframes). Generative-VLM call per step, so slower and metered — scoped to where DOM fails. Published runs: AppControlBench 96.7%, 60 tasks for $0.59 on Doubao. Adopt after pricing one real gate run.

## Dev-machine complement (not the pool)

- **BrowserSkill** ([Tencent/BrowserSkill](https://github.com/Tencent/BrowserSkill), MIT) — drives your logged-in GUI browser from any shell-capable agent: separate Agent Window, tab borrowing with confirmation, human-in-loop for captchas and logins. For everything the headless pool structurally cannot do (SSO staging, personal accounts, captcha'd pages, look-at-what-I'm-seeing). Never a pool component: no login state, no human headless.

## Rejected

- **Browserless self-host** ([browserless/browserless](https://github.com/browserless/browserless)) — SSPL-1.0, verified in its LICENSE file. Unsafe for work use without a paid license.
- **HeadlessX** ([saifyxpro/HeadlessX](https://github.com/saifyxpro/HeadlessX)) — AGPL-3.0, and a scraping platform (dashboard + queue + Postgres + Redis), not a browser pipe: no raw-Playwright endpoint. Its Firefox engine (Camoufox) is being phased out for a Chrome fork in v2.5.
- **Stagehand** ([browserbase/stagehand](https://github.com/browserbase/stagehand)) — dropped entirely. API-compatible with Playwright and faster than cloud Playwright and naive agent loops, but every action is an LLM call: strictly slower than deterministic Playwright for gates. The Jev loop is the fast path for agentic browsing instead.
- **Raw `--remote-debugging-port` Chrome** — no auth, no sessions, Playwright's lower-fidelity CDP caveats. Fallback only.
- **Firefox day one** — deferred. Gates verify our own work; if that changes, Playwright's own Firefox build through the same pattern.

## Fallbacks, never evaluated

- **Gotenberg** ([gotenberg/gotenberg](https://github.com/gotenberg/gotenberg)) — stateless screenshot/PDF API. Only if interaction needs turn out to be load-assert-screenshot and nothing more.
