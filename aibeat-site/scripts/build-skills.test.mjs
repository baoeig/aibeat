import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildArchive, crc32, makeZip, sha256, skillNames, sourcePaths } from "./build-skills.mjs";

const website = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(website, "..", "promptbeat-skills");
fs.mkdirSync(path.join(website, ".build"), { recursive: true });
const scratch = fs.mkdtempSync(path.join(website, ".build", "skills-test-"));
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
const unzip = (...args) => {
  const result = spawnSync("unzip", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
};

test("ZIP CRC uses the standard test vector", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("canonical archive (aibeat-skill) is deterministic, passes independent unzip CRC checks and preserves all sources", () => {
  const data = buildArchive(source, "aibeat-skill");
  assert.deepEqual(data, buildArchive(source, "aibeat-skill"));
  const filename = path.join(scratch, "aibeat-skill.zip");
  fs.writeFileSync(filename, data);
  unzip("-t", filename);
  const entries = unzip("-Z1", filename).trim().split("\n");
  assert.equal(entries.length, sourcePaths.length + 1);
  assert.ok(entries.every((name) => name.startsWith("aibeat-skill/")));
  assert.equal(entries.filter((name) => name.endsWith("/SKILL.md")).length, 6);
  assert.equal(entries.filter((name) => name.includes("/references/")).length, 7);
  assert.ok(entries.some((name) => name.endsWith("/scripts/pack.py")));
  assert.ok(!entries.some((name) => /test-scenarios|\.env|\.exe|node_modules/.test(name)));
  const manifest = JSON.parse(unzip("-p", filename, "aibeat-skill/MANIFEST.json"));
  assert.equal(manifest.format, "aibeat-skill-download-v1");
  assert.deepEqual(manifest.skills, skillNames);
  for (const file of manifest.files) {
    assert.ok(file.path.startsWith("aibeat-skill/"));
    const content = Buffer.from(unzip("-p", filename, file.path));
    assert.equal(content.length, file.bytes);
    assert.equal(sha256(content), file.sha256);
    assert.deepEqual(content, fs.readFileSync(path.join(source, file.path.replace(/^aibeat-skill\//, ""))));
  }
});

test("legacy archive (promptbeat-skills) is deterministic and preserves compatibility", () => {
  const data = buildArchive(source, "promptbeat-skills");
  assert.deepEqual(data, buildArchive(source, "promptbeat-skills"));
  const filename = path.join(scratch, "promptbeat-skills.zip");
  fs.writeFileSync(filename, data);
  unzip("-t", filename);
  const entries = unzip("-Z1", filename).trim().split("\n");
  assert.equal(entries.length, sourcePaths.length + 1);
  assert.ok(entries.every((name) => name.startsWith("promptbeat-skills/")));
  assert.equal(entries.filter((name) => name.endsWith("/SKILL.md")).length, 6);
  assert.equal(entries.filter((name) => name.includes("/references/")).length, 7);
  assert.ok(entries.some((name) => name.endsWith("/scripts/pack.py")));
  assert.ok(!entries.some((name) => /test-scenarios|\.env|\.exe|node_modules/.test(name)));
  const manifest = JSON.parse(unzip("-p", filename, "promptbeat-skills/MANIFEST.json"));
  assert.equal(manifest.format, "promptbeat-skills-download-v1");
  assert.deepEqual(manifest.skills, skillNames);
  for (const file of manifest.files) {
    assert.ok(file.path.startsWith("promptbeat-skills/"));
    const content = Buffer.from(unzip("-p", filename, file.path));
    assert.equal(content.length, file.bytes);
    assert.equal(sha256(content), file.sha256);
    assert.deepEqual(content, fs.readFileSync(path.join(source, file.path.replace(/^promptbeat-skills\//, ""))));
  }
});

test("paths, duplicate names and oversize input fail closed", () => {
  for (const name of ["../SKILL.md", "/SKILL.md", "a/../SKILL.md", "a//SKILL.md", "a\\SKILL.md"]) {
    assert.throws(() => makeZip([{ name, data: "text" }]), /Unsafe/);
  }
  assert.throws(() => makeZip([{ name: "a.md", data: "a" }, { name: "a.md", data: "b" }]), /duplicate/);
  assert.throws(() => makeZip([{ name: "a.md", data: Buffer.alloc(256 * 1024 + 1) }]), /Oversized/);
});

test("source changes alter the archive; symlink and malformed metadata are rejected", () => {
  const copy = path.join(scratch, "source");
  for (const relative of sourcePaths) {
    const output = path.join(copy, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(source, relative), output);
  }
  const before = buildArchive(copy, "aibeat-skill");
  fs.appendFileSync(path.join(copy, "README.md"), "\nrevision\n");
  assert.notEqual(sha256(before), sha256(buildArchive(copy, "aibeat-skill")));
  const skill = path.join(copy, skillNames[0], "SKILL.md");
  fs.writeFileSync(skill, "invalid metadata");
  assert.throws(() => buildArchive(copy), /Invalid Skill metadata/);
  fs.rmSync(skill);
  fs.symlinkSync(path.join(source, skillNames[0], "SKILL.md"), skill);
  assert.throws(() => buildArchive(copy), /Symlink/);
});
