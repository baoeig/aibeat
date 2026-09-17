import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer";

const base = process.env.VISUAL_QA_BASE_URL ?? "http://127.0.0.1:39002";
const repo = path.resolve(process.cwd(), "..");
const evidence = path.join(repo, "docs/website-refresh/evidence/download-loop");
const temporary = process.env.TMPDIR;
if (!temporary || path.resolve(temporary).startsWith("/tmp") || path.resolve(temporary).startsWith("/root")) {
  throw new Error("Set TMPDIR to a workspace-owned temporary directory before this browser test");
}
const scratch = fs.mkdtempSync(path.join(temporary, "aibeat-onboarding-"));
const shots = path.join(evidence, "screenshots");
fs.mkdirSync(shots, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const expectedSkills = fs.readFileSync("downloads/aibeat-skill.zip");
const releases = JSON.parse(fs.readFileSync(path.join(evidence, "release-assets.json"), "utf8"));
const assets = releases.find((release) => release.tag_name === "v0.2").assets;
const linux = assets.find((asset) => asset.name === "promptbeat-0.2-linux-x64.tar.gz");
const agentAssets = fs.readFileSync("downloads/agentbeat-eval-preview.sha256", "utf8").trim().split("\n").map((line) => {
  const match = line.match(/^([a-f0-9]{64})  (agentbeat-[a-zA-Z0-9.-]+)$/);
  assert.ok(match, "Malformed AgentBeat checksum entry");
  return { name: match[2], sha256: match[1] };
});
assert.equal(agentAssets.length, 4);
const agentLinux = agentAssets.find((asset) => asset.name.endsWith("-linux-x64.tar.gz"));
const report = { base, scope: "real Chrome navigation/downloads; AgentBeat packaged CLI with fixed localhost stubs in isolated network namespace; NOT real Agent/model-provider E2E or public availability", pages: [], downloads: [], guideChecks: [], failures: [] };
const browser = await puppeteer.launch({ headless: true, userDataDir: path.join(scratch, "chrome-profile"), args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"] });
const cdp = await browser.target().createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: scratch, eventsEnabled: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clickDownload(page, selector, expectedName, expectedDigest) {
  let guid;
  let timer;
  let begun;
  let progressed;
  const complete = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Download timeout: ${expectedName}`)), 120000);
    begun = (event) => {
      // Do not persist signed redirect URLs from GitHub's asset host.
      if (event.suggestedFilename === expectedName) guid = event.guid;
    };
    progressed = (event) => {
      if (event.guid !== guid) return;
      if (event.state === "completed") resolve(event.receivedBytes);
      if (event.state === "canceled") reject(new Error(`Download canceled: ${expectedName}`));
    };
    cdp.on("Browser.downloadWillBegin", begun);
    cdp.on("Browser.downloadProgress", progressed);
  });
  complete.catch(() => {});
  try {
    const link = await page.$(selector);
    assert.ok(link, `Missing download link: ${selector}`);
    const hiddenProduct = await link.evaluate((node) => node.closest('.aibeat-home-platform-menu[hidden]')?.parentElement.dataset.product);
    if (hiddenProduct) {
      const trigger = await page.$(`.aibeat-home-platform-selector[data-product="${hiddenProduct}"] button`);
      await trigger.evaluate((node) => { node.scrollIntoView({ block: "center", behavior: "instant" }); node.focus({ preventScroll: true }); });
      if (await trigger.evaluate((node) => node.getAttribute("aria-expanded") !== "true")) await page.keyboard.press("Enter");
      assert.equal(await trigger.evaluate((node) => node.getAttribute("aria-expanded")), "true");
    }
    // Mintlify Cards wrap their visible title in an aria-hidden display:contents
    // anchor (zero box). Click the visible title with Chrome's real pointer.
    const isContents = await link.evaluate((node) => getComputedStyle(node).display === "contents");
    const target = isContents ? await link.$('[data-component-part="card-title"]') : link;
    assert.ok(target, `Missing visible download target: ${selector}`);
    // Fixed navigation can cover a link that Chrome considers in-viewport.
    // Center it and verify the real pointer hit, rather than clicking through JS.
    await target.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
    await wait(100);
    assert.ok(await target.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit && (node.contains(hit) || hit.contains(node));
    }), `Download is covered by another element: ${selector}`);
    await target.click();
    const received = await complete;
    const file = path.join(scratch, guid);
    const bytes = fs.readFileSync(file);
    assert.equal(digest(bytes), expectedDigest);
    report.downloads.push({ page: new URL(page.url()).pathname, filename: expectedName, received, sha256: digest(bytes), matchesSource: true });
    return file;
  } finally {
    clearTimeout(timer);
    cdp.off("Browser.downloadWillBegin", begun);
    cdp.off("Browser.downloadProgress", progressed);
  }
}

async function open(page, route, theme) {
  const response = await page.goto(base + route, { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200, `HTTP ${response.status()} at ${route}`);
  await wait(400);
  const currentlyDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (currentlyDark !== (theme === "dark")) {
    const custom = await page.$(".aibeat-home-theme-toggle");
    if (custom) await custom.click();
    else await page.$eval(`button[aria-label="Switch to ${theme} theme"], button[aria-label="切换到${theme}主题"]`, (button) => button.click());
  }
  await page.waitForFunction((selectedTheme) => document.documentElement.classList.contains("dark") === (selectedTheme === "dark"), {}, theme);
  await wait(400);
}

try {
  for (const language of ["en", "cn"]) {
    const prefix = language === "en" ? "" : "/cn";
    for (const width of [390, 1440]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }]);
        await open(page, prefix || "/", theme);
        const key = `${language}-${width}-${theme}`;
        const details = await page.evaluate(() => {
          const visible = (node) => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== "hidden";
          const links = [...document.querySelectorAll(".aibeat-home a")].filter(visible);
          const narrow = links.filter((node) => node.getBoundingClientRect().height < 43.5).map((node) => node.textContent.trim());
          const clipped = [...document.querySelectorAll(".aibeat-home a, .aibeat-home p, .aibeat-home h1, .aibeat-home h2, .aibeat-home h3, .aibeat-home ol")].filter(visible).filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left < -1 || rect.right > innerWidth + 1;
          }).map((node) => node.tagName + ":" + node.textContent.slice(0, 60));
          return { width: innerWidth, theme: document.documentElement.classList.contains("dark") ? "dark" : "light", narrow, clipped, sections: [...document.querySelectorAll(".aibeat-home > section")].map((node) => node.getAttribute("aria-labelledby")), downloads: [...document.querySelectorAll(".aibeat-home-os-btn")].map((node) => node.href), height: document.documentElement.scrollHeight };
        });
        assert.equal(details.theme, theme);
        assert.equal(details.width, width);
        assert.deepEqual(details.sections, [
          "aibeat-home-title", "skills-faststart-title", "seeds-community-title",
        ]);
        assert.deepEqual(details.narrow, [], "Every homepage link needs a 44px target");
        assert.deepEqual(details.clipped, [], "No clipped homepage copy or links");
        assert.deepEqual(details.downloads.sort(), assets.map((asset) => asset.browser_download_url).sort());
        await page.click(`.aibeat-home-download-meta a[href="${prefix}/promptbeat/quickstart"]`);
        await page.waitForFunction((suffix) => location.pathname.endsWith(suffix), {}, `${prefix}/promptbeat/quickstart`);
        await wait(500);
        const guideDownloads = await page.$$eval('a[href*="/releases/download/v0.2/"]', (nodes) => nodes.map((node) => node.href));
        assert.deepEqual(guideDownloads.sort(), assets.map((asset) => asset.browser_download_url).sort());
        await open(page, prefix || "/", theme);
        await page.screenshot({ path: path.join(shots, `home-${key}.png`) });
        await page.keyboard.press("Tab");
        const focused = await page.evaluate(() => {
          const node = document.activeElement;
          const style = getComputedStyle(node);
          return { tag: node.tagName, outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
        });
        assert.notEqual(focused.tag, "BODY");
        assert.notEqual(focused.outline, "none");
        assert.ok(focused.outlineWidth > 0);
        for (const [name, selector] of [["downloads", ".aibeat-home-products-grid"], ["skills", ".aibeat-home-skills-overview"]]) {
          const section = await page.$(selector);
          await section.evaluate((node) => window.scrollTo({ top: node.getBoundingClientRect().top + scrollY - 132, behavior: "instant" }));
          await wait(150);
          if (width === 390) {
            await page.screenshot({ path: path.join(shots, `${name}-${key}.png`) });
            const last = await page.$(`${selector} > :last-child`);
            await last.evaluate((node) => window.scrollTo({ top: node.getBoundingClientRect().top + scrollY - 132, behavior: "instant" }));
            await wait(100);
            await page.screenshot({ path: path.join(shots, `${name}-details-${key}.png`) });
          } else {
            await section.screenshot({ path: path.join(shots, `${name}-${key}.png`) });
          }
        }
        const zip = await clickDownload(page, '.aibeat-home-skills-overview a[href="/downloads/aibeat-skill.zip"]', "aibeat-skill.zip", digest(expectedSkills));
        const check = spawnSync("unzip", ["-t", zip], { encoding: "utf8" });
        assert.equal(check.status, 0, check.stdout + check.stderr);
        if (language === "en" && width === 1440 && theme === "light") {
          const extract = path.join(scratch, "skills-extracted");
          const unpack = spawnSync("unzip", ["-q", zip, "-d", extract]);
          assert.equal(unpack.status, 0);
          for (const destination of [".claude/skills", ".agents/skills"]) {
            const target = path.join(scratch, "example-project", destination, "promptbeat-run-quick-eval");
            fs.cpSync(path.join(extract, "aibeat-skill/promptbeat-run-quick-eval"), target, { recursive: true, errorOnExist: true, force: false });
            for (const relative of ["SKILL.md", "references/cli-recipes.md"]) {
              assert.deepEqual(fs.readFileSync(path.join(target, relative)), fs.readFileSync(path.join(repo, "promptbeat-skills/promptbeat-run-quick-eval", relative)));
            }
          }
          report.guideChecks.push("Real downloaded ZIP extracted; complete quick-eval Skill copied intact to both documented project layouts. Runtime auto-discovery not exercised.");
          // Separate check for legacy promptbeat-skills.zip compatibility:
          const legacyZipBytes = fs.readFileSync("downloads/promptbeat-skills.zip");
          const legacyZipPath = path.join(scratch, "legacy-promptbeat-skills.zip");
          fs.writeFileSync(legacyZipPath, legacyZipBytes);
          const legacyExtract = path.join(scratch, "legacy-extracted");
          const legacyUnpack = spawnSync("unzip", ["-q", legacyZipPath, "-d", legacyExtract]);
          assert.equal(legacyUnpack.status, 0);
          assert.deepEqual(
            fs.readFileSync(path.join(legacyExtract, "promptbeat-skills/promptbeat-run-quick-eval/SKILL.md")),
            fs.readFileSync(path.join(repo, "promptbeat-skills/promptbeat-run-quick-eval/SKILL.md"))
          );
          report.guideChecks.push("Legacy archive promptbeat-skills.zip compatibility verified: old internal root promptbeat-skills/ and leaf SKILL.md intact.");
          await clickDownload(page, `.aibeat-home-os-btn[href="${linux.browser_download_url}"]`, linux.name, linux.digest.replace("sha256:", ""));
        }
        await page.click(`.aibeat-home-skills-overview a[href="${prefix}/promptbeat/skills"]`);
        await page.waitForFunction((suffix) => location.pathname.endsWith(suffix), {}, `${prefix}/promptbeat/skills`);
        await page.waitForSelector('a[href="/downloads/aibeat-skill.zip"]', { timeout: 10000 });
        assert.ok(await page.$('a[href="/downloads/promptbeat-skills.zip"]'));
        await open(page, `${prefix}/promptbeat/quickstart`, theme);
        const windowsTabs = await page.$$('[role="tab"]');
        let selected = false;
        for (const tab of windowsTabs) {
          if ((await tab.evaluate((node) => node.textContent)).includes("Windows PowerShell")) {
            await tab.click(); selected = true; break;
          }
        }
        assert.ok(selected, "Windows extraction instructions must be selectable");
        await wait(200);
        assert.ok(await page.evaluate(() => [...document.querySelectorAll("pre")].some((node) => node.getBoundingClientRect().height > 0 && node.textContent.includes("Expand-Archive") && node.textContent.includes("promptbeat-unpacked"))));
        await open(page, `${prefix}/agentbeat/quickstart`, theme);
        const agentText = await page.$eval("body", (node) => node.innerText);
        assert.ok(agentText.includes("v0.3-agentbeat-preview.1"));
        assert.ok(agentText.includes(language === "en" ? "website-built preview" : "站点预览包"));
        assert.ok(agentText.includes("Promptfoo") && agentText.includes("official_benchmark"));
        const agentLinks = await page.$$eval('a[href^="/downloads/agentbeat-"]', (nodes) => nodes.map((node) => node.getAttribute("href")));
        assert.deepEqual(agentLinks.sort(), [...agentAssets.map((asset) => `/downloads/${asset.name}`), "/downloads/agentbeat-eval-preview.sha256"].sort());
        if (width === 1440 && theme === "light") {
          const downloaded = await clickDownload(page, `a[href="/downloads/${agentLinux.name}"]`, agentLinux.name, agentLinux.sha256);
          if (language === "en") {
            const protocol = spawnSync(process.env.PYTHON ?? "python3", [path.join(repo, "scripts/check-agentbeat-eval-preview.py"), "--archive", downloaded, "--evidence", path.join(evidence, "agentbeat-preview-protocol")], { encoding: "utf8", timeout: 90000 });
            assert.equal(protocol.status, 0, protocol.stdout + protocol.stderr);
            report.guideChecks.push("Chrome-downloaded Linux AgentBeat archive extracted and its eval-run command exercised in fresh loopback-only namespace with credential-free environment and fixed Target/Judge stubs. Not real model/Agent E2E.");
          }
          await clickDownload(page, 'a[href="/downloads/agentbeat-eval-preview.sha256"]', "agentbeat-eval-preview.sha256", digest(fs.readFileSync("downloads/agentbeat-eval-preview.sha256")));
        }
        assert.deepEqual(errors, []);
        report.pages.push({ key, ...details, focus: focused, errors, guideNavigation: "passed", windowsTab: "passed", agentbeatReleaseNotice: "visible" });
        await page.close();
      }
    }
  }
} catch (error) {
  report.failures.push(error.message);
  report.failureStack = error.stack;
  const pages = await browser.pages();
  const failedPage = pages.at(-1);
  report.failureRoute = new URL(failedPage.url()).pathname;
  await failedPage.screenshot({ path: path.join(shots, "onboarding-failure.png") });
} finally {
  await browser.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.writeFileSync(path.join(evidence, "browser-onboarding.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ pages: report.pages.length, downloads: report.downloads.length, failures: report.failures }, null, 2));
if (report.failures.length || report.pages.length !== 8) process.exit(1);
