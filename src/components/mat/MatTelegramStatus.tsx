"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getTelegramInitData,
  getTelegramPlatform,
  getBrowserTelegramName,
  initTelegramMiniAppShell,
  type MatBotScope,
} from "@/lib/telegramMiniApp";
import {
  verifyTelegramMiniAppSession,
  type VerifyTelegramMiniAppSessionResult,
} from "@/services/telegramMiniApp";

type LocalMatStatus = "LOCAL" | "CHECKING" | "OK" | "ERROR";

function getDotClass(status: LocalMatStatus) {
  if (status === "OK") return "bg-emerald-300 shadow-emerald-300/50";
  if (status === "CHECKING") return "bg-amber-300 shadow-amber-300/50";
  if (status === "ERROR") return "bg-rose-400 shadow-rose-400/50";
  return "bg-slate-700 shadow-black/40";
}

function getLabel(status: LocalMatStatus) {
  if (status === "OK") return "Conectado";
  if (status === "CHECKING") return "Conectando";
  if (status === "ERROR") return "Error";
  return "Sin conexion";
}

export function MatTelegramStatus({ scope }: { scope: MatBotScope }) {
  const [initDataLength, setInitDataLength] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [platform, setPlatform] = useState("");
  const [localStatus, setLocalStatus] = useState<LocalMatStatus>("LOCAL");
  const [session, setSession] = useState<VerifyTelegramMiniAppSessionResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    initTelegramMiniAppShell();

    const initData = getTelegramInitData();
    const name = getBrowserTelegramName();
    const currentPlatform = getTelegramPlatform();

    setInitDataLength(initData.length);
    setDisplayName(name);
    setPlatform(currentPlatform);

    if (!initData) {
      setLocalStatus("LOCAL");
      setSession(null);
      return;
    }

    setLocalStatus("CHECKING");

    verifyTelegramMiniAppSession({
      initData,
      botScope: scope,
    })
      .then((result) => {
        if (cancelled) return;
        setSession(result);
        setLocalStatus(result.ok ? "OK" : "ERROR");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[MAT] verifyTelegramMiniAppSession error", error);
        setSession(null);
        setLocalStatus("ERROR");
      });

    return () => {
      cancelled = true;
    };
  }, [scope]);

  const statusText = getLabel(localStatus);

  const title = useMemo(() => {
    const isTelegram = initDataLength > 0;
    const verifiedName = session?.displayName || displayName;
    const source = isTelegram ? "Telegram" : "Navegador";
    const linked = session?.linked ? "vinculado" : "modo limitado";
    return `${statusText} · ${source} · ${linked} · ${verifiedName || platform || "browser"}`;
  }, [displayName, initDataLength, localStatus, platform, session?.displayName, session?.linked, statusText]);

  return (
    <button
      type="button"
      aria-label={`Estado MAT: ${statusText}`}
      title={title}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/25 shadow-xl shadow-black/40 backdrop-blur-xl"
    >
      <span className={`h-3.5 w-3.5 rounded-full shadow-lg ${getDotClass(localStatus)}`} />
    </button>
  );
}