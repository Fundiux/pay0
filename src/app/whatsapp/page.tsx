"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  MessageCircle,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  getWhatsAppQrDashboard,
  omitWhatsAppJob,
  releaseWhatsAppJobDeliveries,
  requestWhatsAppChatsSync,
  requestWhatsAppNewQr,
  resolveWhatsAppJobDestinations,
  retryWhatsAppJobErrors,
  saveWhatsAppDeliveryRoute,
  type WhatsAppDeliveryRoute,
  type WhatsAppQrDashboard,
  type WhatsAppQrJob,
} from "@/services/whatsappQr";

type PeriodMode =
  | "DAY"
  | "WEEK"
  | "MONTH"
  | "YEAR"
  | "CUSTOM"
  | "ALL";

type StatusFilter =
  | "PENDING"
  | "ERROR"
  | "SENT"
  | "ALL";

function clean(value: unknown) {
  return String(value || "").trim();
}

function upper(value: unknown) {
  return clean(value).toUpperCase();
}

function normalizeKey(value: string) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
}

function routeKey(
  clienteId: string,
  sourceType: string,
) {
  return `${
    clean(clienteId) || "SIN_CLIENTE"
  }__${
    normalizeKey(sourceType) || "DEFAULT"
  }`;
}

function formatDate(value: unknown) {
  if (!value) return "-";

  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    "es-MX",
    {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  ).format(date);
}

function startOfDay(value: Date) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getPeriodBounds(
  mode: PeriodMode,
  customFrom: string,
  customTo: string,
): {
  from: Date | null;
  to: Date | null;
} {
  const now = new Date();

  if (mode === "ALL") {
    return {
      from: null,
      to: null,
    };
  }

  if (mode === "CUSTOM") {
    const from = customFrom
      ? new Date(`${customFrom}T00:00:00`)
      : null;

    const to = customTo
      ? new Date(`${customTo}T23:59:59.999`)
      : null;

    return { from, to };
  }

  let from =
    startOfDay(now);

  if (mode === "WEEK") {
    const day =
      from.getDay();

    const diff =
      day === 0 ? 6 : day - 1;

    from.setDate(
      from.getDate() - diff,
    );
  }

  if (mode === "MONTH") {
    from =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );
  }

  if (mode === "YEAR") {
    from =
      new Date(
        now.getFullYear(),
        0,
        1,
      );
  }

  const to = new Date(now);

  return {
    from,
    to,
  };
}

function jobStatus(job: WhatsAppQrJob) {
  return upper(job.status);
}

function isSent(job: WhatsAppQrJob) {
  if (jobStatus(job) === "SENT") {
    return true;
  }

  const stats =
    job.deliveryStatsUi;

  return Boolean(
    stats &&
      stats.total > 0 &&
      stats.sent === stats.total,
  );
}

function isError(job: WhatsAppQrJob) {
  if (
    [
      "ERROR",
      "ERROR_PARTIAL",
      "ERROR_RETRYABLE",
    ].includes(jobStatus(job))
  ) {
    return true;
  }

  return Number(
    job.deliveryStatsUi?.error || 0,
  ) > 0;
}

function isPending(job: WhatsAppQrJob) {
  const status = jobStatus(job);

  if (
    [
      "OMITTED",
      "OMITTED_BACKLOG_RESET",
      "CANCELLED",
    ].includes(status)
  ) {
    return false;
  }

  return !isSent(job) && !isError(job);
}

function isActionable(
  job: WhatsAppQrJob,
) {
  return [
    "READY_FOR_MANUAL_SEND",
    "ERROR",
    "ERROR_PARTIAL",
    "ERROR_RETRYABLE",
  ].includes(jobStatus(job));
}

function statusMatches(
  job: WhatsAppQrJob,
  filter: StatusFilter,
) {
  if (filter === "ALL") {
    return true;
  }

  if (filter === "SENT") {
    return isSent(job);
  }

  if (filter === "ERROR") {
    return isError(job);
  }

  return isPending(job);
}

function statusLabel(
  job: WhatsAppQrJob,
) {
  const status =
    jobStatus(job);

  if (isSent(job)) {
    return "Enviado";
  }

  if (isError(job)) {
    return "Error";
  }

  if (
    status === "READY_FOR_MANUAL_SEND"
  ) {
    return "Pendiente";
  }

  if (
    status === "READY_FOR_SEND"
  ) {
    return "En cola";
  }

  if (status === "SENDING") {
    return "Enviando";
  }

  return status || "Pendiente";
}

