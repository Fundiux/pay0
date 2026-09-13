"use client";

import { formatDateTime24 } from "@/lib/dateTime";
import { parsePay0MassiveLayoutRows, type Pay0MassiveMethodTipo } from "@/lib/pay0MassiveLayout";
import { readPay0MassiveRowsFromFile } from "@/lib/readPay0MassiveExcel";

import {
  useEffect,
  useMemo,
  useRef,
  useState } from "react";
import { useGlobalLoading } from "@/components/GlobalLoading";
import { collection,
  onSnapshot,
  orderBy,
  query,
  where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  previewClientDispersionIq,
  generateClientDispersionIq,
  createClientDispersion,
  previewClientDispersionPricing,
  listScopedClientDispersions,
  createClientDispersionsMassive,
  requestClientDispersionIncident,
  resolveClientDispersionIncident,
  addClientDispersionNota,
  type DispersionIncidentType,
  type ResolveClientDispersionIncidentDecision,
  } from "@/services/financing";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { listScopedClients } from "@/services/clients";
import { Ban,
  MessageSquarePlus,
  RotateCcw,
  Search,
  Undo2,
  UploadCloud,
  XCircle,
  Plus,
} from "lucide-react";
import DispersionDocsModal from "@/components/DispersionDocsModal";
import Modal from "@/components/Modal";
import UiSelect from "@/components/UiSelect";
import DateScopeBar from "@/components/DateScopeBar";
import {
  type CustomRange,
  type DateScopeMode,
  getScopeRange,
  isTsWithinRange,
  shiftBaseDate,
} from "@/lib/dateScope";
import { watchClientBeneficiaries, watchClientBeneficiaryMethods } from "@/services/beneficiaries";
import { readClientOperationalBalanceSummary, type OperationalDispatchBalanceRow } from "@/services/ledger";

interface ClientOption {
  id: string;
  label: string;
}

interface DispersionCostRow {
  id: string;
  despachoId: string;
  operationTypeKey: string;
  assignedCost: number;
  active?: boolean;
}

interface DespachoOption {
  id: string;
  label: string;
  active?: boolean;
}

type DispersionPricingPreview = Awaited<
  ReturnType<
    typeof previewClientDispersionPricing
  >
>;

interface BeneficiaryRow {
  id: string;
  nombre?: string | null;
  clientId?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
  active?: boolean;
}

interface MethodRow {
  id: string;
  beneficiaryId?: string | null;
  beneficiarioId?: string | null;
  clientId?: string | null;
  clienteId?: string | null;
  tipo?: string | null;
  methodTipo?: string | null;
  type?: string | null;
  destinationKind?: string | null;
  destino?: string | null;
  kind?: string | null;
  bankName?: string | null;
  banco?: string | null;
  clabe?: string | null;
  CLABE?: string | null;
  cardNumber?: string | null;
  numeroTarjeta?: string | null;
  tarjeta?: string | null;
  active?: boolean;
  replaced?: boolean;
  replacementStatus?: string | null;
  replacedAt?: any;
  replacedByMethodId?: string | null;
}


interface DispersionRow {
  clienteNombre?: string | null;
  clienteId?: string | null;
  clientId?: string | null;

  // H4_D87_A58_A49_PRINCIPAL_IQ_FOLIOS
  iqDispersionFolios?: string[] | null;
  iqDispersionFolio?: string | null;
  iqDispersionId?: string | null;
  id: string;
  folio?: string | null;
  beneficiaryNombre?: string | null;
  methodTipo?: string | null;
  destinationKind?: string | null;
  bankName?: string | null;
  clabe?: string | null;
  cardNumber?: string | null;
  amount?: number | null;
  status?: string | null;
  note?: string | null;
  reference?: string | null;
  createdUsername?: string | null;
  createdAt?: any;
  incidentStatus?: string | null;
  incidentType?: string | null;
  incidentReason?: string | null;
  incidentDecision?: string | null;
  hasUnreadMsg?: boolean | null;
}

interface BalanceAccountRow {
  id: string;
  holderType?: string | null;
  holderId?: string | null;
  availableBalance?: number | null;
  balance?: number | null;
  currentBalance?: number | null;
}

function asClientLabel(data: any, fallback: string) {
  return String(
    data?.name ||
    data?.nombreComercial ||
    data?.nombre ||
    data?.razonSocial ||
    data?.clienteNombre ||
    fallback
  ).trim();
}

function getTimestampValue(value: any) {
  if (!value) return 0;
  if (typeof value?.seconds === "number") return value.seconds;
  if (typeof value?._seconds === "number") return value._seconds;
  if (typeof value?.toMillis === "function") return Math.floor(value.toMillis() / 1000);
  return 0;
}

function formatDate(value: any) {
  return formatDateTime24(value, "-");
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value || 0);
  return amount.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeAmountInput(value: string) {
  let sanitized = String(value || "").replace(/[^\d.]/g, "");

  const firstDot = sanitized.indexOf(".");
  if (firstDot >= 0) {
    const integerPart = sanitized.slice(0, firstDot + 1);
    const decimalPart = sanitized.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    sanitized = integerPart + decimalPart;
  }

  if (sanitized.startsWith(".")) {
    sanitized = "0" + sanitized;
  }

  return sanitized;
}

function formatAmountForInput(value: string) {
  if (!value) return "";
  const amount = Number(value || 0);
  return amount.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getAvailableBalanceValue(row: BalanceAccountRow | null) {
  if (!row) return 0;
  return Number(row.availableBalance ?? row.balance ?? row.currentBalance ?? 0);
}

function isActiveDispersionMethod(row: MethodRow) {
  const anyRow = row as any;
  const replacementStatus = String(anyRow.replacementStatus || anyRow.status || "")
    .trim()
    .toUpperCase();

  return (
    anyRow.active !== false &&
    anyRow.replaced !== true &&
    replacementStatus !== "REPLACED" &&
    replacementStatus !== "REEMPLAZADO" &&
    !anyRow.replacedAt
  );
}

function noteDateTimeText(value: any) {
  return formatDateTime24(value, "");
}

function NoteBubble({ note }: any) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/70 px-3 py-2">
      <div className="mb-1 text-xs text-slate-400">
        {note?.createdByName || note?.createdByRole || "Sistema"}
      </div>
      <div className="whitespace-pre-wrap text-sm text-slate-100">{note?.text || "-"}</div>
      <div className="mt-1 text-right text-[11px] text-slate-500">{noteDateTimeText(note?.createdAt)}</div>
    </div>
  );
}
function formatIncidentLabel(row: DispersionRow) {
  const status = String(row.incidentStatus || "").trim().toUpperCase();
  const type = String(row.incidentType || "").trim().toUpperCase();
  const decision = String(row.incidentDecision || "").trim().toUpperCase();

  if (!status) return "---";

  if (status === "SOLICITADA") {
    if (type === "DEVOLUCION") return "DEVOLUCION";
    if (type === "CANCELACION") return "CANCELACION";
    return "SOLICITADA";
  }

  if (status === "RESUELTA") {
    if (decision === "DEVOLUCION_APLICADA") return "DEVUELTA";
    if (decision === "CANCELACION_APLICADA") return "CANCELADA";
    if (decision === "RECHAZADA") return "RECHAZADA";
    return "RESUELTA";
  }

  return status;
}

