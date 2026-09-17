import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const skillNames = [
  "agentbeat-write-agent-cases",
  "promptbeat-connect-coding-agent",
  "promptbeat-debug-run",
  "promptbeat-getting-started",
  "promptbeat-run-quick-eval",
  "promptbeat-select-risk-pack",
];
export const sourcePaths = [
  "README.md",
  ...skillNames.map((name) => `${name}/SKILL.md`),
  "agentbeat-write-agent-cases/references/taxonomy-cheatsheet.md",
  "agentbeat-write-agent-cases/references/agent-case-only-v1.schema.json",
  "agentbeat-write-agent-cases/references/agent-security-taxonomy-v1.json",
  "agentbeat-write-agent-cases/references/agent-security-taxonomy-v1.schema.json",
  "agentbeat-write-agent-cases/scripts/pack.py",
  "promptbeat-connect-coding-agent/references/agent-runtimes.md",
  "promptbeat-debug-run/references/common-failures.md",
  "promptbeat-run-quick-eval/references/cli-recipes.md",
].sort();
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP STORE needs no compression dependency. UTF-8 names, fixed 1980-01-01
// timestamps and regular 0644 files make identical sources byte-reproducible.
export function makeZip(files) {
  const local = [];
  const central = [];
  const names = new Set();
  let offset = 0;
  for (const { name, data } of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === "..") || names.has(name)) {
      throw new Error(`Unsafe or duplicate archive path: ${name}`);
    }
    names.add(name);
    const bytes = Buffer.from(data);
    if (bytes.length > 256 * 1024) throw new Error(`Oversized Skill file: ${name}`);
    const encoded = Buffer.from(name);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(encoded.length, 26);
    local.push(header, encoded, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, encoded);
    offset += header.length + encoded.length + bytes.length;
  }
  if (names.size > 65535 || offset > 1024 * 1024) throw new Error("Skills archive exceeds its fixed small-package limits");
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.size, 8);
  end.writeUInt16LE(names.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function buildArchive(sourceRoot, archiveRoot = "aibeat-skill") {
  const sourceFiles = sourcePaths.map((relative) => {
    let current = sourceRoot;
    // Do not follow a symlink at the root or any component of an allowed path.
    if (!fs.lstatSync(current).isDirectory() || fs.lstatSync(current).isSymbolicLink()) throw new Error("Unsafe Skill source root");
    for (const component of relative.split("/")) {
      current = path.join(current, component);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink in Skill source: ${relative}`);
    }
    if (!fs.lstatSync(current).isFile()) throw new Error(`Not a regular Skill source: ${relative}`);
    const data = fs.readFileSync(current);
    if (relative.endsWith("/SKILL.md")) {
      const name = relative.split("/")[0];
      const text = data.toString("utf8");
      if (!text.startsWith(`---\nname: ${name}\ndescription: Use when `)) throw new Error(`Invalid Skill metadata: ${relative}`);
    }
    return { name: `${archiveRoot}/${relative}`, data };
  });
  const format = archiveRoot === "aibeat-skill" ? "aibeat-skill-download-v1" : "promptbeat-skills-download-v1";
  const manifest = {
    format,
    distribution: "website instruction bundle; product executable not included",
    skills: skillNames,
    files: sourceFiles.map(({ name, data }) => ({ path: name, bytes: data.length, sha256: sha256(data) })),
  };
  return makeZip([...sourceFiles, { name: `${archiveRoot}/MANIFEST.json`, data: JSON.stringify(manifest, null, 2) + "\n" }]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourceDir = path.join(websiteRoot, "..", "promptbeat-skills");
  const downloadsDir = path.join(websiteRoot, "downloads");
  const isCheck = process.argv.includes("--check");

  const targets = [
    {
      filename: "aibeat-skill.zip",
      root: "aibeat-skill",
      canonical: true,
    },
    {
      filename: "promptbeat-skills.zip",
      root: "promptbeat-skills",
      canonical: false,
    },
  ];

  for (const { filename, root, canonical } of targets) {
    const output = path.join(downloadsDir, filename);
    const checksumFile = `${output}.sha256`;
    const archive = buildArchive(sourceDir, root);
    const checksum = `${sha256(archive)}  ${filename}\n`;

    if (isCheck) {
      if (!fs.existsSync(output) || !fs.readFileSync(output).equals(archive)) {
        throw new Error(`${canonical ? "Canonical" : "Legacy"} skills download is missing or stale: ${filename}; run npm run build:skills`);
      }
      if (!fs.existsSync(checksumFile) || fs.readFileSync(checksumFile, "utf8") !== checksum) {
        throw new Error(`${canonical ? "Canonical" : "Legacy"} skills checksum is missing or stale: ${filename}.sha256; run npm run build:skills`);
      }
      console.log(`Skills archive verified (${canonical ? "canonical" : "legacy"}): ${filename} (${archive.length} bytes, sha256=${sha256(archive)})`);
    } else {
      fs.mkdirSync(downloadsDir, { recursive: true });
      fs.writeFileSync(output, archive);
      fs.writeFileSync(checksumFile, checksum);
      console.log(`Skills archive built (${canonical ? "canonical" : "legacy"}): ${filename} (${archive.length} bytes, sha256=${sha256(archive)})`);
    }
  }
}