function statusClass(
  job: WhatsAppQrJob,
) {
  if (isSent(job)) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }

  if (isError(job)) {
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }

  if (
    [
      "READY_FOR_SEND",
      "SENDING",
    ].includes(jobStatus(job))
  ) {
    return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

function connectorStatusLabel(
  status: string,
) {
  if (status === "CONNECTED") {
    return "Conectado";
  }

  if (status === "QR_REQUIRED") {
    return "QR requerido";
  }

  if (status === "RESTARTING_QR") {
    return "Generando QR";
  }

  if (status === "RECOVERING") {
    return "Recuperando";
  }

  if (status === "ERROR") {
    return "Error";
  }

  return "Desconectado";
}

function clientLabel(
  job: WhatsAppQrJob,
) {
  return (
    clean(job.targetLabel) ||
    clean(job.clienteId) ||
    "SIN CLIENTE"
  );
}

function clientKey(
  job: WhatsAppQrJob,
) {
  return (
    clean(job.clienteId) ||
    normalizeKey(clientLabel(job))
  );
}

export default function WhatsAppPage() {
  const [
    data,
    setData,
  ] =
    useState<WhatsAppQrDashboard | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    busyKey,
    setBusyKey,
  ] =
    useState("");

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    periodMode,
    setPeriodMode,
  ] =
    useState<PeriodMode>("DAY");

  const [
    customFrom,
    setCustomFrom,
  ] =
    useState("");

  const [
    customTo,
    setCustomTo,
  ] =
    useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<StatusFilter>("PENDING");

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    selectedClient,
    setSelectedClient,
  ] =
    useState("");

  const [
    selectedJobs,
    setSelectedJobs,
  ] =
    useState<Set<string>>(
      new Set(),
    );

  const [
    routeSelections,
    setRouteSelections,
  ] =
    useState<
      Record<string, string[]>
    >({});

  const [
    chatSearch,
    setChatSearch,
  ] =
    useState("");

  async function load(
    silent = false,
  ) {
    if (!silent) {
      setLoading(true);
    }

    setMessage("");

    try {
      const result =
        await getWhatsAppQrDashboard();

      setData(result);

      const next:
        Record<string, string[]> = {};

      for (
        const route of
        result.routes || []
      ) {
        next[
          routeKey(
            route.clienteId,
            route.sourceType,
          )
        ] =
          (
            route.destinationChats || []
          )
            .map(
              (destination) =>
                destination.safeDocId,
            )
            .filter(Boolean);
      }

      setRouteSelections(next);
    }
    catch (error: any) {
      setMessage(
        error?.message ||
          "No se pudo cargar WhatsApp.",
      );
    }
    finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  const connector =
    data?.connector;

  const jobs =
    data?.jobs || [];

  const chats =
    data?.chats || [];

  const routes =
    data?.routes || [];

  const periodJobs =
    useMemo(() => {
      const bounds =
        getPeriodBounds(
          periodMode,
          customFrom,
          customTo,
        );

      return jobs.filter(
        (job) => {
          if (
            !bounds.from &&
            !bounds.to
          ) {
            return true;
          }

          if (!job.createdAt) {
            return false;
          }

          const date =
            new Date(
              String(job.createdAt),
            );

          if (
            Number.isNaN(
              date.getTime(),
            )
          ) {
            return false;
          }

          if (
            bounds.from &&
            date < bounds.from
          ) {
            return false;
          }

          if (
            bounds.to &&
            date > bounds.to
          ) {
            return false;
          }

          return true;
        },
      );
    }, [
      jobs,
      periodMode,
      customFrom,
      customTo,
    ]);

  const clientRows =
    useMemo(() => {
      const map =
        new Map<
          string,
          {
            key: string;
            clienteId: string;
            label: string;
            jobs: WhatsAppQrJob[];
            pending: number;
            error: number;
            sent: number;
            destinations: Set<string>;
            lastAt: string;
          }
        >();

      for (
        const job of periodJobs
      ) {
        const key =
          clientKey(job);

        const row =
          map.get(key) || {
            key,
            clienteId:
              clean(job.clienteId),
            label:
              clientLabel(job),
            jobs: [],
            pending: 0,
            error: 0,
            sent: 0,
            destinations:
              new Set<string>(),
            lastAt:
              clean(
                job.updatedAt ||
                  job.createdAt,
              ),
          };

        row.jobs.push(job);

        if (isSent(job)) {
          row.sent += 1;
        }
        else if (isError(job)) {
          row.error += 1;
        }
        else {
          row.pending += 1;
        }

        for (
          const destination of
          job.targetDestinations || []
        ) {
          if (
            clean(
              destination.chatName,
            )
          ) {
            row.destinations.add(
              clean(
                destination.chatName,
              ),
            );
          }
        }

        const candidate =
          clean(
            job.updatedAt ||
              job.createdAt,
          );

        if (
          candidate &&
          (
            !row.lastAt ||
            new Date(candidate) >
              new Date(row.lastAt)
          )
        ) {
          row.lastAt =
            candidate;
        }

        map.set(key, row);
      }

      for (
        const route of routes
      ) {
        const key =
          clean(route.clienteId);

        if (!key) continue;

        const row =
          map.get(key);

        if (!row) continue;

        for (
          const destination of
          route.destinationChats || []
        ) {
          if (
            clean(
              destination.chatName,
            )
          ) {
            row.destinations.add(
              clean(
                destination.chatName,
              ),
            );
          }
        }
      }

      const q =
        search
          .trim()
          .toLowerCase();

      return Array.from(
        map.values(),
      )
        .filter(
          (row) => {
            const hasStatus =
              row.jobs.some(
                (job) =>
                  statusMatches(
                    job,
                    statusFilter,
                  ),
              );

            if (!hasStatus) {
              return false;
            }

            if (!q) {
              return true;
            }

            return [
              row.label,
              row.clienteId,
              Array.from(
                row.destinations,
              ).join(" "),
            ]
              .join(" ")
              .toLowerCase()
              .includes(q);
          },
        )
        .sort(
          (a, b) =>
            b.pending -
              a.pending ||
            b.error -
              a.error ||
            a.label.localeCompare(
              b.label,
              "es",
            ),
        );
    }, [
      periodJobs,
      routes,
      search,
      statusFilter,
    ]);

  const selectedRow =
    useMemo(
      () =>
        clientRows.find(
          (row) =>
            row.key ===
            selectedClient,
        ) || null,
      [
        clientRows,
        selectedClient,
      ],
    );

  const selectedClientAllJobs =
    useMemo(() => {
      if (!selectedClient) {
        return [];
      }

      return periodJobs
        .filter(
          (job) =>
            clientKey(job) ===
            selectedClient,
        )
        .sort(
          (a, b) =>
            new Date(
              String(
                b.createdAt || 0,
              ),
            ).getTime() -
            new Date(
              String(
                a.createdAt || 0,
              ),
            ).getTime(),
        );
    }, [
      periodJobs,
      selectedClient,
    ]);

  const selectedClientJobs =
    useMemo(
      () =>
        selectedClientAllJobs.filter(
          (job) =>
            statusMatches(
              job,
              statusFilter,
            ),
        ),
      [
        selectedClientAllJobs,
        statusFilter,
      ],
    );

  const selectedCount =
    selectedJobs.size;

  const periodPending =
    periodJobs.filter(
      isPending,
    ).length;

  const periodErrors =
    periodJobs.filter(
      isError,
    ).length;

  const periodSent =
    periodJobs.filter(
      isSent,
    ).length;

  const selectedClientRoutes =
    useMemo(() => {
      if (!selectedRow) {
        return [];
      }

      const routeMap =
        new Map<
          string,
          WhatsAppDeliveryRoute | null
        >();

      for (
        const job of
        selectedClientAllJobs
      ) {
        const type =
          clean(job.sourceType) ||
          "DEFAULT";

        if (
          !routeMap.has(type)
        ) {
          routeMap.set(
            type,
            null,
          );
        }
      }

      for (
        const route of routes
      ) {
        if (
          clean(route.clienteId) !==
          selectedRow.clienteId
        ) {
          continue;
        }

        routeMap.set(
          clean(route.sourceType) ||
            "DEFAULT",
          route,
        );
      }

      return Array.from(
        routeMap.entries(),
      ).map(
        ([sourceType, route]) => ({
          sourceType,
          route,
        }),
      );
    }, [
      routes,
      selectedClientAllJobs,
      selectedRow,
    ]);

  const filteredChats =
    useMemo(() => {
      const q =
        chatSearch
          .trim()
          .toLowerCase();

      if (!q) {
        return chats;
      }

      return chats.filter(
        (chat) =>
          [
            chat.name,
            chat.chatId,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
      );
    }, [
      chats,
      chatSearch,
    ]);

  async function waitForConnectorCommand(
    commandId: string,
    expectQr: boolean,
  ) {
    const attempts =
      expectQr ? 60 : 30;

    for (
      let index = 0;
      index < attempts;
      index += 1
    ) {
      await new Promise(
        (resolve) =>
          window.setTimeout(
            resolve,
            1500,
          ),
      );

      const next =
        await getWhatsAppQrDashboard();

      setData(next);

      if (
        expectQr &&
        String(
          next.connector.status,
        ) === "QR_REQUIRED" &&
        Boolean(
          next.connector.qrDataUrl,
        )
      ) {
        return next;
      }

      const connectorAny =
        next.connector as any;

      if (
        connectorAny.lastCommandId !==
        commandId
      ) {
        continue;
      }

      const status =
        upper(
          connectorAny
            .lastCommandStatus,
        );

      if (status === "DONE") {
        return next;
      }

      if (status === "ERROR") {
        throw new Error(
          connectorAny
            .lastCommandMessage ||
            "El conector no completo la operacion.",
        );
      }
    }

    throw new Error(
      expectQr
        ? "No se genero el QR dentro del tiempo esperado."
        : "La sincronizacion no termino dentro del tiempo esperado.",
    );
  }

  async function syncWhatsApp() {
    setBusyKey(
      "sync-whatsapp",
    );

    try {
      const command =
        await requestWhatsAppChatsSync();

      const next =
        await waitForConnectorCommand(
          command.commandId,
          false,
        );

      alert(
        `WhatsApp actualizado. ${
          next.connector.chatsCount ||
          next.chats.length ||
          0
        } chats/grupos activos.`,
      );

      await load(true);
    }
    catch (error: any) {
      alert(
        error?.message ||
          "No se pudo sincronizar WhatsApp.",
      );
    }
    finally {
      setBusyKey("");
    }
  }

  async function newQr() {
    const confirmed =
      confirm(
        "Se reemplazara la sesion activa de WhatsApp y se generara un QR nuevo. ¿Continuar?",
      );

    if (!confirmed) {
      return;
    }

    setBusyKey("new-qr");

    try {
      const command =
        await requestWhatsAppNewQr();

      await waitForConnectorCommand(
        command.commandId,
        true,
      );

      alert(
        "QR nuevo disponible. Escanealo en esta misma pantalla.",
      );
    }
    catch (error: any) {
      alert(
        error?.message ||
          "No se pudo generar el QR.",
      );
    }
    finally {
      setBusyKey("");
    }
  }

  async function executeJob(
    job: WhatsAppQrJob,
  ) {
    if (
      String(
        connector?.status || "",
      ) !== "CONNECTED"
    ) {
      throw new Error(
        "El conector WhatsApp no esta conectado.",
      );
    }

    const status =
      jobStatus(job);

    if (
      [
        "ERROR",
        "ERROR_PARTIAL",
        "ERROR_RETRYABLE",
      ].includes(status)
    ) {
      await retryWhatsAppJobErrors({
        jobId: job.id,
      });

      return;
    }

    if (
      status !==
      "READY_FOR_MANUAL_SEND"
    ) {
      throw new Error(
        `El job ${job.id} no esta listo para envio manual.`,
      );
    }

    let destinations =
      (
        job.targetDestinations || []
      ).length;

    if (
      destinations === 0
    ) {
      const resolved =
        await resolveWhatsAppJobDestinations(
          {
            jobId: job.id,
          },
        );

      destinations =
        Number(
          resolved.destinationsCount ||
            0,
        );

      if (
        destinations === 0
      ) {
        throw new Error(
          `${clientLabel(
            job,
          )}: no tiene destino WhatsApp configurado.`,
        );
      }
    }

    await releaseWhatsAppJobDeliveries(
      {
        jobId: job.id,
      },
    );
  }

  async function sendOne(
    job: WhatsAppQrJob,
  ) {
    const key =
      `send-${job.id}`;

    setBusyKey(key);

    try {
      await executeJob(job);

      alert(
        isError(job)
          ? "Reintento liberado."
          : "Envio liberado a WhatsApp.",
      );

      await load(true);
    }
    catch (error: any) {
      alert(
        error?.message ||
          "No se pudo enviar.",
      );
    }
    finally {
      setBusyKey("");
    }
  }

  async function sendSelected() {
    const ids =
      Array.from(
        selectedJobs,
      );

    if (
      ids.length === 0
    ) {
      return;
    }

    if (
      !confirm(
        `Enviar/reintentar ${ids.length} documento(s) seleccionados?`,
      )
    ) {
      return;
    }

    setBusyKey(
      "bulk-send",
    );

    let ok = 0;
    const errors:
      string[] = [];

    for (
      const id of ids
    ) {
      const job =
        jobs.find(
          (item) =>
            item.id === id,
        );

      if (!job) {
        continue;
      }

      try {
        await executeJob(job);
        ok += 1;
      }
      catch (error: any) {
        errors.push(
          `${
            clientLabel(job)
          }: ${
            error?.message ||
            "error"
          }`,
        );
      }
    }

    setSelectedJobs(
      new Set(),
    );

    await load(true);

    setBusyKey("");

    alert(
      [
        `Procesados: ${ok}.`,
        errors.length
          ? `Con error: ${errors.length}.`
          : "",
        errors.length
          ? errors
              .slice(0, 5)
              .join("\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  function toggleJob(
    jobId: string,
  ) {
    setSelectedJobs(
      (previous) => {
        const next =
          new Set(previous);

        if (
          next.has(jobId)
        ) {
          next.delete(jobId);
        }
        else {
          next.add(jobId);
        }

        return next;
      },
    );
  }

  function selectVisible() {
    const actionable =
      selectedClientJobs
        .filter(
          isActionable,
        )
        .map(
          (job) => job.id,
        );

    setSelectedJobs(
      new Set(actionable),
    );
  }

  async function saveRoute(
    sourceType: string,
  ) {
    if (
      !selectedRow?.clienteId
    ) {
      alert(
        "Este registro no tiene clienteId.",
      );
      return;
    }

    const key =
      routeKey(
        selectedRow.clienteId,
        sourceType,
      );

    const chatDocIds =
      routeSelections[key] || [];

    if (
      chatDocIds.length === 0
    ) {
      alert(
        "Selecciona al menos un grupo o contacto.",
      );
      return;
    }

    setBusyKey(
      `route-${key}`,
    );

    try {
      const result =
        await saveWhatsAppDeliveryRoute(
          {
            clienteId:
              selectedRow.clienteId,
            sourceType,
            chatDocIds,
          },
        );

      alert(
        result.message ||
          "Ruta guardada.",
      );

      await load(true);
    }
    catch (error: any) {
      alert(
        error?.message ||
          "No se pudo guardar la ruta.",
      );
    }
    finally {
      setBusyKey("");
    }
  }

  async function omitJob(
    job: WhatsAppQrJob,
  ) {
    const reason =
      prompt(
        "Motivo para omitir:",
        "No enviar",
      );

    if (!reason) {
      return;
    }

    setBusyKey(
      `omit-${job.id}`,
    );

    try {
      await omitWhatsAppJob({
        jobId: job.id,
        reason,
      });

      await load(true);
    }
    catch (error: any) {
      alert(
        error?.message ||
          "No se pudo omitir.",
      );
    }
    finally {
      setBusyKey("");
    }
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 text-slate-100">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            WhatsApp
          </h1>

          <p className="mt-1 text-sm text-slate-400">
            Envios de documentos, rutas y conexion QR.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className={
              "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold " +
              (
                String(
                  connector?.status ||
                  "",
                ) ===
                "CONNECTED"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-200"
              )
            }
          >
            {
              String(
                connector?.status ||
                "",
              ) ===
              "CONNECTED"
                ? (
                  <Wifi className="h-4 w-4" />
                )
                : (
                  <WifiOff className="h-4 w-4" />
                )
            }

            {connectorStatusLabel(
              String(
                connector?.status ||
                "",
              ),
            )}
          </div>

          <button
            type="button"
            onClick={syncWhatsApp}
            disabled={
              loading ||
              Boolean(busyKey)
            }
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <RefreshCw
              className={
                busyKey ===
                "sync-whatsapp"
                  ? "h-4 w-4 animate-spin"
                  : "h-4 w-4"
              }
            />

            Sincronizar WhatsApp
          </button>

          <button
            type="button"
            onClick={newQr}
            disabled={
              loading ||
              Boolean(busyKey)
            }
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/20 disabled:opacity-50"
          >
            <QrCode className="h-4 w-4" />
            Nuevo QR
          </button>

          <button
            type="button"
            onClick={() => load()}
            disabled={
              loading ||
              Boolean(busyKey)
            }
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            Actualizar
          </button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {message}
        </div>
      ) : null}

      {connector?.qrDataUrl ? (
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-sky-500/20 bg-sky-500/[0.04] p-4">
          <img
            src={connector.qrDataUrl}
            alt="QR WhatsApp"
            className="h-52 w-52 rounded-xl bg-white p-2"
          />

          <div>
            <div className="text-base font-bold text-sky-100">
              Escanea el QR
            </div>

            <div className="mt-1 text-sm text-slate-400">
              El QR se genero desde PAY0. No necesitas abrir PowerShell.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Sesion
          </div>
          <div className="mt-1 font-semibold">
            {connector?.phoneLabel || "-"}
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
          <div className="text-xs uppercase tracking-wider text-amber-300/70">
            Pendientes
          </div>
          <div className="mt-1 text-xl font-bold text-amber-200">
            {periodPending}
          </div>
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-4">
          <div className="text-xs uppercase tracking-wider text-rose-300/70">
            Errores
          </div>
          <div className="mt-1 text-xl font-bold text-rose-200">
            {periodErrors}
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
          <div className="text-xs uppercase tracking-wider text-emerald-300/70">
            Enviadas
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-200">
            {periodSent}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">

        <div className="flex flex-wrap items-center gap-2">
          {
            [
              ["DAY", "Dia"],
              ["WEEK", "Semana"],
              ["MONTH", "Mes"],
              ["YEAR", "Año"],
              ["CUSTOM", "Periodo"],
              ["ALL", "Todo"],
            ].map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setPeriodMode(
                      value as PeriodMode,
                    );
                    setSelectedJobs(
                      new Set(),
                    );
                  }}
                  className={
                    "rounded-lg border px-3 py-1.5 text-xs font-bold " +
                    (
                      periodMode ===
                      value
                        ? "border-sky-500/40 bg-sky-500/10 text-sky-100"
                        : "border-white/10 bg-black/20 text-slate-400 hover:bg-white/5"
                    )
                  }
                >
                  {label}
                </button>
              ),
            )
          }

          {periodMode ===
          "CUSTOM" ? (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={
                  (event) =>
                    setCustomFrom(
                      event.target.value,
                    )
                }
                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"
              />

              <span className="text-xs text-slate-500">
                a
              </span>

              <input
                type="date"
                value={customTo}
                onChange={
                  (event) =>
                    setCustomTo(
                      event.target.value,
                    )
                }
                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-200"
              />
            </>
          ) : null}

          <div className="mx-1 h-5 w-px bg-white/10" />

          {
            [
              ["PENDING", "Pendientes"],
              ["ERROR", "Errores"],
              ["SENT", "Enviadas"],
              ["ALL", "Todas"],
            ].map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setStatusFilter(
                      value as StatusFilter,
                    );
                    setSelectedJobs(
                      new Set(),
                    );
                  }}
                  className={
                    "rounded-lg border px-3 py-1.5 text-xs font-bold " +
                    (
                      statusFilter ===
                      value
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-100"
                        : "border-white/10 bg-black/20 text-slate-400 hover:bg-white/5"
                    )
                  }
                >
                  {label}
                </button>
              ),
            )
          }

          <div className="relative ml-auto min-w-[230px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

            <input
              value={search}
              onChange={
                (event) =>
                  setSearch(
                    event.target.value,
                  )
              }
              placeholder="Buscar cliente o destino"
              className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">

        <div className="border-b border-white/10 px-4 py-3">
          <h2 className="font-bold">
            Clientes
          </h2>
          <p className="text-xs text-slate-500">
            Las facturas enviadas quedan almacenadas; solo se muestran al abrir el cliente o elegir Enviadas.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-sm">
            <thead className="bg-black/20 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  Cliente
                </th>
                <th className="px-4 py-3">
                  Destino
                </th>
                <th className="px-4 py-3 text-center">
                  Pend.
                </th>
                <th className="px-4 py-3 text-center">
                  Error
                </th>
                <th className="px-4 py-3 text-center">
                  Enviadas
                </th>
                <th className="px-4 py-3">
                  Ultimo movimiento
                </th>
                <th className="px-4 py-3 text-right">
                  Accion
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Cargando WhatsApp...
                  </td>
                </tr>
              ) : clientRows.length ===
                0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No hay registros para este periodo/filtro.
                  </td>
                </tr>
              ) : (
                clientRows.map(
                  (row) => (
                    <tr
                      key={row.key}
                      className={
                        selectedClient ===
                        row.key
                          ? "bg-sky-500/[0.06]"
                          : "hover:bg-white/[0.02]"
                      }
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">
                          {row.label}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {Array.from(
                          row.destinations,
                        ).join(", ") ||
                          "Sin destino"}
                      </td>

                      <td className="px-4 py-3 text-center font-bold text-amber-200">
                        {row.pending}
                      </td>

                      <td className="px-4 py-3 text-center font-bold text-rose-200">
                        {row.error}
                      </td>

                      <td className="px-4 py-3 text-center font-bold text-emerald-200">
                        {row.sent}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-400">
                        {formatDate(
                          row.lastAt,
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClient(
                              row.key,
                            );
                            setSelectedJobs(
                              new Set(),
                            );
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10"
                        >
                          Ver
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedRow ? (
        <section className="overflow-hidden rounded-2xl border border-sky-500/20 bg-sky-500/[0.025]">

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-sky-300/70">
                Cliente
              </div>

              <h2 className="text-lg font-bold">
                {selectedRow.label}
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectVisible}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/10"
              >
                Seleccionar pendientes
              </button>

              <button
                type="button"
                onClick={sendSelected}
                disabled={
                  selectedCount === 0 ||
                  busyKey ===
                    "bulk-send"
                }
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />

                {
                  busyKey ===
                  "bulk-send"
                    ? "Enviando..."
                    : `Enviar seleccionadas (${selectedCount})`
                }
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-black/20 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-3" />
                  <th className="px-3 py-3">
                    Fecha
                  </th>
                  <th className="px-3 py-3">
                    Documento
                  </th>
                  <th className="px-3 py-3">
                    Destino
                  </th>
                  <th className="px-3 py-3">
                    Estado
                  </th>
                  <th className="px-3 py-3 text-center">
                    Docs
                  </th>
                  <th className="px-3 py-3 text-right">
                    Accion
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {selectedClientJobs.length ===
                0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No hay documentos con este filtro.
                    </td>
                  </tr>
                ) : (
                  selectedClientJobs.map(
                    (job) => {
                      const actionable =
                        isActionable(job);

                      const destination =
                        (
                          job.targetDestinations ||
                          []
                        )
                          .map(
                            (item) =>
                              item.chatName,
                          )
                          .filter(Boolean)
                          .join(", ");

                      return (
                        <tr key={job.id}>
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={
                                selectedJobs.has(
                                  job.id,
                                )
                              }
                              disabled={
                                !actionable
                              }
                              onChange={() =>
                                toggleJob(
                                  job.id,
                                )
                              }
                              className="h-4 w-4"
                            />
                          </td>

                          <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-400">
                            {formatDate(
                              job.createdAt,
                            )}
                          </td>

                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-200">
                              {job.sourceType ||
                                "Documento"}
                            </div>

                            <div className="mt-0.5 max-w-[310px] truncate text-[11px] text-slate-500">
                              {job.message ||
                                job.sourceId ||
                                job.id}
                            </div>
                          </td>

                          <td className="px-3 py-3 text-xs text-slate-400">
                            {destination ||
                              "Sin destino"}
                          </td>

                          <td className="px-3 py-3">
                            <span
                              className={
                                "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold " +
                                statusClass(
                                  job,
                                )
                              }
                            >
                              {statusLabel(
                                job,
                              )}
                            </span>
                          </td>

                          <td className="px-3 py-3 text-center text-xs text-slate-400">
                            {job.documentsCount}
                          </td>

                          <td className="px-3 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              {actionable ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    sendOne(
                                      job,
                                    )
                                  }
                                  disabled={
                                    Boolean(
                                      busyKey,
                                    )
                                  }
                                  className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-40"
                                >
                                  {isError(
                                    job,
                                  )
                                    ? "Reintentar"
                                    : "Enviar"}
                                </button>
                              ) : null}

                              {isPending(
                                job,
                              ) &&
                              ![
                                "SENDING",
                                "READY_FOR_SEND",
                              ].includes(
                                jobStatus(
                                  job,
                                ),
                              ) ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    omitJob(
                                      job,
                                    )
                                  }
                                  disabled={
                                    Boolean(
                                      busyKey,
                                    )
                                  }
                                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/10 disabled:opacity-40"
                                >
                                  Omitir
                                </button>
                              ) : null}

                              {[
                                "READY_FOR_SEND",
                                "SENDING",
                              ].includes(
                                jobStatus(
                                  job,
                                ),
                              ) ? (
                                <span className="inline-flex items-center gap-1 text-xs text-sky-300">
                                  <Clock3 className="h-3.5 w-3.5" />
                                  En proceso
                                </span>
                              ) : null}

                              {isSent(
                                job,
                              ) ? (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Enviado
                                </span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    },
                  )
                )}
              </tbody>
            </table>
          </div>

          <details className="border-t border-white/10">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/[0.02]">
              <span className="inline-flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Configurar rutas de {selectedRow.label}
              </span>
            </summary>

            <div className="grid gap-4 border-t border-white/5 p-4">
              {selectedClientRoutes.map(
                ({
                  sourceType,
                  route,
                }) => {
                  const key =
                    routeKey(
                      selectedRow.clienteId,
                      sourceType,
                    );

                  const selected =
                    routeSelections[
                      key
                    ] || [];

                  return (
                    <div
                      key={sourceType}
                      className="rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-slate-200">
                            {sourceType}
                          </div>

                          <div className="text-[11px] text-slate-500">
                            Actual:{" "}
                            {route
                              ?.destinationChats
                              ?.map(
                                (item) =>
                                  item.chatName,
                              )
                              .join(", ") ||
                              "Sin ruta"}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            saveRoute(
                              sourceType,
                            )
                          }
                          disabled={
                            selected.length ===
                              0 ||
                            busyKey ===
                              `route-${key}`
                          }
                          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-100 hover:bg-sky-500/20 disabled:opacity-40"
                        >
                          Guardar ruta
                        </button>
                      </div>

                      <select
                        multiple
                        value={selected}
                        onChange={
                          (event) => {
                            const values =
                              Array.from(
                                event.currentTarget
                                  .selectedOptions,
                              ).map(
                                (option) =>
                                  option.value,
                              );

                            setRouteSelections(
                              (previous) => ({
                                ...previous,
                                [key]:
                                  values,
                              }),
                            );
                          }
                        }
                        className="min-h-[100px] w-full rounded-xl border border-white/10 bg-[#080d16] px-3 py-2 text-xs text-slate-200 outline-none"
                      >
                        {chats.map(
                          (chat) => (
                            <option
                              key={chat.id}
                              value={chat.id}
                            >
                              {chat.isGroup
                                ? "Grupo"
                                : "Contacto"}{" "}
                              -{" "}
                              {chat.name ||
                                chat.chatId}
                            </option>
                          ),
                        )}
                      </select>

                      <div className="mt-1 text-[11px] text-slate-600">
                        Ctrl + clic para varios destinos.
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </details>
        </section>
      ) : null}

      <details className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <summary className="cursor-pointer px-4 py-3 hover:bg-white/[0.02]">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Users className="h-4 w-4" />
            Contactos y grupos sincronizados ({chats.length})
          </span>
        </summary>

        <div className="border-t border-white/10 p-4">

          <div className="relative mb-3 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />

            <input
              value={chatSearch}
              onChange={
                (event) =>
                  setChatSearch(
                    event.target.value,
                  )
              }
              placeholder="Buscar grupo o contacto"
              className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm outline-none placeholder:text-slate-600"
            />
          </div>

          <div className="max-h-[360px] overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0b1220] text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">
                    Nombre
                  </th>
                  <th className="px-3 py-2">
                    Tipo
                  </th>
                  <th className="px-3 py-2">
                    Chat ID
                  </th>
                  <th className="px-3 py-2">
                    Sync
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/5">
                {filteredChats.map(
                  (chat) => (
                    <tr key={chat.id}>
                      <td className="px-3 py-2 font-medium text-slate-200">
                        <span className="inline-flex items-center gap-2">
                          <MessageCircle className="h-3.5 w-3.5 text-emerald-300" />
                          {chat.name ||
                            chat.chatId}
                        </span>
                      </td>

                      <td className="px-3 py-2 text-xs text-slate-400">
                        {chat.isGroup
                          ? "Grupo"
                          : "Contacto"}
                      </td>

                      <td className="px-3 py-2 text-xs text-slate-500">
                        {chat.chatId}
                      </td>

                      <td className="px-3 py-2 text-xs text-slate-500">
                        {formatDate(
                          chat.lastSyncedAt,
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {String(
        connector?.status || "",
      ) !== "CONNECTED" ? (
        <div className="inline-flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-xs text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          El envio requiere que el conector local permanezca conectado. La configuracion y el historial no se pierden.
        </div>
      ) : null}

    </div>
  );
}
