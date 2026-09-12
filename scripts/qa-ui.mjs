import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const packageRoot = process.env.QA_PLAYWRIGHT_PATH || "playwright";
const { chromium } = require(packageRoot);
const { expect } = require(`${packageRoot}/test`);
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined), headless: true });
const output = path.resolve("qa");
await mkdir(output, { recursive: true });
const results = [];
const url = process.env.QA_BASE_URL || "http://localhost:1420";

async function setup(viewport = { width: 1280, height: 820 }) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const files = Array.from({ length: 16 }, (_, index) => ({
      id: `file-${index}`, name: index === 15 ? "LEEME" : `Archivo ${String(index).padStart(2, "0")} con nombre largo`,
      extension: index < 2 ? "wav" : index === 15 ? "" : "txt",
      kind: index < 2 ? "audio" : "document", sizeBytes: 1024 * (index + 1),
      updatedAt: new Date(Date.UTC(2026, 8, 9, 0, 0, 16 - index)).toISOString(),
      favorite: index === 2, trashed: false, folder: "Mi unidad", folderId: null, tags: [], provider: "telegram",
    }));
    window.__qa = { files, folders: [], calls: [], media: {}, dashboardError: null, dashboardPolls: 0 };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      convertFileSrc: file => `/qa-media/${file}`,
      invoke: async (cmd, args = {}) => {
        const qa = window.__qa;
        qa.calls.push({ cmd, args });
        if (cmd === "get_dashboard") {
          qa.dashboardPolls++;
          if (qa.dashboardError) throw qa.dashboardError;
          return {
            syncProgress: qa.syncProgress, files: structuredClone(qa.files), folders: structuredClone(qa.folders), transfers: [], transferHistory: [], totalBytes: 20000, fileCount: qa.files.length,
            favoriteCount: qa.files.filter(file => file.favorite && !file.trashed).length, recentCount: 12,
            telegramConnected: true, telegramAccountLabel: "Cuenta QA", providerStatus: "Conectado · entorno de pruebas",
            queueSummary: { total: 0, completed: 0, pending: 0, failed: 0, active: 0, processedBytes: 0, totalBytes: 0, speedBps: 0, cacheBytes: 0, cacheLimitBytes: 2147483648 },
            settings: { preparationConcurrency: 2, uploadConcurrency: 1, downloadConcurrency: 2, cacheLimitBytes: 2147483648, rememberSession: false, conflictPolicy: "skip" },
          };
        }
        if (cmd === "update_setting") return {};
        if (cmd === "set_trashed") { qa.files.find(file => file.id === args.id).trashed = args.trashed; return; }
        if (cmd === "platform_name") return "windows";
        if (cmd === "create_folder") {
          const id = `folder-${qa.folders.length}`;
          qa.folders.push({id, name: args.name, parentId: args.parentId, trashed: false, fileCount: 0, childCount: 0, sizeBytes: 0, createdAt: 0, updatedAt: 0});
          return id;
        }
        if (cmd === "move_files_to_folder") {
          qa.files.filter(file => args.ids.includes(file.id)).forEach(file => { file.folderId = args.folderId; });
          return args.ids.length;
        }
        if (cmd === "set_favorite") { qa.files.find(file => file.id === args.id).favorite = args.favorite; return; }
        if (cmd === "prepare_media") return new Promise(resolve => { qa.media[args.id] = resolve; });
        if (cmd === "prepare_thumbnail") return qa.thumbnails?.[args.id] ?? null;
        if (cmd === "telegram_auth_state") return qa.telegramAuthState ?? { stage: "needsCredentials", connected: false, message: "Configura tus credenciales", isPremium: false };
        if (cmd === "telegram_configure") {
          qa.telegramAuthState = { stage: "phone", connected: false, message: "Ingresa el teléfono", isPremium: false };
          return qa.telegramAuthState;
        }
        if (cmd === "telegram_submit_phone") {
          qa.telegramAuthState = { stage: "code", connected: false, message: "Ingresa el código", hint: "Código en app oficial de Telegram", isPremium: false, timeout: 60, codeType: "telegram", nextCodeType: "sms" };
          return qa.telegramAuthState;
        }
        if (cmd === "telegram_submit_phone_sms") {
          qa.telegramAuthState = { stage: "code", connected: false, message: "Ingresa el código", hint: "Código en app oficial de Telegram", isPremium: false, timeout: 60, codeType: "telegram", nextCodeType: "sms" };
          return qa.telegramAuthState;
        }
        if (cmd === "telegram_resend_code") {
          qa.telegramAuthState = { stage: "code", connected: false, message: "Ingresa el código", hint: "Código por SMS a tu celular", isPremium: false, timeout: 60, codeType: "sms", nextCodeType: "call" };
          return qa.telegramAuthState;
        }
        if (cmd === "telegram_submit_email") {
          qa.telegramAuthState = { stage: "emailCode", connected: false, message: "Ingresa el código enviado al correo", hint: "Revisa tu correo", isPremium: false };
          return qa.telegramAuthState;
        }
        if (cmd === "telegram_request_qr") {
          qa.telegramAuthState = { stage: "qr", connected: false, message: "Escanea desde Telegram", qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="black"/></svg>', isPremium: false };
          return qa.telegramAuthState;
        }
        if (cmd === "telegram_reset_to_phone") {
          qa.telegramAuthState = { stage: "phone", connected: false, message: "Ingresa el teléfono", isPremium: false };
          return qa.telegramAuthState;
        }
        if (cmd === "plugin:dialog|open") return qa.uploadPaths ?? null;
        if (cmd === "plugin:event|listen") return 1;
        if (cmd === "plugin:event|unlisten") return;
        if (cmd === "prepare_zip_uploads") {
          if (qa.zipError) throw qa.zipError;
          return [{ Ok: { transferId: "zip-qa", fileName: "Nuvio-001.zip", localPath: "zip-qa.zip", sizeBytes: 100, sha256: "qa", duplicate: false, encrypted: false, status: "ready" } }];
        }
        if (cmd === "sync_files") {
          return qa.syncResultCount ?? 0;
        }
        if (cmd.startsWith("plugin:notification|")) return false;
        throw new Error(`Unexpected IPC call in QA: ${cmd}`);
      },
    };
  });
  await page.route("**/qa-media/**", route => route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.alloc(44) }));
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
  return { context, page, errors };
}

