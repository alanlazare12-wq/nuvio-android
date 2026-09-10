import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [command = "build", ...forwardedArgs] = process.argv.slice(2);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const buildLockPath = join(projectRoot, ".nuvio-android-build.lock");

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireBuildLock() {
  if (command !== "build") return () => {};

  if (existsSync(buildLockPath)) {
    const previousPid = Number.parseInt(readFileSync(buildLockPath, "utf8").trim(), 10);
    if (processIsAlive(previousPid)) {
      throw new Error(
        `Ya hay una compilación Android de Nuvio en curso (PID ${previousPid}). Espera a que termine antes de iniciar otra.`,
      );
    }
    unlinkSync(buildLockPath);
  }

  writeFileSync(buildLockPath, String(process.pid), { flag: "wx" });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (existsSync(buildLockPath)) unlinkSync(buildLockPath);
    } catch {
      // El sistema operativo también libera el proceso; el lock obsoleto se limpia en el siguiente inicio.
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(143);
  });
  return release;
}

function existingDirectory(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function versionParts(value) {
  return value.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersionsDesc(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (b[index] ?? 0) - (a[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function detectSdkRoot() {
  const defaults = process.platform === "win32"
    ? [
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"),
        join(homedir(), "AppData", "Local", "Android", "Sdk"),
      ]
    : process.platform === "darwin"
      ? [join(homedir(), "Library", "Android", "sdk")]
      : [join(homedir(), "Android", "Sdk")];

  return existingDirectory([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    ...defaults,
  ]);
}

function detectNdkRoot() {
  const explicit = existingDirectory([
    process.env.NDK_HOME,
    process.env.ANDROID_NDK_HOME,
  ]);
  if (explicit) return explicit;

  const sdkRoot = detectSdkRoot();
  if (!sdkRoot) return null;
  const ndkDirectory = join(sdkRoot, "ndk");
  if (!existsSync(ndkDirectory)) return null;

  const versions = readdirSync(ndkDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionsDesc);

  return versions.length ? join(ndkDirectory, versions[0]) : null;
}

function javaMajor(javaHome) {
  if (!javaHome) return null;
  const java = join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (!existsSync(java)) return null;
  const result = spawnSync(java, ["-version"], { encoding: "utf8", shell: false });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const match = output.match(/version\s+"(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function childDirectories(path) {
  if (!path || !existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(path, entry.name));
}

function detectJava17() {
  const candidates = [process.env.JAVA_HOME];

  const userJava = join(homedir(), "Java");
  candidates.push(
    ...childDirectories(userJava)
      .filter((path) => /jdk-?17/i.test(path))
      .sort()
      .reverse(),
  );

  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    candidates.push(
      ...childDirectories(join(programFiles, "Eclipse Adoptium"))
        .filter((path) => /jdk-?17/i.test(path))
        .sort()
        .reverse(),
    );
  }

  return candidates.find((candidate) => javaMajor(candidate) === 17) ?? null;
}

function androidCppDirectories(ndkRoot) {
  const prebuiltRoot = join(ndkRoot, "toolchains", "llvm", "prebuilt");
  if (!existsSync(prebuiltRoot)) {
    throw new Error(`NDK inválido: no existe ${prebuiltRoot}`);
  }

  const hosts = readdirSync(prebuiltRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (!hosts.length) throw new Error("El NDK no contiene un toolchain LLVM prebuilt");

  const sysrootLib = join(prebuiltRoot, hosts[0], "sysroot", "usr", "lib");
  const targets = {
    "aarch64-linux-android": "aarch64-linux-android",
    "armv7-linux-androideabi": "arm-linux-androideabi",
    "i686-linux-android": "i686-linux-android",
    "x86_64-linux-android": "x86_64-linux-android",
  };

  return Object.fromEntries(
    Object.entries(targets).flatMap(([cargoTarget, ndkTarget]) => {
      const libDir = join(sysrootLib, ndkTarget);
      return existsSync(join(libDir, "libc++_static.a"))
        ? [[cargoTarget, libDir]]
        : [];
    }),
  );
}

function writeCargoAndroidConfig(ndkRoot) {
  const directories = androidCppDirectories(ndkRoot);
  const cargoDirectory = join(projectRoot, "src-tauri", ".cargo");
  const configPath = join(cargoDirectory, "config.toml");
  const marker = "# Generated by Nuvio scripts/tauri-android.mjs";

  if (existsSync(configPath)) {
    const existing = readFileSync(configPath, "utf8");
    if (!existing.startsWith(marker)) {
      throw new Error(
        `No se reemplazó ${configPath} porque contiene una configuración Cargo administrada manualmente.`,
      );
    }
  }

  const sections = Object.entries(directories).map(([target, libDir]) => {
    // Never add the NDK's whole unversioned library directory to -L: its
    // libc.a shadows Android's API-specific libc.so and crashes during startup.
    const cppOnly = join(projectRoot, "src-tauri", "target", "android-cpp", target);
    mkdirSync(cppOnly, { recursive: true });
    for (const name of ["libc++_static.a", "libc++abi.a"]) {
      const source = join(libDir, name);
      const destination = join(cppOnly, name);
      if (!existsSync(destination) || statSync(source).size !== statSync(destination).size || !readFileSync(source).equals(readFileSync(destination))) {
        copyFileSync(source, destination);
      }
    }
    const portablePath = cppOnly.replaceAll("\\", "/");
    return `[target.${JSON.stringify(target)}]\nrustflags = ["-L", ${JSON.stringify(`native=${portablePath}`)}]`;
  });

  if (!sections.length) {
    throw new Error("No se encontró libc++_static.a para ninguna ABI Android soportada");
  }

  mkdirSync(cargoDirectory, { recursive: true });
  writeFileSync(
    configPath,
    `${marker}\n# Machine-specific; refreshed before every Android command.\n\n${sections.join("\n\n")}\n`,
    "utf8",
  );
}

function runPnpmTauri(env) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"), "android", command, ...forwardedArgs], {
      cwd: projectRoot, env, shell: false, windowsHide: true,
      stdio: command === "build" ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", data => { stdout += data; process.stdout.write(data); });
    child.stderr?.on("data", data => { stderr += data; process.stderr.write(data); });
    child.on("error", error => resolveResult({ status: 1, error, stdout, stderr }));
    child.on("close", status => resolveResult({ status, stdout, stderr }));
  });
}

function argumentValue(name) {
  const index = forwardedArgs.indexOf(name);
  return index >= 0 ? forwardedArgs[index + 1] : null;
}

function newestAndroidTdjson(profile, targetTriple) {
  const buildRoot = join(
    projectRoot,
    "src-tauri",
    "target",
    targetTriple,
    profile,
    "build",
  );
  if (!existsSync(buildRoot)) return null;

  const candidates = readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("nuviodrive-v1-"))
    .map((entry) => join(buildRoot, entry.name, "out", "tdlib", "lib", "libtdjson.so"))
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0] ?? null;
}

function windowsNoSymlinkFallback(env, tauriResult) {
  if (process.platform !== "win32" || command !== "build") return null;

  const output = `${tauriResult.stdout ?? ""}\n${tauriResult.stderr ?? ""}`;
  const symlinkDenied = /symbolic link/i.test(output)
    && /(not allowed|developer mode|SeCreateSymbolicLinkPrivilege)/i.test(output);
  if (!symlinkDenied) return null;

  const requestedTarget = argumentValue("--target") ?? "aarch64";
  const targetConfig = {
    aarch64: { triple: "aarch64-linux-android", jni: "arm64-v8a", gradle: "Arm64" },
    armv7: { triple: "armv7-linux-androideabi", jni: "armeabi-v7a", gradle: "Arm" },
    i686: { triple: "i686-linux-android", jni: "x86", gradle: "X86" },
    x86_64: { triple: "x86_64-linux-android", jni: "x86_64", gradle: "X86_64" },
  }[requestedTarget];
  if (!targetConfig) return null;

  const release = !forwardedArgs.includes("--debug") && !forwardedArgs.includes("-d");
  const profile = release ? "release" : "debug";
  const variant = release ? "Release" : "Debug";
  const source = join(
    projectRoot,
    "src-tauri",
    "target",
    targetConfig.triple,
    profile,
    "libnuviodrive_v1_lib.so",
  );

  if (!existsSync(source)) return null;

  const destination = join(
    projectRoot,
    "src-tauri",
    "gen",
    "android",
    "app",
    "src",
    "main",
    "jniLibs",
    targetConfig.jni,
    "libnuviodrive_v1_lib.so",
  );
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);

  const tdjsonSource = newestAndroidTdjson(profile, targetConfig.triple);
  if (!tdjsonSource) {
    throw new Error(`No se encontró libtdjson.so para ${requestedTarget} generada por TDLib.`);
  }
  const tdjsonDestination = join(dirname(destination), "libtdjson.so");
  copyFileSync(tdjsonSource, tdjsonDestination);
  console.log(`[Nuvio Android] Incluyendo TDLib nativo: ${tdjsonDestination}`);

  const gradleRoot = join(projectRoot, "src-tauri", "gen", "android");
  const assembleTask = `assemble${targetConfig.gradle}${variant}`;
  const rustTask = `rustBuild${targetConfig.gradle}${variant}`;
  console.log(`[Nuvio Android] Windows no permite symlinks; usando copia segura de ${requestedTarget} y Gradle.`);

  return spawnSync(
    "cmd.exe",
    ["/d", "/s", "/c", "gradlew.bat", "clean", assembleTask, "-x", rustTask],
    { cwd: gradleRoot, env, stdio: "inherit", shell: false },
  );
}

