import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const base = process.env.VISUAL_QA_BASE_URL ?? "http://127.0.0.1:39002";
const evidenceDir = path.resolve(process.cwd(), "..", "docs", "website-refresh", "evidence");
const outDir = path.resolve(process.env.VISUAL_QA_OUT_DIR ?? path.join(evidenceDir, "screenshots"));
const reportPath = path.resolve(process.env.VISUAL_QA_REPORT ?? path.join(evidenceDir, "visual-qa.json"));
fs.mkdirSync(outDir, { recursive: true });
const routes = [
  ["home-en", "/"],
  ["home-cn", "/cn"],
  ["compare-en", "/about/promptbeat-vs-agentbeat"],
  ["compare-cn", "/cn/about/promptbeat-vs-agentbeat"],
  ["promptbeat-overview-en", "/promptbeat/overview"],
  ["promptbeat-overview-cn", "/cn/promptbeat/overview"],
  ["agentbeat-overview-en", "/agentbeat/overview"],
  ["agentbeat-overview-cn", "/cn/agentbeat/overview"],
  ["promptbeat-quickstart-en", "/promptbeat/quickstart"],
  ["promptbeat-quickstart-cn", "/cn/promptbeat/quickstart"],
  ["promptbeat-skills-en", "/promptbeat/skills"],
  ["promptbeat-skills-cn", "/cn/promptbeat/skills"],
  ["agentbeat-quickstart-en", "/agentbeat/quickstart"],
  ["agentbeat-quickstart-cn", "/cn/agentbeat/quickstart"],
  ["agentbeat-sdk-en", "/agentbeat/sdk-integration"],
  ["agentbeat-sdk-cn", "/cn/agentbeat/sdk-integration"],
  ["agentbeat-evidence-en", "/agentbeat/evidence"],
  ["agentbeat-evidence-cn", "/cn/agentbeat/evidence"],
];
const viewports = [
  ["mobile", { width: 390, height: 844, deviceScaleFactor: 1 }, "light"],
  ["desktop", { width: 1440, height: 900, deviceScaleFactor: 1 }, "dark"],
];

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const results = [];
try {
  for (const [viewportName, viewport, colorScheme] of viewports) {
    for (const [name, route] of routes) {
      const page = await browser.newPage();
      await page.setCacheEnabled(false);
      await page.setViewport(viewport);
      await page.emulateMediaFeatures([
        { name: "prefers-reduced-motion", value: "reduce" },
        { name: "prefers-color-scheme", value: colorScheme },
      ]);
      await page.evaluateOnNewDocument((theme) => {
        localStorage.setItem('theme', theme);
        localStorage.setItem('isDarkMode', String(theme === 'dark'));
      }, colorScheme);
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      const response = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (await page.$('.aibeat-home')) await page.waitForSelector('.aibeat-home[data-downloads-ready="true"]');
      if (await page.evaluate(() => document.documentElement.classList.contains('dark')) !== (colorScheme === 'dark')) {
        const custom = await page.$('.aibeat-home-theme-toggle');
        if (custom) await custom.click();
        else await page.$eval(`button[aria-label="Switch to ${colorScheme} theme"], button[aria-label="切换到${colorScheme}主题"]`, button => button.click());
      }
      await page.waitForFunction(theme => document.documentElement.classList.contains('dark') === (theme === 'dark'), {}, colorScheme);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const responseBody = await response?.text();
      const ssrLang = responseBody?.match(/<html[^>]*\slang=["']([^"']+)["']/i)?.[1] ?? null;
      const audit = await page.evaluate(() => {
        const body = document.body;
        const root = document.documentElement;
        const h1 = [...document.querySelectorAll("h1")];
        const imagesMissingAlt = [...document.querySelectorAll("img")]
          .filter((image) => !image.hasAttribute("alt") && image.getAttribute("role") !== "presentation")
          .map((image) => image.getAttribute("src"));
        const namelessLinks = [...document.querySelectorAll("a[href]")]
          .filter((link) => !(link.textContent ?? "").trim() && !link.getAttribute("aria-label") && !link.querySelector("img[alt]"))
          .map((link) => link.getAttribute("href"));
        const namelessButtons = [...document.querySelectorAll("button")]
          .filter((button) => !(button.textContent ?? "").trim() && !button.getAttribute("aria-label") && !button.getAttribute("title"))
          .map((button) => button.outerHTML.slice(0, 160));
        const panel = document.querySelector(".aibeat-home-product, .aibeat-product-panel");
        const grid = document.querySelector(".aibeat-home-products-grid, .aibeat-product-grid");
        const spotlight = document.querySelector(".aibeat-home-spotlight");
        const layoutElement = grid ?? spotlight;
        const cta = document.querySelector(".aibeat-home-button, .aibeat-product-cta a");
        const panelStyle = panel ? getComputedStyle(panel) : null;
        const gridStyle = layoutElement ? getComputedStyle(layoutElement) : null;
        const ctaStyle = cta ? getComputedStyle(cta) : null;
        const colorCanvas = document.createElement("canvas");
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
        const parseColor = (color) => {
          colorContext.clearRect(0, 0, 1, 1);
          colorContext.fillStyle = color;
          colorContext.fillRect(0, 0, 1, 1);
          const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
          return [red, green, blue, alpha / 255];
        };
        const composite = (foreground, background) => {
          const alpha = foreground[3] + background[3] * (1 - foreground[3]);
          if (alpha === 0) return [0, 0, 0, 0];
          return [
            (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
            (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
            (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
            alpha,
          ];
        };
        const luminance = (channels) => {
          const linear = channels.slice(0, 3).map((value) => {
            const channel = value / 255;
            return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const effectiveBackground = (node) => {
          const layers = [];
          let current = node;
          while (current) {
            layers.push(parseColor(getComputedStyle(current).backgroundColor));
            current = current.parentElement;
          }
          return layers.reverse().reduce((background, layer) => composite(layer, background), [255, 255, 255, 1]);
        };
        const contrast = (foreground, background) => {
          const opaqueForeground = composite(parseColor(foreground), background);
          const foregroundLuminance = luminance(opaqueForeground);
          const backgroundLuminance = luminance(background);
          const high = Math.max(foregroundLuminance, backgroundLuminance);
          const low = Math.min(foregroundLuminance, backgroundLuminance);
          return (high + 0.05) / (low + 0.05);
        };
        const cardContrasts = [...document.querySelectorAll(".card")].flatMap((card) =>
          [...card.querySelectorAll('[data-component-part="card-title"], [data-component-part="card-content"]')]
            .map((node) => contrast(getComputedStyle(node).color, effectiveBackground(node)))
            .filter((value) => value !== null),
        );
        const homeContrastDetails = [...document.querySelectorAll(
          ".aibeat-home h1, .aibeat-home h2, .aibeat-home h3, .aibeat-home p, .aibeat-home li, .aibeat-home a, .aibeat-home strong, .aibeat-home small, .aibeat-home code, .aibeat-home span",
        )]
          .filter((node) => {
            const style = getComputedStyle(node);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              node.getAttribute("aria-hidden") !== "true" &&
              (node.textContent ?? "").trim().length > 0 &&
              node.getBoundingClientRect().width > 0
            );
          })
          .map((node) => ({ contrast: contrast(getComputedStyle(node).color, effectiveBackground(node)), selector: node.tagName + '.' + node.className, text: node.textContent.trim().slice(0, 100), color: getComputedStyle(node).color, background: effectiveBackground(node) }));
        const homeContrasts = homeContrastDetails.map(node => node.contrast);
        return {
          homeContrastFailures: homeContrastDetails.filter(node => node.contrast < 4.5),
          title: document.title,
          lang: root.lang,
          renderedColorScheme: root.classList.contains("dark") ? "dark" : "light",
          h1Count: h1.length,
          h1Text: h1.map((node) => node.textContent?.trim()),
          bodyScrollWidth: body.scrollWidth,
          rootScrollWidth: root.scrollWidth,
          viewportWidth: root.clientWidth,
          horizontalOverflow: Math.max(body.scrollWidth, root.scrollWidth) > root.clientWidth + 1,
          imagesMissingAlt,
          namelessLinks,
          namelessButtons,
          productGridColumns: gridStyle?.gridTemplateColumns ?? null,
          productPanelTransition: panelStyle?.transitionDuration ?? null,
          productCtaMinHeight: ctaStyle?.minHeight ?? null,
          cardContrastMin: cardContrasts.length ? Math.min(...cardContrasts) : null,
          homeContrastMin: homeContrasts.length ? Math.min(...homeContrasts) : null,
          tableCount: document.querySelectorAll("table").length,
          codeBlockCount: document.querySelectorAll("pre").length,
        };
      });
      const screenshot = path.join(outDir, `${name}-${viewportName}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      results.push({
        route,
        name,
        viewport: viewportName,
        status: response?.status() ?? null,
        consoleErrors,
        colorScheme,
        ssrLang,
        screenshot: path.relative(path.resolve(process.cwd(), ".."), screenshot),
        ...audit,
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const failures = results.flatMap((result) => {
  const messages = [];
  if (result.status !== 200) messages.push(`HTTP ${result.status}`);
  const expectedLang = result.route === "/cn" || result.route.startsWith("/cn/") ? "zh-Hans" : "en";
  if (result.lang !== expectedLang) messages.push(`html lang ${result.lang}, expected ${expectedLang}`);
  if (result.renderedColorScheme !== result.colorScheme) {
    messages.push(`rendered theme ${result.renderedColorScheme}, expected ${result.colorScheme}`);
  }
  if (result.h1Count !== 1) messages.push(`H1 count ${result.h1Count}`);
  if (result.horizontalOverflow) messages.push(`horizontal overflow ${result.rootScrollWidth}/${result.viewportWidth}`);
  if (result.imagesMissingAlt.length) messages.push(`images without alt: ${result.imagesMissingAlt.join(", ")}`);
  if (result.namelessLinks.length) messages.push(`links without name: ${result.namelessLinks.join(", ")}`);
  if (result.namelessButtons.length) messages.push(`buttons without name: ${result.namelessButtons.length}`);
  if (result.consoleErrors.length) messages.push(`console errors: ${result.consoleErrors.join(" | ")}`);
  if (result.cardContrastMin !== null && result.cardContrastMin < 4.5) {
    messages.push(`Card text contrast below 4.5:1 (${result.cardContrastMin.toFixed(2)}:1)`);
  }
  if (result.homeContrastMin !== null && result.homeContrastMin < 4.5) {
    messages.push(`Homepage text contrast below 4.5:1 (${result.homeContrastMin.toFixed(2)}:1)`);
  }
  if (result.name.startsWith("home-") && result.viewport === "mobile" && result.productGridColumns?.split(" ").length !== 1) {
    messages.push(`mobile product grid is not one column: ${result.productGridColumns}`);
  }
  if (result.name.startsWith("home-") && result.viewport === "desktop" && result.productGridColumns?.split(" ").length !== 2) {
    messages.push(`desktop product grid is not two columns: ${result.productGridColumns}`);
  }
  if (result.name.startsWith("home-") && result.productPanelTransition && !result.productPanelTransition.includes("1e-05")) {
    messages.push(`reduced-motion transition not suppressed: ${result.productPanelTransition}`);
  }
  return messages.map((message) => ({ route: result.route, viewport: result.viewport, message }));
});
const warnings = results
  .filter((result) => (result.route === "/cn" || result.route.startsWith("/cn/")) && result.ssrLang !== "zh-Hans")
  .map((result) => ({
    route: result.route,
    viewport: result.viewport,
    message: `raw SSR html lang is ${result.ssrLang ?? "missing"}; runtime normalizes it to ${result.lang}`,
  }));
const report = {
  generatedAt: new Date().toISOString(),
  base,
  routes: routes.length,
  screenshots: results.length,
  failures,
  warnings,
  results,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ routes: routes.length, screenshots: results.length, failures: failures.length, warnings: warnings.length }, null, 2));
for (const failure of failures) console.log(`FAIL ${failure.viewport} ${failure.route}: ${failure.message}`);
if (failures.length) process.exit(1);
