"use client";

import { formatDateTime24 } from "@/lib/dateTime";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, FilePenLine, Search } from "lucide-react";
import NoAccess from "@/components/NoAccess";
import { readClientWalletDetailOverview } from "@/services/ledger";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { normalizeRole } from "@/lib/roles";

type BalanceAccount = {
  id: string;
  holderId?: string | null;
  holderName?: string | null;
  availableBalance?: number;
  pendingAmount?: number;
  netBalance?: number;
  lastMovementAt?: any;
};

type WalletMovement = {
  id: string;
  createdAt?: any;
  movementType?: string;
  movementSubType?: string | null;
  direction?: "IN" | "OUT";
  amount?: number;
  note?: string | null;
  holderName?: string | null;
  clienteId?: string | null;
  holderId?: string | null;
  empresaId?: string | null;
  empresaNombre?: string | null;
  companyName?: string | null;
  referenceId?: string | null;
  referenceFolio?: string | null;
  folio?: string | null;
  pagoFolio?: string | null;
  solicitudFolio?: string | null;
  dispersionFolio?: string | null;
  sourceFolio?: string | null;
  referenceType?: string | null;
  depositId?: string | null;
  dispersionId?: string | null;
  transferId?: string | null;
  sourceModule?: string | null;
  operationalReference?: string | null;
  displayConcept?: string | null;
  currency?: string | null;
  actorDisplayName?: string | null;
  actorUsername?: string | null;
  isSystemGenerated?: boolean | null;
  runningBalance?: number;
};
type ClientAdvance = {
  id: string;
  amount?: number;
  pendingAmount?: number;
  status?: string | null;
  reason?: string | null;
  note?: string | null;
  reference?: string | null;
  createdAt?: any;
  lastLiquidatedAt?: any;
};

type DispersionLookup = {
  id: string;
  folio?: string | null;
  beneficiaryId?: string | null;
  beneficiaryNombre?: string | null;
  methodTipo?: string | null;
  destinationKind?: string | null;
  bankName?: string | null;
  clabe?: string | null;
  cardNumber?: string | null;
  displayConcept?: string | null;
  operationalReference?: string | null;
  referenceFolio?: string | null;
  dispersionFolio?: string | null;
  sourceFolio?: string | null;
  empresaId?: string | null;
  note?: string | null;
  reference?: string | null;
};



type StatementPeriodMode = "DIA" | "SEMANA" | "MES" | "ANIO";

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addStatementPeriod(date: Date, mode: StatementPeriodMode, step: number) {
  const next = new Date(date);

  if (mode === "DIA") next.setDate(next.getDate() + step);
  if (mode === "SEMANA") next.setDate(next.getDate() + step * 7);
  if (mode === "MES") next.setMonth(next.getMonth() + step);
  if (mode === "ANIO") next.setFullYear(next.getFullYear() + step);

  return next;
}

function getStatementPeriodRange(date: Date, mode: StatementPeriodMode) {
  const base = startOfLocalDay(date);

  if (mode === "DIA") {
    return {
      start: startOfLocalDay(base),
      end: endOfLocalDay(base),
    };
  }

  if (mode === "SEMANA") {
    const day = base.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(base);
    start.setDate(base.getDate() + mondayOffset);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return {
      start: startOfLocalDay(start),
      end: endOfLocalDay(end),
    };
  }

  if (mode === "MES") {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);

    return {
      start: startOfLocalDay(start),
      end: endOfLocalDay(end),
    };
  }

  const start = new Date(base.getFullYear(), 0, 1);
  const end = new Date(base.getFullYear(), 11, 31);

  return {
    start: startOfLocalDay(start),
    end: endOfLocalDay(end),
  };
}

