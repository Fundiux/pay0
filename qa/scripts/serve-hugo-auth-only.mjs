import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { build } from "esbuild";

const probeDirectory = fileURLToPath(new URL("../probes/hugo-auth-only/", import.meta.url));
const firebaseNames = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
};
export const expectedRevision = "hugo-voice-gateway-canary-00012-mev";

// The operator must obtain this exact tagged URL and revision mapping from status.traffic.
// Validation narrows its destination; it does not invent or discover a Cloud Run tag.
export function validateAuthOnlyConfiguration(fileEnvironment, targetValue, revision) {
  const firebase = {};
  for (const [property, name] of Object.entries(firebaseNames)) {
    const value = fileEnvironment[name];
    if (typeof value !== "string" || !value || /\s/.test(value) || /^(?:undefined|null|todo|changeme|example|your[-_ ].*|<.*>)$/i.test(value)) {
      throw Error(`Configuracion local requerida ausente o invalida: ${name}.`);
    }
    firebase[property] = value;
  }
  if (firebase.projectId !== "pay-0-system") throw Error("Proyecto Firebase local incorrecto.");
  let target;
  try { target = new URL(targetValue); } catch { throw Error("URL etiquetada local invalida."); }
  if (revision !== expectedRevision || target.protocol !== "https:" ||
      !/^[a-z][a-z0-9-]*---hugo-voice-gateway-canary-o4tesftjlq-uc\.a\.run\.app$/.test(target.hostname) ||
      target.pathname !== "/voice" || target.port || target.username || target.password || target.search || target.hash ||
      target.href !== targetValue) {
    throw Error("Se requiere la URL etiquetada exacta /voice de la revision candidata.");
  }
  return Object.freeze({ firebase: Object.freeze(firebase), target: target.href, revision });
}

export async function loadAuthOnlyConfiguration(environment = process.env) {
  const envFile = environment.PAY0_BUILD_ENV_FILE;
  if (!envFile) throw Error("PAY0_BUILD_ENV_FILE es obligatorio para esta sonda local.");
  let fileEnvironment;
  try { fileEnvironment = parseEnv(await fs.readFile(path.resolve(envFile), "utf8")); }
  catch { throw Error("No se pudo leer el archivo protegido de configuracion local."); }
  return validateAuthOnlyConfiguration(fileEnvironment, environment.PAY0_HUGO_AUTH_ONLY_TARGET_URL, environment.PAY0_HUGO_AUTH_ONLY_EXPECTED_REVISION);
}

export async function buildAuthOnlyBrowserBundle() {
  const result = await build({
    entryPoints: [path.join(probeDirectory, "browser.mjs")], bundle: true, write: false,
    platform: "browser", format: "esm", target: "es2022", sourcemap: false, tsconfigRaw: {},
    logLevel: "silent", legalComments: "none", drop: ["console", "debugger"],
  });
  if (result.outputFiles.length !== 1) throw Error("Bundle local inesperado.");
  return result.outputFiles[0].contents;
}

export function createAuthOnlyHandler({ configuration, bundle, html, css, port }) {
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const socketOrigin = new URL(configuration.target).origin.replace("https:", "wss:");
  const headers = {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${socketOrigin}; img-src 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    "Permissions-Policy": "microphone=(), camera=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  const routes = new Map([
    ["/", ["text/html; charset=utf-8", html]],
    ["/probe.mjs", ["text/javascript; charset=utf-8", bundle]],
    ["/styles.css", ["text/css; charset=utf-8", css]],
    ["/config.json", ["application/json; charset=utf-8", JSON.stringify(configuration)]],
  ]);
  return (request, response) => {
    // Never accept a credential-bearing request body, query, foreign Host or Origin.
    // No request logging, telemetry, cookies or persistence are used by this server.
    const invalid = request.method !== "GET" || request.headers.host !== host ||
      (request.headers.origin && request.headers.origin !== origin) ||
      (request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(request.headers["sec-fetch-site"])) ||
      request.headers["transfer-encoding"] || (request.headers["content-length"] && request.headers["content-length"] !== "0") ||
      !routes.has(request.url);
    if (invalid) { response.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" }); response.end("No disponible."); return; }
    const [contentType, content] = routes.get(request.url);
    response.writeHead(200, { ...headers, "Content-Type": contentType });
    response.end(content);
  };
}

export async function startAuthOnlyServer(environment = process.env) {
  const port = Number(environment.PAY0_HUGO_AUTH_ONLY_PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error("Puerto local invalido.");
  const configuration = await loadAuthOnlyConfiguration(environment);
  const [bundle, html, css] = await Promise.all([
    buildAuthOnlyBrowserBundle(), fs.readFile(path.join(probeDirectory, "index.html")), fs.readFile(path.join(probeDirectory, "styles.css")),
  ]);
  const server = http.createServer(createAuthOnlyHandler({ configuration, bundle, html, css, port }));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${port}/` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { server, url } = await startAuthOnlyServer();
    process.stdout.write(`Sonda local auth-only preparada: ${url}\nNo captura ni persiste credenciales. Cierre con Ctrl+C al terminar.\n`);
    process.on("SIGINT", () => server.close(() => process.exit(0)));
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  } catch {
    process.stderr.write("No se pudo preparar la sonda local auth-only. Revise configuracion, URL etiquetada y puerto; no se muestran valores.\n");
    process.exitCode = 1;
  }
}
