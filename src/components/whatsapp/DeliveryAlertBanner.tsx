"use client";

import { useEffect, useState } from "react";

import { getWhatsAppAutomationConfig, type WhatsAppAutomationState } from "@/services/whatsappAutomation";

const REFRESH_MS = 60_000;

// Shows why Hugo is not sending during his hours. Silent when everything is fine or the state cannot be read.
export function DeliveryAlertBanner() {
  const [alert, setAlert] = useState<WhatsAppAutomationState["deliveryAlert"]>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await getWhatsAppAutomationConfig();
        if (!cancelled) setAlert(data.deliveryAlert ?? null);
      } catch {
        // Not allowed or offline: no banner.
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!alert) return null;

  return (
    <div role="alert" className="rounded-2xl border border-orange-400/40 bg-orange-500/10 px-4 py-3 text-[13px] text-orange-200">
      <div className="font-normal text-orange-100">Hugo no está enviando documentos</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {alert.heartbeatMissing ? <li>Hugo no reporta conexión desde hace más de 5 minutos.</li> : null}
        {alert.unclaimedCount > 0 ? (
          <li>
            {alert.unclaimedCount} envío(s) llevan más de 15 minutos esperando
            {alert.oldestUnclaimedMinutes > 0 ? ` (el más antiguo, ${alert.oldestUnclaimedMinutes} min)` : ""}.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