async function test(name, fn, viewport) {
  const { context, page, errors } = await setup(viewport);
  try {
    await fn(page);
    assert.deepEqual(errors, [], "Browser raised an uncaught exception");
    results.push({ name, status: "passed" });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: "failed", error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true });
  } finally { await context.close(); }
}

try {
  await test("selection-after-trash", async page => {
    await page.getByRole("checkbox", { name: "Seleccionar Archivo 00 con nombre largo", exact: true }).check();
    await page.locator(".file-card").first().getByTitle("Mover a Papelera", { exact: true }).click();
    await expect(page.locator(".selection-count")).toHaveCount(0);
  });
  await test("folders-create-move-and-open", async page => {
    await page.getByRole("navigation", {name: "Principal", exact: true}).getByRole("button", {name: "Mis archivos", exact: true}).click();
    await page.getByRole("button", {name: "Nueva carpeta", exact: true}).click();
    await page.getByRole("textbox", {name: "Nombre", exact: true}).fill("Fotos S24");
    await page.getByRole("button", {name: "Crear carpeta", exact: true}).click();
    await expect(page.locator(".folder-card")).toHaveCount(1);
    await page.locator(".file-card").first().getByTitle("Mover a carpeta", {exact: true}).click();
    await page.getByRole("combobox", {name: "Destino", exact: true}).selectOption("folder-0");
    await page.getByRole("dialog").getByRole("button", {name: "Mover", exact: true}).click();
    await expect(page.locator(".file-card")).toHaveCount(15);
    await page.getByRole("button", {name: "Abrir Fotos S24", exact: true}).click();
    await expect(page.locator(".file-card")).toHaveCount(1);
    await expect(page.locator(".file-card")).toContainText("Archivo 00");
  });
  await test("pdf-preview-worker-and-memory-limit", async page => {
    let pdf = "%PDF-1.7\n";
    const stream = "0.2 0.4 0.8 rg 0 0 50000 50000 re f\n";
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50000 50000] /Contents 4 0 R /Resources << >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const start = pdf.length;
    pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
    await page.route("**/qa-media/large.pdf", route => route.fulfill({contentType: "application/pdf", body: pdf}));
    await page.evaluate(() => { window.__qa.files[0].kind = "pdf"; window.__qa.files[0].extension = "pdf"; });
    await expect(page.locator(".file-card").first().locator(".file-extension")).toHaveText("PDF");
    await page.locator(".file-card").first().getByTitle("Vista previa", {exact: true}).click();
    await page.evaluate(() => window.__qa.media["file-0"]({path: "large.pdf", fromCache: true}));
    await expect(page.locator(".pdf-preview canvas")).toBeVisible();
    await expect(page.locator(".preview-loading")).toHaveCount(0, {timeout: 30000});
    await expect(page.locator(".media-modal [role=alert]")).toHaveCount(0);
    assert.equal(await page.locator("canvas").evaluate(canvas => canvas.width > 0 && canvas.height > 0 && canvas.width * canvas.height <= 4_000_000 && canvas.width <= 4096), true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }, {width: 412, height: 915});
  async function makeDropFolder(page) {
    await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("button", { name: "Mis archivos", exact: true }).click();
    await page.getByRole("button", { name: "Nueva carpeta", exact: true }).click();
    await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Destino QA");
    await page.getByRole("button", { name: "Crear carpeta", exact: true }).click();
    await expect(page.locator(".folder-card")).toHaveCount(1);
  }
  await test("drag-card-body-multiple-files", async page => {
    await makeDropFolder(page);
    await page.locator(".file-card strong").nth(0).click();
    await page.locator(".file-card strong").nth(1).click();
    await expect(page.locator(".file-card.selected")).toHaveCount(2);
    await page.locator(".file-card .file-meta").first().dragTo(page.locator(".folder-card"));
    await expect(page.locator(".file-card")).toHaveCount(14);
    const move = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "move_files_to_folder"));
    assert.deepEqual(move.map(c => c.args), [{ ids: ["file-0", "file-1"], folderId: "folder-0" }]);
  });
  async function touchDrag(page, points, hold = 0) {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, point) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y, radiusX: 3, radiusY: 3, force: 1, id: 1 }] : [] });
    await touch("touchStart", points[0]);
    if (hold) await new Promise(resolve => setTimeout(resolve, hold));
    for (const point of points.slice(1)) await touch("touchMove", point);
    await touch("touchEnd");
    await cdp.detach();
  }
  for (const cancel of [false, true]) await test(`touch-card-body-${cancel ? "cancel-outside" : "move"}`, async page => {
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await makeDropFolder(page);
    const name = page.locator(".file-card strong").first();
    await name.tap();
    await expect(page.locator(".file-card.selected")).toHaveCount(1);
    await name.evaluate(element => element.scrollIntoView({ block: "center" }));
    const from = await name.boundingBox();
    const to = await page.locator(".folder-card").boundingBox();
    const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const points = [a, ...Array.from({ length: 8 }, (_, i) => ({ x: a.x + (b.x - a.x) * (i + 1) / 8, y: a.y + (b.y - a.y) * (i + 1) / 8 }))];
    if (cancel) points.push({ x: 4, y: 4 });
    await touchDrag(page, points);
    if (cancel) {
      await expect(page.locator(".touch-drag-badge")).toHaveCount(0);
      assert.equal(await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "move_files_to_folder").length), 0);
    } else await expect(page.locator(".file-card")).toHaveCount(15);
  }, { width: 412, height: 915 });
  await test("preloaded-image-and-text-thumbnails", async page => {
    await page.route("**/qa-media/thumb.txt", route => route.fulfill({ contentType: "text/plain", body: "Documento de ejemplo\nContenido visible antes de abrirlo" }));
    await page.evaluate(() => {
      const qa = window.__qa;
      const fixture = document.createElement("canvas");
      fixture.width = 80; fixture.height = 60;
      const ctx = fixture.getContext("2d"); ctx.fillStyle = "#6476e8"; ctx.fillRect(0, 0, 80, 60);
      qa.thumbnails = {
        "file-0": { kind: "image", path: null, dataUrl: fixture.toDataURL() },
        "file-1": { kind: "text", path: "thumb.txt", dataUrl: null },
      };
      qa.files[0].updatedAt = "2026-09-10T10:00:00Z";
      qa.files[1].updatedAt = "2026-09-10T09:00:00Z";
    });
    await expect(page.locator(".file-thumbnail img")).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator(".file-thumbnail pre")).toContainText("Contenido visible antes de abrirlo");
    assert.equal(await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "prepare_media").length), 0);
    await page.screenshot({ path: path.join(output, "thumbnails-current.png"), fullPage: true });
  });
  await test("large-text-preview-does-not-download", async page => {
    await page.evaluate(() => { window.__qa.files[0].kind = "text"; window.__qa.files[0].sizeBytes = 4 * 1024 * 1024; });
    await expect(page.locator(".file-card").first()).toContainText("4.00 MB");
    await page.locator(".file-card").first().getByTitle("Vista previa", { exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("limitada a 2 MB");
    assert.equal(await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "prepare_media").length), 0);
  });
  await test("selection-after-sort", async page => {
    await page.getByRole("checkbox", { name: "Seleccionar Archivo 00 con nombre largo", exact: true }).check();
    await page.getByRole("combobox", { name: "Ordenar" }).selectOption("oldest");
    await expect(page.locator(".selection-count")).toHaveCount(0);
  });
  await test("theme-persists", async page => {
    await page.getByRole("button", { name: "Cambiar tema", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
  await test("media-close-and-stale-result", async page => {
    await page.locator(".file-card").nth(0).getByTitle("Vista previa", { exact: true }).click();
    await page.getByRole("button", { name: "Cerrar vista previa", exact: true }).click({ timeout: 2500 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".file-card").nth(1).getByTitle("Vista previa", { exact: true }).click();
    await page.evaluate(() => window.__qa.media["file-0"]({ path: "old.wav", fromCache: true }));
    await expect(page.locator(".media-preparing")).toBeVisible();
    await expect(page.locator("audio")).toHaveCount(0);
    await page.evaluate(() => window.__qa.media["file-1"]({ path: "new.wav", fromCache: true }));
    await expect(page.locator("audio")).toHaveAttribute("src", "/qa-media/new.wav");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  await test("modal-keyboard", async page => {
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Continuar con Telegram", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ajustes", exact: true })).toBeFocused();
  });
  await test("search-favorites-trash-and-list", async page => {
    await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("button", { name: "Mis archivos", exact: true }).click();
    await expect(page.locator(".file-card")).toHaveCount(16);
    await page.getByRole("textbox", { name: "Buscar", exact: true }).fill("LEEME");
    await expect(page.locator(".file-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Lista", exact: true }).click();
    await expect(page.locator(".file-row-name strong")).toHaveText("LEEME");
    for (const button of await page.locator(".row-actions button").all()) {
      assert.ok((await button.getAttribute("aria-label")) || (await button.getAttribute("title")), "File action is missing an accessible name");
    }
    await page.getByRole("textbox", { name: "Buscar", exact: true }).fill("");
    await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("button", { name: /Favoritos/ }).click();
    await expect(page.locator(".file-row")).toHaveCount(1);
  });
  await test("natural-sort-filters-and-concurrency", async page => {
    await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("button", { name: "Mis archivos", exact: true }).click();
    await page.evaluate(() => { window.__qa.files[0].name = "Archivo 10"; window.__qa.files[1].name = "Archivo 2"; });
    await page.getByRole("group", { name: "Tipo de archivo" }).getByRole("button", { name: "Audio", exact: true }).click();
    await page.getByLabel("Ordenar", { exact: true }).selectOption("name");
    await expect(page.locator(".file-card")).toHaveCount(2);
    await expect(page.locator(".file-card").first()).toContainText("Archivo 2");
    await page.getByLabel("Ordenar", { exact: true }).selectOption("size");
    await expect(page.locator(".file-card").first()).toContainText("Archivo 2");
    await page.getByLabel("Subidas simultáneas", { exact: true }).selectOption("16");
    await expect.poll(() => page.evaluate(() => window.__qa.calls.some(c => c.cmd === "update_setting" && c.args.key === "upload_concurrency" && c.args.value === "16"))).toBe(true);
  });
  await test("recent-list-and-combined-filters", async page => {
    await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("button", { name: /Recientes/ }).click();
    await expect(page.locator(".file-card")).toHaveCount(16);
    await page.getByLabel("Ordenar", { exact: true }).selectOption("oldest");
    await expect(page.locator(".file-card").first()).toContainText("LEEME");
    await page.getByLabel("Ordenar", { exact: true }).selectOption("recent");
    await expect(page.locator(".file-card").first()).toContainText("Archivo 00");
    await page.getByRole("navigation", { name: "Principal", exact: true }).getByRole("button", { name: /Favoritos/ }).click();
    await expect(page.locator(".file-card")).toHaveCount(1);
    await page.getByRole("group", { name: "Tipo de archivo" }).getByRole("button", { name: "Audio", exact: true }).click();
    await expect(page.locator(".file-card")).toHaveCount(0);
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    await page.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
    await expect(page.locator(".file-card")).toHaveCount(1);
  });
  for (const width of [390, 1280]) {
    await test(`sync-progress-${width}`, async page => {
      await page.evaluate(() => { window.__qa.syncProgress = { active: true, phase: "scanning", scanned: 50, total: 100, percent: 45, etaSeconds: 12 }; });
      const bar = page.getByRole("progressbar", { name: "Sincronización", exact: true });
      await expect(bar).toHaveAttribute("value", "45");
      await expect(page.getByLabel("Progreso de sincronización")).toContainText("12 s");
      await page.evaluate(() => { window.__qa.syncProgress = { active: true, phase: "scanning", scanned: 70, percent: null }; });
      await expect(bar).not.toHaveAttribute("value");
      await page.evaluate(() => { window.__qa.syncProgress = { active: false, phase: "error", scanned: 70, percent: 63, error: "Sin conexión" }; });
      await expect(page.getByLabel("Progreso de sincronización")).toContainText("Sin conexión");
      await expect(bar).toHaveAttribute("value", "63");
      await page.evaluate(() => { window.__qa.syncProgress = { active: false, phase: "complete", scanned: 100, percent: 100 }; });
      await expect(bar).toHaveAttribute("value", "100");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    }, { width, height: 844 });
  }
  for (const width of [390, 1280]) {
    await test(`zip-before-upload-${width}`, async page => {
      await page.evaluate(() => { window.__qa.uploadPaths = ["C:/QA/a.txt", "C:/QA/b.txt"]; });
      await page.getByRole("checkbox", { name: /Comprimir antes de subir/ }).check();
      await page.getByRole("button", { name: "Subir", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "prepare_zip_uploads").length)).toBe(1);
      const calls = await page.evaluate(() => window.__qa.calls);
      assert.deepEqual(calls.find(c => c.cmd === "prepare_zip_uploads").args.items, [{path:"C:/QA/a.txt"},{path:"C:/QA/b.txt"}]);
      assert.equal(calls.some(c => c.cmd === "prepare_upload"), false);
      await expect(page.getByRole("button", { name: "Subir", exact: true })).toBeEnabled();
      await page.evaluate(() => { window.__qa.zipError = "El ZIP supera 2 GB"; });
      await page.getByRole("button", { name: "Subir", exact: true }).click();
      await expect(page.getByText(/No se pudo preparar la selección: El ZIP supera 2 GB/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Subir", exact: true })).toBeEnabled();
    }, {width,height:915});
  }
  await test("boot-error-detail", async page => {
    await page.addInitScript(() => { window.__qa.dashboardError = "No se pudo leer el catálogo de prueba"; });
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("No se pudo leer el catálogo de prueba");
    await page.evaluate(() => { window.__qa.dashboardError = null; });
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Inicio", exact: true })).toBeVisible();
  });
  await test("compact-dialog-and-api-validation", async page => {
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 390, "Dialog extends outside the viewport");
    await page.getByLabel("API ID", { exact: true }).fill("2147483648");
    await page.getByRole("button", { name: "Continuar con Telegram", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("2147483647");
    assert.equal(await page.evaluate(() => window.__qa.calls.some(call => call.cmd === "telegram_configure")), false);
  }, { width: 844, height: 390 });
  await test("batch-upload-limit-protection-desktop", async page => {
    await page.evaluate(() => {
      window.__qa.uploadPaths = Array.from({ length: 501 }, (_, i) => `C:/Uploads/file-${i}.txt`);
    });
    await page.getByRole("button", { name: "Subir", exact: true }).click();
    await expect(page.getByText(/Has seleccionado 501 archivos.*límite máximo por lote es de 500/)).toBeVisible();
    const prepareCalls = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "prepare_upload" || c.cmd === "prepare_zip_uploads"));
    assert.equal(prepareCalls.length, 0, "No upload preparation must happen when exceeding safe limit");
  });
  await test("incremental-and-full-sync-actions", async page => {
    await page.evaluate(() => { window.__qa.syncResultCount = 0; });
    const syncButton = page.getByRole("button", { name: "Sincronizar", exact: true });
    await syncButton.click();
    await expect(page.getByText("Tu catálogo ya está al día con la nube.")).toBeVisible();
    let syncCalls = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "sync_files"));
    assert.deepEqual(syncCalls[syncCalls.length - 1].args, { full: false });

    await page.evaluate(() => { window.__qa.syncResultCount = 3; });
    await syncButton.click();
    await expect(page.getByText("3 archivos nuevos sincronizados.")).toBeVisible();

    await page.evaluate(() => { window.__qa.syncResultCount = 4; });
    await syncButton.click({ button: "right" });
    await expect(page.getByText("Sincronización completa: 4 archivos procesados.")).toBeVisible();
    syncCalls = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "sync_files"));
    assert.deepEqual(syncCalls[syncCalls.length - 1].args, { full: true });
  });
  await test("telegram-auth-options-and-reset", async page => {
    await page.evaluate(() => {
      window.__qa.telegramAuthState = { stage: "phone", connected: false, message: "Ingresa el teléfono", isPremium: false };
    });
    const profileBtn = page.locator(".profile-button");
    await profileBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Verify all 4 tabs exist
    const tabs = page.locator(".auth-method-tab");
    await expect(tabs).toHaveCount(4);
    await expect(page.getByRole("tab", { name: /App Telegram/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /SMS directo/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Código QR/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Correo/ })).toBeVisible();

    // Switch to SMS directo
    await page.getByRole("tab", { name: /SMS directo/ }).click();
    await expect(page.getByText(/mensaje de texto SMS tradicional directamente a tu celular/)).toBeVisible();
    const smsInput = page.locator("#telegram-phone-sms");
    await smsInput.fill("+521234567890");
    await page.getByRole("button", { name: /Enviar código por SMS directo/ }).click();

    // Verify code stage reached and cooldown container is displayed
    await expect(page.getByLabel("Código de verificación")).toBeVisible();
    await expect(page.locator(".auth-cooldown-container")).toBeVisible();
    await expect(page.getByText(/Podrás solicitar código por SMS en/)).toBeVisible();
    let calls = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "telegram_submit_phone_sms"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.phone, "+521234567890");

    // Click back to options button
    const backBtn = page.getByRole("button", { name: /Volver a elegir método/ });
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Verify back in options with 4 tabs
    await expect(page.locator(".auth-methods-nav")).toBeVisible();
    calls = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "telegram_reset_to_phone"));
    assert.equal(calls.length, 1);

    // Switch to QR tab
    await page.getByRole("tab", { name: /Código QR/ }).click();
    await expect(page.locator(".auth-qr")).toBeVisible();

    // Switch to Correo tab
    await page.getByRole("tab", { name: /Correo/ }).click();
    await expect(page.getByText(/Para cuentas de Telegram que tengan configurado inicio de sesión mediante correo/)).toBeVisible();
    const emailInput = page.locator("#telegram-email");
    await emailInput.fill("usuario@ejemplo.com");
    await page.getByRole("button", { name: /Enviar código al correo/ }).click();

    // Verify emailCode stage reached
    await expect(page.getByLabel("Código de correo")).toBeVisible();
    calls = await page.evaluate(() => window.__qa.calls.filter(c => c.cmd === "telegram_submit_email"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.email, "usuario@ejemplo.com");

    // Close modal
    await page.locator(".modal-close").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  for (const width of [390, 768, 1280]) {
    await test(`layout-${width}`, async page => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, "Page has horizontal overflow");
      await page.screenshot({ path: path.join(output, `ui-${width}.png`), fullPage: true });
      if (width === 390) {
        await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
        await page.getByRole("button", { name: "Ajustes", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    }, { width, height: 844 });
  }
} finally {
  await browser.close();
  await writeFile(path.join(output, "ui-results.json"), JSON.stringify(results, null, 2));
}
if (results.some(result => result.status === "failed")) process.exitCode = 1;
