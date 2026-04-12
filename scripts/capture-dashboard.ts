import { chromium } from "playwright";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:5173";
const OUT_DIR = join(__dirname, "..", "screenshots");

const pages = [
  { name: "overview", hash: "/" },
  { name: "sessions", hash: "/sessions" },
  { name: "logs", hash: "/logs" },
  { name: "todos", hash: "/todos" },
  { name: "security", hash: "/security" },
  { name: "features", hash: "/features" },
  // knowledge-graph skipped — needs Brain running on :4242
];

async function capture() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2, // retina quality
  });

  for (const theme of ["dark", "light"] as const) {
    for (const page of pages) {
      const p = await context.newPage();
      await p.goto(`${BASE_URL}/#${page.hash}`, { waitUntil: "networkidle" });

      // Set theme
      await p.evaluate(
        (t) => document.documentElement.setAttribute("data-theme", t),
        theme
      );

      // Wait for theme transition + font load
      await p.waitForTimeout(500);

      const path = join(OUT_DIR, theme, `${page.name}.png`);
      await p.screenshot({ path, fullPage: false });
      console.log(`✓ ${theme}/${page.name}.png`);
      await p.close();
    }
  }

  await browser.close();
  console.log(`\nDone — ${pages.length * 2} screenshots in ${OUT_DIR}`);
}

capture().catch(console.error);
