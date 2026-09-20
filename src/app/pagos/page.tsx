"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePagoReceiptPdfFile } from "@/services/pagoReceipt";
import { findFacturaSubtotalOperation } from "@/lib/solicitudes/operationOptions";
import { useSearchParams } from "next/navigation";
import { collection, onSnapshot, orderBy, query, where, type Query, type DocumentData } from "firebase/firestore";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Link2,
  Eye,
  MessageSquarePlus,
  Search,
  Send,
  ShieldCheck,
  Plus,
  X,
} from "lucide-react";

import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin, isAdmin, isOperador } from "@/lib/roles";
import { useModuleAccess } from "@/lib/useModuleAccess";
import {
  addPagoNota,
  applyPagoToSolicitudesAtomic,
  changePagoStatus,
  createPago,
  listPagos,
  createPagoApplicationIdempotencyKey,
  executePagoApplicationIqPlan,
  diagnosePagoApplicationIqMethods,
  preparePagoApplicationIqPlan,
  resumePagoApplicationIqPlan,
} from "@/services/pagos";
import { listCompanies } from "@/services/companies";
import { listScopedClients } from "@/services/clients";
import DateScopeBar from "@/components/DateScopeBar";
import { useGlobalLoading } from "@/components/GlobalLoading";
import UiSelect from "@/components/UiSelect";
import PagoDocsModal from "@/components/PagoDocsModal";
import PagoApplicationIqFlowModal from "@/components/PagoApplicationIqFlowModal";
import { uploadPagoDoc } from "@/lib/uploadPagoDoc";
import { CustomRange, DateScopeMode, getScopeRange, isTsWithinRange, shiftBaseDate } from "@/lib/dateScope";
import { PaymentRelationIndicator } from "@/components/PaymentRelationIndicator"; // H4-D67-A1B_RELATION_COLUMN