const env = { ...process.env };
// This override is a Windows DLL SDK, never an Android library.
delete env.NUVIO_TDLIB_DIR;
const sdkRoot = detectSdkRoot();
const ndkRoot = detectNdkRoot();
const java17 = detectJava17();

if (!sdkRoot) {
  console.error("No se encontró Android SDK. Define ANDROID_HOME o ANDROID_SDK_ROOT.");
  process.exit(2);
}
if (!ndkRoot) {
  console.error("No se encontró Android NDK. Instálalo desde Android Studio o define NDK_HOME.");
  process.exit(2);
}
if (!java17) {
  console.error("Nuvio Android requiere JDK 17 para este proyecto. No se encontró una instalación compatible.");
  process.exit(2);
}

env.ANDROID_HOME = sdkRoot;
env.ANDROID_SDK_ROOT = sdkRoot;
env.NDK_HOME = ndkRoot;
env.ANDROID_NDK_HOME = ndkRoot;
env.JAVA_HOME = java17;

const isAndroidBuild = command === "build";
const isDebugBuild = isAndroidBuild && (forwardedArgs.includes("--debug") || forwardedArgs.includes("-d"));
if (isDebugBuild) {
  // Keep phone-test APKs small without changing the normal desktop dev profile.
  env.CARGO_PROFILE_DEV_DEBUG = "0";
  env.CARGO_PROFILE_DEV_STRIP = "symbols";
} else if (isAndroidBuild) {
  // Full LTO + one codegen unit is disproportionately slow with statically linked TDLib.
  // Thin LTO preserves release optimization while allowing useful parallelism.
  env.CARGO_PROFILE_RELEASE_LTO = "thin";
  env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "8";
}
writeCargoAndroidConfig(ndkRoot);

console.log(`[Nuvio Android] SDK: ${sdkRoot}`);
console.log(`[Nuvio Android] NDK: ${ndkRoot}`);
console.log(`[Nuvio Android] JDK: ${java17}`);

const releaseBuildLock = acquireBuildLock();
let result = await runPnpmTauri(env);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  const fallback = windowsNoSymlinkFallback(env, result);
  if (fallback) result = fallback;
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
