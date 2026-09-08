"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Copy, RefreshCw, Send, Unlink } from "lucide-react";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import {
  createTelegramLinkToken,
  getMyTelegramLinkStatus,
  getMyTelegramNotificationPrefs,
  unlinkMyTelegramAccount,
  sendMyTelegramTestNotification,
  updateMyTelegramNotificationPrefs,
  type TelegramLinkStatusResult,
  type TelegramNotificationPrefs,
} from "@/services/telegram";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(value: string) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

export default function TelegramPage() {
  const { profile } = useUserProfile();
  const { canAccess } = useModuleAccess(profile, "telegram", "view");

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [polling, setPolling] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [msg, setMsg] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [status, setStatus] = useState<TelegramLinkStatusResult | null>(null);
  const [prefs, setPrefs] = useState<TelegramNotificationPrefs | null>(null);

  const telegramUsername = useMemo(() => {
    const raw = String(status?.telegramUsername || "").trim();
    if (!raw) return "";
    return raw.startsWith("@") ? raw : `@${raw}`;
  }, [status]);

  async function refreshPrefs(options?: { silent?: boolean }) {
    if (!canAccess) return null;

    try {
      const res = await getMyTelegramNotificationPrefs();
      setPrefs(res.prefs);
      return res.prefs;
    } catch (e: any) {
      if (!options?.silent) {
        setMsg(`Error preferencias Telegram: ${e?.code || ""} ${e?.message || e}`);
      }
      return null;
    }
  }

  async function refreshStatus(options?: { silent?: boolean }) {
    if (!canAccess) return null;

    if (!options?.silent) {
      setChecking(true);
      setMsg("");
    }

    try {
      const res = await getMyTelegramLinkStatus();
      setStatus(res);

      if (res.linked) {
        setStartUrl("");
        setExpiresAt("");
        setPolling(false);
      }

      return res;
    } catch (e: any) {
      if (!options?.silent) {
        setMsg(`Error status Telegram: ${e?.code || ""} ${e?.message || e}`);
      }
      return null;
    } finally {
      if (!options?.silent) {
        setChecking(false);
      }
    }
  }

  async function refreshAll(options?: { silent?: boolean }) {
    await Promise.all([
      refreshStatus(options),
      refreshPrefs(options),
    ]);
  }

  async function savePrefs(next: Partial<TelegramNotificationPrefs>) {
    setSavingPrefs(true);
    setMsg("");

    try {
      const res = await updateMyTelegramNotificationPrefs({
        ...prefs,
        ...next,
      });

      setPrefs(res.prefs);
      setMsg("Preferencias Telegram guardadas.");
    } catch (e: any) {
      setMsg(`Error guardando preferencias: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setSavingPrefs(false);
    }
  }

  async function sendTestNotification() {
    if (!status?.linked) {
      setMsg("Primero vincula Telegram.");
      return;
    }

    setSendingTest(true);
    setMsg("");

    try {
      const res = await sendMyTelegramTestNotification();

      if (res.sent) {
        setMsg("Notificacion de prueba enviada.");
      } else if (res.reason === "notifications_disabled") {
        setMsg("Notificaciones Telegram pausadas. Activalas para enviar prueba.");
      } else {
        setMsg("No se envio la notificacion de prueba.");
      }
    } catch (e: any) {
      setMsg(`Error enviando prueba Telegram: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setSendingTest(false);
    }
  }
  async function generateLink() {
    setLoading(true);
    setMsg("");
    setStartUrl("");
    setExpiresAt("");

    try {
      const res = await createTelegramLinkToken();
      setStartUrl(res.startUrl || "");
      setExpiresAt(res.expiresAt || "");
      setPolling(true);
      setMsg("Enlace generado. Abre Telegram y confirma la vinculacion.");
      await refreshAll({ silent: true });
    } catch (e: any) {
      setMsg(`Error generando enlace: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function unlinkAccount() {
    if (!status?.linked) return;

    const ok = window.confirm("Desvincular Telegram de esta cuenta PAY0?");
    if (!ok) return;

    setUnlinking(true);
    setMsg("");

    try {
      await unlinkMyTelegramAccount();
      setStartUrl("");
      setExpiresAt("");
      setPolling(false);
      setMsg("Cuenta Telegram desvinculada.");
      await refreshAll({ silent: true });
    } catch (e: any) {
      setMsg(`Error desvinculando Telegram: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setUnlinking(false);
    }
  }

  async function copyLink() {
    if (!startUrl) return;

    try {
      await navigator.clipboard.writeText(startUrl);
      setMsg("Enlace copiado.");
    } catch {
      setMsg("No se pudo copiar automaticamente. Copia el enlace manualmente.");
    }
  }

  useEffect(() => {
    refreshAll({ silent: true });
  }, [canAccess]);

  useEffect(() => {
    function onFocus() {
      refreshAll({ silent: true });
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [canAccess]);

  useEffect(() => {
    if (!polling || !startUrl || status?.linked) return;

    let tries = 0;
    const maxTries = 40;

    const timer = window.setInterval(async () => {
      tries += 1;
      const res = await refreshStatus({ silent: true });

      if (res?.linked) {
        setMsg("Cuenta Telegram vinculada.");
        window.clearInterval(timer);
        return;
      }

      if (tries >= maxTries) {
        setPolling(false);
        window.clearInterval(timer);
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [polling, startUrl, status?.linked, canAccess]);

  if (!canAccess) {
    return (
      <main className="p-6 text-slate-400">
        No tienes acceso a Telegram.
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-slate-100 text-2xl font-semibold">Telegram</div>
          <div className="text-slate-400 text-sm mt-1">
            Vincula tu cuenta Telegram con PAY0 sin ejecutar acciones operativas.
          </div>
        </div>

        <button
          onClick={() => refreshAll()}
          disabled={checking}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-slate-100 disabled:opacity-60"
        >
          <RefreshCw className={cx("h-4 w-4", checking && "animate-spin")} />
          Revisar
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-white/5 border border-white/10 p-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-sky-500/15 border border-sky-400/20 grid place-items-center">
              <Send className="h-5 w-5 text-sky-300" />
            </div>

            <div>
              <div className="text-slate-100 font-semibold">Estado de vinculacion</div>
              <div className="text-slate-400 text-sm">Cuenta PAY0 actual</div>
            </div>
          </div>

          <div className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <span className="text-slate-400">Estado</span>
              <span
                className={cx(
                  "px-3 py-1 rounded-lg border text-xs font-semibold",
                  status?.linked
                    ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
                    : "bg-amber-500/15 border-amber-400/30 text-amber-200"
                )}
              >
                {status?.linked ? "Vinculada" : "No vinculada"}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
              <span className="text-slate-400">Usuario Telegram</span>
              <span className="text-slate-100 font-semibold">{telegramUsername || "N/D"}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Rol PAY0</span>
              <span className="text-slate-100 font-semibold">{status?.role || "N/D"}</span>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white/5 border border-white/10 p-5">
          <div className="text-slate-100 font-semibold">Generar enlace seguro</div>
          <div className="text-slate-400 text-sm mt-1">
            El enlace dura 15 minutos. Se usa una sola vez desde Telegram.
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={generateLink}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/15 border border-sky-400/30 hover:bg-sky-500/20 text-sky-100 font-semibold disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {loading ? "Generando..." : "Generar enlace"}
            </button>

            {status?.linked && (
              <button
                onClick={unlinkAccount}
                disabled={unlinking}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-400/30 hover:bg-red-500/15 text-red-100 font-semibold disabled:opacity-60"
              >
                <Unlink className="h-4 w-4" />
                {unlinking ? "Desvinculando..." : "Desvincular"}
              </button>
            )}

            {startUrl && (
              <>
                <button
                  onClick={copyLink}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-slate-100"
                >
                  <Copy className="h-4 w-4" />
                  Copiar
                </button>

                <a
                  href={startUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-slate-100"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Telegram
                </a>
              </>
            )}
          </div>

          {startUrl && (
            <div className="mt-5 rounded-xl bg-black/20 border border-white/10 p-3">
              <div className="text-slate-400 text-xs mb-2">Enlace</div>
              <div className="text-slate-100 text-sm break-all">{startUrl}</div>
              <div className="text-slate-500 text-xs mt-2">
                Expira: {formatDate(expiresAt)}
              </div>
              {polling && (
                <div className="text-sky-300 text-xs mt-2">
                  Esperando confirmacion desde Telegram...
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-slate-100 font-semibold">Preferencias Telegram</div>
            <div className="text-slate-400 text-sm mt-1">
              Configuracion preparada para futuras notificaciones. No envia avisos automaticos todavia.
            </div>
          </div>

                    <button
            onClick={sendTestNotification}
            disabled={sendingTest || !status?.linked}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-400/30 hover:bg-sky-500/15 text-sky-100 text-xs font-semibold disabled:opacity-50"
          >
            {sendingTest ? "Enviando..." : "Enviar prueba"}
          </button>
<span
            className={cx(
              "px-3 py-1 rounded-lg border text-xs font-semibold",
              prefs?.enabled
                ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
                : "bg-slate-500/15 border-slate-400/20 text-slate-300"
            )}
          >
            {prefs?.enabled ? "Activas" : "Pausadas"}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-4 py-3">
            <span className="text-slate-200 text-sm">Notificaciones Telegram</span>
            <input
              type="checkbox"
              checked={Boolean(prefs?.enabled)}
              disabled={savingPrefs}
              onChange={(e) => savePrefs({ enabled: e.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-4 py-3">
            <span className="text-slate-200 text-sm">Saldo usuario</span>
            <input
              type="checkbox"
              checked={Boolean(prefs?.notifySaldo)}
              disabled={savingPrefs}
              onChange={(e) => savePrefs({ notifySaldo: e.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-4 py-3">
            <span className="text-slate-200 text-sm">Pagos</span>
            <input
              type="checkbox"
              checked={Boolean(prefs?.notifyPagos)}
              disabled={savingPrefs}
              onChange={(e) => savePrefs({ notifyPagos: e.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-4 py-3">
            <span className="text-slate-200 text-sm">Solicitudes</span>
            <input
              type="checkbox"
              checked={Boolean(prefs?.notifySolicitudes)}
              disabled={savingPrefs}
              onChange={(e) => savePrefs({ notifySolicitudes: e.target.checked })}
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-4 py-3">
            <span className="text-slate-200 text-sm">Dispersiones</span>
            <input
              type="checkbox"
              checked={Boolean(prefs?.notifyDispersiones)}
              disabled={savingPrefs}
              onChange={(e) => savePrefs({ notifyDispersiones: e.target.checked })}
            />
          </label>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white/5 border border-white/10 p-5">
        <div className="text-slate-100 font-semibold">Flujo de prueba</div>
        <div className="mt-3 grid gap-2 text-sm text-slate-300">
          <div>1. Genera enlace para vincular Telegram.</div>
          <div>2. Usa /status para validar vinculacion.</div>
          <div>3. Usa /saldo para consultar saldo usuario read-only.</div>
          <div>4. Usa Desvincular para cortar acceso Telegram.</div>
          <div>5. Despues de desvincular, /saldo debe pedir nueva vinculacion.</div>
        </div>
      </div>

      {msg && (
        <div className="mt-4 rounded-xl bg-black/20 border border-white/10 px-4 py-3 text-slate-200 text-sm">
          {msg}
        </div>
      )}
    </main>
  );
}