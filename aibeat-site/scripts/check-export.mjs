import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const zipPath = path.resolve(root, process.argv[2] ?? ".build/aibeat-site.zip");
const config = JSON.parse(fs.readFileSync(path.join(root, "docs.json"), "utf8"));
const failures = [];

const unzip = (...args) => {
  const result = spawnSync("unzip", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`unzip ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
};

if (!fs.existsSync(zipPath)) {
  console.error(`Missing Mintlify export: ${zipPath}`);
  process.exit(1);
}

const routes = config.navigation.languages.flatMap((language) =>
  language.groups.flatMap((group) => group.pages),
);
const entries = new Set(unzip("-Z1", zipPath).split("\n").filter(Boolean));
const readEntry = (entry) => unzip("-p", zipPath, entry);

if (routes.length !== 44) failures.push(`expected 44 published routes, got ${routes.length}`);
if (!entries.has("localization.js")) failures.push("export is missing auto-discovered localization.js");

const downloadableAssets = [
  "downloads/aibeat-skill.zip",
  "downloads/aibeat-skill.zip.sha256",
  "downloads/promptbeat-skills.zip",
  "downloads/promptbeat-skills.zip.sha256",
  "downloads/agentbeat-0.2-eval-preview.1-linux-x64.tar.gz",
  "downloads/agentbeat-0.2-eval-preview.1-darwin-arm64.tar.gz",
  "downloads/agentbeat-0.2-eval-preview.1-darwin-x64.tar.gz",
  "downloads/agentbeat-0.2-eval-preview.1-windows-x64.zip",
  "downloads/agentbeat-eval-preview.sha256",
];
for (const asset of downloadableAssets) {
  if (!entries.has(asset)) {
    failures.push(`export is missing downloadable asset: ${asset}`);
    continue;
  }
  const extracted = spawnSync("unzip", ["-p", zipPath, asset], { maxBuffer: 64 * 1024 * 1024 });
  if (extracted.status !== 0 || !extracted.stdout.equals(fs.readFileSync(path.join(root, asset)))) {
    failures.push(`exported download bytes differ from source: ${asset}`);
  }
}

const requiredImageAssets = [
  "images/aibeat-wecom-contact.png",
];
for (const asset of requiredImageAssets) {
  if (!entries.has(asset)) {
    failures.push(`export is missing image asset: ${asset}`);
    continue;
  }
  const extracted = spawnSync("unzip", ["-p", zipPath, asset], { maxBuffer: 64 * 1024 * 1024 });
  if (extracted.status !== 0 || !extracted.stdout.equals(fs.readFileSync(path.join(root, asset)))) {
    failures.push(`exported image bytes differ from source: ${asset}`);
  }
}

const localizationSource = entries.has("localization.js") ? readEntry("localization.js") : "";
if (!localizationSource.includes('document.documentElement.lang = expectedLanguage')) {
  failures.push("exported localization.js does not normalize documentElement.lang");
}

let metadataPass = 0;
let customScriptPass = 0;
let rawChineseLangMismatch = 0;
for (const route of routes) {
  const entry = `${route}/index.html`;
  if (!entries.has(entry)) {
    failures.push(`${route}: missing ${entry}`);
    continue;
  }
  const html = readEntry(entry);
  const hasTitle = /<title>[^<]+<\/title>/.test(html);
  const hasDescription = /<meta\s+name="description"\s+content="[^"]+"/.test(html);
  const hasOgTitle = /<meta\s+property="og:title"\s+content="[^"]+"/.test(html);
  const hasOgDescription = /<meta\s+property="og:description"\s+content="[^"]+"/.test(html);
  const h1Count = (html.match(/<h1(?:\s|>)/g) ?? []).length;
  if (hasTitle && hasDescription && hasOgTitle && hasOgDescription && h1Count === 1) {
    metadataPass += 1;
  } else {
    failures.push(
      `${route}: metadata/H1 check failed (title=${hasTitle}, description=${hasDescription}, ogTitle=${hasOgTitle}, ogDescription=${hasOgDescription}, h1=${h1Count})`,
    );
  }
  if (html.includes("syncDocumentLanguage")) customScriptPass += 1;
  else failures.push(`${route}: custom localization script is not embedded in exported page data`);

  if (route.startsWith("cn/")) {
    const rawLang = html.match(/<html[^>]*\slang=["']([^"']+)["']/i)?.[1];
    if (rawLang !== "zh-Hans") rawChineseLangMismatch += 1;
  }
}

if (failures.length > 0) {
  console.error(`Mintlify export check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Mintlify export check passed: routes=${routes.length}, metadata=${metadataPass}, custom-script=${customScriptPass}, raw-cn-lang-warnings=${rawChineseLangMismatch}.`,
);
if (rawChineseLangMismatch > 0) {
  console.warn(
    "Known Mintlify 4.2.587 limitation: raw /cn export HTML uses lang=en; runtime localization.js normalizes exact /cn routes to zh-Hans. Recheck Mintlify Cloud before deployment.",
  );
}