function money2(value: any) {
  const raw = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const num = Number(raw || 0);
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function toCurrency(value: any) {
  return money2(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeMoneyInput(value: any) {
  let text = String(value ?? "")
    .replace(/,/g, "")
    .replace(/[^\d.]/g, "");

  if (!text) return "";

  const firstDot = text.indexOf(".");
  if (firstDot >= 0) {
    text =
      text.slice(0, firstDot + 1) +
      text.slice(firstDot + 1).replace(/\./g, "");
  }

  if (text.startsWith(".")) {
    text = "0" + text;
  }

  const hasDot = text.includes(".");
  const parts = text.split(".");
  const integerPart = (parts[0] || "0").replace(/^0+(?=\d)/, "") || "0";
  const decimalPart = hasDot ? (parts[1] || "").slice(0, 2) : "";

  return hasDot ? `${integerPart}.${decimalPart}` : integerPart;
}

function formatMoneyInput(value: any) {
  const normalized = normalizeMoneyInput(value);
  if (!normalized) return "";

  const hasDot = normalized.includes(".");
  const parts = normalized.split(".");
  const integerPart = Number(parts[0] || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
  const decimalPart = hasDot ? ((parts[1] || "") + "00").slice(0, 2) : "00";

  return `${integerPart}.${decimalPart}`;
}

function tsToDateText(value: any) {
  if (value?.seconds) {
    return new Date(value.seconds * 1000).toLocaleDateString();
  }
  return "---";
}

function tsToDateTimeText(value: any) {
  if (value?.seconds) {
    return new Date(value.seconds * 1000).toLocaleString();
  }
  return "Ahora";
}

function normalizeText(value: any) {
  return String(value || "").trim().toLowerCase();
}

function parseMoneyInput(value: any) {
  return normalizeMoneyInput(value).replace(/,/g, "");
}

function statusClass(status: string) {
  const map: Record<string, string> = {
    REGISTRADO: "bg-slate-500/10 text-slate-300 border-slate-500/20",
    CONCILIACION_PENDIENTE: "bg-amber-500/10 text-amber-300 border-amber-500/20 animate-pulse",
    CONCILIADO: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    APLICADO_PARCIAL: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    APLICADO_TOTAL: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    RECHAZADO: "bg-rose-500/10 text-rose-300 border-rose-500/20",
    CANCELADO: "bg-red-500/10 text-red-300 border-red-500/20",
  };

  return map[String(status || "").toUpperCase()] || "bg-white/5 text-slate-300 border-white/10";
}

function aplicacionStatusLabel(a: any) {
  const solicitudStatus = String(a?.solicitudStatus || "").toUpperCase();

  if (solicitudStatus === "COMPLETADA") {
    return "LIQUIDADO";
  }

  return "APLICADO";
}

function aplicacionStatusClass(a: any) {
  const solicitudStatus = String(a?.solicitudStatus || "").toUpperCase();

  if (solicitudStatus === "COMPLETADA") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }

  return "border-sky-500/20 bg-sky-500/10 text-sky-300";
}

function clientLabel(client: any) {
  return String(
    client?.nombre ||
    client?.clienteNombre ||
    client?.name ||
    client?.razonSocial ||
    client?.alias ||
    client?.id ||
    "Cliente"
  );
}

function matchSolicitudWithCliente(s: any, clienteId: string, clienteNombre: string) {
  const byId =
    String(s?.clienteId || "").trim() &&
    String(s?.clienteId || "").trim() === String(clienteId || "").trim();

  const byName =
    normalizeText(s?.clienteNombre) &&
    normalizeText(clienteNombre) &&
    normalizeText(s?.clienteNombre) === normalizeText(clienteNombre);

  return !!byId || !!byName;
}

function getSolicitudPendiente(s: any) {
  const monto = money2(s?.monto || 0);
  const abonado = money2(s?.totalAbonado || 0);
  return money2(Math.max(0, monto - abonado));
}

function isSolicitudTerminal(s: any) {
  const status = String(s?.status || "").toUpperCase();
  return [
    "RECHAZADA",
    "RECHAZADO",
    "CANCELADA",
    "CANCELADO",
    "ELIMINADA",
    "ELIMINADO"
  ].includes(status);
}

function NoteBubble({ note, myUid }: any) {
  const isMine = String(note?.createdBy || "") === String(myUid || "");
  const wrapper = isMine ? "justify-end" : "justify-start";
  const bubble = isMine
    ? "bg-sky-500/15 border-sky-500/20 text-slate-100"
    : "bg-white/5 border-white/10 text-slate-100";



  return (
    <div className={`flex ${wrapper}`}>
      <div className={`max-w-[80%] rounded-2xl border px-4 py-3 ${bubble}`}>
        <div className={`mb-1 text-[11px] ${isMine ? "text-sky-300 text-right" : "text-slate-400 text-left"}`}>
          {note?.createdByName || note?.createdByRole || "Sistema"}
        </div>
        <div className="whitespace-pre-wrap text-sm">{note?.text || "-"}</div>
        <div className={`mt-2 text-[10px] ${isMine ? "text-right text-sky-200/70" : "text-left text-slate-500"}`}>
          {tsToDateTimeText(note?.createdAt)}
        </div>
      </div>
    </div>
  );
}


function getPagoFolio(p: any) {
  return String(p?.folio || p?.referenceFolio || p?.pagoFolio || p?.id || p?.pagoId || '---');
}
function getTodayDateInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
// IQ2G_H4_D43D_PAGOS_IQ_HELPERS
function getPagoIqFolio(p: any) {
  return String(
    p?.iqDepositFolio ||
    p?.iqDepositId ||
    p?.iqPagoDepositFolio ||
    p?.iqPagoDepositId ||
    ""
  ).trim() || "---";
}

// H4_D85_A10_A36_PAY0_IQ_FOLIO_LINK_VISIBILITY
function getSolicitudIqFolioVisible(s: any) {
  const direct = String(
    s?.solicitudIqFolio ||
    s?.iqInvoiceFolio ||
    s?.iqFolio ||
    ""
  ).trim();

  if (/^\d{3,20}$/.test(direct)) return direct;

  const attempts = Array.isArray(s?.iqAttempts)
    ? s.iqAttempts
    : [];

  const activeAttempt = [...attempts]
    .reverse()
    .find((attempt: any) => {
      const folio = String(
        attempt?.solicitudIqFolio ||
        attempt?.iqInvoiceFolio ||
        attempt?.iqFolio ||
        ""
      ).trim();

      return /^\d{3,20}$/.test(folio);
    });

  return String(
    activeAttempt?.solicitudIqFolio ||
    activeAttempt?.iqInvoiceFolio ||
    activeAttempt?.iqFolio ||
    ""
  ).trim();
}

function isPagoIqLinked(p: any) {
  return getPagoIqFolio(p) !== "---";
}

function getPagoIqStatus(p: any) {
  return String(
    p?.iqDepositReconciliationStatus ||
    p?.iqPagoDepositReconciliationStatus ||
    p?.iqDepositStatus ||
    p?.iqPagoDepositStatus ||
    p?.iqDepositCreationStatus ||
    ""
  ).trim() || "---";
}

function getIqFlowStage(planResult: any) {
  const status = String(planResult?.status || "").toUpperCase();
  const executionStatus = String(planResult?.iqExecutionStatus || "").toUpperCase();

  if (status === "IQ_APPLIED" || executionStatus === "SUCCEEDED") return "SUCCEEDED";
  if (["IQ_REJECTED_REVIEW_REQUIRED", "IQ_UNKNOWN_REVIEW_REQUIRED"].includes(status)) return "REVIEW_REQUIRED";
  if (["REJECTED_REVIEW_REQUIRED", "UNKNOWN_REVIEW_REQUIRED"].includes(executionStatus)) return "REVIEW_REQUIRED";
  if (status === "IQ_IN_PROGRESS" || executionStatus === "IN_PROGRESS") return "IN_PROGRESS";
  if (executionStatus === "FAILED_SAFE") return "FAILED_SAFE";
  return "READY";
}

function isIqPaymentApplicationBlocking(pago: any) {
  const status = String(pago?.iqPaymentApplicationStatus || "").toUpperCase();
  const executionStatus = String(pago?.iqPaymentApplicationExecutionStatus || "").toUpperCase();
  return [
    "PAY0_APPLIED_PENDING_IQ_PLAN",
    "PREVALIDATED",
    "IQ_IN_PROGRESS",
    "IQ_REJECTED_REVIEW_REQUIRED",
    "IQ_UNKNOWN_REVIEW_REQUIRED",
  ].includes(status) || [
    "NOT_EXECUTED",
    "IN_PROGRESS",
    "FAILED_SAFE",
    "REJECTED_REVIEW_REQUIRED",
    "UNKNOWN_REVIEW_REQUIRED",
  ].includes(executionStatus) && status !== "IQ_APPLIED";
}

export default function PagosPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const globalLoading = useGlobalLoading();
  const { modules, canAccess: canViewPagos } = useModuleAccess(profile, "pagos", "view");

  const canCreatePagos = !!modules?.pagos?.create;
  const canConciliatePagos = !!modules?.pagos?.conciliate;
  const canApplyPagos = !!modules?.pagos?.create || !!modules?.pagos?.conciliate;
  const canManagePagoDocs = !!modules?.pagos?.create || !!modules?.pagos?.conciliate || !!modules?.pagos?.uploadDocs;
  const role = normalizeRole((profile as any)?.role);
  const canViewIqFolios = isSuperAdmin(role);

  const rootId = (profile as any)?.rootId || user?.uid;
  const myUid = user?.uid || "";

  const [mode, setMode] = useState<DateScopeMode>("day");
  const [baseDate, setBaseDate] = useState(new Date());
  const [customRange, setCustomRange] = useState<CustomRange>({});

  const [pagos, setPagos] = useState<any[]>([]);
  const [clientes, setClientes] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [solicitudes, setSolicitudes] = useState<any[]>([]);
  const [pagoAplicaciones, setPagoAplicaciones] = useState<any[]>([]);
  const [loadingPagos, setLoadingPagos] = useState(true);
  const [loadingMorePagos, setLoadingMorePagos] = useState(false);
  const [hasMorePagos, setHasMorePagos] = useState(false);
  const [pagoCursor, setPagoCursor] = useState<{ seconds: number; nanoseconds: number; id: string } | null>(null);

  const [filter, setFilter] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", dir: "desc" });

  const [openNewPago, setOpenNewPago] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedOperationTypeKey, setSelectedOperationTypeKey] = useState("");
  const [operationTypes, setOperationTypes] = useState<any[]>([]);
  const [montoTotal, setMontoTotal] = useState("");
  const [isMontoTotalFocused, setIsMontoTotalFocused] = useState(false);
  const [fechaPago, setFechaPago] = useState(() => getTodayDateInputValue());
  const [moneda, setMoneda] = useState("MXN");
  const [paymentForm, setPaymentForm] = useState("");
  const [notaInicial, setNotaInicial] = useState("");
  const [comprobantePagoFile, setComprobantePagoFile] = useState<File | null>(null);
  const [comprobantePagoDragActive, setComprobantePagoDragActive] = useState(false);
  const [isPagoPageDragging, setIsPagoPageDragging] = useState(false);
  const [receiptBatchOpen, setReceiptBatchOpen] = useState(false);
  const [receiptBatchBusy, setReceiptBatchBusy] = useState(false);
  const [receiptBatchCreating, setReceiptBatchCreating] = useState(false);
  const [receiptBatchItems, setReceiptBatchItems] = useState<any[]>([]);
  const clientesRef = useRef<any[]>([]);

  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState("");
  const [pageMsg, setPageMsg] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [notesFor, setNotesFor] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");
  const [noteSending, setNoteSending] = useState(false);

  const [applyFor, setApplyFor] = useState<any>(null);
  const applyRequestKeyRef = useRef("");
  const [pendingOpenPagoId, setPendingOpenPagoId] = useState("");
  const [applyAmounts, setApplyAmounts] = useState<Record<string, string>>({});
  const [iqFlow, setIqFlow] = useState<any>(null);
  const [iqFlowOpen, setIqFlowOpen] = useState(false);
  const [iqFlowBusy, setIqFlowBusy] = useState(false);
  const [iqHumanConfirmed, setIqHumanConfirmed] = useState(false);
  const iqFlowActionRef = useRef(false);
  const [viewAplicacionesFor, setViewAplicacionesFor] = useState<any>(null);
  const [pagoDocsFor, setPagoDocsFor] = useState<any>(null);
  const missingPagoFields = useMemo(() => {
    const missing: string[] = [];
    const montoNumber = Number(String(montoTotal || "").replace(/,/g, ""));

    if (!selectedClientId) missing.push("Cliente");
    if (!selectedCompanyId) missing.push("Empresa");
    if (!selectedOperationTypeKey) missing.push("Tipo");
    if (!Number.isFinite(montoNumber) || montoNumber <= 0) missing.push("Monto");
    if (!fechaPago) missing.push("Fecha");
    if (!moneda) missing.push("Moneda");
    if (!comprobantePagoFile) missing.push("Comprobante");

    return missing;
  }, [selectedClientId, selectedCompanyId, selectedOperationTypeKey, montoTotal, fechaPago, moneda, comprobantePagoFile]);

  const isPagoFormComplete = missingPagoFields.length === 0;
  const pagoFormTooltip = isPagoFormComplete ? "" : `Campos incompletos: ${missingPagoFields.join(", ")}`;

  function resetNewPagoForm() {
    setSelectedClientId("");
    setSelectedCompanyId("");
    setSelectedOperationTypeKey("");
    setMontoTotal("");
    setFechaPago(getTodayDateInputValue());
    setMoneda("MXN");
    setPaymentForm("");
    setNotaInicial("");
    setComprobantePagoFile(null);
    setComprobantePagoDragActive(false);
    setPageMsg("");
  }

  function openNewPagoModal() {
    setIsPagoPageDragging(false);
    resetNewPagoForm();
    setOpenNewPago(true);
  }

  const RECEIPT_MATCH_LOW_VALUE_WORDS = new Set([
    "sa",
    "cv",
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "y",
    "sapi",
    "sofom",
    "enr",
    "rl",
    "sc",
    "ac",
    "comercializadora",
    "comercial",
    "distribuidora",
    "distribuciones",
    "servicios",
    "productos",
    "soluciones",
    "empresa",
    "corporativo",
    "grupo",
    "constructora",
    "operadora",
    "operaciones",
    "sistemas",
    "sistema",
    "redes",
    "equipamiento",
    "telecom",
    "telecomunicaciones",
    "tecnologia",
    "tecnologias",
    "integral",
    "integrales",
    "mexico",
    "mexicana",
    "mexicano",
  ]);

  function normalizeReceiptMatchText(value: unknown) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function receiptMatchTokens(value: unknown) {
    return normalizeReceiptMatchText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter(
        (token) =>
          token.length >= 2 &&
          !RECEIPT_MATCH_LOW_VALUE_WORDS.has(token),
      );
  }

  function receiptBigrams(value: string) {
    const compact = value.replace(/\s+/g, "");
    const set = new Set<string>();

    if (compact.length <= 1) {
      if (compact) set.add(compact);
      return set;
    }

    for (let i = 0; i < compact.length - 1; i += 1) {
      set.add(compact.slice(i, i + 2));
    }

    return set;
  }

  function receiptDiceSimilarity(left: string, right: string) {
    const a = receiptBigrams(left);
    const b = receiptBigrams(right);

    if (a.size === 0 || b.size === 0) return 0;

    let common = 0;
    a.forEach((part) => {
      if (b.has(part)) common += 1;
    });

    return (2 * common) / (a.size + b.size);
  }

  function receiptNameSimilarity(detectedName: string, candidateName: string) {
    const wanted = normalizeReceiptMatchText(detectedName);
    const candidate = normalizeReceiptMatchText(candidateName);

    if (!wanted || !candidate) return 0;
    if (wanted === candidate) return 1;

    const wantedTokens = receiptMatchTokens(wanted);
    const candidateTokens = receiptMatchTokens(candidate);

    const wantedCore = wantedTokens.join(" ");
    const candidateCore = candidateTokens.join(" ");

    if (wantedCore && candidateCore && wantedCore === candidateCore) {
      return 0.99;
    }

    if (
      wantedCore.length >= 4 &&
      candidateCore.length >= 4 &&
      (wantedCore.includes(candidateCore) ||
        candidateCore.includes(wantedCore))
    ) {
      const shorter = Math.min(wantedCore.length, candidateCore.length);
      const longer = Math.max(wantedCore.length, candidateCore.length);
      return Math.min(0.985, 0.94 + 0.045 * (shorter / longer));
    }

    const wantedSet = new Set(wantedTokens);
    const candidateSet = new Set(candidateTokens);

    const commonDistinctive = wantedTokens.filter(
      (token) =>
        token.length >= 5 &&
        candidateSet.has(token),
    );

    if (commonDistinctive.length > 0) {
      const longest = Math.max(...commonDistinctive.map((token) => token.length));
      const bonus = Math.min(0.035, Math.max(0, longest - 5) * 0.005);

      // Una palabra distintiva exacta es una seÃ±al fuerte:
      // NORREY, AIMIERA, SETUBAL, INSERVICE, etc.
      return Math.min(0.985, 0.94 + bonus);
    }

    const union = new Set([...wantedTokens, ...candidateTokens]);

    let common = 0;
    wantedSet.forEach((token) => {
      if (candidateSet.has(token)) common += 1;
    });

    const jaccard = union.size > 0 ? common / union.size : 0;
    const coverage =
      Math.min(wantedSet.size, candidateSet.size) > 0
        ? common / Math.min(wantedSet.size, candidateSet.size)
        : 0;
    const dice = receiptDiceSimilarity(
      wantedCore || wanted,
      candidateCore || candidate,
    );

    return Math.max(
      jaccard * 0.7 + coverage * 0.3,
      dice * 0.9,
    );
  }

  function normalizeReceiptRfc(value: unknown) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9&Ã‘]/g, "")
      .trim();
  }

  function normalizeReceiptDigits(value: unknown) {
    return String(value || "").replace(/\D/g, "");
  }

  function receiptItemNames(item: any) {
    return [
      item?.name,
      item?.nombre,
      item?.label,
      item?.razonSocial,
      item?.businessName,
      item?.commercialName,
      item?.nombreComercial,
      item?.empresaNombre,
      item?.clienteNombre,
      item?.companyName,
      item?.clientName,
      item?.displayName,
      item?.legalName,
      item?.shortName,
      item?.alias,
      item?.depositAlias,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function receiptItemRfcs(item: any) {
    return [
      item?.rfc,
      item?.RFC,
      item?.taxId,
      item?.taxID,
    ]
      .map(normalizeReceiptRfc)
      .filter(Boolean);
  }

  function receiptItemAccounts(item: any) {
    const depositClabes = Array.isArray(item?.depositClabes)
      ? item.depositClabes
      : [];

    return [
      item?.clabe,
      item?.CLABE,
      item?.bankClabe,
      item?.cuenta,
      item?.account,
      item?.accountNumber,
      ...depositClabes,
    ]
      .map(normalizeReceiptDigits)
      .filter((value) => value.length >= 4);
  }

  function scoreReceiptCatalogItem(
    item: any,
    detectedName: string,
    detectedRfc = "",
    detectedClabe = "",
    detectedAccount = "",
  ) {
    const nameScore = Math.max(
      0,
      ...receiptItemNames(item).map((name) =>
        receiptNameSimilarity(detectedName, name),
      ),
    );

    let score = nameScore;

    const wantedRfc = normalizeReceiptRfc(detectedRfc);
    if (
      wantedRfc &&
      receiptItemRfcs(item).some((rfc) => rfc === wantedRfc)
    ) {
      score = Math.max(score, 0.995);
    }

    const wantedClabe = normalizeReceiptDigits(detectedClabe);
    if (
      wantedClabe.length === 18 &&
      receiptItemAccounts(item).some(
        (account) => account === wantedClabe,
      )
    ) {
      score = Math.max(score, 1);
    }

    const wantedAccount = normalizeReceiptDigits(detectedAccount);
    if (wantedAccount.length >= 4) {
      const accountMatch = receiptItemAccounts(item).some((account) => {
        const minLength = Math.min(account.length, wantedAccount.length);
        const suffixLength = Math.min(8, minLength);
        if (suffixLength < 4) return false;
        return (
          account.slice(-suffixLength) ===
          wantedAccount.slice(-suffixLength)
        );
      });

      if (accountMatch) {
        score = Math.max(score, 0.97);
      }
    }

    return score;
  }

  function findUniqueReceiptCatalogMatch(
    items: any[],
    detectedName: string,
    signals?: {
      rfc?: string;
      clabe?: string;
      account?: string;
    },
  ) {
    const name = String(detectedName || "").trim();
    const rfc = String(signals?.rfc || "").trim();
    const clabe = String(signals?.clabe || "").trim();
    const account = String(signals?.account || "").trim();

    if (!name && !rfc && !clabe && !account) return null;

    const exactClabe = normalizeReceiptDigits(clabe);

    if (exactClabe.length === 18) {
      const exactMatches = items.filter((item) =>
        receiptItemAccounts(item).some(
          (candidate) => candidate === exactClabe,
        ),
      );

      if (exactMatches.length === 1) {
        return {
          item: exactMatches[0],
          score: 1,
          secondScore: 0,
        };
      }

      if (exactMatches.length > 1) {
        return null;
      }
    }

    // Si el comprobante solo muestra una terminacion de la cuenta/CLABE,
    // permitir match deterministico siempre que sea unica en el catalogo.
    if (exactClabe.length >= 4 && exactClabe.length < 18) {
      const suffixLengths = [8, 6, 4].filter(
        (length) => exactClabe.length >= length,
      );

      for (const suffixLength of suffixLengths) {
        const suffix = exactClabe.slice(-suffixLength);

        const suffixMatches = items.filter((item) =>
          receiptItemAccounts(item).some((candidate) =>
            candidate.endsWith(suffix),
          ),
        );

        if (suffixMatches.length === 1) {
          return {
            item: suffixMatches[0],
            score: 1,
            secondScore: 0,
          };
        }

        if (suffixMatches.length > 1) {
          return null;
        }
      }
    }

    const ranked = items
      .map((item) => ({
        item,
        score: scoreReceiptCatalogItem(
          item,
          name,
          rfc,
          clabe,
          account,
        ),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const second = ranked[1];

    if (!best) return null;

    const minimumScore =
      rfc || clabe || account
        ? 0.78
        : 0.7;

    if (best.score < minimumScore) {
      return null;
    }

    const margin = second
      ? best.score - second.score
      : 1;

    const strongDistinctiveWinner = best.score >= 0.94;

    if (
      second &&
      !strongDistinctiveWinner &&
      margin < 0.1
    ) {
      return null;
    }

    if (
      second &&
      strongDistinctiveWinner &&
      second.score >= 0.94 &&
      margin < 0.04
    ) {
      return null;
    }

    return {
      item: best.item,
      score: best.score,
      secondScore: second?.score || 0,
    };
  }
  function isPagoQuickPdf(file: File) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();

    return (
      type === "application/pdf" ||
      type === "image/jpeg" ||
      type === "image/png" ||
      type === "image/webp" ||
      /\.(pdf|jpg|jpeg|png|webp)$/.test(name)
    );
  }

  function receiptBatchKey(file: File, index: number) {
    return `${file.name}__${file.size}__${file.lastModified}__${index}`;
  }

  async function analyzeReceiptBatch(files: File[]) {
    const valid = files.filter(isPagoQuickPdf);
    const rejectedTypeCount = files.length - valid.length;
    const oversized = valid.filter((file) => file.size > 1 * 1024 * 1024);
    const accepted = valid.filter((file) => file.size <= 1 * 1024 * 1024);

    if (accepted.length === 0) {
      setPageMsg(
        oversized.length > 0
          ? "Los comprobantes PDF exceden el limite de 1 MB."
          : "No se encontraron comprobantes PDF validos.",
      );
      return;
    }

    const initialItems = accepted.map((file, index) => ({
      key: receiptBatchKey(file, index),
      file,
      status: "PENDING",
      parsed: null,
      error: "",
    }));

    setIsPagoPageDragging(false);
    setReceiptBatchItems(initialItems);
    setReceiptBatchOpen(true);
    setReceiptBatchBusy(true);
    setPageMsg(
      rejectedTypeCount > 0 || oversized.length > 0
        ? `Analizando ${accepted.length} comprobante(s). Se omitieron ${rejectedTypeCount + oversized.length} archivo(s) no compatibles.`
        : `Analizando ${accepted.length} comprobante(s)...`,
    );

    const queue = [...initialItems];
    let cursor = 0;

    async function worker() {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= queue.length) return;

        const item = queue[currentIndex];

        setReceiptBatchItems((current) =>
          current.map((row) =>
            row.key === item.key
              ? { ...row, status: "ANALYZING" }
              : row,
          ),
        );

        try {
          const parsed = await parsePagoReceiptPdfFile(item.file);

          const senderSignals = {
            rfc: parsed.rfc,
            account: parsed.account,
          };

          const beneficiarySignals = {
            clabe: parsed.destinationAccount || parsed.clabe,
            account: parsed.destinationAccount,
          };

          const clientMatch =
            findUniqueReceiptCatalogMatch(
              clientes,
              parsed.senderName,
              senderSignals,
            );

          const companyMatch =
            findUniqueReceiptCatalogMatch(
              companies,
              parsed.beneficiaryName,
              beneficiarySignals,
            ) ||
            findUniqueReceiptCatalogMatch(
              companies,
              parsed.shortName,
              beneficiarySignals,
            );

          setReceiptBatchItems((current) =>
            current.map((row) =>
              row.key === item.key
                ? {
                    ...row,
                    status: "READY",
                    parsed,
                    clientMatch,
                    companyMatch,
                    operationTypeKey:
                      row.operationTypeKey ||
                      facturaSubtotalOperationKey,
                  }
                : row,
            ),
          );
        } catch (error: any) {
          setReceiptBatchItems((current) =>
            current.map((row) =>
              row.key === item.key
                ? {
                    ...row,
                    status: "ERROR",
                    error:
                      error?.message ||
                      "No se pudo analizar este comprobante.",
                  }
                : row,
            ),
          );
        }
      }
    }

    await Promise.all([worker(), worker(), worker()]);
    setReceiptBatchBusy(false);
    setPageMsg("Analisis de comprobantes terminado. Revisa el lote.");
  }

  function getReceiptBatchMissingFields(item: any): string[] {
    const parsed = item?.parsed || {};
    const missing: string[] = [];

    if (!item?.file) missing.push("comprobante");
    if (!item?.clientMatch?.item?.id) missing.push("cliente");
    if (!item?.companyMatch?.item?.id) missing.push("empresa");
    if (!item?.companyMatch?.item?.despachoId) missing.push("despacho");
    if (!item?.operationTypeKey) missing.push("tipo de operacion");

    const amount = Number(parsed.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      missing.push("monto");
    }

    if (!String(parsed.date || "").trim()) {
      missing.push("fecha");
    }

    return missing;
  }

  const receiptBatchCreationSummary = useMemo(() => {
    const readyToCreate = receiptBatchItems.filter(
      (row) =>
        row?.status === "READY" &&
        !row?.createdPagoId &&
        getReceiptBatchMissingFields(row).length === 0,
    );

    const needsReview = receiptBatchItems.filter(
      (row) =>
        row?.status === "READY" &&
        getReceiptBatchMissingFields(row).length > 0,
    );

    return {
      readyToCreate,
      needsReview,
    };
  }, [receiptBatchItems]);

  function getReceiptBatchStatusLabel(item: any): string {
    switch (String(item?.status || "")) {
      case "PENDING":
        return "Pendiente";
      case "ANALYZING":
        return "Analizando";
      case "READY":
        return getReceiptBatchMissingFields(item).length === 0
          ? "Listo para crear"
          : "Requiere revision";
      case "CREATING":
        return "Creando pago";
      case "UPLOADING":
        return "Subiendo comprobante";
      case "CREATED":
        return "Pago creado";
      case "CREATE_ERROR":
        return "Error al crear pago";
      case "DUPLICATE":
        return "Comprobante ya registrado";
      case "UPLOAD_ERROR":
        return "Pago creado / error en comprobante";
      case "ERROR":
        return "Error de analisis";
      default:
        return "Pendiente";
    }
  }

  function buildReceiptDetectedNote(item: any) {
    const parsed = item?.parsed || {};

    return [
      parsed.senderName ? `Ordenante/Proveedor: ${parsed.senderName}` : "",
      parsed.beneficiaryName ? `Beneficiario/Receptor: ${parsed.beneficiaryName}` : "",
      parsed.shortName ? `Nombre corto beneficiario: ${parsed.shortName}` : "",
      parsed.bankName ? `Banco: ${parsed.bankName}` : "",
      parsed.reference ? `Referencia: ${parsed.reference}` : "",
      parsed.concept ? `Concepto: ${parsed.concept}` : "",
      parsed.rfc ? `RFC detectado: ${parsed.rfc}` : "",
      parsed.destinationAccount ? `Cuenta destino detectada: ${parsed.destinationAccount}` : "",
      item.clientMatch ? `Match cliente: ${Math.round(item.clientMatch.score * 100)}%` : "",
      item.companyMatch ? `Match empresa: ${Math.round(item.companyMatch.score * 100)}%` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  }

  async function createReadyReceiptBatch() {
    if (!canCreatePagos || receiptBatchBusy || receiptBatchCreating) return;

    const rows = receiptBatchCreationSummary.readyToCreate;

    if (rows.length === 0) {
      setPageMsg("No hay comprobantes completos listos para crear.");
      return;
    }

    setReceiptBatchCreating(true);
    setPageMsg(`Creando ${rows.length} pago(s) del lote...`);

    let createdCount = 0;
    let failedCount = 0;

    try {
      for (const item of rows) {
        let createdPagoId = "";

        setReceiptBatchItems((current) =>
          current.map((row) =>
            row.key === item.key
              ? {
                  ...row,
                  status: "CREATING",
                  error: "",
                }
              : row,
          ),
        );

        try {
          const parsed = item?.parsed || {};
          const company = item?.companyMatch?.item;

          const pagoId = await createPagoWithReceipt({
            clienteId: String(item?.clientMatch?.item?.id || ""),
            companyId: String(company?.id || ""),
            despachoId: String(company?.despachoId || ""),
            empresaNombre: String(
              company?.label || receiptItemNames(company)[0] || "",
            ),
            operationTypeKey: String(item?.operationTypeKey || ""),
            montoTotal: Number(parsed.amount || 0),
            fechaPago: String(parsed.date || ""),
            referencia: String(parsed.reference || ""),
            moneda: String(parsed.currency || "MXN"),
            notaInicial: buildReceiptDetectedNote(item),
            file: item.file,
            onPagoCreated: (nextPagoId) => {
              createdPagoId = nextPagoId;

              setReceiptBatchItems((current) =>
                current.map((row) =>
                  row.key === item.key
                    ? {
                        ...row,
                        status: "UPLOADING",
                        createdPagoId: nextPagoId,
                        error: "",
                      }
                    : row,
                ),
              );
            },
          });

          createdCount += 1;

          setReceiptBatchItems((current) =>
            current.map((row) =>
              row.key === item.key
                ? {
                    ...row,
                    status: "CREATED",
                    createdPagoId: pagoId,
                    error: "",
                  }
                : row,
            ),
          );
        } catch (error: any) {
          failedCount += 1;

          const errorCode = String(
            error?.details?.code ||
            error?.code ||
            "",
          ).toUpperCase();

          const errorMessage = String(
            error?.message || "",
          );

          const isDuplicate =
            errorCode.includes("PAGO_RECEIPT_DUPLICATE") ||
            errorCode.includes("ALREADY-EXISTS") ||
            errorMessage.toLowerCase().includes(
              "comprobante ya registrado",
            );

          setReceiptBatchItems((current) =>
            current.map((row) =>
              row.key === item.key
                ? {
                    ...row,
                    status: isDuplicate
                      ? "DUPLICATE"
                      : createdPagoId
                        ? "UPLOAD_ERROR"
                        : "CREATE_ERROR",
                    ...(createdPagoId
                      ? { createdPagoId }
                      : {}),
                    error:
                      error?.message ||
                      "No se pudo crear este pago.",
                  }
                : row,
            ),
          );
        }
      }

      setPageMsg(
        failedCount > 0
          ? `Lote procesado: ${createdCount} pago(s) creado(s) y ${failedCount} con error.`
          : `Lote procesado: ${createdCount} pago(s) creado(s) correctamente.`,
      );
    } finally {
      setReceiptBatchCreating(false);
    }
  }

  function openReceiptBatchItem(item: any) {
    const parsed = item?.parsed;
    if (!parsed || !item?.file) return;

    resetNewPagoForm();
    setComprobantePagoFile(item.file);
    setOpenNewPago(true);

    if (item.clientMatch?.item?.id) {
      setSelectedClientId(String(item.clientMatch.item.id));
    }

    if (item.companyMatch?.item?.id) {
      setSelectedCompanyId(String(item.companyMatch.item.id));
    }

    if (Number(parsed.amount || 0) > 0) {
      setMontoTotal(String(parsed.amount));
    }

    // Un comprobante importado nunca debe heredar la fecha de hoy
    // si la fecha real no fue detectada.
    setFechaPago(parsed.date || "");

    if (parsed.currency) {
      setMoneda(parsed.currency);
    }

    setNotaInicial(buildReceiptDetectedNote(item));
    setPageMsg(
      item.clientMatch && item.companyMatch
        ? "Comprobante del lote cargado con datos detectados."
        : "Comprobante del lote cargado. Revisa los campos pendientes.",
    );
  }
  async function openNewPagoModalFromPdf(file: File) {
    setIsPagoPageDragging(false);
    resetNewPagoForm();
    setComprobantePagoFile(file);
    setOpenNewPago(true);
    setPageMsg("Leyendo comprobante de pago...");

    try {
      const parsed = await parsePagoReceiptPdfFile(file);

      const senderSignals = {
        rfc: parsed.rfc,
        account: parsed.account,
      };

      const beneficiarySignals = {
        clabe: parsed.destinationAccount || parsed.clabe,
        account: parsed.destinationAccount,
      };

      const clientMatch =
        findUniqueReceiptCatalogMatch(
          clientes,
          parsed.senderName,
          senderSignals,
        );

      const companyMatch =
        findUniqueReceiptCatalogMatch(
          companies,
          parsed.beneficiaryName,
          beneficiarySignals,
        ) ||
        findUniqueReceiptCatalogMatch(
          companies,
          parsed.shortName,
          beneficiarySignals,
        );

      if (clientMatch?.item?.id) {
        setSelectedClientId(String(clientMatch.item.id));
      }

      if (companyMatch?.item?.id) {
        setSelectedCompanyId(String(companyMatch.item.id));
      }

      if (Number(parsed.amount || 0) > 0) {
        setMontoTotal(String(parsed.amount));
      }

      // Un comprobante importado nunca debe heredar la fecha de hoy
      // si la fecha real no fue detectada.
      setFechaPago(parsed.date || "");

      if (parsed.currency) {
        setMoneda(parsed.currency);
      }

      const detectedDetails = [
        parsed.senderName ? `Ordenante/Proveedor: ${parsed.senderName}` : "",
        parsed.beneficiaryName ? `Beneficiario/Receptor: ${parsed.beneficiaryName}` : "",
        parsed.bankName ? `Banco: ${parsed.bankName}` : "",
        parsed.reference ? `Referencia: ${parsed.reference}` : "",
        parsed.concept ? `Concepto: ${parsed.concept}` : "",
        parsed.rfc ? `RFC detectado: ${parsed.rfc}` : "",
        parsed.clabe ? `CLABE detectada: ${parsed.clabe}` : "",
        parsed.account ? `Cuenta origen detectada: ${parsed.account}` : "",
        parsed.shortName ? `Nombre corto beneficiario: ${parsed.shortName}` : "",
        parsed.destinationAccount
          ? `Cuenta destino detectada: ${parsed.destinationAccount}`
          : "",
        clientMatch
          ? `Match cliente: ${Math.round(clientMatch.score * 100)}%`
          : "",
        companyMatch
          ? `Match empresa: ${Math.round(companyMatch.score * 100)}%`
          : "",
      ].filter(Boolean);

      if (detectedDetails.length > 0) {
        setNotaInicial(detectedDetails.join(" | "));
      }

      const unresolved = [
        parsed.senderName && !clientMatch
          ? `Cliente sin coincidencia suficientemente clara: ${parsed.senderName}.`
          : "",
        parsed.beneficiaryName && !companyMatch
          ? `Empresa sin coincidencia suficientemente clara: ${parsed.beneficiaryName}.`
          : "",
        ...parsed.warnings,
      ].filter(Boolean);

      setPageMsg(
        unresolved.length > 0
          ? `Comprobante leido. Revisa: ${unresolved.join(" ")}`
          : "Comprobante leido y datos principales prellenados.",
      );
    } catch (error: any) {
      setPageMsg(
        error?.message ||
          "No se pudo leer automaticamente el comprobante. Puedes completar el pago manualmente.",
      );
    }
  }

  function closeNewPagoModal() {
    if (saving) return;
    resetNewPagoForm();
    setOpenNewPago(false);
  }

  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types || []).includes("Files");
    }

    function isPagoPdf(file: File) {
      const name = String(file.name || "").toLowerCase();
      const type = String(file.type || "").toLowerCase();

      return (
        type === "application/pdf" ||
        type === "image/jpeg" ||
        type === "image/png" ||
        type === "image/webp" ||
        /\.(pdf|jpg|jpeg|png|webp)$/.test(name)
      );
    }

    function handlePagoWindowDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      if (!canCreatePagos || openNewPago || saving) return;

      event.preventDefault();
      setIsPagoPageDragging(true);
    }

    function handlePagoWindowDragLeave(event: DragEvent) {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setIsPagoPageDragging(false);
      }
    }

    function handlePagoWindowDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      if (!canCreatePagos || openNewPago || saving) return;

      event.preventDefault();
      setIsPagoPageDragging(false);

      const files = Array.from(event.dataTransfer?.files || []);
      void analyzeReceiptBatch(files);
    }

    window.addEventListener("dragover", handlePagoWindowDragOver, true);
    window.addEventListener("dragleave", handlePagoWindowDragLeave, true);
    window.addEventListener("drop", handlePagoWindowDrop, true);

    return () => {
      window.removeEventListener("dragover", handlePagoWindowDragOver, true);
      window.removeEventListener("dragleave", handlePagoWindowDragLeave, true);
      window.removeEventListener("drop", handlePagoWindowDrop, true);
    };
  }, [canCreatePagos, openNewPago, saving]);
  useEffect(() => {
    if (!openNewPago) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNewPagoModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openNewPago, saving]);

  const range = useMemo(() => getScopeRange(mode, baseDate, customRange), [mode, baseDate, customRange]);

  useEffect(() => {
    clientesRef.current = clientes;
  }, [clientes]);

  useEffect(() => {
    const q = String(searchParams.get("q") || "").trim();
    if (q) {
      setFilter(q);
    }
  }, [searchParams]);

  const loadPagosPage = useCallback(async (append = false) => {
    if (!canViewPagos || !rootId || !myUid) {
      setPagos([]);
      setLoadingPagos(false);
      return;
    }
    append ? setLoadingMorePagos(true) : setLoadingPagos(true);
    try {
      const page = await listPagos(append && pagoCursor ? {
        limit: 100,
        fromMillis: range.from.getTime(),
        toMillis: range.to.getTime(),
        cursorSeconds: pagoCursor.seconds,
        cursorNanoseconds: pagoCursor.nanoseconds,
        cursorId: pagoCursor.id,
      } : { limit: 100, fromMillis: range.from.getTime(), toMillis: range.to.getTime() });
      setPagos((current) => append ? [...current, ...page.items] : page.items);
      setPagoCursor(page.nextCursor);
      setHasMorePagos(page.hasMore);
    } catch {
      setPageMsg("No se pudieron cargar pagos.");
    } finally {
      setLoadingPagos(false);
      setLoadingMorePagos(false);
    }
  }, [canViewPagos, rootId, myUid, pagoCursor, range]);

  useEffect(() => { void loadPagosPage(false); }, [canViewPagos, rootId, myUid, range]);

  useEffect(() => {
    if (!canViewPagos || !rootId || !myUid) {
      setClientes([]);
      return;
    }

    return listScopedClients(
      { uid: myUid, role, rootId },
      (items) => setClientes(items as any[]),
      () => setClientes([])
    );
  }, [canViewPagos, rootId, myUid, role]);

  useEffect(() => {
    if (!canViewPagos || !myUid || !role) {
      setCompanies([]);
      return;
    }

    return listCompanies(
      { uid: myUid, role: role as any },
      (items) => setCompanies(items as any[]),
      () => setCompanies([])
    );
  }, [canViewPagos, myUid, role]);

  // Si un comprobante se analizo antes de que terminaran de cargar
  // los catalogos, volver a hacer el match automaticamente.
  useEffect(() => {
    if (clientes.length === 0 && companies.length === 0) return;

    setReceiptBatchItems((current) => {
      let changed = false;

      const next = current.map((row) => {
        const parsed = row?.parsed;

        if (!parsed || row?.status !== "READY") {
          return row;
        }

        const senderSignals = {
          rfc: parsed.rfc,
          account: parsed.account,
        };

        const beneficiarySignals = {
          clabe: parsed.destinationAccount || parsed.clabe,
          account: parsed.destinationAccount,
        };

        const clientMatch =
          clientes.length > 0
            ? findUniqueReceiptCatalogMatch(
                clientes,
                parsed.senderName,
                senderSignals,
              )
            : row.clientMatch || null;

        const companyMatch =
          companies.length > 0
            ? findUniqueReceiptCatalogMatch(
                companies,
                parsed.beneficiaryName,
                beneficiarySignals,
              ) ||
              findUniqueReceiptCatalogMatch(
                companies,
                parsed.shortName,
                beneficiarySignals,
              )
            : row.companyMatch || null;

        const currentClientId = String(
          row?.clientMatch?.item?.id || "",
        );
        const nextClientId = String(
          clientMatch?.item?.id || "",
        );

        const currentCompanyId = String(
          row?.companyMatch?.item?.id || "",
        );
        const nextCompanyId = String(
          companyMatch?.item?.id || "",
        );

        if (
          currentClientId === nextClientId &&
          currentCompanyId === nextCompanyId
        ) {
          return row;
        }

        changed = true;

        return {
          ...row,
          clientMatch,
          companyMatch,
        };
      });

      return changed ? next : current;
    });
  }, [clientes, companies]);

  useEffect(() => {
    if (!canViewPagos || !rootId || !myUid) {
      setSolicitudes([]);
      return;
    }

    let qy: Query<DocumentData>;
    if (isSuperAdmin(role)) {
      qy = query(collection(db, "solicitudes"), where("rootId", "==", rootId));
    } else if (isAdmin(role)) {
      qy = query(collection(db, "solicitudes"), where("adminId", "==", myUid));
    } else if (isOperador(role)) {
      qy = query(collection(db, "solicitudes"), where("createdBy", "==", myUid));
    } else {
      setSolicitudes([]);
      return;
    }

    return onSnapshot(
      qy,
      (snap) => {
        setSolicitudes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        setPageMsg("No se pudieron cargar solicitudes.");
        setSolicitudes([]);
      }
    );
  }, [canViewPagos, rootId, myUid, role]);

  useEffect(() => {
    if (!notesFor?.id) {
      setNotes([]);
      return;
    }

    (async () => {
      try {
        await changePagoStatus({ pagoId: notesFor.id, hasUnreadMsg: false });
      } catch (e) {
        console.warn("changePagoStatus(hasUnreadMsg:false) fallo.", e);
      }
    })();

    const qy = query(
      collection(db, `pagos/${notesFor.id}/notas`),
      orderBy("createdAt", "asc")
    );

    return onSnapshot(qy, (snap) => {
      setNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [notesFor]);

  useEffect(() => {
    if (!rootId || !myUid) {
      setPagoAplicaciones([]);
      return;
    }

    let qy: Query<DocumentData>;
    if (isSuperAdmin(role)) {
      qy = query(collection(db, "pagoAplicaciones"), where("rootId", "==", rootId));
    } else if (isAdmin(role)) {
      qy = query(collection(db, "pagoAplicaciones"), where("adminId", "==", myUid));
    } else if (isOperador(role)) {
      qy = query(collection(db, "pagoAplicaciones"), where("createdBy", "==", myUid));
    } else {
      setPagoAplicaciones([]);
      return;
    }

    return onSnapshot(
      qy,
      (snap) => {
        setPagoAplicaciones(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        setPageMsg("No se pudieron cargar aplicaciones de pagos.");
        setPagoAplicaciones([]);
      }
    );
  }, [rootId, myUid, role]);

  const clientesOrdenados = useMemo(() => {
    return [...clientes].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)));
  }, [clientes]);

  const selectedClient = useMemo(() => {
    return clientesOrdenados.find((c) => c.id === selectedClientId) || null;
  }, [clientesOrdenados, selectedClientId]);

  const companyOptions = useMemo(() => {
    return [...companies]
      .map((c: any) => {
        const value = String(c?.id || c?.companyId || "").trim();
        const label = String(
          c?.nombre ||
          c?.empresaNombre ||
          c?.razonSocial ||
          c?.name ||
          c?.alias ||
          value
        ).trim();

        const despachoId = String(c?.despachoId || "").trim();

        return { value, label, despachoId };
      })
      .filter((x) => x.value)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [companies]);

  const selectedCompany = useMemo(() => {
    return companyOptions.find((c) => c.value === selectedCompanyId) || null;
  }, [companyOptions, selectedCompanyId]);


  useEffect(() => {
    if (!openNewPago) {
      setSelectedCompanyId("");
      setSelectedOperationTypeKey("");
    }
  }, [openNewPago]);

  useEffect(() => {
    if (!canViewPagos || !myUid) {
      setOperationTypes([]);
      return;
    }

    const qy = query(collection(db, "operationTypes"), orderBy("name"));

    return onSnapshot(
      qy,
      (snap) => {
        setOperationTypes(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(
              (x: any) =>
                x?.active !== false &&
                String(x?.category || "OPERACION").toUpperCase() ===
                  "OPERACION",
            ),
        );
      },
      (error) => {
        console.error("No se pudieron cargar operationTypes.", error);
        setOperationTypes([]);
      },
    );
  }, [canViewPagos, myUid]);

  const facturaSubtotalOperation = useMemo(() => {
    const matched = findFacturaSubtotalOperation(
      operationTypes.map((x: any) => ({
        label: String(x?.name || x?.key || x?.id || ""),
        value: String(x?.key || x?.id || ""),
        operation: x,
      })),
    );

    return matched?.operation || null;
  }, [operationTypes]);

  const facturaSubtotalOperationKey = facturaSubtotalOperation
    ? String(facturaSubtotalOperation?.key || facturaSubtotalOperation?.id || "")
    : "";

  // Si el comprobante termino de analizarse antes de que cargara
  // el catalogo de tipos, completar FACTURA SUBTOTAL al llegar.
  useEffect(() => {
    if (!facturaSubtotalOperationKey) return;

    setReceiptBatchItems((current) => {
      let changed = false;

      const next = current.map((row) => {
        if (
          row?.status !== "READY" ||
          !row?.parsed ||
          row?.operationTypeKey
        ) {
          return row;
        }

        changed = true;

        return {
          ...row,
          operationTypeKey: facturaSubtotalOperationKey,
        };
      });

      return changed ? next : current;
    });
  }, [facturaSubtotalOperationKey, receiptBatchItems]);

  const clientOptions = useMemo(() => {
    return clientesOrdenados.map((c) => ({
      value: c.id,
      label: clientLabel(c),
    }));
  }, [clientesOrdenados]);

  const currencyOptions = useMemo(() => {
    return [
      { value: "MXN", label: "MXN" },
      { value: "USD", label: "USD" },
      { value: "EUR", label: "EUR" },
    ];
  }, []);

  const solicitudesPendientesCliente = useMemo(() => {
    if (!selectedClient || !selectedCompanyId) return [];

    return solicitudes
      .filter((s) => !s?.oculto)
      .filter((s) => !isSolicitudTerminal(s))
      .filter((s) => matchSolicitudWithCliente(s, selectedClient.id, clientLabel(selectedClient)))
      .filter((s) => String(s?.companyId || "").trim() === String(selectedCompanyId || "").trim())
      .filter((s) => getSolicitudPendiente(s) > 0)
      .sort((a, b) => {
        const aSec = a?.createdAt?.seconds || 0;
        const bSec = b?.createdAt?.seconds || 0;
        return bSec - aSec;
      });
  }, [solicitudes, selectedClient]);

  const getFoliosPendientesByPago = (pago: any) => {
    return solicitudes
      .filter((s) => !s?.oculto)
      .filter((s) => !isSolicitudTerminal(s))
      .filter((s) => matchSolicitudWithCliente(s, pago?.clienteId, pago?.clienteNombre))
      .filter((s) => String(s?.companyId || "").trim() === String(pago?.companyId || "").trim())
      .filter((s) => getSolicitudPendiente(s) > 0)
      .sort((a, b) => {
        const aSec = a?.createdAt?.seconds || 0;
        const bSec = b?.createdAt?.seconds || 0;
        return bSec - aSec;
      });
  };

  const foliosAplicables = useMemo(() => {
    if (!applyFor) return [];

    const rows = getFoliosPendientesByPago(applyFor);

    if (!isPagoIqLinked(applyFor)) {
      return rows;
    }

    return rows.filter(
      (solicitud) =>
        /^\d{3,20}$/.test(
          getSolicitudIqFolioVisible(solicitud)
        )
    );
  }, [applyFor, solicitudes]);

  const aplicacionesDelPago = useMemo(() => {
    if (!viewAplicacionesFor?.id) return [];

    return pagoAplicaciones
      .filter((x) => String(x?.pagoId || "") === String(viewAplicacionesFor.id))
      .map((x) => {
        const solicitud = solicitudes.find((s) => String(s?.id || "") === String(x?.solicitudId || ""));
        return {
          ...x,
          folioSolicitud: solicitud?.folio || x?.solicitudId || "---",
          solicitudStatus: solicitud?.status || "---",
          empresaNombre: solicitud?.empresaNombre || viewAplicacionesFor?.empresaNombre || "---",
          clienteNombre: solicitud?.clienteNombre || viewAplicacionesFor?.clienteNombre || "---",
        };
      })
      .sort((a, b) => (b?.createdAt?.seconds || 0) - (a?.createdAt?.seconds || 0));
  }, [viewAplicacionesFor, pagoAplicaciones, solicitudes]);

  const totalAplicarSeleccionado = useMemo(() => {
    return money2(
      foliosAplicables.reduce((acc, s) => {
        const monto = money2(applyAmounts[s.id] || 0);
        return acc + (monto > 0 ? monto : 0);
      }, 0)
    );
  }, [foliosAplicables, applyAmounts]);

  const pagosFiltradosOrdenados = useMemo(() => {
    const term = filter.toLowerCase();

    const data = pagos
      .filter((p) => isTsWithinRange(p?.createdAt, range.from, range.to))
      .filter((p) => {
        const id = String(p?.id || "").toLowerCase();
        const cliente = String(p?.clienteNombre || "").toLowerCase();
        const clienteId = String(p?.clienteId || "").toLowerCase();
        const status = String(p?.status || "").toLowerCase();
        return id.includes(term) || cliente.includes(term) || clienteId.includes(term) || status.includes(term);
      });

    return data.sort((a, b) => {
      let vA: any = a?.[sortConfig.key as keyof typeof a] ?? "";
      let vB: any = b?.[sortConfig.key as keyof typeof b] ?? "";

      if (sortConfig.key === "createdAt") {
        vA = a?.createdAt?.seconds || 0;
        vB = b?.createdAt?.seconds || 0;
      }

      if ((vA as any)?.seconds) vA = (vA as any).seconds;
      if ((vB as any)?.seconds) vB = (vB as any).seconds;

      if (vA < vB) return sortConfig.dir === "asc" ? -1 : 1;
      if (vA > vB) return sortConfig.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [pagos, filter, sortConfig, range]);

  const totales = useMemo(() => {
    return pagosFiltradosOrdenados.reduce(
      (acc, p) => {
        acc.total += Number(p?.montoTotal || 0);
        acc.aplicado += Number(p?.montoAplicado || 0);
        acc.disponible += Number(p?.montoDisponible || 0);
        return acc;
      },
      { total: 0, aplicado: 0, disponible: 0 }
    );
  }, [pagosFiltradosOrdenados]);

  function selectPagoReceiptFile(nextFile: File | null) {
    if (!nextFile) {
      setComprobantePagoFile(null);
      return;
    }

    const name = String(nextFile.name || "").toLowerCase();
    const type = String(nextFile.type || "").toLowerCase();
    const allowed =
      type === "application/pdf" ||
      type.startsWith("image/") ||
      /\.(pdf|jpg|jpeg|png|webp)$/.test(name);

    if (!allowed) {
      setComprobantePagoFile(null);
      setPageMsg("El comprobante debe ser PDF, JPG, PNG o WEBP.");
      return;
    }

    if (nextFile.size > 1 * 1024 * 1024) {
      setComprobantePagoFile(null);
      setPageMsg("El comprobante excede el limite de 1 MB.");
      return;
    }

    setPageMsg("");
    setComprobantePagoFile(nextFile);
  }
  async function createPagoWithReceipt(input: {
    clienteId: string;
    companyId: string;
    despachoId: string;
    empresaNombre: string;
    operationTypeKey: string;
    montoTotal: string | number;
    fechaPago: string;
    paymentForm?: string;
    referencia?: string;
    moneda: string;
    notaInicial: string;
    file: File;
    onPagoCreated?: (pagoId: string) => void;
    backgroundUpload?: boolean;
    onUploadError?: (error: any) => void;
  }) {
    const createdPago: any = await createPago({
      clienteId: input.clienteId,
      companyId: input.companyId,
      despachoId: input.despachoId,
      empresaNombre: input.empresaNombre,
      operationTypeKey: input.operationTypeKey,
      montoTotal: input.montoTotal,
      fechaPago: input.fechaPago,
      paymentForm: input.paymentForm || "",
      referencia: input.referencia || "",
      moneda: input.moneda,
      notaInicial: input.notaInicial,
    });

    const createdPagoId = String(
      createdPago?.pagoId ||
      createdPago?.id ||
      createdPago?.data?.pagoId ||
      createdPago?.data?.id ||
      createdPago?.data?.data?.pagoId ||
      createdPago?.data?.data?.id ||
      createdPago?.result?.pagoId ||
      createdPago?.result?.id ||
      ""
    ).trim();

    if (!createdPagoId) {
      throw new Error(
        "Pago creado, pero no fue posible obtener el ID para subir el comprobante.",
      );
    }

    input.onPagoCreated?.(createdPagoId);

    const uploadReceipt = () =>
      uploadPagoDoc({
        pagoId: createdPagoId,
        documentType: "COMPROBANTE_PAGO",
        customDocumentTypeLabel: "",
        file: input.file,
        onProgress: () => undefined,
      });

    if (input.backgroundUpload) {
      void uploadReceipt().catch((error) => {
        input.onUploadError?.(error);
      });

      return createdPagoId;
    }

    await uploadReceipt();

    return createdPagoId;
  }

  const onCreatePago = async () => {
    if (!canCreatePagos) return;
    if (saving) return;

    const monto = Number(String(montoTotal).replace(/,/g, ""));    setPageMsg("");
    setPageMsg("");

    if (!isPagoFormComplete) {
      setPageMsg(`Completa: ${missingPagoFields.join(", ")}.`);
      return;
    }

    if (!selectedClientId) {
      setPageMsg("Selecciona un cliente.");
      return;
    }

    if (!selectedCompanyId) {
      setPageMsg("Selecciona la empresa a la que se esta depositando.");
      return;
    }
    if (!selectedOperationTypeKey) {
      setPageMsg("Selecciona el tipo de operacion.");
      return;
    }
    if (!selectedCompany?.despachoId) {
      setPageMsg("La empresa seleccionada no tiene despacho asignado. Corrige la empresa antes de crear el pago.");
      return;
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      setPageMsg("Monto invalido.");
      return;
    }

    try {
      setSaving(true);

      await globalLoading.run(undefined, async () => {
        if (!comprobantePagoFile) {
          throw new Error("Selecciona el comprobante de pago.");
        }

        await createPagoWithReceipt({
          clienteId: selectedClientId,
          companyId: selectedCompanyId,
          despachoId: selectedCompany?.despachoId || "",
          empresaNombre: selectedCompany?.label || "",
          operationTypeKey: selectedOperationTypeKey,
          montoTotal: parseMoneyInput(montoTotal),
          fechaPago: fechaPago || "",
          paymentForm,
          moneda: moneda || "MXN",
          notaInicial: notaInicial.trim(),
          file: comprobantePagoFile,
          backgroundUpload: true,
          onUploadError: (error: any) => {
            setPageMsg(
              error?.message ||
                "Pago creado, pero no se pudo subir el comprobante.",
            );
          },
        });

        setSelectedClientId("");
        setSelectedCompanyId("");
        setSelectedOperationTypeKey("");
        setMontoTotal("");
        setFechaPago("");
        setMoneda("MXN");
        setPaymentForm("");
        setNotaInicial("");
    setComprobantePagoFile(null);
        setOpenNewPago(false);
      });
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo crear el pago.");
    } finally {
      setSaving(false);
    }
  };

  const moveToConciliacion = async (pagoId: string) => {
    if (!canConciliatePagos) return;
    if (actionId) return;
    try {
      setActionId(pagoId);
      await globalLoading.run(undefined, async () => {
        await changePagoStatus({
          pagoId,
          newStatus: "CONCILIACION_PENDIENTE",
          conciliationNote: "Enviado a conciliacion desde modulo Pagos",
        });
      });
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo enviar a conciliacion.");
    } finally {
      setActionId("");
    }
  };

  const conciliarPago = async (pagoId: string) => {
    if (!canConciliatePagos) return;
    if (actionId) return;
    try {
      setActionId(pagoId);
      await globalLoading.run(undefined, async () => {
        await changePagoStatus({
          pagoId,
          newStatus: "CONCILIADO",
          conciliationNote: "Conciliado desde modulo Pagos",
        });
      });
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo conciliar el pago.");
    } finally {
      setActionId("");
    }
  };

  const requestRechazarPago = (pagoId: string) => {
    if (!canConciliatePagos) return;
    if (actionId) return;

    setConfirmAction({
      title: "Rechazar pago",
      message: "Seguro que quieres rechazar este pago?",
      confirmLabel: "Rechazar",
      danger: true,
      onConfirm: () => rechazarPago(pagoId),
    });
  };
  const rechazarPago = async (pagoId: string) => {
    if (!canConciliatePagos) return;
    if (actionId) return;

    try {
      setActionId(pagoId);
      await changePagoStatus({
        pagoId,
        newStatus: "RECHAZADO",
        conciliationNote: "Pago rechazado desde modulo Pagos",
      });
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo rechazar el pago.");
    } finally {
      setActionId("");
    }
  };

  const applySelectedFolios = async () => {
    if (!canApplyPagos) return;
    if (!applyFor?.id) return;
    if (actionId || iqFlowActionRef.current) return;

    const seleccionados = foliosAplicables
      .map((solicitud) => {
        const monto = money2(applyAmounts[solicitud.id] || 0);
        return {
          solicitud,
          monto: Number.isFinite(monto) ? monto : 0,
          pendiente: getSolicitudPendiente(solicitud),
        };
      })
      .filter((item) => item.monto > 0);

    if (seleccionados.length === 0) {
      setPageMsg("Captura al menos un monto a aplicar.");
      return;
    }

    if (
      isPagoIqLinked(applyFor) &&
      seleccionados.some(
        (item) =>
          !/^\d{3,20}$/.test(
            getSolicitudIqFolioVisible(
              item.solicitud
            )
          )
      )
    ) {
      setPageMsg(
        "Una o mas solicitudes no tienen un folio IQ vinculado. No se puede preparar la Aplicacion de pagos IQ."
      );
      return;
    }

    const disponible = money2(applyFor?.montoDisponible || 0);
    const suma = money2(seleccionados.reduce((acc, item) => acc + item.monto, 0));

    if (suma > disponible) {
      setPageMsg("La suma excede el saldo disponible del pago.");
      return;
    }

    const excedido = seleccionados.find((item) => item.monto > item.pendiente);
    if (excedido) {
      setPageMsg(`El monto para ${excedido.solicitud?.folio || excedido.solicitud?.id} excede el pendiente.`);
      return;
    }

    const pago = applyFor;
    const idempotencyKey = applyRequestKeyRef.current || createPagoApplicationIdempotencyKey();
    const aplicaciones = seleccionados.map((item) => ({
      solicitudId: item.solicitud.id,
      montoAplicado: item.monto,
      solicitudFolio: item.solicitud?.folio || item.solicitud.id,
      invoiceType: item.solicitud?.tipoFactura || "",
      solicitudIqFolio:
        getSolicitudIqFolioVisible(
          item.solicitud
        ),
    }));

    applyRequestKeyRef.current = idempotencyKey;
    iqFlowActionRef.current = true;
    setIqHumanConfirmed(false);
    setIqFlowOpen(true);
    setIqFlow({
      pago,
      idempotencyKey,
      aplicaciones,
      applicationCount: aplicaciones.length,
      totalAmount: suma,
      stage: "PREPARING",
      message: "Aplicando el lote atomico en PAY0 y preparando la vista previa IQ.",
      pay0Result: null,
      planResult: null,
      executionResult: null,
    });
    setApplyFor(null);
    setApplyAmounts({});
    setActionId(pago.id);
    setIqFlowBusy(true);

    let pay0Result: any = null;
    try {
      await globalLoading.run(undefined, async () => {
        pay0Result = await applyPagoToSolicitudesAtomic({
          pagoId: pago.id,
          idempotencyKey,
          aplicaciones: seleccionados.map((item) => ({
            solicitudId: item.solicitud.id,
            montoAplicado: item.monto,
          })),
        });

        setIqFlow((current: any) => current ? {
          ...current,
          pay0Result,
          message: "Lote PAY0 confirmado. Prevalidando deposito y facturas en IQ.",
        } : current);

        const planResult = await preparePagoApplicationIqPlan({
          pagoId: pago.id,
          idempotencyKey,
          aplicaciones: aplicaciones.map((item) => ({
            solicitudId: item.solicitudId,
            montoAplicado: item.montoAplicado,
          })),
        });

        setIqFlow((current: any) => current ? {
          ...current,
          pay0Result,
          planResult,
          stage: getIqFlowStage(planResult),
          message: "Plan IQ prevalidado. Revisa cada dato antes de confirmar.",
        } : current);
      });
      applyRequestKeyRef.current = "";
    } catch (error: any) {
      setIqFlow((current: any) => current ? {
        ...current,
        pay0Result,
        stage: "PREPARATION_ERROR",
        message: error?.message || "PAY0 fue procesado, pero no se pudo completar la prevalidacion IQ.",
      } : current);
    } finally {
      iqFlowActionRef.current = false;
      setIqFlowBusy(false);
      setActionId("");
    }
  };

  const retryIqPreparation = async () => {
    if (!iqFlow?.pago?.id || iqFlowActionRef.current) return;

    iqFlowActionRef.current = true;
    setIqFlowBusy(true);
    setIqHumanConfirmed(false);
    setIqFlow((current: any) => current ? {
      ...current,
      stage: "PREPARING",
      message: "Reintentando prevalidacion con la misma reserva idempotente.",
    } : current);

    try {
      let planResult: any;
      if (iqFlow.idempotencyKey && Array.isArray(iqFlow.aplicaciones) && iqFlow.aplicaciones.length > 0) {
        const aplicaciones = iqFlow.aplicaciones.map((item: any) => ({
          solicitudId: item.solicitudId,
          montoAplicado: item.montoAplicado,
        }));
        const pay0Result = await applyPagoToSolicitudesAtomic({
          pagoId: iqFlow.pago.id,
          idempotencyKey: iqFlow.idempotencyKey,
          aplicaciones,
        });
        planResult = await preparePagoApplicationIqPlan({
          pagoId: iqFlow.pago.id,
          idempotencyKey: iqFlow.idempotencyKey,
          aplicaciones,
        });
        setIqFlow((current: any) => current ? { ...current, pay0Result } : current);
      } else {
        planResult = await resumePagoApplicationIqPlan({ pagoId: iqFlow.pago.id });
      }

      setIqFlow((current: any) => current ? {
        ...current,
        planResult,
        stage: getIqFlowStage(planResult),
        message: "Plan IQ recuperado y listo para revision.",
      } : current);
    } catch (error: any) {
      setIqFlow((current: any) => current ? {
        ...current,
        stage: "PREPARATION_ERROR",
        message: error?.message || "No se pudo recuperar la prevalidacion IQ.",
      } : current);
    } finally {
      iqFlowActionRef.current = false;
      setIqFlowBusy(false);
    }
  };

  const refreshIqFlowStatus = async () => {
    if (!iqFlow?.pago?.id || iqFlowActionRef.current) return;

    iqFlowActionRef.current = true;
    setIqFlowBusy(true);
    try {
      const planResult = await resumePagoApplicationIqPlan({ pagoId: iqFlow.pago.id });
      setIqFlow((current: any) => current ? {
        ...current,
        planResult,
        stage: getIqFlowStage(planResult),
        message: planResult?.iqExecutionStatus === "IN_PROGRESS"
          ? "IQ continua procesando el lote. No se enviara un segundo intento."
          : "Estado IQ actualizado.",
      } : current);
    } catch (error: any) {
      setIqFlow((current: any) => current ? {
        ...current,
        stage: "CLIENT_UNKNOWN",
        message: error?.message || "No se pudo consultar el estado. No reintentes la ejecucion sin revisar.",
      } : current);
    } finally {
      iqFlowActionRef.current = false;
      setIqFlowBusy(false);
    }
  };

  const diagnoseIqMethods = async () => {
    if (!iqFlow?.planResult?.planId || !iqFlow?.planResult?.planHash) return;
    if (iqFlowActionRef.current) return;

    iqFlowActionRef.current = true;
    setIqFlowBusy(true);
    setIqFlow((current: any) => current ? {
      ...current,
      stage: "EXECUTING",
      message: "Probando 3 metodos IQ sin presionar Crear.",
    } : current);

    try {
      const diagnosticResult = await diagnosePagoApplicationIqMethods({
        planId: iqFlow.planResult.planId,
        planHash: iqFlow.planResult.planHash,
      });
      setIqFlow((current: any) => current ? {
        ...current,
        diagnosticResult,
        stage: "FAILED_SAFE",
        message: diagnosticResult?.message || "Diagnostico de 3 metodos finalizado sin ejecutar IQ.",
      } : current);
    } catch (error: any) {
      setIqFlow((current: any) => current ? {
        ...current,
        stage: "FAILED_SAFE",
        message: error?.message || "No se pudo completar el diagnostico de metodos. No se ejecuto IQ.",
      } : current);
    } finally {
      iqFlowActionRef.current = false;
      setIqFlowBusy(false);
    }
  };

  const executePreparedIqFlow = async () => {
    if (!iqHumanConfirmed || !iqFlow?.planResult?.planId || !iqFlow?.planResult?.planHash) return;
    if (iqFlowActionRef.current) return;

    iqFlowActionRef.current = true;
    setIqFlowBusy(true);
    setIqFlow((current: any) => current ? {
      ...current,
      stage: "EXECUTING",
      message: "Enviando una sola confirmacion final a IQ.",
    } : current);

    try {
      const executionResult = await executePagoApplicationIqPlan({
        planId: iqFlow.planResult.planId,
        planHash: iqFlow.planResult.planHash,
        confirmExecution: true,
      });
      const stage = getIqFlowStage(executionResult);

      setIqHumanConfirmed(false);
      setIqFlow((current: any) => current ? {
        ...current,
        executionResult,
        stage,
        message: executionResult?.message || "IQ devolvio un resultado para el lote.",
      } : current);
    } catch (error: any) {
      setIqHumanConfirmed(false);
      setIqFlow((current: any) => current ? {
        ...current,
        stage: "CLIENT_UNKNOWN",
        message: error?.message || "No se pudo confirmar el resultado del callable. Consulta el estado antes de cualquier reintento.",
      } : current);
    } finally {
      iqFlowActionRef.current = false;
      setIqFlowBusy(false);
    }
  };

  const openExistingIqApplicationFlow = async (pago: any) => {
    if (!pago?.id || iqFlowActionRef.current) return;

    iqFlowActionRef.current = true;
    setIqFlowBusy(true);
    setIqHumanConfirmed(false);
    setIqFlowOpen(true);
    setIqFlow({
      pago,
      stage: "PREPARING",
      message: "Recuperando la reserva y el plan IQ del pago.",
      planResult: null,
      executionResult: null,
    });

    try {
      const planResult = await resumePagoApplicationIqPlan({ pagoId: pago.id });
      setIqFlow((current: any) => current ? {
        ...current,
        planResult,
        stage: getIqFlowStage(planResult),
        message: "Flujo IQ recuperado. Revisa el plan antes de continuar.",
      } : current);
    } catch (error: any) {
      setIqFlow((current: any) => current ? {
        ...current,
        stage: "PREPARATION_ERROR",
        message: error?.message || "No se pudo recuperar el flujo IQ del pago.",
      } : current);
    } finally {
      iqFlowActionRef.current = false;
      setIqFlowBusy(false);
    }
  };

  const sendPagoNote = async () => {
    if (noteSending) return;

    const text = newNote.trim();
    if (!notesFor?.id || !text) return;

    setNoteSending(true);

    try {
      await globalLoading.run(undefined, async () => {
        await addPagoNota({
          pagoId: notesFor.id,
          text,
        });
        setNewNote("");
      });
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo guardar la nota.");
    } finally {
      setNoteSending(false);
    }
  };

  async function runConfirmAction() {
    if (!confirmAction || confirmBusy) return;

    setConfirmBusy(true);
    try {
      await globalLoading.run(undefined, async () => {
        await confirmAction.onConfirm();
        setConfirmAction(null);
      });
    } finally {
      setConfirmBusy(false);
    }
  }
  if (!canViewPagos) {
    return (
      <div className="w-[98%] mx-auto py-10 text-slate-400">
        No tienes acceso a Pagos.
      </div>
    );
  }

  return (
    <div
      className="relative w-full min-w-0 py-4 text-white font-normal"
      onDragEnter={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (!canCreatePagos || openNewPago || saving) return;
        setIsPagoPageDragging(true);
      }}
      onDragOver={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (!canCreatePagos || openNewPago || saving) return;
        setIsPagoPageDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.defaultPrevented) return;
        const nextTarget = e.relatedTarget as Node | null;
        if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
          setIsPagoPageDragging(false);
        }
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        setIsPagoPageDragging(false);

        if (!canCreatePagos || openNewPago || saving) return;

        const files = Array.from(e.dataTransfer.files || []);
        void analyzeReceiptBatch(files);
      }}
    >
      {isPagoPageDragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[#0063C4]/60 bg-[#0063C4]/10 p-6">
          <div className="rounded-2xl border border-[#0063C4]/50 bg-[#0b1220]/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
            <div className="text-[14px] font-normal text-white">
              Suelta uno o varios comprobantes de pago aqui
            </div>
            <div className="mt-1 text-[12px] text-slate-400">
              PAY0 analizara el lote y te mostrara cada comprobante por separado
            </div>
          </div>
        </div>
      ) : null}

      <header className="mb-2 grid min-w-0 grid-cols-1 gap-1.5 2xl:grid-cols-[380px_minmax(0,1fr)_auto] 2xl:items-center">
        <div className="relative w-full min-w-0 2xl:w-[380px]">
          <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar por pago o cliente..."
            className="h-9 w-full rounded-xl border border-white/10 bg-[#161d2b] py-2 pl-9 text-[11px] outline-none"
          />
        </div>

        <DateScopeBar
          className="min-w-0 w-full 2xl:flex-1"
          mode={mode}
          baseDate={baseDate}
          customRange={customRange}
          onModeChange={(m) => {
            setMode(m);
            if (m !== "custom") {
              setCustomRange({});
              setBaseDate(new Date());
            }
          }}
          onNavigate={(direction) => setBaseDate((prev) => shiftBaseDate(mode, prev, direction))}
          onCustomRangeChange={(rangeValue) => {
            setCustomRange(rangeValue);
            if (rangeValue.start && rangeValue.end) {
              setMode("custom");
            }
          }}
        />

        {canCreatePagos && (
          <button
            onClick={openNewPagoModal}
            className="h-9 w-full rounded-xl bg-sky-500 px-4 text-[11px] font-normal text-black transition hover:bg-sky-400 2xl:w-auto 2xl:shrink-0"
          >
            + Nuevo Pago
          </button>
        )}
      </header>

      {pageMsg && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {pageMsg}
        </div>
      )}
      <div className="pay0-pagos-table-wrap w-full min-w-0 rounded-2xl border border-white/5 bg-[#161d2b] shadow-2xl overflow-x-auto">
        <table className="pay0-pagos-main-table pay0-table w-full text-left min-w-[1355px]">
          <colgroup className="pay0-pagos-colgroup">{/* H4-D67-A4_CANONICAL_15_COLUMNS */}
            <col className="pay0-col-folio" />
            {/* IQ2G_H4_D43G_PAGOS_IQ_COLS_AFTER_FOLIO */}
            <col className="pay0-col-iq-folio" />
            <col className="pay0-col-relacion" />
            <col className="pay0-col-iq-status" />
            <col className="pay0-col-fecha" />
            <col className="pay0-col-cliente" />
            <col className="pay0-col-empresa" />
            <col className="pay0-col-monto" />
            <col className="pay0-col-aplicado" />
            <col className="pay0-col-disponible" />
            <col className="pay0-col-pendientes" />
            <col className="pay0-col-doc" />
            <col className="pay0-col-nota" />
            <col className="pay0-col-estatus" />
            <col className="pay0-col-acciones" />
          </colgroup>
          <thead className="uppercase">
            <tr className="pay0-table-head-row">
              {[
                { label: "Folio", key: "id" },
                // IQ2G_H4_D43G_PAGOS_IQ_HEADERS_AFTER_FOLIO
                { label: "Folio IQ", key: "iqDepositFolio" },
                { label: "Relacion", key: "montoAplicado" },
                { label: "Estado IQ", key: "iqDepositReconciliationStatus" },
                { label: "Fecha", key: "createdAt" },
                { label: "Cliente", key: "clienteNombre" },
                { label: "Empresa", key: "empresaNombre" },
                { label: "Monto", key: "montoTotal" },
                { label: "Aplicado", key: "montoAplicado" },
                { label: "Disponible", key: "montoDisponible" },
              ].map((h) => (
                <th
                  key={h.key}
                  className={`p-3 cursor-pointer hover:text-sky-400 !text-[13px] ${["Folio", "Cliente", "Empresa"].includes(h.label) ? "text-left" : "text-center"} !py-[6px] font-normal`}
                  onClick={() =>
                    setSortConfig((prev) => ({
                      key: h.key,
                      dir: prev.key === h.key && prev.dir === "asc" ? "desc" : "asc",
                    }))
                  }
                >
                  <div className={`flex items-center gap-1 ${["Folio", "Cliente", "Empresa"].includes(h.label) ? "justify-start" : "justify-center"}`}>
                    {h.label}
                    {sortConfig.key === h.key &&
                      (sortConfig.dir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                  </div>
                </th>
              ))}
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Pendientes</th><th className="pay0-th pay0-pagos-docs-cell text-center !text-[13px] !py-[6px] font-normal">Docs / IQ</th><th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Nota</th><th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Estatus</th><th className="pay0-th pay0-pagos-actions-cell text-center !text-[13px] !py-[6px] font-normal">Acciones</th></tr>
          </thead>

          <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.025] [&>tr:nth-child(even)]:bg-slate-950/20">
            {loadingPagos ? (
              <tr><td colSpan={15} className="pay0-empty-cell">
                  Cargando pagos...
                </td></tr>
            ) : pagosFiltradosOrdenados.length === 0 ? (
              <tr><td colSpan={15} className="p-4 text-[12px] italic text-slate-500">
                  no hay registros para este periodo
                </td></tr>
            ) : (
              pagosFiltradosOrdenados.map((p, index) => {
                const status = String(p?.status || "REGISTRADO").toUpperCase();
                const foliosPendientes = getFoliosPendientesByPago(p);
                const aplicacionesPago = pagoAplicaciones.filter((x) => String(x?.pagoId || "") === String(p.id));
                const iqApplicationBlocking = isIqPaymentApplicationBlocking(p);
                const iqApplicationStatus = String(p?.iqPaymentApplicationStatus || "").toUpperCase();
                const iqApplicationExecutionStatus = String(p?.iqPaymentApplicationExecutionStatus || "").toUpperCase();
                const iqApplicationId = String(p?.iqPaymentApplicationId || "").trim();
                const hasIqApplicationFlow = !!(
                  p?.lastPaymentApplicationReservationId ||
                  p?.iqPaymentApplicationReservationId ||
                  p?.iqPaymentApplicationPlanId
                );
                const iqApplicationFolioPending =
                  iqApplicationStatus === "IQ_APPLIED" &&
                  iqApplicationExecutionStatus === "SUCCEEDED" &&
                  !iqApplicationId;
                const canResumeIqApplication =
                  hasIqApplicationFlow &&
                  (iqApplicationBlocking || iqApplicationFolioPending);

                return (
                  <tr
                    key={getPagoFolio(p)}
                    className={`group ${index % 2 === 0 ? "" : ""}`}
                  ><td className="pay0-td-date text-sky-400 text-left">{getPagoFolio(p)}</td><td className="pay0-td text-sky-200 text-center">{/* IQ2G_H4_D43G_PAGOS_IQ_ROW_AFTER_FOLIO */}<div className="font-mono text-[11px]">{getPagoIqFolio(p)}</div></td>
<td className="pay0-td text-center"><PaymentRelationIndicator payment={p} /></td><td className="pay0-td text-slate-300 text-center"><span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase text-slate-200">{getPagoIqStatus(p)}</span></td><td className="pay0-td-date text-center">{tsToDateText(p?.createdAt)}</td><td className="pay0-td text-white text-left">
                      <div>{p?.clienteNombre || "---"}</div>
                    </td><td className="pay0-td text-slate-300 text-left">
                      <div>{p?.empresaNombre || p?.companyId || "---"}</div>
                    </td><td className="pay0-td-money text-white text-center">{toCurrency(p?.montoTotal)}</td><td className="pay0-td-money text-emerald-400 text-center">{toCurrency(p?.montoAplicado)}</td><td className="pay0-td-money text-amber-400 text-center">{toCurrency(p?.montoDisponible)}</td><td className="pay0-td text-center">
                      {foliosPendientes.length === 0 ? (
                        <span className="text-slate-500">Sin pendientes</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {foliosPendientes.slice(0, 0).map((s) => (
                            <span
                              key={s.id}
                              className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300"
                              title={`Pendiente: $${toCurrency(getSolicitudPendiente(s))}`}
                            >
                              {s.folio}
                            </span>
                          ))}
                          {foliosPendientes.length > 0 && (
                              <div className="relative flex justify-center">
                                <button
                                  type="button"
                                  className="mx-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-sky-400/20 bg-sky-500/10 px-1.5 text-center text-[10px] font-normal leading-none text-sky-300 transition hover:bg-sky-500/20 hover:text-sky-100"
                                  title={foliosPendientes
                                    .map((s) => `${s.folio || s.id}: $${toCurrency(getSolicitudPendiente(s))}`)
                                    .join("\n")}
                                  aria-label={`${foliosPendientes.length} folios pendientes`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    const key = String(p?.id || getPagoFolio(p));
                                    setPendingOpenPagoId((prev) => (prev === key ? "" : key));
                                  }}
                                >
                                  {foliosPendientes.length}
                                </button>

                                {pendingOpenPagoId === String(p?.id || getPagoFolio(p)) ? (
                                  <div className="absolute left-1/2 top-7 z-40 w-[280px] -translate-x-1/2 rounded-2xl border border-sky-400/20 bg-[#0b1220] p-3 text-left shadow-2xl shadow-black/50">
                                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
                                      <span className="text-[11px] uppercase tracking-[0.12em] text-sky-200">
                                        Folios pendientes
                                      </span>
                                      <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-200">
                                        {foliosPendientes.length}
                                      </span>
                                    </div>

                                    <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                                      {foliosPendientes.map((s) => (
                                        <div
                                          key={s.id || s.folio}
                                          className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-2 py-1.5"
                                        >
                                          <span className="max-w-[150px] truncate font-mono text-[11px] text-sky-300">
                                            {s.folio || s.id}
                                          </span>
                                          <span className="whitespace-nowrap font-mono text-[11px] text-amber-300">
                                            ${toCurrency(getSolicitudPendiente(s))}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            )}
                        </div>
                      )}
                    </td><td className="pay0-td pay0-pagos-docs-cell text-center">
                      {canManagePagoDocs ? (
                        <button
                          type="button"
                          title={status === "RECHAZADO" || status === "CANCELADO" ? "Subir nuevo comprobante" : "Abrir documentos del pago"}
                          aria-label={status === "RECHAZADO" || status === "CANCELADO" ? "Nuevo comprobante" : "Docs"}
                          onClick={() => setPagoDocsFor(p)}
                          className={`inline-flex items-center justify-center rounded-full border border-dashed p-0.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${status === "RECHAZADO" || status === "CANCELADO" ? "border-amber-400 text-amber-300 hover:bg-amber-400/10" : "border-sky-400 text-sky-400 hover:bg-sky-400/10"}`}
                          disabled={actionId === p.id}
                        >
                          <Plus size={10} aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="text-slate-600">---</span>
                      )}
                    </td><td className="pay0-td text-center">
                      <button
                        title="Notas"
                        onClick={() => setNotesFor(p)}
                        className={`transition-all ${p?.hasUnreadMsg ? "text-yellow-400 animate-[pulse_1.5s_infinite]" : "text-slate-500 hover:text-yellow-400"}`}
                      >
                        <MessageSquarePlus size={18} />
                      </button>
                    </td><td className="pay0-td text-center">
                      <span
                        className={`inline-flex h-6 min-w-[145px] items-center justify-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-tighter ${statusClass(status)}`}
                      >
                        {status}
                      </span>
                    </td><td className="pay0-td pay0-pagos-actions-cell text-center">
                      <div className="flex justify-end gap-2 opacity-50 transition-opacity group-hover:opacity-100">

{canConciliatePagos && status === "REGISTRADO" && (
                          <button
                            title="Enviar a conciliacion"
                            onClick={() => moveToConciliacion(p.id)}
                            className="rounded p-1 text-amber-400 hover:bg-amber-500/10"
                            disabled={actionId === p.id}
                          >
                            <Send size={16} />
                          </button>
                        )}

                        {canConciliatePagos && status === "CONCILIACION_PENDIENTE" && (
                          <>
                            <button
                              title="Conciliar pago"
                              onClick={() => conciliarPago(p.id)}
                              className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"
                              disabled={actionId === p.id}
                            >
                              <ShieldCheck size={16} />
                            </button>

                            <button
                              title="Rechazar pago"
                              onClick={() => requestRechazarPago(p.id)}
                              className="rounded p-1 text-rose-400 hover:bg-rose-500/10"
                              disabled={actionId === p.id}
                            >
                              <Ban size={16} />
                            </button>
                          </>
                        )}                        {aplicacionesPago.length > 0 && (
                          <button
                            title="Ver aplicaciones"
                            onClick={() => setViewAplicacionesFor(p)}
                            className="rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                          >
                            <Eye size={16} />
                          </button>
                        )}


                        {canApplyPagos && canResumeIqApplication && (
                          <button
                            title="Continuar aplicacion IQ pendiente"
                            onClick={() => openExistingIqApplicationFlow(p)}
                            className="rounded p-1 text-amber-300 hover:bg-amber-500/10"
                            disabled={actionId === p.id || iqFlowBusy}
                          >
                            <ShieldCheck size={16} />
                          </button>
                        )}

                        {canApplyPagos &&
                          !iqApplicationBlocking &&
                          (status === "CONCILIADO" || status === "APLICADO_PARCIAL") &&
                          money2(p?.montoDisponible || 0) > 0 &&
                          foliosPendientes.length > 0 && (
                            <button
                              title="Aplicar a folios"
                              onClick={() => {
                                applyRequestKeyRef.current = createPagoApplicationIdempotencyKey();
                                setApplyFor(p);
                                setApplyAmounts({});
                              }}
                              className="rounded p-1 text-sky-400 hover:bg-sky-500/10"
                              disabled={actionId === p.id}
                            >
                              <Link2 size={16} />
                            </button>
                          )}
                      </div>
                    </td></tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {hasMorePagos && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadPagosPage(true)}
            disabled={loadingMorePagos}
            className="rounded-lg border border-sky-400/30 px-4 py-2 text-xs text-sky-200 hover:bg-sky-400/10 disabled:opacity-50"
          >
            {loadingMorePagos ? "Cargando pagos..." : "Cargar más pagos"}
          </button>
        </div>
      )}

      {receiptBatchOpen && (
        <div className="fixed inset-0 z-[1150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-sm font-normal text-white">
                  Comprobantes detectados
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {receiptBatchBusy
                    ? "Analizando hasta 3 comprobantes en paralelo..."
                    : `${receiptBatchItems.length} comprobante(s) en el lote.`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={
                    receiptBatchBusy ||
                    receiptBatchCreating ||
                    receiptBatchCreationSummary.readyToCreate.length === 0
                  }
                  onClick={() => void createReadyReceiptBatch()}
                  className="rounded-xl bg-white px-4 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {receiptBatchCreating
                    ? "CREANDO PAGOS..."
                    : `CREAR ${receiptBatchCreationSummary.readyToCreate.length} PAGO(S)`}
                </button>

                <button
                  type="button"
                  disabled={receiptBatchBusy || receiptBatchCreating}
                  onClick={() => {
                    setReceiptBatchOpen(false);
                    setReceiptBatchItems([]);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 hover:text-white disabled:opacity-40"
                  aria-label="Cerrar lote"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="max-h-[72vh] overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3">
                {receiptBatchItems.map((item) => {
                  const parsed = item.parsed || {};
                  const clientName =
                    item.clientMatch?.item
                      ? clientLabel(item.clientMatch.item)
                      : "";
                  const companyName =
                    item.companyMatch?.item
                      ? receiptItemNames(item.companyMatch.item)[0] || ""
                      : "";
                  const missingFields =
                    item.status === "READY"
                      ? getReceiptBatchMissingFields(item)
                      : [];

                  return (
                    <div
                      key={item.key}
                      className="rounded-2xl border border-white/10 bg-[#0b1220] p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-slate-100">
                            {item.file?.name || "Comprobante"}
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                            {getReceiptBatchStatusLabel(item)}
                          </div>

                          {item.status === "READY" && (
                            <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-slate-300 md:grid-cols-3">
                              <div>
                                <span className="text-slate-500">Cliente: </span>
                                {clientName || parsed.senderName || "Sin detectar"}
                              </div>
                              <div>
                                <span className="text-slate-500">Empresa: </span>
                                {companyName || parsed.shortName || parsed.beneficiaryName || "Sin detectar"}
                              </div>
                              <div>
                                <span className="text-slate-500">Monto: </span>
                                {Number(parsed.amount || 0) > 0
                                  ? `$${toCurrency(parsed.amount)}`
                                  : "Sin detectar"}
                              </div>
                              <div>
                                <span className="text-slate-500">Fecha: </span>
                                {parsed.date || "Sin detectar"}
                              </div>
                              <div>
                                <span className="text-slate-500">Banco: </span>
                                {parsed.bankName || "Sin detectar"}
                              </div>
                              <div>
                                <span className="text-slate-500">Referencia: </span>
                                {parsed.reference || "Sin detectar"}
                              </div>

                              <div className="md:col-span-3">
                                <div className="mb-1 text-slate-500">
                                  Tipo de operacion
                                </div>
                                <UiSelect
                                  value={String(item.operationTypeKey || "")}
                                  onChange={(value) =>
                                    setReceiptBatchItems((current) =>
                                      current.map((row) =>
                                        row.key === item.key
                                          ? {
                                              ...row,
                                              operationTypeKey: value,
                                            }
                                          : row,
                                      ),
                                    )
                                  }
                                  options={operationTypes.map((x: any) => ({
                                    value: String(x.key || x.id),
                                    label: String(x.name || x.key || x.id),
                                  }))}
                                  placeholder="Selecciona tipo de operacion..."
                                />

                                {missingFields.length > 0 && (
                                  <div className="mt-2 text-[11px] text-amber-300">
                                    Pendiente: {missingFields.join(", ")}.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {["ERROR", "CREATE_ERROR", "UPLOAD_ERROR", "DUPLICATE"].includes(
                            item.status,
                          ) && (
                            <div className="mt-2 text-[11px] text-rose-300">
                              {item.error || "No se pudo analizar."}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          disabled={item.status !== "READY"}
                          onClick={() => openReceiptBatchItem(item)}
                          className="rounded-xl border border-sky-400/30 bg-sky-500/15 px-4 py-2 text-[11px] text-sky-100 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Revisar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
            <div className="border-b border-white/10 bg-white/5 px-6 py-4">
              <div className="text-base font-normal text-slate-100">{confirmAction.title}</div>
              <div className="mt-2 text-sm text-slate-400">{confirmAction.message}</div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4">
              <button
                type="button"
                onClick={() => !confirmBusy && setConfirmAction(null)}
                disabled={confirmBusy}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-normal uppercase text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={runConfirmAction}
                disabled={confirmBusy}
                className={
                  confirmAction.danger
                    ? "rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-normal uppercase text-rose-300 transition-all hover:bg-rose-500/20 disabled:opacity-50"
                    : "rounded-xl border border-sky-400/30 bg-sky-500/20 px-4 py-2 text-xs font-normal uppercase text-sky-100 transition-all hover:bg-sky-500/25 disabled:opacity-50"
                }
              >
                {confirmBusy ? "Procesando..." : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {openNewPago && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center overflow-x-hidden bg-black/80 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeNewPagoModal();
            }
          }}
        >
          <div className="relative w-[calc(100vw-2rem)] max-w-[420px] overflow-visible rounded-3xl border border-white/10 bg-[#161d2b] p-6 shadow-2xl">
            <button
              type="button"
              onClick={closeNewPagoModal}
              disabled={saving}
              className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X size={16} strokeWidth={1.9} />
            </button>

            {pageMsg && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[13px] text-slate-200">
                {pageMsg}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 text-[13px] text-slate-300">
              <UiSelect
                value={selectedClientId}
                onChange={(value) => {
                  setSelectedClientId(value);
                  setSelectedCompanyId("");
                }}
                options={clientOptions}
                placeholder="Selecciona un cliente..."
              />

              <UiSelect
                value={selectedCompanyId}
                onChange={setSelectedCompanyId}
                options={companyOptions}
                placeholder="Selecciona una empresa..."
              />

              <UiSelect
                value={selectedOperationTypeKey}
                onChange={setSelectedOperationTypeKey}
                options={operationTypes.map((x: any) => ({
                  value: String(x.key || x.id),
                  label: String(x.name || x.key || x.id),
                }))}
                placeholder="Selecciona tipo de operacion..."
              />

              <input
                aria-label="Monto total"
                value={isMontoTotalFocused ? normalizeMoneyInput(montoTotal) : formatMoneyInput(montoTotal)}
                onFocus={() => setIsMontoTotalFocused(true)}
                onBlur={() => {
                  setMontoTotal((prev) => normalizeMoneyInput(prev));
                  setIsMontoTotalFocused(false);
                }}
                onChange={(e) => setMontoTotal(normalizeMoneyInput(e.target.value))}
                className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-[14px] text-slate-100 outline-none"
                placeholder="0.00"
                inputMode="decimal"
              />

              <input
                type="date"
                aria-label="Fecha pago"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-[13px] text-slate-100 outline-none [color-scheme:dark]"
              />

              <UiSelect
                value={moneda}
                onChange={setMoneda}
                options={currencyOptions}
                placeholder="Selecciona moneda..."
              />
              <UiSelect
                value={paymentForm}
                onChange={setPaymentForm}
                options={[{ value: "01", label: "01 · Efectivo" }, { value: "02", label: "02 · Cheque nominativo" }, { value: "03", label: "03 · Transferencia" }, { value: "04", label: "04 · Tarjeta de crédito" }, { value: "28", label: "28 · Tarjeta de débito" }, { value: "29", label: "29 · Tarjeta de servicios" }]}
                placeholder="Forma SAT del pago (para complemento)..."
              />
              <label
                className={`block cursor-pointer rounded-2xl border border-dashed px-4 py-4 text-[12px] transition ${
                  comprobantePagoDragActive
                    ? "border-sky-300 bg-sky-500/15 shadow-lg shadow-sky-950/20"
                    : "border-sky-400/30 bg-[#0b1220] hover:border-sky-400/60"
                } ${saving ? "cursor-not-allowed opacity-60" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!saving) setComprobantePagoDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!saving) setComprobantePagoDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setComprobantePagoDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setComprobantePagoDragActive(false);
                  if (saving) return;
                  selectPagoReceiptFile(event.dataTransfer.files?.[0] || null);
                }}
              >
                {/* IQ2G_H4_D40C_NUEVO_PAGO_COMPROBANTE_UI */}
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="uppercase tracking-[0.12em] text-slate-400">Comprobante de pago *</span>
                  <span className="text-[10px] text-slate-500">PDF/JPG/PNG · MAX 1 MB</span>
                </div>

                <input
                  type="file"
                  accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp"
                  disabled={saving}
                  onChange={(event) => selectPagoReceiptFile(event.target.files?.[0] || null)}
                  className="hidden"
                />

                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-center text-[12px] text-slate-200">
                  <div className="font-normal text-slate-100">
                    {comprobantePagoFile
                      ? comprobantePagoFile.name
                      : comprobantePagoDragActive
                        ? "Suelta el comprobante aqui"
                        : "Arrastra el comprobante aqui o haz clic para seleccionar"}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    PDF, JPG, PNG o WEBP. Maximo 1 MB.
                  </div>
                </div>
              </label>

              <button
                type="button"
                onClick={onCreatePago}
                disabled={saving}
                title={pagoFormTooltip || undefined}
                className={
                  isPagoFormComplete
                    ? "rounded-xl border border-[#0063C4]/40 bg-[#0063C4]/25 px-5 py-3 text-[13px] font-normal uppercase text-sky-100 transition hover:bg-[#0063C4]/35 disabled:opacity-50"
                    : "rounded-xl border border-amber-400/30 bg-amber-500/20 px-5 py-3 text-[13px] font-normal uppercase text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-50"
                }
              >
                {saving ? "Guardando..." : isPagoFormComplete ? "Crear Pago" : "Campos incompletos"}
              </button>
            </div>
          </div>
        </div>
      )}
      {applyFor && (
        <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-[#161d2b] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-normal text-white">Aplicar pago a folios pendientes</div>
                <div className="text-[11px] text-slate-400">
                  {getPagoFolio(applyFor)} - {applyFor?.clienteNombre || "---"} - Disponible: ${toCurrency(applyFor?.montoDisponible)}
                </div>
              </div>

              <button
                onClick={() => {
                  if (actionId === applyFor?.id) return;
                  applyRequestKeyRef.current = "";
                  setApplyFor(null);
                  setApplyAmounts({});
                }}
                disabled={actionId === applyFor?.id}
                className="text-slate-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            {foliosAplicables.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                {isPagoIqLinked(applyFor)
                  ? "No hay solicitudes pendientes con folio IQ vinculado para este pago."
                  : "Este cliente ya no tiene folios pendientes por liquidar."}
              </div>
            ) : (
              <>
                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
                  <table className="pay0-pagos-inner-table min-w-[1100px] w-full text-left">
                    <thead>
                      <tr><th className="p-3">Folio PAY0</th>{canViewIqFolios && <th className="p-3">Folio IQ</th>}<th className="p-3">Monto</th><th className="p-3">Abonado</th><th className="p-3">Pendiente</th><th className="p-3">Aplicar</th><th className="p-3 text-right">Rapido</th></tr>
                    </thead>
                    <tbody>
                      {foliosAplicables.map((s) => {
                        const pendiente = getSolicitudPendiente(s);



  return (
                          <tr key={s.id} className="border-b border-white/5 text-[11px] text-white"><td className="p-3">
                              <div className="font-mono text-sky-400">{s?.folio || s?.id}</div>
                              <div className="mt-0.5 text-[10px] text-slate-500">{s?.clienteNombre || "---"}</div>
                            </td>{canViewIqFolios && (
                              <td className="p-3">
                                <div className="font-mono text-cyan-300">
                                  {getSolicitudIqFolioVisible(s) || "---"}
                                </div>
                              </td>
                            )}<td className="p-3 text-center font-mono">${toCurrency(s?.monto)}</td><td className="p-3 text-center font-mono text-emerald-400">${toCurrency(s?.totalAbonado)}</td><td className="p-3 text-center font-mono text-amber-400">${toCurrency(pendiente)}</td><td className="p-3">
                              <input
                                value={applyAmounts[s.id] || ""}
                                onChange={(e) =>
                                  setApplyAmounts((prev) => ({
                                    ...prev,
                                    [s.id]: e.target.value,
                                  }))
                                }
                                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[12px] text-slate-100 outline-none"
                                placeholder="0.00"
                              />
                            </td><td className="p-3 text-right">
                              <button
                                onClick={() =>
                                  setApplyAmounts((prev) => ({
                                    ...prev,
                                    [s.id]: String(pendiente),
                                  }))
                                }
                                className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-300 hover:bg-sky-500/20"
                              >
                                Todo
                              </button>
                            </td></tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <div className="text-sm text-slate-300">
                    Seleccionado: <span className="font-normal text-white">${toCurrency(totalAplicarSeleccionado)}</span>
                  </div>

                  <button
                    onClick={applySelectedFolios}
                    disabled={actionId === applyFor?.id}
                    className="rounded-xl bg-emerald-500 px-4 py-3 text-[12px] font-normal text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionId === applyFor?.id ? "Preparando..." : "Aplicar en PAY0 y revisar IQ"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <PagoApplicationIqFlowModal
        open={iqFlowOpen}
        flow={iqFlow}
        busy={iqFlowBusy}
        humanConfirmed={iqHumanConfirmed}
        onHumanConfirmedChange={setIqHumanConfirmed}
        onExecute={executePreparedIqFlow}
        onRetryPreparation={retryIqPreparation}
        onRefreshStatus={refreshIqFlowStatus}
        onDiagnoseMethods={diagnoseIqMethods}
        onClose={() => {
          if (iqFlowBusy) return;
          setIqFlowOpen(false);
          setIqHumanConfirmed(false);
        }}
      />

      {pagoDocsFor && (
        <PagoDocsModal
          open={!!pagoDocsFor}
          pago={pagoDocsFor}
          onClose={() => setPagoDocsFor(null)}
        />
      )}

      {viewAplicacionesFor && (        <div className="fixed inset-0 z-[1280] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex h-[80vh] w-full max-w-5xl flex-col rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <div className="text-sm font-normal text-white">Aplicaciones del pago</div>
                <div className="text-[11px] text-slate-400">
                  {viewAplicacionesFor?.id} - {viewAplicacionesFor?.clienteNombre || "---"} - {viewAplicacionesFor?.empresaNombre || "---"}
                </div>
              </div>

              <button
                onClick={() => setViewAplicacionesFor(null)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {aplicacionesDelPago.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  Este pago todavia no tiene aplicaciones registradas.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="pay0-pagos-inner-table min-w-[900px] w-full text-left">
                    <thead>
                      <tr><th className="p-3">Fecha</th><th className="p-3">Solicitud</th><th className="p-3">Cliente</th><th className="p-3">Empresa</th><th className="p-3 text-center">Monto aplicado</th><th className="pay0-th">Estatus</th></tr>
                    </thead>
                    <tbody>
                      {aplicacionesDelPago.map((a) => (
                        <tr key={a.id} className="border-b border-white/5 text-[11px] text-white"><td className="p-3">{tsToDateText(a?.createdAt)}</td><td className="p-3">
                            <a
                              href={`/solicitudes?q=${encodeURIComponent(a?.folioSolicitud || a?.solicitudId || "")}`}
                              className="font-mono text-sky-400 hover:text-sky-300 hover:underline"
                              title="Abrir solicitud"
                            >
                              {a?.folioSolicitud || "---"}
                            </a>
                            <div className="mt-0.5 text-[10px] text-slate-500">{a?.solicitudId || "---"}</div>
                          </td><td className="p-3">{a?.clienteNombre || "---"}</td><td className="p-3">{a?.empresaNombre || "---"}</td><td className="p-3 text-center font-mono text-emerald-400">
                            ${toCurrency(a?.montoAplicado || 0)}
                          </td><td className="p-3 text-center">
                            <span className={`inline-flex h-6 min-w-[110px] items-center justify-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-tighter ${aplicacionStatusClass(a)}`}>
                              {aplicacionStatusLabel(a)}
                            </span>
                          </td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {notesFor && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <div className="text-sm font-normal text-white">Notas del pago</div>
                <div className="text-[11px] text-slate-400">
                  {notesFor?.id} - {notesFor?.clienteNombre || "---"}
                </div>
              </div>

              <button
                onClick={() => {
                  setNotesFor(null);
                  setNotes([]);
                  setNewNote("");
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {notes.length === 0 ? (
                <div className="text-sm text-slate-400">Sin mensajes todavia.</div>
              ) : (
                notes.map((note) => <NoteBubble key={note.id} note={note} myUid={myUid} />)
              )}
            </div>

            <div className="border-t border-white/10 p-4">
              <div className="flex gap-2">
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={noteSending ? "Enviando nota..." : "Escribe una nota..."}
                  disabled={noteSending}
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!noteSending) sendPagoNote();
                    }
                  }}
                />
                <button
                  onClick={sendPagoNote}
                  disabled={noteSending || !newNote.trim()}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-[12px] font-normal text-black hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  title={noteSending ? "Enviando..." : "Enviar nota"}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
