"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getIqAutomationDashboard,
  getIqOperatingCalendar,
  setIqAutomationMasterEnabled,
  updateIqOperatingCalendar,
  type IqAutomationProcessConfig,
  type IqOperatingCalendar,
  type IqOperatingWindow,
} from "@/services/iq";
import {
  getWhatsAppAutomationConfig,
  setWhatsAppAutomationEnabled,
  type WhatsAppAutomationState,
} from "@/services/whatsappAutomation";

const H4_D82_A3_A6_A3C_AUTOMATION_CONTROL = true;
const H4_D82_A3_A6_A3D_SOLICITUD_CREATE_AUTOMATION = true;

const DAYS = [
  ["monday", "Lunes"],
  ["tuesday", "Martes"],
  ["wednesday", "Miércoles"],
  ["thursday", "Jueves"],
  ["friday", "Viernes"],
  ["saturday", "Sábado"],
  ["sunday", "Domingo"],
] as const;

const PROCESS_ROWS: Array<{
  key: keyof IqAutomationProcessConfig;
  label: string;
  description: string;
  available: boolean;
}> = [
  {
    key: "solicitudes",
    label: "Solicitudes",
    description:
      "Automatiza el flujo completo de solicitudes IQ: creacion, recuperacion de folio, seguimiento de estado e importacion de factura.",
    available: true,
  },
  {
    key: "pagos",
    label: "Pagos",
    description:
      "Automatiza el flujo completo de depositos IQ: creacion y conciliacion.",
    available: true,
  },
  {
    key: "aplicacionPagos",
    label: "Aplicacion de pagos",
    description:
      "Continua automaticamente en IQ las aplicaciones de pago que ya fueron definidas y aplicadas en PAY0.",
    available: true,
  },
  {
    key: "dispersiones",
    label: "Dispersiones",
    description:
      "Automatiza la creacion de dispersiones IQ elegibles.",
    available: true,
  },
  {
    key: "crearCliente",
    label: "Crear cliente",
    description:
      "Sincroniza automaticamente con IQ al crear o actualizar un cliente PAY0.",
    available: true,
  },
  {
    key: "cancelarSolicitud",
    label: "Cancelar solicitud",
    description:
      "Pendiente de conectar la propagacion automatica de cancelaciones a IQ. La operacion manual no se modifica.",
    available: false,
  },
];

// H4_D87_A57_A18_DENY_BY_DEFAULT_PRE_A58
const DEFAULT_AUTOMATION: IqAutomationProcessConfig = {
  solicitudes: false,
  pagos: false,
  aplicacionPagos: false,
  dispersiones: false,
  crearCliente: false,
  cancelarSolicitud: false,
};

const DEFAULT_INTERVAL_MINUTES = {
  discovery: 20,
  invoiceImport: 20,
  statusMonitor: 20,
  solicitudCreate: 1,
  solicitudReconciliation: 20,
  pagoCreate: 1,
  pagoReconciliation: 20,
  dispersionCreate: 5,
  paymentApplicationExecution: 5,
};

const DEFAULT_WINDOWS: Record<string, IqOperatingWindow[]> = {
  monday: [{ start: "09:00", end: "19:00" }],
  tuesday: [{ start: "09:00", end: "19:00" }],
  wednesday: [{ start: "09:00", end: "19:00" }],
  thursday: [{ start: "09:00", end: "19:00" }],
  friday: [{ start: "09:00", end: "19:00" }],
  saturday: [{ start: "09:00", end: "14:30" }],
  sunday: [],
};

function defaultConfig(): IqOperatingCalendar {
  return {
    enabled: false,
    timezone: "America/Mexico_City",
    weeklyWindows: DEFAULT_WINDOWS,
    holidays: [],
    dateOverrides: {},
    creationCutoffMinutes: 20,
    reconciliationCutoffMinutes: 5,
    invoiceCutoffMinutes: 10,
    queueDrainSeconds: 15,
    automation: DEFAULT_AUTOMATION,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    configured: false,
    decisions: {},
  };
}

