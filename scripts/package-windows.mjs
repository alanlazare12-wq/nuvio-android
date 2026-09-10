import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("El paquete Windows se genera en un host Windows x64.");
const tauri = join(root, "src-tauri");
const directories = path => existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name)) : [];
const sdkCandidates = [process.env.NUVIO_TDLIB_DIR, ...["debug", "release"].flatMap(profile => directories(join(tauri, "target", profile, "build")).filter(path => /nuviodrive-v1-/.test(path)).map(path => join(path, "out", "tdlib")))];
const sdk = sdkCandidates.find(path => path && existsSync(join(path, "lib", "tdjson.lib")) && existsSync(join(path, "bin", "tdjson.dll")));
if (!sdk) throw new Error("Define NUVIO_TDLIB_DIR con el SDK de TDLib para Windows x64.");
const vswhere = join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
const vs = spawnSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], { encoding: "utf8", windowsHide: true }).stdout?.trim();
const crt = process.env.NUVIO_VC_RUNTIME_DIR || directories(join(vs || "", "VC", "Redist", "MSVC")).sort().reverse().map(path => join(path, "x64", "Microsoft.VC143.CRT")).find(path => existsSync(join(path, "vcruntime140.dll")));
if (!crt) throw new Error("No se encontró el runtime redistribuible de Visual C++ x64. Define NUVIO_VC_RUNTIME_DIR.");
const stage = join(tauri, "windows-runtime");
mkdirSync(stage, { recursive: true });
const resources = {};
for (const directory of [join(sdk, "bin"), crt]) {
  for (const name of readdirSync(directory).filter(name => name.toLowerCase().endsWith(".dll"))) {
    const binary = readFileSync(join(directory, name));
    const pe = binary.readUInt32LE(0x3c);
    if (binary.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`Biblioteca que no es x64: ${name}`);
    copyFileSync(join(directory, name), join(stage, name));
    resources[`windows-runtime/${name}`] = name;
  }
}
const config = join(tauri, "windows-bundle.generated.json");
writeFileSync(config, JSON.stringify({ bundle: { resources } }, null, 2));
const env = { ...process.env, NUVIO_TDLIB_DIR: sdk, CARGO_NET_OFFLINE: "true" };
console.log(`TDLib local: ${sdk}`);
console.log(`Incluyendo ${Object.keys(resources).length} bibliotecas x64.`);
const operation = process.argv.includes("--bundle-only") ? "bundle" : "build";
const result = spawnSync(process.execPath, [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), operation, "--bundles", "nsis", "--config", config], { cwd: root, env, stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const installers = join(tauri, "target", "release", "bundle", "nsis");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const exe = `Nuvio_${version}_x64-setup.exe`;
if (!existsSync(join(installers, exe))) throw new Error(`No se generó el instalador x64 ${version}.`);
const output = join(root, "release", "Windows");
mkdirSync(output, { recursive: true });
copyFileSync(join(installers, exe), join(output, "Nuvio-Setup-Windows11-x64.exe"));
console.log(`Instalador: ${join(output, "Nuvio-Setup-Windows11-x64.exe")}`);
