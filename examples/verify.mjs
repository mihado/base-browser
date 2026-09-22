// Minimal verifier client: playwright-core only, no browser download.
//   BROWSER_WS_URL=ws://<host>:3000 node examples/verify.mjs <url>
import { chromium } from "playwright-core";

const [url] = process.argv.slice(2);
if (!url) {
  console.error("usage: node examples/verify.mjs <url>");
  process.exit(2);
}

const browser = await chromium.connectOverCDP(process.env.BROWSER_WS_URL);
const context = await browser.newContext();
try {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(await page.title());
} finally {
  await browser.close();
}
