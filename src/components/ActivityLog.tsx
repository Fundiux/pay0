"use client";

import { formatDateTime24WithSeconds } from "@/lib/dateTime";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole } from "@/lib/roles";
import UiSelect from "@/components/UiSelect";
import {
  getActivityEventLabel,
  normalizeActivityEventKey,
} from "@/lib/activityEventLabels";

type Props = {
  adminId?: string;
  rootId?: string;
  from?: Date;
  to?: Date;
  hideAuthEvents?: boolean;
  title?: string;
  maxRows?: number;
  searchTerm?: string;
  eventFilter?: string;
  showInternalFilters?: boolean;
  showHeader?: boolean;
  rowDividers?: boolean;
  flat?: boolean;
};

export default function ActivityLog({
  from,
  to,
  hideAuthEvents = true,
  title = "Actividad del sistema",
  maxRows = 200,
  searchTerm,
  eventFilter,
  showInternalFilters = true,
  showHeader = true,
  rowDividers = true,
  flat = false,
}: Props) {
  const { user } = useAuth();
  const { profile } = useUserProfile();

  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [localEventFilter, setLocalEventFilter] = useState("TODOS");

  const uid = user?.uid || "";
  const role = normalizeRole((profile as any)?.role);
  const myRootId = String((profile as any)?.rootId || uid || "");

  const effectiveSearch = typeof searchTerm === "string" ? searchTerm : localSearch;
  const effectiveEventFilter = typeof eventFilter === "string" ? eventFilter : localEventFilter;

  function getEventKey(it: any) {
    return normalizeActivityEventKey(String(it?.event || it?.type || it?.eventType || ""));
  }

  function getEventColor(event: string) {
    switch (event) {
      case "SOLICITUD_CREADA":
        return "text-sky-400";
      case "SOLICITUD_CANCELADA":
        return "text-amber-400";
      case "SOLICITUD_COMPLETADA":
        return "text-emerald-400";
      case "SOLICITUD_RECHAZADA":
        return "text-rose-400";
      case "SOLICITUD_STATUS_ACTUALIZADO":
        return "text-violet-400";
      case "SOLICITUD_EN_CONCILIACION":
        return "text-cyan-400";
      case "SOLICITUD_EN_SUSTITUCION":
        return "text-fuchsia-400";
      case "SOLICITUD_SUSTITUCION_ACTUALIZADA":
        return "text-purple-300";
      case "PAGO_CREADO":
        return "text-sky-400";
      case "PAGO_STATUS_ACTUALIZADO":
        return "text-indigo-300";
      case "PAGO_APLICADO_A_SOLICITUD":
        return "text-teal-300";
      case "ABONO_REGISTRADO":
        return "text-lime-400";
      case "LOGIN":
        return "text-cyan-400";
      case "LOGOUT":
        return "text-slate-400";
      default:
        return "text-violet-300";
    }
  }

  function formatDate(ts: any) {
    if (!ts?.seconds) return { main: "-", sub: "" };

    const main = formatDateTime24WithSeconds(ts, "-");
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Zona local";
    const sub = `Hora local del sistema | ${zone}`;

    return { main, sub };
  }

  function isWithinRange(ts: any) {
    if (!from || !to) return true;
    if (!ts?.seconds) return false;
    const value = ts.seconds * 1000;
    return value >= from.getTime() && value <= to.getTime();
  }

  function looksCorrupted(text: string) {
    if (!text) return false;
    const corruptionTokens = [
      "\u00c3",
      "\u00c2",
      "\ufffd",
      "\u00e2\u20ac"
    ];
    return corruptionTokens.some((token) => text.includes(token));
  }

  function cleanDisplayName(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (looksCorrupted(raw)) return "";
    if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return "";
    if (raw.includes("@")) return "";
    return raw;
  }

  function isBusinessFolio(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    return /^[SPD]\d/i.test(raw);
  }

  function isTechnicalToken(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (isBusinessFolio(raw)) return false;
    if (/^\d+(\.\d+)?$/.test(raw)) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return false;
    return /^[A-Za-z0-9_-]{18,}$/.test(raw);
  }

  function looksTechnicalReference(value: string) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (isTechnicalToken(raw)) return true;

    const tokens = raw.match(/[A-Za-z0-9_-]{18,}/g) || [];
    return tokens.some((token) => isTechnicalToken(token));
  }

  function cleanTechnicalReferences(value: string) {
    const raw = String(value || "");
    if (!raw) return "";
    return raw.replace(/[A-Za-z0-9_-]{18,}/g, (token) => {
      return isTechnicalToken(token) ? "[ref tecnica]" : token;
    });
  }

      function getReference(it: any) {
    const primary = String(
      it.referenceFolio ||
      it.folio ||
      it.pagoFolio ||
      it.solicitudFolio ||
      it.dispersionFolio ||
      it.referenceId ||
      it.pagoId ||
      it.solicitudId ||
      it.entityId ||
      ""
    ).trim();

    if (!primary || looksCorrupted(primary) || looksTechnicalReference(primary)) return "-";
    return primary;
  }

  function getRelatedReference(it: any) {
    const related = String(
      it.relatedEntityFolio ||
      it.relatedFolio ||
      it.solicitudFolio ||
      it.pagoFolio ||
      it.dispersionFolio ||
      it.relatedEntityId ||
      it.solicitudId ||
      ""
    ).trim();

    if (!related || looksCorrupted(related) || looksTechnicalReference(related)) return "";
    return related;
  }



  function getAmount(it: any) {
    const raw = it?.amount ?? it?.monto ?? it?.total ?? it?.importe ?? null;
    if (raw === null || raw === undefined || raw === "") return "N/A";

    const n = Number(raw);
    if (Number.isNaN(n)) return "N/A";

    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
  }

  function getActorDisplay(it: any) {
    const actorUsername = cleanDisplayName(String(it.actorUsername || ""));
    if (actorUsername) return actorUsername;

    const actorName = cleanDisplayName(String(it.actorName || ""));
    if (actorName) return actorName;

    const createdByName = cleanDisplayName(String(it.createdByName || ""));
    if (createdByName) return createdByName;

    const currentProfileName = cleanDisplayName(
      String(
        (profile as any)?.username ||
        (profile as any)?.displayName ||
        (profile as any)?.name ||
        ""
      )
    );

    const matchesCurrentUser =
      String(it.actorUid || "") === uid ||
      String(it.createdBy || "") === uid ||
      String(it.actorId || "") === uid;

    if (matchesCurrentUser && currentProfileName) return currentProfileName;

    return "-";
  }

  function getCleanDescription(it: any) {
    const event = getEventKey(it);
    const raw = String(it.description || it.text || it.message || "").trim();

    if (event === "LOGIN") return "Inicio de sesion";
    if (event === "LOGOUT") return "Cierre de sesion";

    if (!raw) return "-";
    if (looksCorrupted(raw)) return "Descripcion no legible en registro historico";

    const cleaned = cleanTechnicalReferences(raw);

    if (cleaned.length > 300) return cleaned.slice(0, 300) + "...";
    return cleaned;
  }

  useEffect(() => {
    if (!uid || !role) return;

    setLoading(true);

    let qy: any;

    if (role === "superadmin") {
      qy = query(
        collection(db, "activityLog"),
        where("rootId", "==", myRootId),
        orderBy("createdAt", "desc"),
        limit(maxRows)
      );
    } else if (role === "admin") {
      qy = query(
        collection(db, "activityLog"),
        where("adminId", "==", uid),
        orderBy("createdAt", "desc"),
        limit(maxRows)
      );
    } else {
      qy = query(
        collection(db, "activityLog"),
        where("actorUid", "==", uid),
        orderBy("createdAt", "desc"),
        limit(maxRows)
      );
    }

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setActivity(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Error ActivityLog:", error);
        setActivity([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid, role, myRootId, maxRows]);

  const eventOptions = useMemo(() => {
    const hidden = hideAuthEvents ? ["LOGIN", "LOGOUT"] : [];
    const unique = Array.from(
      new Set(
        activity
          .map((it) => getEventKey(it))
          .filter(Boolean)
          .filter((event) => !hidden.includes(event))
      )
    ).sort((a, b) => getActivityEventLabel(a).localeCompare(getActivityEventLabel(b), "es"));

    return ["TODOS", ...unique];
  }, [activity, hideAuthEvents]);

  const filteredActivity = useMemo(() => {
    let data = activity;

    if (hideAuthEvents) {
      data = data.filter((it) => {
        const event = getEventKey(it);
        return event !== "LOGIN" && event !== "LOGOUT";
      });
    }

    data = data.filter((it) => isWithinRange(it.createdAt));

    if (effectiveEventFilter !== "TODOS") {
      data = data.filter((it) => getEventKey(it) === normalizeActivityEventKey(effectiveEventFilter));
    }

    if (effectiveSearch.trim()) {
      const term = effectiveSearch.toLowerCase();
      data = data.filter((it) => {
        const eventKey = getEventKey(it);
        const eventLabel = getActivityEventLabel(eventKey).toLowerCase();
        const actorDisplay = getActorDisplay(it).toLowerCase();
        const reference = getReference(it).toLowerCase();
        const description = getCleanDescription(it).toLowerCase();

        return (
          reference.includes(term) ||
          actorDisplay.includes(term) ||
          description.includes(term) ||
          eventLabel.includes(term)
        );
      });
    }

    return data;
  }, [activity, effectiveSearch, effectiveEventFilter, from, to, hideAuthEvents, profile, uid]);

  const rowClass = (index: number) =>
    index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd";

  const summaryText = from && to
    ? "Filtrado por rango de fechas"
    : "Vista reciente";

  const wrapperClass = flat
    ? ""
    : "mt-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur";

  return (
    <div className={wrapperClass}>
      {showHeader && (
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-base font-semibold text-slate-100">{title}</div>
            <div className="text-[11px] text-slate-500">
              {summaryText} | {filteredActivity.length} registro(s)
            </div>
          </div>

          {showInternalFilters && (
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Buscar por folio, pago, usuario o descripcion..."
                className="rounded border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white outline-none"
              />

              <UiSelect
                value={localEventFilter}
                onChange={(value) => setLocalEventFilter(value)}
                options={eventOptions.map((event) => ({
                  value: event,
                  label: event === "TODOS" ? "Todos los eventos" : getActivityEventLabel(event),
                }))}
                placeholder="Evento"
              />
            </div>
          )}
        </div>
      )}

      {!showHeader && (
        <div className="mb-4 text-[11px] text-slate-500">
          {summaryText} | {filteredActivity.length} registro(s)
        </div>
      )}

      {loading ? (
        <div className="pay0-empty-cell">Cargando actividad...</div>
      ) : filteredActivity.length === 0 ? (
        <div className="pay0-empty-cell">No hay registros para este filtro.</div>
      ) : (
        <div className="pay0-table-card">
          <div className="pay0-table-wrap">
          <table className="pay0-table min-w-[1200px]">
            <thead>
              <tr className="pay0-table-head-row">
                <th className="pay0-th">Fecha</th>
                <th className="pay0-th">Usuario</th>
                <th className="pay0-th">Rol</th>
                <th className="pay0-th-right">Monto</th>
                <th className="pay0-th">Referencia operativa</th>
                <th className="pay0-th">Evento</th>
                <th className="pay0-th">Descripcion</th>
              </tr>
            </thead>

            <tbody>
              {filteredActivity.map((it, index) => {
                const event = getEventKey(it);
                const reference = getReference(it);
                const relatedReference = getRelatedReference(it);
                const cleanDescription = getCleanDescription(it);
                const actorDisplay = getActorDisplay(it);
                const amountDisplay = getAmount(it);
                const dateDisplay = formatDate(it.createdAt);

                return (
                  <tr key={it.id} className={rowClass(index)}>
                    <td className="pay0-td-date text-slate-400">
                      <div>{dateDisplay.main}</div>
                      {dateDisplay.sub ? (
                        <div className="mt-0.5 text-[12px] font-normal text-slate-600">{dateDisplay.sub}</div>
                      ) : null}
                    </td>

                    <td className="pay0-td text-slate-100">
                      {actorDisplay}
                    </td>

                    <td className="pay0-td text-slate-400">
                      {it.actorRole || "-"}
                    </td>

                    <td className="pay0-td-money text-slate-300">
                      {amountDisplay}
                    </td>

                    <td className="pay0-td text-sky-400">
                      <div className="whitespace-nowrap font-mono">{reference}</div>
                      {relatedReference ? (
                        <div className="mt-1 whitespace-nowrap text-[10px] text-slate-500">
                          Relacionado: {relatedReference}
                        </div>
                      ) : null}
                    </td>

                    <td className={`pay0-td font-normal ${getEventColor(event)}`}>
                      {getActivityEventLabel(event)}
                    </td>

                    <td className="pay0-td text-slate-300">
                      <div className="max-w-[480px] whitespace-normal break-words">
                        {cleanDescription}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}