function withDefaults(
  input?: Partial<IqOperatingCalendar> | null,
): IqOperatingCalendar {
  const base = defaultConfig();
  const incomingWindows = input?.weeklyWindows || {};
  const hasOperatingWindow = Object.values(
    incomingWindows,
  ).some((windows) => windows.length > 0);

  return {
    ...base,
    ...input,
    weeklyWindows: hasOperatingWindow
      ? {
          ...DEFAULT_WINDOWS,
          ...incomingWindows,
        }
      : DEFAULT_WINDOWS,
    automation: {
      ...DEFAULT_AUTOMATION,
      ...(input?.automation || {}),
    },
    intervalMinutes: {
      ...DEFAULT_INTERVAL_MINUTES,
      ...(input?.intervalMinutes || {}),
    },
  };
}

function statusLabel(enabled: boolean) {
  return enabled ? "Activa" : "Pausada";
}

export default function IqAutomationPage() {
  const [config, setConfig] =
    useState<IqOperatingCalendar>(defaultConfig());
  const [dashboard, setDashboard] = useState<any>(null);
  const [whatsappAutomation, setWhatsappAutomation] =
    useState<WhatsAppAutomationState | null>(null);
  const [whatsappSaving, setWhatsappSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masterSaving, setMasterSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // H4_D87_A58_A12_INTERNAL_TABS
  const [activeTab, setActiveTab] = useState<
    "processes" | "protection" | "stats"
  >("processes");

  async function load() {
    setLoading(true);
    setError("");

    try {
      const [
        calendarResult,
        dashboardResult,
        whatsappResult,
      ] = await Promise.all([
        getIqOperatingCalendar(),
        getIqAutomationDashboard(),
        getWhatsAppAutomationConfig(),
      ]);

      setConfig(withDefaults(calendarResult.data));
      setDashboard(dashboardResult.data);
      setWhatsappAutomation(whatsappResult.data);
      setMessage(calendarResult.message || "");
    } catch (loadError: any) {
      setError(
        loadError?.message ||
          "No se pudo cargar la automatización IQ.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const enabledProcesses = useMemo(
    () =>
      PROCESS_ROWS.filter(
        (row) => config.automation[row.key],
      ).length,
    [config.automation],
  );

  // H4_D87_A59_PROCESS_SWITCH_PERSIST
  // Los switches de flujo IQ persisten inmediatamente.
  // El Master IQ sigue siendo independiente y usa su propio callable.
  async function toggleProcess(
    key: keyof IqAutomationProcessConfig,
    value: boolean,
  ) {
    if (saving) {
      return;
    }

    const next: IqOperatingCalendar = {
      ...config,
      automation: {
        ...config.automation,
        [key]: value,
      },
    };

    // Actualizacion optimista para respuesta visual inmediata.
    setConfig(next);
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await updateIqOperatingCalendar(next);

      setConfig(withDefaults(result.data));

      setMessage(
        result.message ||
          `Flujo ${String(key)} ${
            value ? "activado" : "desactivado"
          }.`,
      );
    } catch (processError: any) {
      setError(
        processError?.message ||
          "No se pudo actualizar el flujo IQ.",
      );

      // Firestore vuelve a ser la fuente de verdad si fallo el guardado.
      await load();
    } finally {
      setSaving(false);
    }
  }

  function setWindow(
    day: string,
    field: "start" | "end",
    value: string,
  ) {
    setConfig((current) => {
      const currentWindow =
        current.weeklyWindows[day]?.[0] || {
          start: "09:00",
          end: "19:00",
        };

      return {
        ...current,
        weeklyWindows: {
          ...current.weeklyWindows,
          [day]: [
            {
              ...currentWindow,
              [field]: value,
            },
          ],
        },
      };
    });
  }

  function setDayEnabled(day: string, enabled: boolean) {
    setConfig((current) => ({
      ...current,
      weeklyWindows: {
        ...current.weeklyWindows,
        [day]: enabled
          ? current.weeklyWindows[day]?.length
            ? current.weeklyWindows[day]
            : [{ start: "09:00", end: "19:00" }]
          : [],
      },
    }));
  }

  // H4_D87_A58_A3_HOLIDAY_CONTROL
  function setHoliday(value: string, enabled: boolean) {
    const date = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }

    setConfig((current) => ({
      ...current,
      holidays: enabled
        ? Array.from(new Set([...current.holidays, date])).sort()
        : current.holidays.filter((entry) => entry !== date),
    }));
  }

  // H4_D87_A58_A3_DATE_OVERRIDE_CONTROL
  function setDateOverrideClosed(dateValue: string, closed: boolean) {
    const date = dateValue.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }

    setConfig((current) => {
      const nextOverrides = { ...current.dateOverrides };

      if (closed) {
        nextOverrides[date] = { closed: true };
      } else {
        delete nextOverrides[date];
      }

      return {
        ...current,
        dateOverrides: nextOverrides,
      };
    });
  }
  async function toggleMaster(enabled: boolean) {
    setMasterSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await setIqAutomationMasterEnabled(enabled);

      setConfig((current) => ({
        ...current,
        enabled: result.data.enabled,
      }));

      setMessage(
        result.message ||
          (result.data.enabled
            ? "Master IQ activado."
            : "Master IQ desactivado."),
      );
    } catch (masterError: any) {
      setError(
        masterError?.message ||
          "No se pudo actualizar el Master IQ.",
      );
    } finally {
      setMasterSaving(false);
    }
  }

  async function toggleWhatsappAutomation(enabled: boolean) {
    setWhatsappSaving(true);
    setError("");
    setMessage("");

    try {
      const result =
        await setWhatsAppAutomationEnabled(enabled);

      setWhatsappAutomation(result.data);

      setMessage(
        result.message ||
          (result.data.enabled
            ? "Automatizacion WhatsApp activada."
            : "Automatizacion WhatsApp desactivada."),
      );
    } catch (whatsappError: any) {
      setError(
        whatsappError?.message ||
          "No se pudo actualizar la automatizacion WhatsApp.",
      );
    } finally {
      setWhatsappSaving(false);
    }
  }

  async function save(next: IqOperatingCalendar) {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      // El Master IQ es independiente de los flujos.
      // Ningun switch de flujo puede activarlo por si mismo.
      const result =
        await updateIqOperatingCalendar(next);

      setConfig(withDefaults(result.data));
      setMessage(result.message || "Automatización PAY0 guardada.");
      await load();
    } catch (saveError: any) {
      setError(
        saveError?.message ||
          "No se pudo guardar la automatización IQ.",
      );
    } finally {
      setSaving(false);
    }
  }

  const queueSummary = dashboard?.summary || {};
  const cards = [
    {
      label: "Facturas",
      value: queueSummary?.invoices?.active ?? 0,
      detail: `${queueSummary?.invoices?.failed ?? 0} con error`,
    },
    {
      label: "Creaciones",
      value: queueSummary?.creations?.active ?? 0,
      detail: `${queueSummary?.creations?.failed ?? 0} con error`,
    },
    {
      label: "Estados",
      value: queueSummary?.statuses?.active ?? 0,
      detail: `${queueSummary?.statuses?.failed ?? 0} con error`,
    },
    {
      label: "Flujos",
      value: enabledProcesses,
      detail: `${PROCESS_ROWS.length} definidos`,
    },
  ];

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
        Cargando automatización IQ...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-300">
              PAY0 / AUTOMATIZACION
            </p>
            <h1 className="mt-2 text-2xl font-semibold">
              Automatización PAY0
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Controla automatizacion IQ y WhatsApp desde un solo lugar.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/integraciones/iq/diagnostico"
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              Diagnóstico
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              Actualizar
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-100">
            {message}
          </div>
        ) : null}

        
        <nav
          aria-label="Secciones de automatizacion PAY0"
          className="flex flex-wrap gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-2"
        >
          {[
            ["processes", "Flujos automaticos"],
            ["protection", "Proteccion de consumo"],
            ["stats", "Estadisticas"],
          ].map(([key, label]) => {
            const selected = activeTab === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setActiveTab(
                    key as "processes" | "protection" | "stats",
                  )
                }
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold transition",
                  selected
                    ? "bg-sky-500 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {activeTab === "processes" ? (
          <div className="space-y-6">
<section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                Estado general IQ
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {statusLabel(config.enabled)} · Zona horaria{" "}
                {config.timezone}
              </p>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="font-semibold text-slate-200">
                    Master IQ
                  </div>
                  <div className="mt-1 max-w-xl text-slate-400">
                    OFF detiene toda ejecucion automatica IQ. Las acciones manuales de contingencia siguen disponibles.
                  </div>
                </div>

                <button
                  type="button"
                  aria-pressed={config.enabled}
                  disabled={masterSaving}
                  onClick={() =>
                    void toggleMaster(!config.enabled)
                  }
                  className={[
                    "ml-auto min-w-24 rounded-xl border px-4 py-2 text-sm font-semibold transition",
                    config.enabled
                      ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                      : "border-slate-700 bg-slate-900 text-slate-400",
                  ].join(" ")}
                >
                  {masterSaving
                    ? "..."
                    : config.enabled
                      ? "ON"
                      : "OFF"}
                </button>
              </div>
            </div>
          </div>
        </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      WhatsApp
                    </h2>

                    <p className="mt-1 text-sm text-slate-400">
                      Envio automatico de documentos por WhatsApp.
                      El control es independiente del Master IQ.
                      El envio manual desde la solicitud permanece disponible aunque esta automatizacion este apagada.
                    </p>
                  </div>

                  <button
                    type="button"
                    aria-pressed={whatsappAutomation?.enabled === true}
                    disabled={whatsappSaving}
                    onClick={() =>
                      void toggleWhatsappAutomation(
                        !(whatsappAutomation?.enabled === true),
                      )
                    }
                    className={[
                      "min-w-24 rounded-xl border px-4 py-2 text-sm font-semibold transition",
                      whatsappAutomation?.enabled
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                        : "border-slate-700 bg-slate-900 text-slate-400",
                    ].join(" ")}
                  >
                    {whatsappSaving
                      ? "..."
                      : whatsappAutomation?.enabled
                        ? "ON"
                        : "OFF"}
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Conector
                    </div>

                    <div className="mt-2 font-semibold">
                      {whatsappAutomation?.connector?.connected
                        ? "CONECTADO"
                        : whatsappAutomation?.connector?.status === "STALE"
                          ? "SIN SEÑAL"
                          : whatsappAutomation?.connector?.status || "DESCONOCIDO"}
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      {whatsappAutomation?.connector?.phoneLabel || "Sin sesion"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Chats sincronizados
                    </div>

                    <div className="mt-2 text-xl font-semibold">
                      {whatsappAutomation?.connector?.chatsCount ?? 0}
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      Ultima sincronizacion:{" "}
                      {whatsappAutomation?.connector?.lastChatsSyncedAt
                        ? new Date(
                            whatsappAutomation.connector.lastChatsSyncedAt,
                          ).toLocaleString("es-MX")
                        : "Sin registro"}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Envio del conector
                    </div>

                    <div className="mt-2 font-semibold">
                      {whatsappAutomation?.connector?.sendEnabled
                        ? "HABILITADO"
                        : "BLOQUEADO"}
                    </div>

                    <div className="mt-1 text-sm text-slate-400">
                      {whatsappAutomation?.effectiveReady
                        ? "Listo para ejecucion automatica."
                        : "La automatizacion aun no puede ejecutar envios."}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Diagnostico
                    </div>

                    <div className="mt-2 font-semibold">
                      {whatsappAutomation?.connector?.error
                        ? "CON ERROR"
                        : whatsappAutomation?.connector?.status === "STALE"
                          ? "SIN SEÑAL"
                          : "SIN ERROR"}
                    </div>

                    <div className="mt-1 break-words text-sm text-slate-400">
                      {whatsappAutomation?.connector?.error ||
                        "Sin errores reportados por el conector."}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  Auth client:{" "}
                  {whatsappAutomation?.connector?.authClientId || "Sin registro"}
                  {" · "}
                  Ultima señal:{" "}
                  {whatsappAutomation?.connector?.lastHeartbeatAt
                    ? new Date(
                        whatsappAutomation.connector.lastHeartbeatAt,
                      ).toLocaleString("es-MX")
                    : "Sin registro"}
                </div>
              </div>
            </section>
            <section>
<div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">
              Flujos automaticos IQ
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              El Master IQ controla exclusivamente los flujos IQ. Cada switch habilita o pausa un flujo IQ completo.
            </p>

            <div className="mt-5 space-y-3">
              {PROCESS_ROWS.map((row) => {
                const enabled = config.automation[row.key];

                return (
                  <div
                    key={row.key}
                    className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="font-semibold">{row.label}</div>
                        <div className="mt-1 text-sm text-slate-400">
                          {row.description}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">

                        {/* H4_D87_A58_A10_PROCESS_ON_OFF_UI */}
                        <button
                          type="button"
                          aria-pressed={enabled}
                          disabled={!row.available || saving}
                          onClick={() => {
                            if (
                              row.available &&
                              !saving
                            ) {
                              void toggleProcess(
                                row.key,
                                !enabled,
                              );
                            }
                          }}
                          className={[
                            "min-w-24 rounded-xl border px-4 py-2 text-sm font-semibold transition",
                            !row.available
                              ? "cursor-not-allowed border-amber-700/40 bg-amber-500/10 text-amber-300"
                              : enabled
                                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                                : "border-slate-700 bg-slate-900 text-slate-400",
                          ].join(" ")}
                        >
                          {!row.available
                            ? "PENDIENTE"
                            : enabled
                              ? "ON"
                              : "OFF"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
            </section>
          </div>
        ) : null}

        {activeTab === "protection" ? (
          <div className="space-y-6">
{/* H4_D87_A58_A3_TIMEZONE_CONTROL */}
        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">Zona horaria</h2>
          <p className="mt-1 text-sm text-slate-400">
            Define la zona usada para evaluar ventanas, cortes y excepciones.
          </p>

          <select
            value={config.timezone}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                timezone: event.target.value,
              }))
            }
            className="mt-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="America/Mexico_City">America/Mexico_City</option>
            <option value="America/Monterrey">America/Monterrey</option>
            <option value="America/Cancun">America/Cancun</option>
            <option value="America/Tijuana">America/Tijuana</option>
          </select>
        </section>

            <section>
<div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">
              Parámetros estrictos
            </h2>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-slate-300">
                  Corte de creación
                </span>
                <input
                  type="number"
                  min={0}
                  max={180}
                  value={config.creationCutoffMinutes}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      creationCutoffMinutes: Number(
                        event.target.value,
                      ),
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="text-slate-300">
                  Corte de conciliación
                </span>
                <input
                  type="number"
                  min={0}
                  max={180}
                  value={
                    config.reconciliationCutoffMinutes
                  }
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      reconciliationCutoffMinutes:
                        Number(event.target.value),
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="text-slate-300">
                  Corte de factura
                </span>
                <input
                  type="number"
                  min={0}
                  max={180}
                  value={config.invoiceCutoffMinutes}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      invoiceCutoffMinutes: Number(
                        event.target.value,
                      ),
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="text-slate-300">
                  Drenado de cola
                </span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={config.queueDrainSeconds}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      queueDrainSeconds: Number(
                        event.target.value,
                      ),
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
            </div>
          </div>
            </section>

<section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
          <h2 className="text-lg font-semibold">
            Ventanas operativas
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Creación de depósitos puede operar 24/7. Los demás procesos
            respetan estas ventanas.
          </p>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {DAYS.map(([key, label]) => {
              const window = config.weeklyWindows[key]?.[0];
              const enabled = Boolean(window);

              return (
                <div
                  key={key}
                  className="grid grid-cols-[auto_1fr_1fr] items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(event) =>
                        setDayEnabled(
                          key,
                          event.target.checked,
                        )
                      }
                    />
                    {label}
                  </label>

                  <input
                    type="time"
                    disabled={!enabled}
                    value={window?.start || "09:00"}
                    onChange={(event) =>
                      setWindow(
                        key,
                        "start",
                        event.target.value,
                      )
                    }
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40"
                  />

                  <input
                    type="time"
                    disabled={!enabled}
                    value={window?.end || "19:00"}
                    onChange={(event) =>
                      setWindow(
                        key,
                        "end",
                        event.target.value,
                      )
                    }
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Feriados / días cerrados</h2>
            <p className="mt-1 text-sm text-slate-400">
              Marca fechas completas en las que IQ no debe operar.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                id="iqHolidayDate"
                type="date"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("iqHolidayDate") as HTMLInputElement | null;
                  if (input?.value) {
                    setHoliday(input.value, true);
                    input.value = "";
                  }
                }}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white"
              >
                Agregar cierre
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {config.holidays.length === 0 ? (
                <p className="text-sm text-slate-500">Sin feriados configurados.</p>
              ) : (
                config.holidays.map((date) => (
                  <div
                    key={date}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
                  >
                    <span>{date}</span>
                    <button
                      type="button"
                      onClick={() => setHoliday(date, false)}
                      className="text-rose-300 hover:text-rose-200"
                    >
                      Quitar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
            <h2 className="text-lg font-semibold">Excepciones por fecha</h2>
            <p className="mt-1 text-sm text-slate-400">
              Cierra una fecha específica sin alterar el horario semanal.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                id="iqOverrideDate"
                type="date"
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const input = document.getElementById("iqOverrideDate") as HTMLInputElement | null;
                  if (input?.value) {
                    setDateOverrideClosed(input.value, true);
                    input.value = "";
                  }
                }}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950"
              >
                Cerrar fecha
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {Object.keys(config.dateOverrides).length === 0 ? (
                <p className="text-sm text-slate-500">Sin excepciones configuradas.</p>
              ) : (
                Object.entries(config.dateOverrides)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([date, override]) => (
                    <div
                      key={date}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
                    >
                      <span>
                        {date} · {override.closed ? "Cerrado" : "Ventana especial"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDateOverrideClosed(date, false)}
                        className="text-rose-300 hover:text-rose-200"
                      >
                        Quitar
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </section>

<section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
          <h2 className="text-base font-semibold text-slate-100">
            Protección de consumo
          </h2>
          <p className="mt-2">
            Los schedulers primero leen la configuración y terminan sin
            consultar colas ni abrir navegador cuando PAY0 está pausado,
            fuera de horario o con el proceso desactivado.
          </p>
        </section>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(config)}
                className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar configuracion"}
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === "stats" ? (
          <div className="space-y-6">
<section className="grid gap-4 md:grid-cols-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
            >
              <div className="text-xs uppercase tracking-wider text-slate-400">
                {card.label}
              </div>
              <div className="mt-2 text-3xl font-semibold">
                {card.value}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {card.detail}
              </div>
            </div>
          ))}
        </section>
          </div>
        ) : null}      </div>
    </main>
  );
}
