import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const installed = resolve(process.argv[2] || join(root, "qa", "windows-install-1.1.0"));
const source = join(root, "src-tauri", "target", "release", "nuviodrive-v1.exe");
const original = readFileSync(source);
const executable = readFileSync(join(installed, "nuviodrive-v1.exe"));
assert.equal(executable.length, original.length, "El ejecutable instalado tiene un tamaño distinto");
const differences = [];
for (let index = 0; index < original.length; index++) if (original[index] !== executable[index]) differences.push(index);
if (differences.length) {
  assert.equal(differences.length, 3, "El ejecutable contiene diferencias adicionales al identificador del instalador");
  assert.deepEqual(differences, [differences[0], differences[0] + 1, differences[0] + 2]);
  assert.equal(original.subarray(differences[0], differences[0] + 3).toString(), "UNK");
  assert.equal(executable.subarray(differences[0], differences[0] + 3).toString(), "NSS");
}
const hash = data => createHash("sha256").update(data).digest("hex");
const dlls = readdirSync(join(root, "src-tauri", "windows-runtime")).filter(name => name.endsWith(".dll"));
assert.equal(dlls.length, 15);
for (const name of dlls) {
  assert.equal(hash(readFileSync(join(installed, name))), hash(readFileSync(join(root, "src-tauri", "windows-runtime", name))), name);
}
const index = readFileSync(join(root, "dist", "index.html"), "utf8");
const script = index.match(/\/assets\/(index-[^" ]+\.js)/)?.[1];
assert.ok(script && executable.includes(Buffer.from(script)), "El instalador no contiene la última interfaz compilada");
const result = { version: JSON.parse(readFileSync(join(root, "package.json"))).version, installed, dllCount: dlls.length,
  executableMatches: true, bundleMarker: differences.length ? "UNK -> NSS (Tauri NSIS)" : "identical", frontend: script,
  sha256: hash(executable), verifiedAt: new Date().toISOString() };
writeFileSync(join(root, "qa", "windows-install-verification.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
