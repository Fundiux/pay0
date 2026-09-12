"use client";

import NoAccess from "@/components/NoAccess";
import { useModuleAccess } from "@/lib/useModuleAccess";

import ActivityLog from "../../components/ActivityLog";
import React, { useMemo, useState, useEffect } from "react";
import { collection, query, where, Timestamp, getCountFromServer } from "firebase/firestore";
import { db } from "../../lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin, isAdmin } from "@/lib/roles";

type Mode = "day" | "week" | "month" | "year" | "custom";

const getWeekNumber = (d: Date) => {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
};

const formatMonthSpanish = (d: Date) =>
  [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ][d.getMonth()];

function getEffectiveRootId(profile: any, uid?: string) {
  return String(profile?.rootId || uid || "");
}

function getEffectiveAdminId(profile: any, uid?: string) {
  const role = normalizeRole(profile?.role);
  const parentUserId = String(profile?.parentUserId || "");

  if (!uid) return "";
  if (isSuperAdmin(role) || isAdmin(role)) return uid;
  return parentUserId || uid;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { profile, loading: loadingProfile } = useUserProfile();

  const [mode, setMode] = useState<Mode>("day");
  const [baseDate, setBaseDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);

  const [customRange, setCustomRange] = useState<{ start?: Date; end?: Date }>({});
  const [counts, setCounts] = useState({ total: 0, pendientes: 0, pagadas: 0 });
  const [loadingCounts, setLoadingCounts] = useState(true);

  const uid = (user as any)?.uid;
  const role = normalizeRole((profile as any)?.role);
  const adminId = useMemo(() => getEffectiveAdminId(profile, uid), [profile, uid]);
  const rootId = useMemo(() => getEffectiveRootId(profile, uid), [profile, uid]);

  const { modules, canAccess: canViewDashboard } = useModuleAccess(profile, "dashboard", "view");
  const canViewActividad = !!modules?.actividad?.view;

  const range = useMemo(() => {
    if (mode === "custom" && customRange.start && customRange.end) {
      const from = new Date(customRange.start);
      const to = new Date(customRange.end);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    }

    const from = new Date(baseDate);
    const to = new Date(baseDate);

    if (mode === "day") {
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
    } else if (mode === "week") {
      const day = from.getDay();
      from.setDate(from.getDate() - day);
      from.setHours(0, 0, 0, 0);
      to.setDate(from.getDate() + 6);
      to.setHours(23, 59, 59, 999);
    } else if (mode === "month") {
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      to.setMonth(to.getMonth() + 1);
      to.setDate(0);
      to.setHours(23, 59, 59, 999);
    } else if (mode === "year") {
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      to.setMonth(11, 31);
      to.setHours(23, 59, 59, 999);
    }

    return { from, to };
  }, [baseDate, mode, customRange]);

  const navigate = (direction: number) => {
    if (mode === "custom") return;
    const next = new Date(baseDate);
    if (mode === "day") next.setDate(next.getDate() + direction);
    if (mode === "week") next.setDate(next.getDate() + direction * 7);
    if (mode === "month") next.setMonth(next.getMonth() + direction);
    if (mode === "year") next.setFullYear(next.getFullYear() + direction);
    setBaseDate(next);
  };

  const centerLabel = useMemo(() => {
    if (mode === "custom") return "Periodo Libre";
    if (mode === "day") return `${baseDate.getDate()}/${baseDate.getMonth() + 1}/${baseDate.getFullYear()}`;
    if (mode === "week") return `Semana ${getWeekNumber(baseDate)}`;
    if (mode === "month") return formatMonthSpanish(baseDate);
    if (mode === "year") return `${baseDate.getFullYear()}`;
    return "";
  }, [baseDate, mode]);

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setBaseDate(new Date());
    setShowPicker(false);
    setCustomRange({});
  };

  useEffect(() => {
    if (!canViewDashboard) {
      setCounts({ total: 0, pendientes: 0, pagadas: 0 });
      setLoadingCounts(false);
      return;
    }

    if (loadingProfile || !uid) return;

    setLoadingCounts(true);

    let q;
    if (isSuperAdmin(role)) {
      if (!rootId) {
        setCounts({ total: 0, pendientes: 0, pagadas: 0 });
        setLoadingCounts(false);
        return;
      }

      q = query(
        collection(db, "solicitudes"),
        where("rootId", "==", rootId),
        where("createdAt", ">=", Timestamp.fromDate(range.from)),
        where("createdAt", "<=", Timestamp.fromDate(range.to))
      );
    } else if (isAdmin(role)) {
      q = query(
        collection(db, "solicitudes"),
        where("adminId", "==", uid),
        where("createdAt", ">=", Timestamp.fromDate(range.from)),
        where("createdAt", "<=", Timestamp.fromDate(range.to))
      );
    } else {
      q = query(
        collection(db, "solicitudes"),
        where("createdBy", "==", uid),
        where("createdAt", ">=", Timestamp.fromDate(range.from)),
        where("createdAt", "<=", Timestamp.fromDate(range.to))
      );
    }

    let active = true;
    const countForStatus = (status: string) =>
      getCountFromServer(query(q, where("status", "==", status))).then((result) => result.data().count);

    Promise.all([
      getCountFromServer(q).then((result) => result.data().count),
      countForStatus("PROCESANDO"),
      countForStatus("CONCILIACION_PENDIENTE"),
      countForStatus("COMPLETADA"),
    ])
      .then(([total, procesando, conciliacionPendiente, pagadas]) => {
        if (!active) return;
        setCounts({ total, pendientes: procesando + conciliacionPendiente, pagadas });
      })
      .catch((err) => {
        console.error("[Dashboard] conteos de solicitudes error:", err);
      })
      .finally(() => {
        if (active) setLoadingCounts(false);
      });

    return () => { active = false; };
  }, [uid, rootId, role, range, loadingProfile, canViewDashboard]);

  const calendarDays = useMemo(() => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
    return days;
  }, [baseDate]);

  const handleDateClick = (date: Date) => {
    if (!customRange.start || (customRange.start && customRange.end)) {
      setCustomRange({ start: date });
    } else if (date < customRange.start) {
      setCustomRange({ start: date });
    } else {
      setCustomRange({ ...customRange, end: date });
      setMode("custom");
      setShowPicker(false);
    }
  };

  if (!canViewDashboard) {
    return <NoAccess message="No tienes acceso al Dashboard." />;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] pb-10">
      <div className="sticky top-0 z-[100] border-b border-white/[0.03] bg-[#0b1220] py-2.5">
        <div className="relative flex min-h-[60px] flex-col gap-3 rounded-xl border border-white/[0.06] bg-[#0b1220]/80 px-4 py-2.5 backdrop-blur xl:flex-row xl:items-center">
          <div className="flex w-full flex-wrap gap-1.5 xl:w-auto">
            {(["day", "week", "month", "year"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  background: mode === m ? "rgba(56, 189, 248, 0.15)" : "transparent",
                  color: mode === m ? "#38bdf8" : "#64748b",
                  border: mode === m ? "1px solid #38bdf8" : "1px solid transparent",
                  cursor: "pointer"
                }}
              >
                {m === "day" ? "DÍA" : m === "week" ? "SEMANA" : m === "month" ? "MES" : "AÑO"}
              </button>
            ))}
          </div>

          <div className="flex w-full items-center justify-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.03] px-4 py-2 xl:absolute xl:left-1/2 xl:w-auto xl:-translate-x-1/2" style={{ opacity: mode === "custom" ? 0.5 : 1 }}>
            <button onClick={() => navigate(-1)} disabled={mode === "custom"} style={{ color: "#38bdf8", fontSize: 22, background: "none", border: "none", cursor: "pointer" }}>-</button>
            <span style={{ color: "#f8fafc", fontWeight: 600, fontSize: 14, minWidth: 100, textAlign: "center" }}>{centerLabel}</span>
            <button onClick={() => navigate(1)} disabled={mode === "custom"} style={{ color: "#38bdf8", fontSize: 22, background: "none", border: "none", cursor: "pointer" }}>+</button>
          </div>

          <div className="relative w-full xl:ml-auto xl:w-auto">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="w-full justify-center xl:w-auto"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 18px",
                borderRadius: 8,
                background: mode === "custom" ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.4)",
                color: mode === "custom" ? "#38bdf8" : "#f1f5f9",
                border: mode === "custom" ? "1px solid #38bdf8" : "1px solid rgba(255,255,255,0.1)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Calendario
            </button>

            {showPicker && (
              <div
                style={{
                  position: "absolute",
                  top: "55px",
                  right: 0,
                  zIndex: 1000,
                  background: "#0b1220",
                  border: "1px solid #334155",
                  borderRadius: "12px",
                  padding: "20px",
                  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.7)",
                  width: "min(320px, calc(100vw - 32px))"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", color: "#fff", marginBottom: "15px", fontWeight: "bold" }}>
                  <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer" }}>-</button>
                  <span>{formatMonthSpanish(baseDate)} {baseDate.getFullYear()}</span>
                  <button onClick={() => navigate(1)} style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer" }}>+</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "5px", textAlign: "center" }}>
                  {["L", "M", "M", "J", "V", "S", "D"].map((d) => (
                    <span key={d} style={{ color: "#64748b", fontSize: "10px", fontWeight: "bold" }}>{d}</span>
                  ))}

                  {calendarDays.map((date, i) => {
                    if (!date) return <div key={`empty-${i}`} />;
                    const isStart = customRange.start?.toDateString() === date.toDateString();
                    const isEnd = customRange.end?.toDateString() === date.toDateString();
                    const inRange = customRange.start && customRange.end && date > customRange.start && date < customRange.end;

                    return (
                      <button
                        key={date.toISOString()}
                        onClick={() => handleDateClick(date)}
                        style={{
                          padding: "8px 0",
                          border: "none",
                          borderRadius: isStart ? "4px 0 0 4px" : isEnd ? "0 4px 4px 0" : "0",
                          background: (isStart || isEnd) ? "#38bdf8" : inRange ? "rgba(56, 189, 248, 0.2)" : "transparent",
                          color: (isStart || isEnd) ? "#000" : "#fff",
                          cursor: "pointer",
                          fontSize: "12px",
                          fontWeight: (isStart || isEnd) ? "bold" : "normal"
                        }}
                      >
                        {date.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 min-w-0">
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
          <Card title="Solicitudes" value={counts.total} color="#38bdf8" range={range} loading={loadingCounts} />
          <Card title="Pendientes" value={counts.pendientes} color="#fbbf24" range={range} loading={loadingCounts} />
          <Card title="Pagadas" value={counts.pagadas} color="#34d399" range={range} loading={loadingCounts} />
        </div>

        {canViewActividad && (
          <div className="relative z-10 mt-6 min-w-0">
            <ActivityLog
              adminId={adminId}
              rootId={rootId}
              from={range.from}
              to={range.to}
              hideAuthEvents={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, value, color, range, loading }: any) {
  const fmt = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div
      className="rounded-2xl border border-white/10 bg-[#161d2b] px-5 py-4 shadow-xl"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="text-[12px] font-normal uppercase tracking-widest" style={{ color }}>
        {title}
      </div>
      <div className="mt-2 text-[28px] font-normal tabular-nums text-white">
        {loading ? "..." : value}
      </div>
      <div className="mt-2 text-[11px] font-normal uppercase tracking-wide text-slate-500">
        {fmt(range.from)} - {fmt(range.to)}
      </div>
    </div>
  );
}