export default function WalletDispersionesPage() {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile();
  const globalLoading = useGlobalLoading();

  const uid = String((user as any)?.uid || "").trim();
  const rootId = String((profile as any)?.rootId || uid || "").trim();
  const role = String((profile as any)?.role || "").trim().toLowerCase();
  const isSuperadmin = role === "superadmin";

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryRow[]>([]);
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [methodId, setMethodId] = useState("");
  const [despachoId, setDespachoId] = useState("");
  const [clientDispersionCosts, setClientDispersionCosts] =
    useState<DispersionCostRow[]>([]);
  const [despachos, setDespachos] =
    useState<DespachoOption[]>([]);
  const [pricingPreview, setPricingPreview] =
    useState<DispersionPricingPreview | null>(null);
  const [pricingPreviewBusy, setPricingPreviewBusy] =
    useState(false);
  const [pricingPreviewError, setPricingPreviewError] =
    useState("");
  const [rows, setRows] = useState<DispersionRow[]>([]);
  const [dispersionSearch, setDispersionSearch] = useState("");

  // H4_D87_A58_A47_DISPERSION_DATE_SCOPE
  // Mismo contrato de Solicitudes y Pagos.
  const [mode, setMode] =
    useState<DateScopeMode>("day");
  const [baseDate, setBaseDate] =
    useState(new Date());
  const [customRange, setCustomRange] =
    useState<CustomRange>({});
  const [openDispersionModal, setOpenDispersionModal] = useState(false);
  const [openDispersionMassiveModal, setOpenDispersionMassiveModal] = useState(false);
  const [dispersionImportPreview, setDispersionImportPreview] = useState<any | null>(null);
  const [dispersionImportFileName, setDispersionImportFileName] = useState("");
  const [dispersionImportBusy, setDispersionImportBusy] = useState(false);
  const [dispersionImportSaving, setDispersionImportSaving] = useState(false);
  const [dispersionImportMethodTipo, setDispersionImportMethodTipo] = useState<Pay0MassiveMethodTipo>("DEBITO");
  // H4_D87_A58_A33_MASSIVE_DESPACHO_CONTRACT
  const [dispersionImportDespachoId, setDispersionImportDespachoId] = useState("");
  const [isDispersionImportDragging, setIsDispersionImportDragging] = useState(false);
  const [docsFor, setDocsFor] = useState<DispersionRow | null>(null);
  const [notesFor, setNotesFor] = useState<DispersionRow | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [balanceRow, setBalanceRow] = useState<BalanceAccountRow | null>(null);
  const [dispatchBalanceRows, setDispatchBalanceRows] =
    useState<OperationalDispatchBalanceRow[]>([]);
  const [balanceReloadKey, setBalanceReloadKey] = useState(0);

  const [amount, setAmount] = useState("");
  const [amountFocused, setAmountFocused] = useState(false);
  const [reference, setReference] = useState("");
  const [loadingClients, setLoadingClients] = useState(false);
  const [saving, setSaving] = useState(false);
  const createDispersionLockRef = useRef(false);
  const createMassiveDispersionLockRef = useRef(false);
  const [incidentBusyId, setIncidentBusyId] = useState("");
  const [iqBusyId, setIqBusyId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (profileLoading) {
      setClients([]);
      return;
    }

    if (!uid || !rootId) {
      setClients([]);
      setLoadingClients(false);
      return;
    }

    setLoadingClients(true);
    setError("");

    const unsubscribe = listScopedClients(
      { uid, role, rootId, requiredPermission: "operateDispersiones" },
      (items) => {
        const options = items
          .map((item: any) => ({
            id: String(item.id || ""),
            label: asClientLabel(item, String(item.id || "")),
          }))
          .filter((item) => item.id && item.label)
          .sort((a, b) => a.label.localeCompare(b.label, "es"));

        setClients(options);
        setClientId((current) => {
          if (!current) return current;
          return options.some((item) => item.id === current) ? current : "";
        });
        setLoadingClients(false);
      },
      (e) => {
        setClients([]);
        setLoadingClients(false);
        setError(e?.message || "No se pudieron cargar los clientes.");
      }
    );

    return () => unsubscribe();
  }, [uid, role, rootId, profileLoading]);

  useEffect(() => {
    const qd = query(
      collection(db, "despachos"),
      orderBy("nombre", "asc"),
    );

    return onSnapshot(
      qd,
      (snap) => {
        setDespachos(
          snap.docs
            .map((docSnap) => {
              const data: any =
                docSnap.data() || {};

              return {
                id: docSnap.id,
                label: String(
                  data.nombre ||
                    data.name ||
                    docSnap.id,
                ),
                active:
                  data.active !== false,
              };
            })
            .filter((row) => row.active),
        );
      },
      () => setDespachos([]),
    );
  }, []);

  useEffect(() => {
    if (!clientId) {
      setClientDispersionCosts([]);
      return;
    }

    return onSnapshot(
      collection(
        db,
        "clients",
        clientId,
        "costos",
      ),
      (snap) => {
        setClientDispersionCosts(
          snap.docs.map((docSnap) => {
            const data: any =
              docSnap.data() || {};

            return {
              id: docSnap.id,
              despachoId: String(
                data.despachoId ||
                  data.sourceDespachoId ||
                  "",
              ),
              operationTypeKey: String(
                data.operationTypeKey ||
                  "",
              ).toUpperCase(),
              assignedCost: Number(
                data.assignedCost || 0,
              ),
              active:
                data.active !== false,
            };
          }),
        );
      },
      () => setClientDispersionCosts([]),
    );
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setBeneficiaries([]);
      setMethods([]);
      return;
    }

    const offBeneficiaries = watchClientBeneficiaries(
      clientId,
      (nextRows) => setBeneficiaries(nextRows as BeneficiaryRow[]),
      (e) => setError(e.message || "No se pudieron cargar los beneficiarios.")
    );

    const offMethods = watchClientBeneficiaryMethods(
      clientId,
      (nextRows) => setMethods(nextRows as MethodRow[]),
      (e) => setError(e.message || "No se pudieron cargar los metodos.")
    );

    return () => {
      offBeneficiaries();
      offMethods();
    };
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;

    async function loadOperationalBalance() {
      if (!clientId) {
        setBalanceRow(null);
        setDispatchBalanceRows([]);
        return;
      }

      setDispatchBalanceRows([]);

      try {
        const summary = await readClientOperationalBalanceSummary(clientId);

        if (cancelled) return;

        if (!summary) {
          setBalanceRow(null);
          setDispatchBalanceRows([]);
          return;
        }

        setBalanceRow({
          id: `CLIENT_${clientId}`,
          holderType: "CLIENT",
          holderId: clientId,
          availableBalance: summary.availableBalance,
          balance: summary.availableBalance,
          currentBalance: summary.availableBalance,
        });

        setDispatchBalanceRows(
          Array.isArray(summary.dispatchBalances)
            ? summary.dispatchBalances
            : [],
        );
      } catch (e: any) {
        if (!cancelled) {
          setBalanceRow(null);
          setDispatchBalanceRows([]);
          setError(e?.message || "No se pudo cargar el saldo operativo.");
        }
      }
    }

    loadOperationalBalance();

    return () => {
      cancelled = true;
    };
  }, [clientId, balanceReloadKey]);

  const selectedBeneficiary = useMemo(
    () => beneficiaries.find((item) => item.id === beneficiaryId) || null,
    [beneficiaries, beneficiaryId]
  );

  const filteredMethods = useMemo(() => {
    if (!beneficiaryId) return [];

    return methods.filter((item) => {
      if (!isActiveDispersionMethod(item)) return false;
      return String((item as any).beneficiaryId || (item as any).beneficiarioId || "") === String(beneficiaryId);
    });
  }, [methods, beneficiaryId]);

  const selectedMethod = useMemo(
    () => filteredMethods.find((item) => item.id === methodId) || null,
    [filteredMethods, methodId]
  );

  const operationTypeKey = useMemo(() => {
    const method = String(
      selectedMethod?.tipo ||
        selectedMethod?.methodTipo ||
        "",
    )
      .trim()
      .toUpperCase();
    const destination = String(
      selectedMethod?.destinationKind ||
        selectedMethod?.destino ||
        "",
    )
      .trim()
      .toUpperCase();

    if (
      method === "EFECTIVO" ||
      destination === "EFECTIVO"
    ) {
      return "EFECTIVO";
    }

    if (
      method === "TDC" ||
      method === "AMEX"
    ) {
      return "TDC";
    }

    if (method === "DEBITO") {
      return "TRANSFERENCIA";
    }

    return "";
  }, [selectedMethod]);

  const massiveOperationTypeKey = useMemo(
    () =>
      dispersionImportMethodTipo === "DEBITO"
        ? "TRANSFERENCIA"
        : "TDC",
    [dispersionImportMethodTipo],
  );

  const eligibleMassiveDespachos = useMemo(() => {
    const ids = new Set(
      clientDispersionCosts
        .filter(
          (row) =>
            row.active !== false &&
            row.operationTypeKey === massiveOperationTypeKey &&
            row.despachoId,
        )
        .map((row) => row.despachoId),
    );

    return despachos.filter((row) =>
      ids.has(row.id),
    );
  }, [
    clientDispersionCosts,
    despachos,
    massiveOperationTypeKey,
  ]);

  useEffect(() => {
    if (
      dispersionImportDespachoId &&
      eligibleMassiveDespachos.some(
        (row) => row.id === dispersionImportDespachoId,
      )
    ) {
      return;
    }

    const preferredIq =
      eligibleMassiveDespachos.find((row) => {
        const label = String(
          row.label || "",
        )
          .trim()
          .toUpperCase();

        const id = String(
          row.id || "",
        )
          .trim()
          .toUpperCase();

        return (
          label === "IQ" ||
          id === "IQ"
        );
      });

    setDispersionImportDespachoId(
      preferredIq?.id ||
        (eligibleMassiveDespachos.length === 1
          ? eligibleMassiveDespachos[0].id
          : ""),
    );
  }, [
    eligibleMassiveDespachos,
    dispersionImportDespachoId,
  ]);

  const eligibleDespachos = useMemo(() => {
    if (!operationTypeKey) return [];

    const ids = new Set(
      clientDispersionCosts
        .filter(
          (row) =>
            row.active !== false &&
            row.operationTypeKey ===
              operationTypeKey &&
            row.despachoId,
        )
        .map((row) => row.despachoId),
    );

    return despachos.filter((row) =>
      ids.has(row.id),
    );
  }, [
    clientDispersionCosts,
    despachos,
    operationTypeKey,
  ]);

  useEffect(() => {
    if (
      despachoId &&
      eligibleDespachos.some(
        (row) => row.id === despachoId,
      )
    ) {
      return;
    }

    const preferredIq =
      eligibleDespachos.find((row) => {
        const label = String(
          row.label || "",
        )
          .trim()
          .toUpperCase();

        const id = String(
          row.id || "",
        )
          .trim()
          .toUpperCase();

        return (
          label === "IQ" ||
          id === "IQ"
        );
      });

    setDespachoId(
      preferredIq?.id ||
        (eligibleDespachos.length === 1
          ? eligibleDespachos[0].id
          : ""),
    );
  }, [eligibleDespachos, despachoId]);

  useEffect(() => {
    if (!methodId) return;

    const exists = filteredMethods.some((item) => item.id === methodId);
    if (!exists) {
      // methodId no pertenece al beneficiario seleccionado
      setMethodId("");
    }
  }, [filteredMethods, methodId]);

  const amountNumber = useMemo(() => Number(amount || 0), [amount]);
  const availableBalance = useMemo(() => {
    const selectedDispatchBalance =
      Number(
        (pricingPreview as any)
          ?.beforeBalance,
      );

    if (
      despachoId &&
      Number.isFinite(
        selectedDispatchBalance,
      )
    ) {
      return selectedDispatchBalance;
    }

    const canonicalClientBalance =
      getAvailableBalanceValue(
        balanceRow,
      );

    if (
      Number.isFinite(
        canonicalClientBalance,
      )
    ) {
      return canonicalClientBalance;
    }

    return 0;
  }, [
    balanceRow,
    despachoId,
    pricingPreview,
  ]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(
      async () => {
        setPricingPreview(null);
        setPricingPreviewError("");

        if (
          !clientId ||
          !methodId ||
          !despachoId ||
          !Number.isFinite(amountNumber) ||
          amountNumber <= 0
        ) {
          setPricingPreviewBusy(false);
          return;
        }

        try {
          setPricingPreviewBusy(true);

          const result =
            await previewClientDispersionPricing({
              clienteId: clientId,
              methodId,
              despachoId,
              amount: amountNumber,
            });

          if (!cancelled) {
            setPricingPreview(result);
          }
        } catch (error: any) {
          if (!cancelled) {
            setPricingPreview(null);
            setPricingPreviewError(
              error?.message ||
                "No se pudo calcular la tarifa.",
            );
          }
        } finally {
          if (!cancelled) {
            setPricingPreviewBusy(false);
          }
        }
      },
      300,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    clientId,
    methodId,
    despachoId,
    amountNumber,
  ]);

  const totalClientDebitAmount =
    pricingPreview?.totalClientDebitAmount ??
    amountNumber;

  const projectedBalance = useMemo(() => {
    const safeAmount = Number.isFinite(
      totalClientDebitAmount,
    )
      ? totalClientDebitAmount
      : 0;

    return availableBalance - safeAmount;
  }, [
    availableBalance,
    totalClientDebitAmount,
  ]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === clientId) || null,
    [clients, clientId]
  );
  const range = useMemo(
    () =>
      getScopeRange(
        mode,
        baseDate,
        customRange,
      ),
    [mode, baseDate, customRange],
  );

  useEffect(() => {
    if (profileLoading || !uid || !rootId) {
      setRows([]);
      return;
    }
    let cancelled = false;

    async function loadDispersions() {
      try {
        const result = await listScopedClientDispersions(500);
        if (cancelled) return;
        setRows((result.rows || []) as DispersionRow[]);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "No se pudieron cargar las dispersiones.");
      }
    }

    loadDispersions();

    return () => {
      cancelled = true;
    };
  }, [
    profileLoading,
    uid,
    rootId,
    balanceReloadKey,
  ]);
  const displayedRows = useMemo(() => {
    const term =
      dispersionSearch
        .trim()
        .toLowerCase();

    return rows
      .filter((row) =>
        isTsWithinRange(
          row.createdAt,
          range.from,
          range.to,
        ),
      )
      .filter((row) => {
        if (!clientId) return true;

        const rowClientId =
          String(
            row.clientId ||
              row.clienteId ||
              "",
          ).trim();

        return rowClientId === clientId;
      })
      .filter((row) => {
        if (!term) return true;

        const haystack = [
          row.folio,
          getDispersionIqFolioText(row),
          row.clienteNombre,
          row.beneficiaryNombre,
          row.methodTipo,
          row.destinationKind,
          row.bankName,
          row.clabe,
          row.cardNumber,
          row.status,
          row.incidentStatus,
          row.incidentType,
          row.reference,
          row.note,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(term);
      });
  }, [
    rows,
    dispersionSearch,
    clientId,
    range,
  ]);

  function getDispersionIqFolioText(
    row: DispersionRow,
  ): string {
    const fromArray =
      Array.isArray(
        row.iqDispersionFolios,
      )
        ? row.iqDispersionFolios
            .map((value) =>
              String(
                value || "",
              ).trim(),
            )
            .filter(Boolean)
        : [];

    if (fromArray.length > 0) {
      return Array.from(
        new Set(fromArray),
      ).join(", ");
    }

    return String(
      row.iqDispersionFolio ||
        row.iqDispersionId ||
        "",
    ).trim();
  }

  function safeDispersionExportText(
    value: unknown,
  ): string {
    return String(
      value ?? "",
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function dispersionExportDate(): string {
    const now = new Date();

    return [
      now.getFullYear(),
      String(
        now.getMonth() + 1,
      ).padStart(2, "0"),
      String(
        now.getDate(),
      ).padStart(2, "0"),
    ].join("");
  }

  function dispersionExportClient(): string {
    if (!clientId) {
      return "TODOS";
    }

    return String(
      clients.find(
        (client) =>
          client.id === clientId,
      )?.label ||
        "CLIENTE",
    )
      .replace(
        /[^A-Za-z0-9_-]+/g,
        "_",
      )
      .slice(0, 60);
  }

  function getDispersionExportRows() {
    return displayedRows.map(
      (row) => ({
        "Folio PAY0":
          safeDispersionExportText(
            row.folio,
          ),

        "Folio IQ":
          getDispersionIqFolioText(
            row,
          ),

        Fecha:
          formatDate(
            row.createdAt,
          ),

        Cliente:
          safeDispersionExportText(
            row.clienteNombre,
          ),

        Beneficiario:
          safeDispersionExportText(
            row.beneficiaryNombre,
          ),

        Tipo:
          safeDispersionExportText(
            row.methodTipo ||
              row.destinationKind,
          ),

        Banco:
          safeDispersionExportText(
            row.bankName,
          ),

        "CLABE/Tarjeta":
          safeDispersionExportText(
            row.clabe ||
              row.cardNumber ||
              row.destinationKind,
          ),

        Monto:
          Number(
            row.amount || 0,
          ),

        Estatus:
          safeDispersionExportText(
            row.status,
          ),
      }),
    );
  }

  async function handleExportDispersionesExcel() {
    if (
      displayedRows.length === 0
    ) {
      setError(
        "No hay dispersiones para exportar con el filtro actual.",
      );
      return;
    }

    setError("");
    const { downloadSpreadsheetFile } = await import("@/lib/spreadsheetReader");

    const exportRows =
      getDispersionExportRows();

    await downloadSpreadsheetFile(
      `dispersiones_${dispersionExportClient()}_${dispersionExportDate()}.xlsx`,
      "Dispersiones",
      exportRows,
      [18, 16, 20, 28, 32, 18, 20, 24, 16, 18],
    );
  }

  async function handleExportDispersionesPdf() {
    if (
      displayedRows.length === 0
    ) {
      setError(
        "No hay dispersiones para exportar con el filtro actual.",
      );
      return;
    }

    setError("");
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);

    const exportRows =
      getDispersionExportRows();

    const doc =
      new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

    doc.setFontSize(14);

    doc.text(
      "PAY0 - DISPERSIONES",
      10,
      12,
    );

    doc.setFontSize(8);

    doc.text(
      `Cliente: ${
        clientId
          ? clients.find(
              (client) =>
                client.id === clientId,
            )?.label ||
            clientId
          : "Todos los clientes"
      }`,
      10,
      18,
    );

    doc.text(
      `Registros: ${displayedRows.length}`,
      10,
      23,
    );

    autoTable(
      doc,
      {
        startY: 28,

        head: [[
          "Folio PAY0",
          "Folio IQ",
          "Fecha",
          "Cliente",
          "Beneficiario",
          "Tipo",
          "Banco",
          "CLABE/Tarjeta",
          "Monto",
          "Estatus",
        ]],

        body:
          exportRows.map(
            (row) => [
              row["Folio PAY0"],
              row["Folio IQ"],
              row.Fecha,
              row.Cliente,
              row.Beneficiario,
              row.Tipo,
              row.Banco,
              row["CLABE/Tarjeta"],
              formatMoney(
                row.Monto,
              ),
              row.Estatus,
            ],
          ),

        styles: {
          fontSize: 6.5,
          cellPadding: 1.3,
          overflow: "linebreak",
        },

        margin: {
          left: 7,
          right: 7,
        },
      },
    );

    doc.save(
      `dispersiones_${dispersionExportClient()}_${dispersionExportDate()}.pdf`,
    );
  }

  const canSave = useMemo(() => {
    return (
      !!clientId &&
      !!beneficiaryId &&
      !!methodId &&
      !!despachoId &&
      !!operationTypeKey &&
      !!pricingPreview &&
      pricingPreview.canCreate === true &&
      Number.isFinite(amountNumber) &&
      amountNumber > 0
    );
  }, [
    clientId,
    beneficiaryId,
    methodId,
    despachoId,
    operationTypeKey,
    pricingPreview,
    amountNumber,
  ]);

  function getDispersionBlockReason() {
    if (!clientId) {
      return "SELECCIONA CLIENTE ORIGEN";
    }

    if (!beneficiaryId) {
      return "SELECCIONA BENEFICIARIO";
    }

    if (!methodId) {
      return "SELECCIONA METODO";
    }

    if (!despachoId) {
      return "SELECCIONA DESPACHO";
    }

    if (!operationTypeKey) {
      return "SELECCIONA TIPO";
    }

    if (
      !Number.isFinite(amountNumber) ||
      amountNumber <= 0
    ) {
      return "CAPTURA UN MONTO VALIDO";
    }

    if (pricingPreviewBusy) {
      return "CALCULANDO SALDO DEL DESPACHO";
    }

    if (pricingPreviewError) {
      return pricingPreviewError;
    }

    if (!pricingPreview) {
      return "VALIDANDO COSTO Y SALDO DEL DESPACHO";
    }

    if (
      pricingPreview.canCreate !== true
    ) {
      return String(
        (pricingPreview as any)
          ?.reason ||
          (pricingPreview as any)
            ?.message ||
          "SALDO INSUFICIENTE EN EL DESPACHO SELECCIONADO",
      );
    }

    if (
      !canCreateWithOperationalBalance
    ) {
      return "SALDO INSUFICIENTE EN EL DESPACHO SELECCIONADO";
    }

    return "";
  }




  useEffect(() => {
    if (!notesFor?.id) {
      setNotes([]);
      return;
    }

    const qy = query(
      collection(db, `clientDispersions/${notesFor.id}/notas`),
      orderBy("createdAt", "asc")
    );

    return onSnapshot(
      qy,
      (snap) => {
        setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("[Dispersiones] notas snapshot error:", err);
        setNotes([]);
      }
    );
  }, [notesFor]);

  async function sendDispersionNote() {
    if (!notesFor?.id || !newNote.trim()) return;

    try {
      await addClientDispersionNota({
        dispersionId: notesFor.id,
        text: newNote.trim(),
      });
      setNewNote("");
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar la nota.");
    }
  }
  function cleanMassiveErrorText(value: unknown) {
    return String(value || "")
      .replace(/^Fila\s+\d+\s*:\s*/i, "")
      .trim();
  }
  function normalizeMassiveText(value: unknown) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
  }

      function findDispersionImportTarget(row: any) {
    const rowName = normalizeMassiveText(row.nombre || row.beneficiario || row.beneficiaryNombre);
    const rowClabe = String(row.clabe || row.CLABE || "").replace(/\D/g, "");
    const rowCard = String(row.numeroTarjeta || row.cardNumber || row.tarjeta || row["NUMERO DE TARJETA"] || "").replace(/\D/g, "");
    const selectedMethodTipo = normalizeMassiveText(dispersionImportMethodTipo || "DEBITO");

    const beneficiaryMatches = beneficiaries.filter((item) => {
      if (item.active === false) return false;
      return normalizeMassiveText(item.nombre) === rowName;
    });

    if (beneficiaryMatches.length > 1) {
      return {
        error: `beneficiario duplicado (${row.nombre || row.beneficiario || "-"}). Revisa Beneficiarios antes de dispersar.`,
      };
    }

    const beneficiary = beneficiaryMatches[0] || null;

    function methodTipoOf(item: MethodRow) {
      const anyItem = item as any;
      return normalizeMassiveText(anyItem.tipo || anyItem.methodTipo || anyItem.type || "");
    }

    function methodClabeOf(item: MethodRow) {
      const anyItem = item as any;
      return String(anyItem.clabe || anyItem.CLABE || "").replace(/\D/g, "");
    }

    function methodCardOf(item: MethodRow) {
      const anyItem = item as any;
      return String(anyItem.cardNumber || anyItem.numeroTarjeta || anyItem.tarjeta || "").replace(/\D/g, "");
    }

    const beneficiaryMethods = beneficiary
      ? methods.filter((item) => {
          if (!isActiveDispersionMethod(item)) return false;
          return String((item as any).beneficiaryId || (item as any).beneficiarioId || "") === String(beneficiary.id);
        })
      : [];

    const method = beneficiaryMethods.find((item) => {
      const methodTipo = methodTipoOf(item);
      if (methodTipo !== selectedMethodTipo) return false;

      if (rowClabe) return methodClabeOf(item) === rowClabe;
      if (rowCard) return methodCardOf(item) === rowCard;

      return false;
    }) || null;

    return {
      beneficiary,
      method,
      beneficiaryAction: beneficiary ? "EXISTENTE" : "POR_CREAR",
      methodAction: method ? "EXISTENTE" : "POR_CREAR",
    };
  }

  async function handleDispersionImportFile(file: File | null) {
    setError("");
    setSuccess("");
    setDispersionImportPreview(null);
    setDispersionImportFileName("");

    if (!clientId) {
      setError("Selecciona un cliente antes de cargar dispersiones.");
      return;
    }

    if (!file) return;

    setDispersionImportBusy(true);

    try {
      const rows = await readPay0MassiveRowsFromFile(file, {
        preferredSheetNames: ["ADMON"],
        requiredHeaders: ["NOMBRE", "MONTO"],
        maxHeaderScanRows: 30,
      });

      const basePreview: any = parsePay0MassiveLayoutRows(rows, "DISPERSIONES", {
        methodTipo: dispersionImportMethodTipo,
      });

      const checkedRows = (basePreview.rows || []).map((row: any) => {
        const target = findDispersionImportTarget(row);
        const targetErrors = target.error ? [target.error] : [];
        const amount = Number(row.monto || row.amount || 0);

        return {
          ...row,
          amount,
          beneficiaryId: target.beneficiary?.id || "",
          methodId: target.method?.id || "",
          beneficiaryName: target.beneficiary?.nombre || row.nombre || row.beneficiario || "",
          beneficiaryAction: target.beneficiaryAction || "POR_CREAR",
          methodAction: target.methodAction || "POR_CREAR",
          methodTipo: dispersionImportMethodTipo,
          errors: [...(row.errors || []), ...targetErrors],
        };
      });

      const validRows = checkedRows.filter((row: any) => row.errors.length === 0);
      const errorRows = checkedRows.filter((row: any) => row.errors.length > 0);
      const totalAmount = validRows.reduce((sum: number, row: any) => sum + Number(row.amount || row.monto || 0), 0);

      const beneficiaryCreateKeys = new Set<string>();
      const methodCreateKeys = new Set<string>();

      validRows.forEach((row: any) => {
        const nameKey = normalizeMassiveText(row.nombre || row.beneficiario || row.beneficiaryName);
        const dato = String(row.clabe || row.numeroTarjeta || row.cardNumber || row.tarjeta || "").replace(/\D/g, "");

        if (row.beneficiaryAction === "POR_CREAR" && nameKey) {
          beneficiaryCreateKeys.add(nameKey);
        }

        if (row.methodAction === "POR_CREAR" && nameKey && dato) {
          methodCreateKeys.add(`${nameKey}|${dispersionImportMethodTipo}|${row.destinationKind}|${dato}`);
        }
      });

      const preview = {
        ...basePreview,
        rows: checkedRows,
        validRows,
        errorRows,
        summary: {
          beneficiariesToCreate: beneficiaryCreateKeys.size,
          methodsToCreate: methodCreateKeys.size,
          beneficiariesExisting: validRows.filter((row: any) => row.beneficiaryAction === "EXISTENTE").length,
          methodsExisting: validRows.filter((row: any) => row.methodAction === "EXISTENTE").length,
        },
        totals: {
          rows: checkedRows.length,
          valid: validRows.length,
          errors: errorRows.length,
          totalAmount,
        },
      };

      setDispersionImportPreview(preview);
      setDispersionImportFileName(file.name);

      if (preview.totals.rows === 0) {
        setError("El archivo no contiene filas para importar.");
      } else if (preview.totals.totalAmount > availableBalance) {
        setError("Saldo insuficiente para crear la dispersion masiva.");
      } else if (preview.totals.errors > 0) {
        setError(`Preview generado: ${preview.totals.valid} fila(s) se procesaran y ${preview.totals.errors} se omitiran.`);
      } else {
        setSuccess(`Preview generado: ${preview.totals.valid} dispersion(es) por ${formatMoney(preview.totals.totalAmount)}.`);
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el archivo Excel.");
    } finally {
      setDispersionImportBusy(false);
    }
  }

  async function handleCreateMassiveDispersionsFromPreview() {
    if (!dispersionImportPreview) return;

    const validRows =
      dispersionImportPreview.validRows || [];

    const skippedPreviewRows =
      dispersionImportPreview.skippedRows || [];

    if (!dispersionImportDespachoId) {
      setError(
        "Selecciona el despacho para la dispersion masiva.",
      );
      return;
    }

    if (validRows.length === 0) {
      setError("No hay filas validas para crear.");
      return;
    }

    if (dispersionImportPreview.insufficientBalance) {
      setError(
        "Saldo insuficiente para crear la dispersion masiva.",
      );
      return;
    }

    const selectedMassiveDespacho =
      eligibleMassiveDespachos.find(
        (row) =>
          row.id ===
          dispersionImportDespachoId,
      ) || null;

    const selectedDespachoLabel =
      String(
        selectedMassiveDespacho?.label || "",
      )
        .trim()
        .toUpperCase();

    const selectedDespachoId =
      String(
        selectedMassiveDespacho?.id || "",
      )
        .trim()
        .toUpperCase();

    const shouldGenerateIq =
      selectedDespachoLabel === "IQ" ||
      selectedDespachoId === "IQ";

    const confirmed = window.confirm(
      shouldGenerateIq
        ? `Procesar archivo?\n\nSe crearan ${validRows.length} dispersion(es) en PAY0 y se enviaran automaticamente a IQ.\nSe omitiran ${skippedPreviewRows.length} fila(s).\nTotal a dispersar: ${formatMoney(dispersionImportPreview.totals.totalAmount)}.`
        : `Procesar archivo?\n\nSe crearan ${validRows.length} dispersion(es).\nSe omitiran ${skippedPreviewRows.length} fila(s).\nTotal a dispersar: ${formatMoney(dispersionImportPreview.totals.totalAmount)}.`,
    );

    if (!confirmed) return;

    if (
      createMassiveDispersionLockRef.current ||
      dispersionImportSaving
    ) {
      return;
    }

    createMassiveDispersionLockRef.current = true;

    setDispersionImportSaving(true);
    setError("");
    setSuccess("");

    try {
      await globalLoading.run(
        undefined,
        async () => {
          const payloadRows =
            validRows.map((row: any) => ({
              rowNumber: row.rowNumber,
              beneficiaryName:
                row.beneficiaryName,
              amount: row.amount,
              reference: row.reference,
              banco: row.banco,
              clabe: row.clabe,
              tarjeta: row.tarjeta,
              tipo: row.tipo,
              methodTipo: row.methodTipo,
              beneficiaryId:
                row.beneficiaryId,
              methodId: row.methodId,
              beneficiaryAction:
                row.beneficiaryAction,
              methodAction:
                row.methodAction,
            }));

          const result =
            await createClientDispersionsMassive({
              clienteId: clientId,
              despachoId:
                dispersionImportDespachoId,
              methodTipo:
                dispersionImportMethodTipo,
              items: payloadRows,
            });

          const createdDispersions =
            Array.isArray(result?.dispersions)
              ? result.dispersions.filter(
                  (item: any) =>
                    String(
                      item?.dispersionId || "",
                    ).trim(),
                )
              : [];

          if (
            shouldGenerateIq &&
            createdDispersions.length > 0
          ) {
            let iqGenerated = 0;
            let iqReview = 0;
            let iqFailed = 0;

            const iqProblems: string[] = [];

            for (
              const created of
              createdDispersions
            ) {
              const dispersionId =
                String(
                  created.dispersionId || "",
                ).trim();

              const folio =
                String(
                  created.folio ||
                    dispersionId,
                ).trim();

              if (!dispersionId) {
                iqFailed += 1;
                iqProblems.push(
                  `${folio}: sin dispersionId`,
                );
                continue;
              }

              try {
                const iqResult =
                  await generateClientDispersionIq({
                    dispersionId,
                    confirm: true,
                  });

                if (
                  iqResult.aggregateStatus ===
                  "IQ_GENERADA"
                ) {
                  iqGenerated += 1;
                } else if (
                  Number(
                    iqResult.reviewCount || 0,
                  ) > 0 ||
                  String(
                    iqResult.aggregateStatus ||
                      "",
                  )
                    .toUpperCase()
                    .includes("REVISION")
                ) {
                  iqReview += 1;

                  iqProblems.push(
                    `${folio}: ${iqResult.aggregateStatus}`,
                  );
                } else {
                  iqFailed += 1;

                  iqProblems.push(
                    `${folio}: ${iqResult.aggregateStatus || "IQ_FALLIDA"}`,
                  );
                }
              } catch (iqError: any) {
                iqFailed += 1;

                iqProblems.push(
                  `${folio}: ${
                    iqError?.message ||
                    "Error al generar en IQ"
                  }`,
                );
              }
            }

            setSuccess(
              `Dispersion masiva creada: ${result?.createdCount || 0} creada(s), ${result?.skippedCount || 0} omitida(s). IQ: ${iqGenerated} generada(s), ${iqReview} en revision, ${iqFailed} fallida(s).`,
            );

            if (iqProblems.length > 0) {
              setError(
                `IQ requiere atencion en ${iqProblems.length} dispersion(es): ${iqProblems.join(" | ")}`,
              );
            }
          } else {
            setSuccess(
              `Dispersion masiva creada: ${result?.createdCount || 0} creada(s), ${result?.skippedCount || 0} omitida(s).`,
            );
          }

          setDispersionImportPreview(null);
          setDispersionImportFileName("");
          setDispersionImportDespachoId("");
          setOpenDispersionMassiveModal(false);

          setBalanceReloadKey(
            (value) => value + 1,
          );
        },
      );
    } catch (e: any) {
      const missing =
        Array.isArray(
          e?.details?.missingFolios,
        ) &&
        e.details.missingFolios.length
          ? ` Folios no creados: ${e.details.missingFolios.join(", ")}`
          : "";

      setError(
        (e?.message ||
          "No se pudo crear la dispersion masiva.") +
          missing,
      );
    } finally {
      createMassiveDispersionLockRef.current =
        false;

      setDispersionImportSaving(false);
    }
  }
  const requestedDispersionAmount = Number(amount || 0);

  const canCreateWithOperationalBalance =
    Boolean(clientId) &&
    Boolean(balanceRow) &&
    Number.isFinite(availableBalance) &&
    requestedDispersionAmount > 0 &&
    availableBalance >=
      totalClientDebitAmount &&
    pricingPreview?.canCreate === true;
  async function handleCreateDispersion() {
    if (saving || createDispersionLockRef.current) return;

    if (!balanceRow || !Number.isFinite(availableBalance)) {
      setError("No se pudo validar saldo disponible. Recarga el saldo antes de crear dispersion.");
      return;
    }

    if (requestedDispersionAmount <= 0) {
      setError("Monto invalido para dispersion.");
      return;
    }

    if (!pricingPreview) {
      setError(
        pricingPreviewError ||
          "No se pudo validar costo y comision.",
      );
      return;
    }

    if (
      availableBalance <
      pricingPreview.totalClientDebitAmount
    ) {
      setError(
        "Saldo insuficiente en el despacho seleccionado para monto y comision.",
      );
      return;
    }

    createDispersionLockRef.current = true;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      await globalLoading.run(undefined, async () => {
        const result = await createClientDispersion({
          clienteId: clientId,
          beneficiaryId,
          methodId,
          despachoId,
          amount: Number(amount),
          reference: reference.trim(),
        });

        setSuccess(
          `Dispersion creada: ${
            result.folio ||
            result.dispersionId ||
            "sin folio"
          }. Comision: ${formatMoney(
            result.clientChargeAmount,
          )}.`,
        );
        setAmount("");
        setReference("");
        setBeneficiaryId("");
        setMethodId("");
        setDespachoId("");
        setPricingPreview(null);
        setPricingPreviewError("");
        setOpenDispersionModal(false);
        setBalanceReloadKey((value) => value + 1);
      });
    } catch (e: any) {
      setError(e?.message || "No se pudo crear la dispersion.");
    } finally {
      createDispersionLockRef.current = false;
      setSaving(false);
    }
  }

  function getIqGenerationStatus(
    row: any,
  ) {
    return String(
      row?.iqGenerationStatus || "",
    )
      .trim()
      .toUpperCase();
  }

  function canGenerateIqForRow(
    row: any,
  ) {
    const iqStatus =
      getIqGenerationStatus(row);

    return (
      String(
        row?.forwardOnlyVersion || "",
      ).trim() ===
        "H4_D82_A3_A2_FORWARD_ONLY_V1" &&
      String(
        row?.reservationStatus || "",
      )
        .trim()
        .toUpperCase() ===
        "SALDO_RESERVADO" &&
      row?.reservationReleased !== true &&
      ![
        "IQ_GENERADA",
        "IQ_REQUIERE_REVISION",
      ].includes(iqStatus)
    );
  }


  async function handleGenerateIq(
    dispersionId: string,
    folio?: string | null,
  ) {
    setIqBusyId(dispersionId);
    setError("");
    setSuccess("");

    try {
      const preview =
        await previewClientDispersionIq(
          dispersionId,
        );
      const readyLegs =
        preview.legs.filter(
          (leg) =>
            leg.status === "READY",
        );
      const skippedLegs =
        preview.legs.filter(
          (leg) =>
            leg.status !== "READY",
        );
      if (readyLegs.length === 0) {
        const diagnostics =
          skippedLegs
            .map((leg) => {
              const d =
                leg.diagnostic;
              const config =
                d
                  ? [
                      `Despacho: ${d.despachoNombre || leg.despachoName || "SIN NOMBRE"}`,
                      `Activo: ${d.active === null || d.active === undefined ? "N/D" : d.active ? "SI" : "NO"}`,
                      `IQ efectivo: ${d.iqEnabled ? "SI" : "NO"}`,
                      `iqEnabled: ${d.iqEnabledFlag ? "SI" : "NO"}`,
                      `usesIq: ${d.usesIq ? "SI" : "NO"}`,
                      `iqDispersionEnabled: ${d.iqDispersionEnabled ? "SI" : "NO"}`,
                      `Marcador integracion: ${d.integrationMarker || "VACIO"}`,
                      `Perfil IQ configurado: ${d.credentialProfileConfigured ? "SI" : "NO"}`,
                    ].join(" | ")
                  : "";

              return `Tramo ${leg.legIndex + 1}: ${leg.reason || leg.status}${config ? `\n${config}` : ""}`;
            })
            .join("\n\n");

        setError(
          `PREVALIDACION IQ BLOQUEADA\n\n${diagnostics || "No hay tramos READY."}\n\nNo se envio informacion a IQ.`,
        );
        return;
      }

      const amountTotal =
        readyLegs.reduce(
          (total, leg) =>
            total +
            Number(leg.amount || 0),
          0,
        );
      const legSummary =
        readyLegs
          .map(
            (leg) =>
              `Tramo ${leg.legIndex + 1}: ${leg.despachoName || leg.despachoId} | ${leg.currency || "MXN"} ${Number(leg.amount || 0).toLocaleString("es-MX", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} | ${leg.operationTypeKey} ${leg.percentageLabel || "0"}% | ${leg.destinationKind} ****${leg.destinationLast4} | Asociado: ${leg.associatedName} | Perfil: ${leg.iqCredentialProfileAlias || leg.iqCredentialProfileId}`,
          )
          .join("\n");
      const skippedSummary =
        skippedLegs.length > 0
          ? `\n\nNo enviados:\n${skippedLegs
              .map(
                (leg) =>
                  `Tramo ${leg.legIndex + 1}: ${leg.reason || leg.status}`,
              )
              .join("\n")}`
          : "";
      const confirmed =
        window.confirm(
          `PREVALIDACION IQ\n\nDispersion: ${folio || dispersionId}\nTipo: ${preview.operationTypeKey}\nDestino: ${preview.destination.kind} ****${preview.destination.last4}\nTramos IQ: ${readyLegs.length}\nTotal principal: MXN ${amountTotal.toLocaleString("es-MX", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}\n\n${legSummary}${skippedSummary}\n\nEsta accion pulsara Crear en IQ para cada tramo READY. Un resultado incierto bloqueara el reintento para evitar duplicados.\n\n¿Continuar?`,
        );

      if (!confirmed) {
        setSuccess(
          "Prevalidacion IQ terminada sin enviar datos.",
        );
        return;
      }

      const result =
        await generateClientDispersionIq({
          dispersionId,
          confirm: true,
        });

      const resultLines =
        result.results
          .map(
            (leg) =>
              `${leg.legId}: ${leg.status}${leg.iqId ? ` | IQ ${leg.iqId}` : ""}`,
          )
          .join(" · ");

      setSuccess(
        result.aggregateStatus ===
          "IQ_GENERADA"
          ? `Dispersion IQ generada: ${result.createdCount}/${result.legCount} tramos. ${resultLines}`
          : `IQ termino en ${result.aggregateStatus}: ${result.createdCount} creados, ${result.reviewCount} en revision y ${result.failedCount} fallidos. ${resultLines}`,
      );
    } catch (e: any) {
      setError(
        e?.message ||
          "No se pudo prevalidar o generar la dispersion en IQ.",
      );
    } finally {
      setIqBusyId("");
    }
  }

  async function handleRequestIncident(dispersionId: string, incidentType: DispersionIncidentType) {
    const confirmed = window.confirm("Solicitar incidencia para esta dispersion?");
    if (!confirmed) return;

    setIncidentBusyId(dispersionId);
    setError("");
    setSuccess("");

    try {
      await requestClientDispersionIncident({
        dispersionId,
        incidentType,
      });

      setSuccess(`Incidencia ${incidentType} solicitada.`);
    } catch (e: any) {
      setError(e?.message || "No se pudo solicitar la incidencia.");
    } finally {
      setIncidentBusyId("");
    }
  }

  async function handleResolveIncident(
    dispersionId: string,
    decision: ResolveClientDispersionIncidentDecision
  ) {
    const confirmed = window.confirm("Confirmar resolucion de incidencia?");
    if (!confirmed) return;

    setIncidentBusyId(dispersionId);
    setError("");
    setSuccess("");

    try {
      const result = await resolveClientDispersionIncident({
        dispersionId,
        decision,
      });

      setSuccess(
        result.reintegrated
          ? `Incidencia resuelta: ${decision}. Saldo reintegrado.`
          : `Incidencia resuelta: ${decision}.`
      );
    } catch (e: any) {
      setError(e?.message || "No se pudo resolver la incidencia.");
    } finally {
      setIncidentBusyId("");
    }
  }

  // D6E window drop dispersiones
  useEffect(() => {
    function isAllowedMassiveFile(file: File | null) {
      const name = String(file?.name || "").toLowerCase();
      return Boolean(
        file &&
          (name.endsWith(".xlsx") || name.endsWith(".csv"))
      );
    }

    function handleWindowDragEnter(event: DragEvent) {
      if (!clientId || dispersionImportBusy || dispersionImportSaving) return;
      event.preventDefault();
      setIsDispersionImportDragging(true);
    }

    function handleWindowDragOver(event: DragEvent) {
      if (!clientId || dispersionImportBusy || dispersionImportSaving) return;
      event.preventDefault();
      setIsDispersionImportDragging(true);
    }

    function handleWindowDragLeave(event: DragEvent) {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setIsDispersionImportDragging(false);
      }
    }

    function handleWindowDrop(event: DragEvent) {
      if (event.defaultPrevented) return;

      event.preventDefault();
      setIsDispersionImportDragging(false);

      if (dispersionImportBusy || dispersionImportSaving) return;

      const file = event.dataTransfer?.files?.[0] || null;
      if (!file) return;

      if (!clientId) {
        setError("Selecciona un cliente antes de cargar dispersiones.");
        setSuccess("");
        return;
      }

      if (!isAllowedMassiveFile(file)) {
        setError("Solo se permite Excel .xlsx o CSV para dispersion masiva.");
        setSuccess("");
        return;
      }

      setError("");
      setSuccess("");
      setOpenDispersionMassiveModal(true);
      void handleDispersionImportFile(file);
    }

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);

    return () => {
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [clientId, dispersionImportBusy, dispersionImportSaving, handleDispersionImportFile]);
  return (
    <div
      className="relative space-y-6"
      onDragEnter={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (dispersionImportBusy || dispersionImportSaving) return;
        setIsDispersionImportDragging(true);
      }}
      onDragOver={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (dispersionImportBusy || dispersionImportSaving) return;
        setIsDispersionImportDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.defaultPrevented) return;
        const nextTarget = e.relatedTarget as Node | null;
        if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
          setIsDispersionImportDragging(false);
        }
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        setIsDispersionImportDragging(false);

        if (dispersionImportBusy || dispersionImportSaving) return;

        const file = e.dataTransfer.files?.[0] || null;
        if (!file) return;

        const filename = file.name.toLowerCase();
        if (!filename.endsWith(".xlsx") && !filename.endsWith(".csv")) {
          setError("Solo se permite Excel .xlsx o CSV para dispersion masiva.");
          setSuccess("");
          return;
        }

        setOpenDispersionMassiveModal(true);
        void handleDispersionImportFile(file);
      }}
    >
      {isDispersionImportDragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[#0063C4]/60 bg-[#0063C4]/10 p-6">
          <div className="rounded-2xl border border-[#0063C4]/50 bg-[#0b1220]/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
            <UploadCloud size={34} strokeWidth={1.8} className="mx-auto mb-2 text-sky-200" />
            <div className="text-[14px] font-normal text-white">Suelta el Excel aqui</div>
            <div className="mt-1 text-[12px] text-slate-400">Se abrira la carga masiva de dispersiones</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[280px_1fr_190px_170px] xl:items-center">
        <div className="relative w-full">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
            size={18}
            strokeWidth={1.8}
          />

          <input
            value={dispersionSearch}
            onChange={(e) => setDispersionSearch(e.target.value)}
            placeholder="Buscar dispersion..."
            className="h-[42px] w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-sky-500/70 disabled:cursor-not-allowed disabled:opacity-45"
          />
        </div>

        <UiSelect
          value={clientId}
          onChange={(nextClientId) => {
            setClientId(nextClientId);
            setBeneficiaryId("");
            setMethodId("");
            setDispersionSearch("");
            setSuccess("");
            setError("");
          }}
          options={[
            {
              value: "",
              label: "Todos los clientes",
            },
            ...clients.map((client) => ({
              value: client.id,
              label: client.label,
            })),
          ]}
          placeholder="Todos los clientes"
        />

        <button
          type="button"
          onClick={() => setOpenDispersionMassiveModal(true)}
          disabled={!clientId}
          className="inline-flex h-[42px] items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-4 text-sm text-slate-300 transition hover:border-sky-400 hover:bg-sky-500/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
        >
          + Dispersion masiva
        </button>

        <button
          type="button"
          onClick={() => setOpenDispersionModal(true)}
          disabled={!clientId}
          className="inline-flex h-[42px] items-center justify-center rounded-xl bg-blue-600 px-5 text-base font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
        >
          + Dispersion
        </button>
      </div>

      <DateScopeBar
        className="min-w-0 w-full"
        mode={mode}
        baseDate={baseDate}
        customRange={customRange}
        onModeChange={(nextMode) => {
          setMode(nextMode);

          if (nextMode !== "custom") {
            setCustomRange({});
            setBaseDate(new Date());
          }
        }}
        onNavigate={(direction) =>
          setBaseDate((previous) =>
            shiftBaseDate(
              mode,
              previous,
              direction,
            ),
          )
        }
        onCustomRangeChange={(rangeValue) => {
          setCustomRange(rangeValue);

          if (
            rangeValue.start &&
            rangeValue.end
          ) {
            setMode("custom");
          }
        }}
      />

      {clientId ? (
        <div
          data-pay0="dispersionMainBalanceSummary"
          className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">
                Saldo general
              </span>
              <span className="font-medium text-white">
                {formatMoney(
                  getAvailableBalanceValue(balanceRow),
                )}
              </span>
            </div>

            {dispatchBalanceRows.map((row) => {
              const despachoLabel =
                row.channel === "IQ"
                  ? "IQ"
                  : row.despachoName ||
                    despachos.find(
                      (item) =>
                        item.id === row.despachoId,
                    )?.label ||
                    row.channel ||
                    row.despachoId;

              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-slate-500">
                    {despachoLabel} disponible
                  </span>
                  <span className="font-medium text-emerald-300">
                    {formatMoney(
                      row.executableBalance ??
                        row.availableBalance,
                    )}
                  </span>

                  {Number(row.reservedBalance || 0) > 0 ? (
                    <>
                      <span className="text-slate-700">
                        ·
                      </span>
                      <span className="text-slate-500">
                        reservado
                      </span>
                      <span className="text-amber-200">
                        {formatMoney(
                          row.reservedBalance,
                        )}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {loadingClients ? <p className="text-sm text-slate-400">Cargando clientes...</p> : null}
      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-400">{success}</p> : null}

      <Modal
        open={openDispersionModal}
        title=""
        onClose={() => {
          if (!saving) {
            setOpenDispersionModal(false);
        setBalanceReloadKey((value) => value + 1);
            setBeneficiaryId("");
            setMethodId("");
            setDespachoId("");
            setPricingPreview(null);
            setPricingPreviewError("");
            setAmount("");
            setReference("");
          }
        }}
        widthClassName="max-w-[430px]"
        bodyClassName="max-h-[calc(100vh-2rem)] overflow-y-auto px-5 py-3"
      >
        <div className="space-y-2">
          <div className="grid w-full grid-cols-2 rounded-xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => {}}
              className="w-full rounded-lg bg-[#0063C4]/25 px-3 py-2 text-[13px] font-normal text-sky-100 transition"
            >
              Captura
            </button>
            <button
              type="button"
              onClick={() => {
                if (saving) return;
                setOpenDispersionModal(false);
        setBalanceReloadKey((value) => value + 1);
                setOpenDispersionMassiveModal(true);
              }}
              className="w-full rounded-lg px-3 py-2 text-[13px] font-normal text-slate-400 transition hover:text-white"
            >
              Masiva
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white">
            <div className="truncate font-normal">{selectedClient?.label || "Selecciona cliente"}</div>
          </div>

          <UiSelect
            value={beneficiaryId}
            onChange={(nextBeneficiaryId) => {
              setBeneficiaryId(nextBeneficiaryId);
              setMethodId("");
              setDespachoId("");
              setPricingPreview(null);
              setPricingPreviewError("");
              setSuccess("");
              setError("");
            }}
            options={beneficiaries.map((item) => ({
              value: item.id,
              label: item.nombre || item.id,
            }))}
            placeholder="Beneficiario"
          />

          <UiSelect
            value={methodId}
            onChange={(nextMethodId) => {
              setMethodId(nextMethodId);
              setDespachoId("");
              setPricingPreview(null);
              setPricingPreviewError("");
              setSuccess("");
              setError("");
            }}
            disabled={!beneficiaryId}
            options={filteredMethods.map((item) => ({
              value: item.id,
              label: `${item.tipo || "-"} | ${item.bankName || "-"} | ${item.clabe || item.cardNumber || item.destinationKind || "-"}`,
            }))}
            placeholder={beneficiaryId && filteredMethods.length === 0 ? "Sin metodos activos" : "Metodo"}
          />

          <UiSelect
            value={despachoId}
            onChange={(value) => {
              setDespachoId(value);
              setPricingPreview(null);
              setPricingPreviewError("");
            }}
            disabled={
              !methodId ||
              eligibleDespachos.length === 0
            }
            options={eligibleDespachos.map(
              (item) => ({
                value: item.id,
                label: item.label,
              }),
            )}
            placeholder={
              methodId &&
              eligibleDespachos.length === 0
                ? "Configura costo final del cliente"
                : "Despacho"
            }
          />

          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
            <input
              value={amountFocused ? amount : amount ? formatAmountForInput(amount) : ""}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              onChange={(e) => {
                const next = normalizeAmountInput(e.target.value);
                setAmount(next);
                setSuccess("");
                setError("");
              }}
              placeholder="Monto"
              inputMode="decimal"
              className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-2 pl-8 pr-3 text-right text-[13px] text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40"
            />
          </div>

          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Referencia operativa"
            className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40"
          />

          <div className="rounded-xl border border-white/10 bg-[#0b1220] px-2.5 py-1.5 text-[11px] leading-tight text-slate-300">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Saldo despacho seleccionado</span>
              <span className="whitespace-nowrap text-white">{formatMoney(availableBalance)}</span>
            </div>
            <div className="mt-0.5 flex justify-between gap-3">
              <span className="text-slate-500">Monto dispersion</span>
              <span className="whitespace-nowrap text-white">- {formatMoney(amountNumber)}</span>
            </div>
            <div className="mt-0.5 flex justify-between gap-3">
              <span className="text-slate-500">
                Comision cliente
                {pricingPreview?.pricingMode ===
                "PERCENT"
                  ? ` ${
                      pricingPreview.clientRate
                    }%`
                  : ""}
              </span>
              <span className="whitespace-nowrap text-amber-200">
                -{" "}
                {formatMoney(
                  pricingPreview?.clientChargeAmount ||
                    0,
                )}
              </span>
            </div>
            <div className="mt-0.5 flex justify-between gap-3">
              <span className="text-slate-500">
                Total a descontar
              </span>
              <span className="whitespace-nowrap text-white">
                -{" "}
                {formatMoney(
                  totalClientDebitAmount,
                )}
              </span>
            </div>
            <div className="mt-0.5 flex justify-between gap-3 border-t border-white/10 pt-0.5">
              <span className="font-normal text-slate-300">Saldo despues</span>
              <span className={`whitespace-nowrap font-normal ${projectedBalance < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                {formatMoney(projectedBalance)}
              </span>
            </div>
          </div>

          <div className="grid gap-0.5 rounded-xl border border-white/10 bg-[#0b1220] px-2.5 py-1.5 text-[11px] leading-tight text-slate-300">
            <div data-pay0="clientOriginSummary" className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Cliente origen</span>
                <span className="truncate text-right text-white">
                  {selectedClient?.label || clientId || "-"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
              <span className="text-slate-500">Beneficiario</span>
              <span className="truncate text-white">{selectedBeneficiary?.nombre || "-"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Tipo</span>
              <span className="truncate text-white">
                {pricingPreview?.operationTypeName ||
                  operationTypeKey ||
                  selectedMethod?.tipo ||
                  "-"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Despacho</span>
              <span className="truncate text-white">
                {eligibleDespachos.find(
                  (item) =>
                    item.id === despachoId,
                )?.label || "-"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Banco</span>
              <span className="truncate text-white">{selectedMethod?.bankName || "-"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Dato</span>
              <span className="truncate text-white">{selectedMethod?.clabe || selectedMethod?.cardNumber || selectedMethod?.destinationKind || "-"}</span>
            </div>
          </div>

          {pricingPreviewBusy ? (
            <div className="text-center text-[11px] text-slate-400">
              Calculando costo y ganancias...
            </div>
          ) : null}

          {pricingPreviewError ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
              {pricingPreviewError}
            </div>
          ) : null}

          {(!canSave ||
            !canCreateWithOperationalBalance) &&
          !pricingPreviewBusy ? (
            <div
              data-pay0="dispersionBlockReasonVisible"
              className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-center text-[11px] text-amber-200"
            >
              {getDispersionBlockReason()}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleCreateDispersion}
            disabled={!canSave || saving || !canCreateWithOperationalBalance}
            className={
              canSave && canCreateWithOperationalBalance && !saving
                ? "w-full rounded-xl border border-[#0063C4]/40 bg-[#0063C4]/25 px-4 py-2 text-[13px] font-normal text-sky-100 transition hover:bg-[#0063C4]/35 disabled:opacity-50"
                : "w-full rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[13px] font-normal text-amber-200 transition disabled:cursor-not-allowed disabled:opacity-80"
            }
          >
            {saving
              ? "Guardando..."
              : canSave &&
                  canCreateWithOperationalBalance
                ? "Crear dispersion"
                : getDispersionBlockReason()}
          </button>
        </div>
      </Modal>

      <Modal
        open={openDispersionMassiveModal}
        title=""
        onClose={() => {
          if (!dispersionImportBusy && !dispersionImportSaving) {
            setOpenDispersionMassiveModal(false);
        setBalanceReloadKey((value) => value + 1);
            setDispersionImportPreview(null);
            setDispersionImportFileName("");
            setIsDispersionImportDragging(false);
          }
        }}
        widthClassName="max-w-[520px]"
        bodyClassName="max-h-[calc(100vh-2rem)] overflow-y-auto px-5 py-3"
      >
        <div className="space-y-2">
          <div className="grid w-full grid-cols-2 rounded-xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => {
                if (dispersionImportBusy || dispersionImportSaving) return;
                setOpenDispersionMassiveModal(false);
        setBalanceReloadKey((value) => value + 1);
                setOpenDispersionModal(true);
              }}
              className="w-full rounded-lg px-3 py-2 text-[13px] font-normal text-slate-400 transition hover:text-white"
            >
              Captura
            </button>
            <button
              type="button"
              onClick={() => {}}
              className="w-full rounded-lg bg-[#0063C4]/25 px-3 py-2 text-[13px] font-normal text-sky-100 transition"
            >
              Masiva
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[13px] text-white">
            <div className="truncate font-normal">{selectedClient?.label || "Selecciona cliente"}</div>
            <div className="mt-1 text-[11px] text-slate-400">Dispersion masiva Excel</div>
          </div>

          
          <div>
            <div className="mb-1 text-[11px] text-slate-500">Despacho</div>
            <UiSelect
              value={dispersionImportDespachoId}
              onChange={(value) => {
                setDispersionImportDespachoId(value);
                setDispersionImportPreview(null);
                setDispersionImportFileName("");
                setIsDispersionImportDragging(false);
                setError("");
                setSuccess("");
              }}
              options={eligibleMassiveDespachos.map(
                (item) => ({
                  value: item.id,
                  label: item.label,
                }),
              )}
              placeholder={
                eligibleMassiveDespachos.length === 0
                  ? "Configura costo final del cliente"
                  : "Selecciona despacho"
              }
            />
          </div>

          <div>
            <div className="mb-1 text-[11px] text-slate-500">Tipo de metodo archivo</div>
            <UiSelect
              value={dispersionImportMethodTipo}
              onChange={(value) => {
                setDispersionImportMethodTipo(value as Pay0MassiveMethodTipo);
                setDispersionImportDespachoId("");
                setDispersionImportPreview(null);
                setDispersionImportFileName("");
                setIsDispersionImportDragging(false);
                setError("");
              }}
              options={[
                { value: "DEBITO", label: "DEBITO" },
                { value: "TDC", label: "TDC" },
                { value: "AMEX", label: "AMEX" },
              ]}
              placeholder="Tipo de metodo archivo"
            />
          </div>

          <label
            onDragEnter={(e) => {
              e.preventDefault();
              if (!dispersionImportBusy && !dispersionImportSaving) setIsDispersionImportDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dispersionImportBusy && !dispersionImportSaving) setIsDispersionImportDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDispersionImportDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDispersionImportDragging(false);
              if (dispersionImportBusy || dispersionImportSaving) return;
              const file = e.dataTransfer.files?.[0] || null;
              void handleDispersionImportFile(file);
            }}
            className={`flex min-h-[104px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center transition ${
              isDispersionImportDragging
                ? "border-[#0063C4]/40 bg-[#0063C4]/10"
                : "border-white/10 bg-[#0b1220] hover:bg-white/5"
            } ${dispersionImportBusy || dispersionImportSaving ? "cursor-not-allowed opacity-70" : ""}`}
          >
            <UploadCloud size={28} strokeWidth={1.8} className="text-slate-300" />
            <span className="text-[13px] font-normal text-white">
              {dispersionImportBusy ? "Leyendo Excel..." : "Arrastra tu Excel o haz clic"}
            </span>
            <span className="text-xs text-slate-500">Carga Excel para validar antes de crear dispersiones.</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={dispersionImportBusy || dispersionImportSaving}
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                void handleDispersionImportFile(file);
                e.currentTarget.value = "";
              }}
            />
          </label>

          {dispersionImportPreview ? (
            <div className="rounded-xl border border-white/10 bg-[#0b1220] p-3 text-[12px] text-slate-300">
              <div className="mb-2 text-[11px] font-normal text-slate-400">
                Resultado dispersion masiva
              </div>

              <div className="grid gap-1">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Archivo</span>
                  <span className="truncate text-right text-white">{dispersionImportFileName || "-"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Tipo archivo</span>
                  <span className="text-white">{dispersionImportMethodTipo}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Filas leidas</span>
                  <span className="text-white">{dispersionImportPreview.totals.rows}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">A procesar</span>
                  <span className="text-emerald-300">{dispersionImportPreview.totals.valid}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Omitidas</span>
                  <span className={dispersionImportPreview.totals.errors > 0 ? "text-rose-300" : "text-slate-300"}>
                    {dispersionImportPreview.totals.errors}
                  </span>
                </div>
                <div className="flex justify-between gap-3 border-t border-white/10 pt-2">
                  <span className="text-slate-500">Beneficiarios por crear</span>
                  <span className="text-white">{dispersionImportPreview.summary?.beneficiariesToCreate || 0}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Metodos por crear</span>
                  <span className="text-white">{dispersionImportPreview.summary?.methodsToCreate || 0}</span>
                </div>
                <div className="flex justify-between gap-3 border-t border-white/10 pt-2">
                  <span className="text-slate-500">Saldo disponible</span>
                  <span className="text-white">{formatMoney(availableBalance)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Total valido</span>
                  <span className="text-white">- {formatMoney(dispersionImportPreview.totals.totalAmount)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="font-semibold text-slate-300">Saldo despues</span>
                  <span className={availableBalance - dispersionImportPreview.totals.totalAmount < 0 ? "text-rose-300" : "text-emerald-300"}>
                    {formatMoney(availableBalance - dispersionImportPreview.totals.totalAmount)}
                  </span>
                </div>
              </div>

              {dispersionImportPreview.totals.totalAmount > availableBalance ? (
                <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-950/20 p-2 text-rose-200">
                  Saldo insuficiente para procesar el total valido. Ajusta el archivo o deposita fondos antes de continuar.
                </div>
              ) : null}

              {dispersionImportPreview.errorRows.length > 0 ? (
                <div className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-rose-400/10 bg-rose-950/10 p-2">
                  {dispersionImportPreview.errorRows.slice(0, 10).map((row: any) => (
                    <div key={row.rowNumber} className="text-rose-200">
                      Fila {row.rowNumber}: {row.errors.map(cleanMassiveErrorText).join(" ")}
                    </div>
                  ))}
                  {dispersionImportPreview.errorRows.length > 10 ? (
                    <div className="text-slate-500">+ {dispersionImportPreview.errorRows.length - 10} error(es) mas.</div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleCreateMassiveDispersionsFromPreview}
                disabled={
                  dispersionImportSaving ||
                  dispersionImportPreview.totals.valid === 0 ||
                  dispersionImportPreview.totals.totalAmount > availableBalance
                }
                className={
                  !dispersionImportSaving &&
                  dispersionImportPreview.totals.valid > 0 &&
                  dispersionImportPreview.totals.totalAmount <= availableBalance
                    ? "mt-3 w-full rounded-xl border border-[#0063C4]/40 bg-[#0063C4]/25 px-4 py-2 text-[13px] font-normal text-sky-100 transition hover:bg-[#0063C4]/35 disabled:opacity-50"
                    : "mt-3 w-full rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[13px] font-normal text-amber-200 transition disabled:cursor-not-allowed disabled:opacity-80"
                }
              >
                {dispersionImportSaving
                  ? "Procesando..."
                  : dispersionImportPreview.totals.valid > 0 && dispersionImportPreview.totals.totalAmount <= availableBalance
                    ? "Procesar archivo"
                    : "CAMPOS INCOMPLETOS"}
              </button>
            </div>
          ) : null}
        </div>
      </Modal>
      <div className="pay0-table-card">
        <div className="pay0-table-header">
          <h2 className="pay0-table-title">
            {clientId
              ? "DISPERSIONES DEL CLIENTE"
              : "DISPERSIONES"}
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-normal text-slate-400">
              {displayedRows.length} registros
            </span>

            <button
              type="button"
              onClick={handleExportDispersionesExcel}
              disabled={displayedRows.length === 0}
              title="Exportar dispersiones a Excel"
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Excel
            </button>

            <button
              type="button"
              onClick={handleExportDispersionesPdf}
              disabled={displayedRows.length === 0}
              title="Exportar dispersiones a PDF"
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-rose-500/50 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              PDF
            </button>
          </div>
        </div>

        <div className="pay0-table-wrap">
          <table className="pay0-dispersiones-main-table pay0-table min-w-[1380px]">
            <colgroup className="pay0-dispersiones-colgroup">
              <col className="pay0-dis-col-folio" />
              <col className="pay0-dis-col-folio" />
              <col className="pay0-dis-col-fecha" />
              <col />
              <col className="pay0-dis-col-beneficiario" />
              <col className="pay0-dis-col-tipo" />
              <col className="pay0-dis-col-banco" />
              <col className="pay0-dis-col-dato" />
              <col className="pay0-dis-col-monto" />
              <col className="pay0-dis-col-estatus" />
              <col className="pay0-dis-col-docs" />
              <col className="pay0-dis-col-acciones" />
            </colgroup>
            <thead>
              <tr>
                <th className="pay0-th">Folio</th>
                <th className="pay0-th">Folio IQ</th>
                <th className="pay0-th">Fecha</th>
                <th className="pay0-th">Cliente</th>
                <th className="pay0-th">Beneficiario</th>
                <th className="pay0-th">Tipo</th>
                <th className="pay0-th">Banco</th>
                <th className="pay0-th">CLABE/Tarjeta</th>
                <th className="pay0-th">Monto</th>
                <th className="pay0-th">Estatus</th>
                <th className="pay0-th text-center">COMPS</th>
                <th className="pay0-th text-center">ACC</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row, index) => {
                const busy = incidentBusyId === row.id;
                const canRequest = row.status === "REGISTRADA" && !row.incidentStatus;
                const canResolve = isSuperadmin && row.incidentStatus === "SOLICITADA";

              
  return (
                  <tr key={row.id} className={index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}>
                    <td className="pay0-td-date text-sky-400" title={String(row.folio || "")}>{row.folio || "-"}</td>
                    <td
                      className="pay0-td-date text-emerald-300"
                      title={getDispersionIqFolioText(row)}
                    >
                      {getDispersionIqFolioText(row) || "-"}
                    </td>
                    <td className="pay0-td-date" title={formatDate(row.createdAt)}>{formatDate(row.createdAt)}</td>
                    <td
                      className="pay0-td"
                      title={String(row.clienteNombre || "")}
                    >
                      {row.clienteNombre || "-"}
                    </td>
                    <td className="pay0-td" title={String(row.beneficiaryNombre || "")}>{row.beneficiaryNombre || "-"}</td>
                    <td className="pay0-td" title={String(row.methodTipo || row.destinationKind || "")}>{row.methodTipo || row.destinationKind || "-"}</td>
                    <td className="pay0-td" title={String(row.bankName || "")}>{row.bankName || "-"}</td>
                    <td className="pay0-td-date" title={String(row.clabe || row.cardNumber || row.destinationKind || "")}>
                      {row.clabe || row.cardNumber || row.destinationKind || "-"}
                    </td>
                    <td className="pay0-td-money text-white" title={formatMoney(row.amount)}>{formatMoney(row.amount)}</td>
                    <td className="pay0-td" title={String(row.status || "")}>{row.status || "-"}</td>
                                        <td className="pay0-td text-center">
                      <button
                        type="button"
                        onClick={() => setDocsFor(row)}
                        className="text-sky-400 border border-dashed border-sky-400 rounded-full p-0.5 hover:bg-sky-400/10"
                        title="Comps"
                        aria-label={`Comps ${row.folio || row.id}`}
                      >
                        <Plus size={10} />
                      </button>
                    </td>
                    <td className="pay0-td text-center">
                      <div className="pay0-dis-actions flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => setNotesFor(row)}
                          className={`inline-flex items-center justify-center p-1 transition-colors duration-150 ${row.hasUnreadMsg ? "text-yellow-400 animate-[pulse_1.5s_infinite]" : "text-slate-500 hover:text-yellow-400"}`}
                          title="Notas / incidencias"
                          aria-label={`Notas / incidencias ${row.folio || row.id}`}
                        >
                          <MessageSquarePlus size={16} strokeWidth={1.8} />
                        </button>
                        {canRequest ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRequestIncident(row.id, "DEVOLUCION")}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:opacity-40 hover:text-amber-500"
                              title="Solicitar devolucion"
                              aria-label={`Solicitar devolucion ${row.folio || row.id}`}
                            >
                              <RotateCcw size={16} strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleRequestIncident(row.id, "CANCELACION")}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:opacity-40 hover:text-amber-500"
                              title="Solicitar cancelacion"
                              aria-label={`Solicitar cancelacion ${row.folio || row.id}`}
                            >
                              <Ban size={16} strokeWidth={1.8} />
                            </button>
                          </>
                        ) : null}

                        {canResolve ? (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleResolveIncident(row.id, "RECHAZADA")}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:opacity-40 hover:text-rose-500"
                              title="Rechazar incidencia"
                              aria-label={`Rechazar incidencia ${row.folio || row.id}`}
                            >
                              <XCircle size={16} strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleResolveIncident(row.id, "DEVOLUCION_APLICADA")}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:opacity-40 hover:text-amber-500"
                              title="Aplicar devolucion"
                              aria-label={`Aplicar devolucion ${row.folio || row.id}`}
                            >
                              <Undo2 size={16} strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleResolveIncident(row.id, "CANCELACION_APLICADA")}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:opacity-40 hover:text-rose-500"
                              title="Aplicar cancelacion"
                              aria-label={`Aplicar cancelacion ${row.folio || row.id}`}
                            >
                              <Ban size={16} strokeWidth={1.8} />
                            </button>
                          </>
                        ) : null}

                        
                          {canGenerateIqForRow(row) ? (
                            <button
                              type="button"
                              disabled={
                                incidentBusyId === row.id ||
                                iqBusyId === row.id
                              }
                              onClick={() =>
                                handleGenerateIq(
                                  row.id,
                                  row.folio,
                                )
                              }
                              className="rounded-lg border border-emerald-600 px-3 py-1 text-xs text-emerald-300 disabled:opacity-50"
                            >
                              {iqBusyId === row.id
                                ? "Generando IQ..."
                                : "Generar en IQ"}
                            </button>
                          ) : getIqGenerationStatus(row) ? (
                            <span className="text-xs text-slate-400">
                              {getIqGenerationStatus(row).replaceAll(
                                "_",
                                " ",
                              )}
                            </span>
                          ) : null}

{!canRequest && !canResolve && !canGenerateIqForRow(row) ? (
                          <span className="text-xs text-slate-500">-</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="pay0-empty-cell">
                    No hay dispersiones para este periodo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
            {notesFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Notas de dispersion</div>
                <div className="text-xs text-slate-400">
                  {notesFor?.folio || notesFor?.id} - {notesFor?.clienteNombre || "---"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setNotesFor(null);
                  setNotes([]);
                  setNewNote("");
                }}
                className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            {notesFor?.incidentStatus ? (
              <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-slate-300">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">Incidencia actual</div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Estatus</span>
                  <span className="text-right text-white">{formatIncidentLabel(notesFor)}</span>
                </div>
                {notesFor?.incidentReason ? (
                  <div className="mt-2 border-t border-white/10 pt-2 text-slate-400">
                    {notesFor.incidentReason}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mb-3 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              {notes.length === 0 ? (
                <div className="text-sm text-slate-400">Sin mensajes todavia.</div>
              ) : (
                notes.map((note) => <NoteBubble key={note.id} note={note} />)
              )}
            </div>

            <div className="flex gap-2">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Escribe una nota..."
                className="min-h-20 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              />
              <button
                type="button"
                onClick={sendDispersionNote}
                disabled={!newNote.trim()}
                className="self-end rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <DispersionDocsModal
        open={!!docsFor}
        dispersion={docsFor}
        onClose={() => setDocsFor(null)}
      />

    </div>
  );
}