function formatStatementPeriodLabel(date: Date, mode: StatementPeriodMode) {
  const range = getStatementPeriodRange(date, mode);

  if (mode === "DIA") {
    return date.toLocaleDateString("es-MX");
  }

  return `${range.start.toLocaleDateString("es-MX")} - ${range.end.toLocaleDateString("es-MX")}`;
}
function getStatementClientName(account: BalanceAccount | null, clienteId: string) {
  const name =
    String((account as any)?.holderName || "").trim() ||
    String((account as any)?.clienteNombre || "").trim() ||
    String((account as any)?.clientName || "").trim() ||
    String(clienteId || "").trim();

  return name || "CLIENTE";
}
function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatText(value: unknown, fallback = "---") {
  const raw = String(value || "").trim();
  return raw || fallback;
}

function formatMovementType(value: unknown) {
  const raw = String(value || "MOVIMIENTO").trim();
  return raw ? raw.replace(/_/g, " ") : "MOVIMIENTO";
}

function formatReferenceType(value: unknown) {
  const raw = String(value || "").trim();
  return raw ? raw.replace(/_/g, " ") : "---";
}

function shortReference(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "---";
  if (raw.length <= 12) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function formatMovementOrigin(item: WalletMovement) {
  const type = String(item.movementType || "").toUpperCase();
  const subType = String(item.movementSubType || "").toUpperCase();
  const source = String(item.sourceModule || "").toUpperCase();

  if (type === "PAGO_RECIBIDO_BRUTO") return "Pago recibido";
  if (type === "COMISION_CLIENTE_COBRADA") return "Comision";
  if (type === "SALDO_GENERADO" && subType.includes("PAGO")) return "Pago conciliado";
  if (type === "SALDO_GENERADO") return "Saldo generado";
  if (type === "ADELANTO_OTORGADO") return "Adelanto otorgado";
  if (type === "ADELANTO_LIQUIDADO") return "Adelanto liquidado";
  if (type === "DISPERSION_REGISTRADA") return "Dispersion registrada";
  if (type === "DISPERSION_REINTEGRADA") return "Dispersion reintegrada";
  if (type === "UTILIDAD_GENERADA") return "Utilidad generada";
  if (type === "AJUSTE_MANUAL") return "Ajuste manual";
  if (type === "CORRECCION_MOVIMIENTO") return "Correccion";
  if (type === "DEVOLUCION") return "Devolucion";

  if (source === "DEPOSITS") return "Pago";
  if (source === "FINANCING") return "Wallet";
  if (source === "BALANCES") return "Balance";

  return formatMovementType(item.movementType);
}

function formatMovementReference(item: WalletMovement) {
  const type = String(item.movementType || "").toUpperCase();

  const visible =
    String(
      item.referenceFolio ||
      item.folio ||
      item.pagoFolio ||
      item.solicitudFolio ||
      item.dispersionFolio ||
      item.sourceFolio ||
      item.operationalReference ||
      ""
    ).trim();

  if (visible) return visible;

  if (item.depositId) return `Pago ${shortReference(item.depositId)}`;
  if (item.dispersionId) return `Dispersion ${shortReference(item.dispersionId)}`;
  if (item.transferId) return `Transferencia ${shortReference(item.transferId)}`;

  if (item.referenceType || item.referenceId) {
    return `${formatReferenceType(item.referenceType)} ${shortReference(item.referenceId)}`.trim();
  }

  if (type === "ADELANTO_OTORGADO" || type === "ADELANTO_LIQUIDADO") return "Adelanto";
  return "---";
}

function formatEmpresaMovimiento(item: WalletMovement) {
  const byName = String(item.empresaNombre || item.companyName || "").trim();
  if (byName) return byName;
  if (item.empresaId) return "Empresa vinculada";
  return "---";
}

function formatMovementDescription(item: WalletMovement) {
  const displayConcept = String(item.displayConcept || "").trim();
  if (displayConcept) return displayConcept;

  const note = String(item.note || "").trim();
  if (note) return note;

  const origin = formatMovementOrigin(item);
  const reference = formatMovementReference(item);
  if (reference !== "---") return `${origin} / ${reference}`;

  return origin;
}

function getMovementDispersionId(item: WalletMovement) {
  const direct = String(item.dispersionId || "").trim();
  if (direct) return direct;

  const referenceType = String(item.referenceType || "").trim().toUpperCase();
  const referenceId = String(item.referenceId || "").trim();

  if (referenceType === "DISPERSION" && referenceId) return referenceId;

  return "";
}

function formatMovementKind(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const type = String(item.movementType || "").trim().toUpperCase();
  if (type === "DISPERSION_REGISTRADA") {
    return getDispersionConceptByType(dispersion);
  }

  if (type === "DISPERSION_REINTEGRADA") return "Reintegro";
  if (type === "PAGO_RECIBIDO_BRUTO") return "Pago";
  if (type === "COMISION_CLIENTE_COBRADA") return "Comision";
  if (type.includes("ADELANTO")) return "Adelanto";
  if (type === "SALDO_GENERADO") return "Pago";
  if (type.includes("UTILIDAD")) return "Utilidad";
  if (type.includes("AJUSTE")) return "Ajuste";
  if (type.includes("CORRECCION")) return "Correccion";

  return formatMovementType(item.movementType);
}

function formatMovementBeneficiary(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const type = String(item.movementType || "").trim().toUpperCase();

  if (type.includes("DISPERSION")) {
    const beneficiary = String(dispersion?.beneficiaryNombre || "").trim();
    return beneficiary || "Beneficiario no localizado";
  }

  return "---";
}

function formatOperationalReference(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const type = String(item.movementType || "").trim().toUpperCase();

  const directReference = String(item.operationalReference || "").trim();
  if (directReference) return directReference;

  if (type.includes("DISPERSION")) {
    const operationalReference = String(dispersion?.reference || "").trim();
    return operationalReference || "---";
  }

  if (type.includes("ADELANTO")) {
    return "---";
  }

  return "---";
}

function formatActorDisplay(item: WalletMovement) {
  if (item.isSystemGenerated) return "Sistema";

  const raw = String(item.actorUsername || "").trim();
  if (!raw) return "Usuario";

  const looksEmail = raw.includes("@");
  const looksUid = /^[A-Za-z0-9_-]{18,}$/.test(raw);

  if (looksEmail || looksUid) return "Usuario";

  return raw;
}

function cleanTechnicalText(value: unknown) {
  let raw = String(value || "").trim();
  if (!raw) return "";

  raw = raw.replace(/\b[A-Za-z0-9_-]{18,}\b/g, "");
  raw = raw.replace(/\s{2,}/g, " ").trim();
  raw = raw.replace(/pago\s+despues/gi, "pago despues");
  raw = raw.replace(/pago\s+por/gi, "pago por");

  return raw;
}


function getDispersionConceptByType(dispersion?: DispersionLookup | null) {
  const methodTipo = String(dispersion?.methodTipo || "").trim().toUpperCase();
  const destinationKind = String(dispersion?.destinationKind || "").trim().toUpperCase();

  const type = methodTipo || destinationKind;

  if (type === "DEBITO") return "TRANSFERENCIA";
  if (type === "TDC") return "PAGO TDC";
  if (type === "AMEX") return "PAGO AMEX";
  if (type === "EFECTIVO") return "RETIRO EFECTIVO";
  if (type === "OTRO") return "OTRO TIPO - VER REFERENCIA";

  return "TRANSFERENCIA";
}
function formatDispersionFullConcept(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const displayConcept =
    cleanTechnicalText(item.displayConcept) ||
    cleanTechnicalText(dispersion?.displayConcept);

  if (displayConcept) return displayConcept;

  const type = String(
    dispersion?.methodTipo ||
    dispersion?.destinationKind ||
    ""
  ).trim().toUpperCase();

  const destinationData = String(
    dispersion?.cardNumber ||
    dispersion?.clabe ||
    ""
  ).trim();

  let base = "";

  if (type === "DEBITO") base = "TRANSFERENCIA";
  else if (type === "TDC") base = "PAGO TDC";
  else if (type === "AMEX") base = "PAGO AMEX";
  else if (type === "EFECTIVO") base = "RETIRO EFECTIVO";
  else if (type === "OTRO") base = "OTRO TIPO";
  else base = cleanTechnicalText(item.note) || "DISPERSION";

  return destinationData ? `${base} ${destinationData}` : base;
}
function formatMovementConcept(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const type = String(item.movementType || "").trim().toUpperCase();
  const displayConcept = cleanTechnicalText(item.displayConcept);
  if (displayConcept) return displayConcept;

  if (type.includes("DISPERSION")) {
    return formatDispersionFullConcept(item, dispersion);
  }

  if (type === "PAGO_RECIBIDO_BRUTO") {
    return "Pago recibido";
  }

  if (type === "COMISION_CLIENTE_COBRADA") {
    return "Comision por servicio";
  }

  if (type === "ADELANTO_LIQUIDADO") {
    return "Liquidacion de adelanto";
  }
  if (type === "DISPERSION_REGISTRADA") {
    return getDispersionConceptByType(dispersion);
  }
  if (type === "DISPERSION_REINTEGRADA") {
    return "DEVOLUCION";
  }

  if (type === "SALDO_GENERADO") {
    return "Pago conciliado aplicado a wallet";
  }

  if (type === "ADELANTO_OTORGADO") {
    const note = cleanTechnicalText(item.note);
    return note || "Adelanto otorgado al cliente";
  }

  if (type === "ADELANTO_LIQUIDADO") {
    return "Adelanto liquidado con pago conciliado";
  }

  const note = cleanTechnicalText(item.note);
  if (note) return note;

  return formatMovementOrigin(item);
}

function formatEmpresaMovimientoCanonica(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const byName = String(item.empresaNombre || item.companyName || "").trim();
  if (byName) return byName;

  if (item.empresaId || dispersion?.empresaId) return "Empresa vinculada";

  return "---";
}


function formatStatementMovement(item: WalletMovement, dispersion?: DispersionLookup | null) {
  const type = String(item.movementType || "").trim().toUpperCase();

  if (type === "DISPERSION_REGISTRADA") {
    const concept = formatMovementConcept(item, dispersion);
    return String(concept || getDispersionConceptByType(dispersion)).trim().toUpperCase();
  }

  if (type === "DISPERSION_REINTEGRADA") {
    return "DEVOLUCION";
  }

  if (type === "PAGO_RECIBIDO_BRUTO") {
    return "PAGO RECIBIDO";
  }

  if (type === "COMISION_CLIENTE_COBRADA") {
    const concept = cleanTechnicalText(item.displayConcept) || formatMovementConcept(item, dispersion);
    return String(concept || "COMISION POR SERVICIO").trim().toUpperCase();
  }

  if (type === "ADELANTO_OTORGADO") {
    return "ADELANTO OTORGADO";
  }

  if (type === "ADELANTO_LIQUIDADO") {
    return "LIQUIDACION DE ADELANTO";
  }

  const concept = cleanTechnicalText(item.displayConcept) || formatMovementConcept(item, dispersion);
  return String(concept || formatMovementOrigin(item)).trim().toUpperCase();
}
function getMovementAccountingOrder(item: WalletMovement) {
  const type = String(item.movementType || "").trim().toUpperCase();

  if (type === "PAGO_RECIBIDO_BRUTO") return 10;
  if (type === "COMISION_CLIENTE_COBRADA") return 20;
  if (type === "ADELANTO_LIQUIDADO") return 30;
  if (type === "SALDO_GENERADO") return 40;
  if (type.includes("DISPERSION")) return 50;
  if (type.includes("ADELANTO")) return 60;

  return 99;
}

function getMovementSortTime(item: WalletMovement) {
  const value: any = item.createdAt;

  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMovementGroupKey(item: WalletMovement) {
  return String(item.depositId || item.dispersionId || item.referenceId || item.id || "").trim();
}


function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getMovementSignedAmount(item: WalletMovement) {
  const amount = Number(item.amount || 0);
  return item.direction === "IN" ? amount : -amount;
}


type AdvanceStatementRow = {
  id: string;
  createdAt: any;
  movement: string;
  abono: number;
  cargo: number;
  saldo: number;
};

function buildAdvanceStatementRows(items: ClientAdvance[]) {
  const sorted = [...items].sort((a, b) => {
    const timeA = getMovementSortTime({ createdAt: a.createdAt } as WalletMovement);
    const timeB = getMovementSortTime({ createdAt: b.createdAt } as WalletMovement);
    return timeA - timeB;
  });

  let saldo = 0;
  const rows: AdvanceStatementRow[] = [];

  for (const item of sorted) {
    const amount = roundMoney(Number(item.amount || 0));
    const pending = roundMoney(Number(item.pendingAmount || 0));
    const liquidated = roundMoney(Math.max(0, amount - pending));
    if (amount > 0) {
      saldo = roundMoney(saldo + amount);

      rows.push({
        id: `${item.id}-otorgado`,
        createdAt: item.createdAt,
        movement: "ADELANTO OTORGADO",
        abono: 0,
        cargo: amount,
        saldo,
      });
    }

    if (liquidated > 0) {
      const isFinal = pending <= 0;
      saldo = roundMoney(Math.max(0, saldo - liquidated));

      rows.push({
        id: `${item.id}-liquidado`,
        createdAt: item.createdAt,
        movement: isFinal ? "FINIQUITO ADELANTO" : "ABONO A ADELANTO",
        abono: liquidated,
        cargo: 0,
        saldo: isFinal ? 0 : saldo,
      });
    }
  }

  return rows;
}
function buildStatementRowsForDisplay(items: WalletMovement[]) {
  const rows = sortWalletMovementsForStatement(items);
  return rows.map((item) => ({
    item,
    visualRunningBalance: Number(item.runningBalance || 0),
  }));
}
function sortWalletMovementsForStatement(items: WalletMovement[]) {
  return [...items].sort((a, b) => {
    const timeA = getMovementSortTime(a);
    const timeB = getMovementSortTime(b);

    if (timeA !== timeB) return timeA - timeB;

    const groupA = getMovementGroupKey(a);
    const groupB = getMovementGroupKey(b);

    if (groupA && groupB && groupA === groupB) {
      return getMovementAccountingOrder(a) - getMovementAccountingOrder(b);
    }

    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}
function formatDate(value: any) {
  return formatDateTime24(value, "---");
}

function getEpoch(value: any) {
  if (value?.seconds) return Number(value.seconds);
  return 0;
}

export default function WalletClienteDetallePage() {
  const params = useParams();
  const routeClienteId = decodeURIComponent(String((params as any)?.clienteId || "").trim());

  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { canAccess: canViewWalletClient } = useModuleAccess(profile, "wallet", "estadoCuentaCliente");

  const role = normalizeRole((profile as any)?.role);
  const uid = String(user?.uid || "");
  const rootId = useMemo(
    () => String((profile as any)?.rootId || uid || ""),
    [profile, uid]
  );

  const [account, setAccount] = useState<BalanceAccount | null>(null);
  const [movements, setMovements] = useState<WalletMovement[]>([]);
  const [advances, setAdvances] = useState<ClientAdvance[]>([]);
  const [dispersionLookup, setDispersionLookup] = useState<Record<string, DispersionLookup>>({});
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [loadingAdvances, setLoadingAdvances] = useState(true);
  const [loadingDispersions, setLoadingDispersions] = useState(true);
  const [statementSearch, setStatementSearch] = useState("");
  const [statementPeriodMode, setStatementPeriodMode] = useState<StatementPeriodMode>("DIA");
  const [statementDate, setStatementDate] = useState(() => new Date());

  const scope = useMemo(() => {
    if (role === "superadmin") {
      return {
        field: "rootId",
        value: rootId,
        subtitle: "Estado de cuenta cliente global",
      };
    }

    if (role === "admin") {
      return {
        field: "adminId",
        value: uid,
        subtitle: "Estado de cuenta cliente de tu universo",
      };
    }

    return {
      field: "operadorId",
      value: uid,
      subtitle: "Estado de cuenta cliente de tu universo",
    };
  }, [role, rootId, uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadClientDetail() {
      if (!canViewWalletClient || !routeClienteId || !uid) {
        setAccount(null);
        setMovements([]);
        setAdvances([]);
        setDispersionLookup({});
        setLoadingAccount(false);
        setLoadingMovements(false);
        setLoadingAdvances(false);
        setLoadingDispersions(false);
        return;
      }

      setLoadingAccount(true);
      setLoadingMovements(true);
      setLoadingAdvances(true);
      setLoadingDispersions(true);

      try {
        const detail = await readClientWalletDetailOverview(routeClienteId);

        if (cancelled) return;

        setAccount((detail?.account || null) as BalanceAccount | null);
        setMovements((detail?.movements || []) as WalletMovement[]);
        setAdvances((detail?.advances || []) as ClientAdvance[]);
        setDispersionLookup((detail?.dispersionLookup || {}) as Record<string, DispersionLookup>);
        setLoadingAccount(false);
        setLoadingMovements(false);
        setLoadingAdvances(false);
        setLoadingDispersions(false);
      } catch {
        if (!cancelled) {
          setAccount(null);
          setMovements([]);
          setAdvances([]);
          setDispersionLookup({});
          setLoadingAccount(false);
          setLoadingMovements(false);
          setLoadingAdvances(false);
          setLoadingDispersions(false);
        }
      }
    }

    loadClientDetail();

    return () => {
      cancelled = true;
    };
  }, [canViewWalletClient, routeClienteId, uid]);

  const walletSummary = useMemo(() => {
    const rows = movements || [];

    let totalAbonos = 0;
    let totalCargos = 0;

    rows.forEach((item) => {
      const amount = Number(item.amount || 0);
      if (item.direction === "IN") totalAbonos += amount;
      else totalCargos += amount;
    });

    const first = rows[0];
    const last = rows[rows.length - 1];

    let saldoInicialVisible = 0;
    if (first) {
      const firstAmount = Number(first.amount || 0);
      const signedFirstAmount = first.direction === "IN" ? firstAmount : -firstAmount;
      saldoInicialVisible = Number(first.runningBalance || 0) - signedFirstAmount;
    }

    const saldoFinalVisible = last
      ? Number(last.runningBalance || 0)
      : Number(account?.availableBalance || 0);

    return {
      saldoInicialVisible,
      totalAbonos,
      totalCargos,
      saldoFinalVisible,
      firstDate: first ? formatDate(first.createdAt) : "---",
      lastDate: last ? formatDate(last.createdAt) : "---",
      movimientosVisibles: rows.length,
    };
  }, [movements, account]);

  const advanceSummary = useMemo(() => {
    const rows = advances || [];

    let totalAdelantado = 0;
    let adelantoPendiente = 0;

    rows.forEach((item) => {
      totalAdelantado += Number(item.amount || 0);
      adelantoPendiente += Number(item.pendingAmount || 0);
    });

    const totalLiquidado = totalAdelantado - adelantoPendiente;
    const saldoDisponible = Number(account?.availableBalance || 0);
    const saldoNeto = Number(account?.netBalance || 0);

    return {
      totalAdelantado,
      adelantoPendiente,
      totalLiquidado,
      saldoDisponible,
      saldoNeto,
    };
  }, [advances, account]);

  const loading = loadingAccount || loadingMovements || loadingAdvances || loadingDispersions;

  const statementRows = useMemo(() => {
    return buildStatementRowsForDisplay(movements);
  }, [movements, account]);

  const advanceStatementRows = useMemo(() => {
    return buildAdvanceStatementRows(advances);
  }, [advances]);
  const filteredStatementRows = useMemo(() => {
    const search = statementSearch.trim().toLowerCase();
    const range = getStatementPeriodRange(statementDate, statementPeriodMode);

    return statementRows.filter(({ item }) => {
      const movementTime = getMovementSortTime(item);
      const inDateRange =
        movementTime >= range.start.getTime() &&
        movementTime <= range.end.getTime();

      if (!inDateRange) return false;

      if (!search) return true;

      const dispersionId = getMovementDispersionId(item);
      const dispersion = dispersionId ? dispersionLookup[dispersionId] : null;

      const searchable = [
        formatStatementMovement(item, dispersion),
        formatMovementBeneficiary(item, dispersion),
        formatOperationalReference(item, dispersion),
        formatEmpresaMovimientoCanonica(item, dispersion),
        formatMovementConcept(item, dispersion),
        item.note,
        item.displayConcept,
        item.operationalReference,
        item.depositId,
        item.dispersionId,
        item.referenceId,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return searchable.includes(search);
    });
  }, [statementRows, statementSearch, statementDate, statementPeriodMode, dispersionLookup]);


  if (!canViewWalletClient) {
    return (
      <NoAccess
        className="p-6 text-slate-400"
        message="No tienes acceso al estado de cuenta cliente."
      />
    );
  }

  return (
    <div className="w-[95%] mx-auto pb-10">
      <header className="py-4">
  <div className="flex items-center gap-3 flex-wrap">
    <div className="relative flex-1 min-w-[280px]">
      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
      <input
        value={statementSearch}
        onChange={(event) => setStatementSearch(event.target.value)}
        placeholder="Buscar Movimiento, beneficiario, referencia o empresa..."
        className="w-full pl-11 pr-4 py-3 rounded-2xl bg-[#161d2b] border border-white/10 text-sm font-normal text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500/60"
      />
    </div>

    <div className="flex items-center gap-2 rounded-2xl bg-[#161d2b] border border-white/10 p-1">
      {(["DIA", "SEMANA", "MES", "ANIO"] as StatementPeriodMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => setStatementPeriodMode(mode)}
          className={`px-4 py-2 rounded-xl text-xs font-normal tracking-widest transition-colors ${
            statementPeriodMode === mode
              ? "bg-sky-500/20 text-sky-300 border border-sky-500/50"
              : "text-slate-500 hover:text-slate-200"
          }`}
        >
          {mode}
        </button>
      ))}
    </div>

    <div className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-[#161d2b] border border-white/10">
      <button
        type="button"
        onClick={() => setStatementDate((current) => addStatementPeriod(current, statementPeriodMode, -1))}
        className="px-2 text-sky-300 text-lg leading-none"
      >
        -
      </button>

      <div className="min-w-[180px] text-center text-sm font-normal text-white">
        {formatStatementPeriodLabel(statementDate, statementPeriodMode)}
      </div>

      <button
        type="button"
        onClick={() => setStatementDate((current) => addStatementPeriod(current, statementPeriodMode, 1))}
        className="px-2 text-sky-300 text-lg leading-none"
      >
        +
      </button>
    </div>

    <label className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#161d2b] border border-white/10 text-sm font-normal text-slate-200 hover:bg-white/5 transition-colors cursor-pointer">
      <CalendarDays size={16} />
      Calendario
      <input
        type="date"
        value={toDateInputValue(statementDate)}
        onChange={(event) => setStatementDate(parseDateInputValue(event.target.value))}
        className="sr-only"
      />
    </label>

    <Link
      href="/wallet/clientes"
      className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/10 text-xs font-normal tracking-widest text-slate-300 hover:bg-white/5 transition-colors"
    >
      <ArrowLeft size={16} />
      Volver a clientes
    </Link>
  </div>
</header>
      <div className="pay0-table-card mb-8">
        <div className="pay0-table-header">
          <h2 className="pay0-table-title">{`ESTADO DE CUENTA / ${getStatementClientName(account, routeClienteId)}`}</h2>
          <FilePenLine size={18} className="text-slate-500" />
        </div>

        <div className="pay0-table-wrap">
          <table className="pay0-table">
            <thead>
              <tr className="pay0-table-head-row">
                <th className="pay0-th">Fecha</th>
                <th className="pay0-th">Movimiento</th>
                <th className="pay0-th">Beneficiario</th>
                <th className="pay0-th">Referencia</th>
                <th className="pay0-th">Empresa</th>
                <th className="pay0-th-right">Abono</th>
                <th className="pay0-th-right">Cargo</th>
                <th className="pay0-th-right">Saldo</th>
              </tr>
            </thead>

            <tbody>
              {loadingMovements ? (
                <tr>
                  <td colSpan={8} className="pay0-empty-cell">
                    Cargando estado wallet...
                  </td>
                </tr>
              ) : filteredStatementRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="pay0-empty-cell">
                    No hay movimientos para este rango / filtro.
                  </td>
                </tr>
              ) : (
                filteredStatementRows.map(({ item, visualRunningBalance }, index) => {
                  const amount = Number(item.amount || 0);
                  const abono = item.direction === "IN" ? amount : 0;
                  const cargo = item.direction === "OUT" ? amount : 0;
                  const dispersionId = getMovementDispersionId(item);
                  const dispersion = dispersionId ? dispersionLookup[dispersionId] : null;

                  return (
                    <tr key={item.id} className={index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}>
                      <td className="pay0-td-date">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="pay0-td text-white">
                        {formatStatementMovement(item, dispersion)}
                      </td>

                      <td className="pay0-td text-slate-300">
                        {formatMovementBeneficiary(item, dispersion)}
                      </td>

                      <td className="pay0-td text-sky-300">
                        {formatOperationalReference(item, dispersion)}
                      </td>

                      <td className="pay0-td text-slate-400">
                        {formatEmpresaMovimientoCanonica(item, dispersion)}
                      </td>


                      <td className="pay0-td-money text-emerald-400">
                        {abono > 0 ? formatMoney(abono) : "---"}
                      </td>

                      <td className="pay0-td-money text-rose-400">
                        {cargo > 0 ? formatMoney(cargo) : "---"}
                      </td>

                      <td className="pay0-td-money text-white">
                        {formatMoney(visualRunningBalance)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pay0-table-card">
        <div className="pay0-table-header">
          <h2 className="pay0-table-title">
            ESTADO DE ADELANTOS
          </h2>
          <FilePenLine size={18} className="text-slate-500" />
        </div>

        <div className="pay0-table-wrap">
          <table className="pay0-table table-fixed">
            <thead>
              <tr className="pay0-table-head-row">
                <th className="pay0-th w-[15%]">Fecha</th>
                <th className="pay0-th w-[46%]">Movimiento</th>
                <th className="pay0-th-right w-[13%]">Abono</th>
                <th className="pay0-th-right w-[13%]">Cargo</th>
                <th className="pay0-th-right w-[13%]">Saldo</th>
              </tr>
            </thead>

            <tbody>
              {loadingAdvances ? (
                <tr>
                  <td colSpan={8} className="pay0-empty-cell">
                    Cargando adelantos...
                  </td>
                </tr>
              ) : advanceStatementRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="pay0-empty-cell">
                    No hay adelantos visibles para este cliente.
                  </td>
                </tr>
              ) : (
                advanceStatementRows.map((row, index) => {
                  return (
                    <tr key={row.id} className={index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}>
                      <td className="pay0-td-date w-[15%]">
                        {formatDate(row.createdAt)}
                      </td>

                      <td className="pay0-td text-white w-[46%]">
                        {row.movement}
                      </td>

                      <td className="pay0-td-money text-emerald-400 w-[13%]">
                        {row.abono > 0 ? formatMoney(row.abono) : "---"}
                      </td>

                      <td className="pay0-td-money text-rose-400 w-[13%]">
                        {row.cargo > 0 ? formatMoney(row.cargo) : "---"}
                      </td>

                      <td className="pay0-td-money text-white w-[13%]">
                        {formatMoney(row.saldo)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}





