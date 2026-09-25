import { initializeApp, deleteApp, setLogLevel } from "firebase/app";
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";

// The only outgoing gateway message is authentication. Injected dependencies let
// local tests exercise this protocol without Firebase or external connections.
export async function runAuthOnlyProbe({ getIdToken, createSocket, dispose, timeoutMs = 12000 }) {
  let token = "", socket = null, timer = null, settled = false;
  try {
    return await new Promise(resolve => {
      const finish = result => {
        if (settled) return;
        settled = true;
        token = "";
        clearTimeout(timer);
        if (socket) {
          socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
          if (socket.readyState < 2) socket.close(1000, "Auth-only complete");
        }
        resolve(result);
      };
      timer = setTimeout(() => finish("TIMEOUT"), timeoutMs);
      Promise.resolve().then(getIdToken).then(value => {
        if (settled) return;
        token = value;
        if (typeof token !== "string" || !token) { finish("SESSION_UNAVAILABLE"); return; }
        socket = createSocket();
        socket.onopen = () => {
          if (settled) return;
          try { socket.send(JSON.stringify({ type: "authenticate", idToken: token })); }
          catch { finish("CONNECTION_FAILED"); }
          finally { token = ""; }
        };
        socket.onmessage = message => {
          let event;
          try { event = JSON.parse(String(message.data)); } catch { finish("INVALID_RESPONSE"); return; }
          if (event?.type === "authenticated") { finish("AUTHORIZED"); return; }
          if (event?.type === "gateway.error") { finish("AUTHORIZATION_REJECTED"); return; }
          finish("INVALID_RESPONSE");
        };
        socket.onerror = () => finish("CONNECTION_FAILED");
        socket.onclose = () => finish("CONNECTION_CLOSED");
      }).catch(() => finish("SESSION_UNAVAILABLE"));
    });
  } finally {
    token = "";
    clearTimeout(timer);
    await dispose();
  }
}

const resultMessages = Object.freeze({
  AUTHORIZED: "APROBÓ: autorización confirmada. Sonda sin sesión Realtime. Sesión local cerrada; cierre del gateway pendiente de corroborar en logs.",
  TIMEOUT: "No aprobó: tiempo de espera agotado. Conexión y sesión local cerradas.",
  SESSION_UNAVAILABLE: "No aprobó: sesión local no disponible.",
  CONNECTION_FAILED: "No aprobó: no se pudo conectar con la revisión candidata.",
  CONNECTION_CLOSED: "No aprobó: la conexión terminó antes de confirmar autorización.",
  AUTHORIZATION_REJECTED: "No aprobó: el gateway rechazó la autorización.",
  INVALID_RESPONSE: "No aprobó: respuesta de la sonda inesperada.",
});

export async function initializeAuthOnlyPage(documentObject = document) {
  setLogLevel("silent");
  const status = documentObject.getElementById("status");
  const loginForm = documentObject.getElementById("login-form");
  const emailInput = documentObject.getElementById("email");
  const passwordInput = documentObject.getElementById("password");
  const loginButton = documentObject.getElementById("login");
  const probeButton = documentObject.getElementById("probe");
  let app = null, auth = null, socket = null, disposed = false, consumed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    emailInput.value = ""; passwordInput.value = "";
    if (socket && socket.readyState < 2) socket.close(1000, "Auth-only complete");
    try { if (auth) await signOut(auth); } finally { if (app) await deleteApp(app); auth = null; app = null; }
  };
  try {
    const response = await fetch("/config.json", { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw Error("LOCAL_CONFIGURATION");
    const configuration = await response.json();
    app = initializeApp(configuration.firebase, `hugo-auth-only-${crypto.randomUUID()}`);
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
    loginButton.disabled = false;
    status.textContent = "Inicia sesión normalmente como EBASOR. Las credenciales permanecen en el navegador y Firebase Auth.";
    loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (disposed || loginButton.disabled) return;
      loginButton.disabled = true;
      let email = emailInput.value.trim(), password = passwordInput.value;
      emailInput.value = ""; passwordInput.value = "";
      try {
        await signInWithEmailAndPassword(auth, email, password);
        email = ""; password = "";
        if (disposed) return;
        loginForm.hidden = true;
        probeButton.disabled = false;
        status.textContent = "Sesión local lista. Pulsa Probar autorización una sola vez.";
      } catch {
        status.textContent = "No se pudo iniciar sesión. Verifica el acceso normal; no compartas credenciales ni capturas de sesión.";
        if (!disposed) loginButton.disabled = false;
      } finally { email = ""; password = ""; }
    });
    probeButton.addEventListener("click", async () => {
      if (consumed || disposed || !auth?.currentUser) return;
      consumed = true;
      probeButton.disabled = true;
      status.textContent = "Verificando únicamente autorización…";
      try {
        const result = await runAuthOnlyProbe({
          getIdToken: () => auth.currentUser.getIdToken(),
          createSocket: () => { socket = new WebSocket(configuration.target); return socket; },
          dispose,
        });
        status.textContent = resultMessages[result] || "No aprobó: resultado inesperado.";
      } catch { status.textContent = "No aprobó: la sonda local no pudo finalizar. Cierra esta página."; }
    });
    window.addEventListener("pagehide", () => { void dispose(); }, { once: true });
  } catch {
    status.textContent = "Sonda local no disponible. No ingreses credenciales; comunica únicamente este mensaje.";
    loginButton.disabled = true; probeButton.disabled = true;
    await dispose();
  }
}

if (typeof document !== "undefined") void initializeAuthOnlyPage();
