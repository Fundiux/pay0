import type { Firestore } from "firebase-admin/firestore";
import type {
  MatClientHomeResult,
  MatHomeBalance,
  MatHomeItem,
  MatHomeMetric,
  MatHomeTone,
  MatUserHomeResult,
} from "./domain";
import { readCanonicalBalanceSummary, readCanonicalStatement } from "../ledger/service";
import { assertDispersionFundingOwner } from "../financing/dispersionFunding";

function cleanText(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toMoney(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(value: unknown) {
  return `$${toMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getMillis(value: any): number {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (value instanceof Date) return value.getTime();

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  return role === "operator" ? "operador" : role;
}

function getClientName(data: any, fallback: string) {
  return cleanText(
    data?.name ||
      data?.nombreComercial ||
      data?.nombre ||
      data?.razonSocial ||
      data?.clienteNombre,
    fallback,
  );
}

function getCompanyName(data: any) {
  return cleanText(data?.empresaNombre || data?.companyName || data?.empresa || data?.company || "", "---");
}

function getFolio(data: any, fallback: string) {
  return cleanText(
    data?.folio ||
      data?.referenceFolio ||
      data?.sourceFolio ||
      data?.solicitudFolio ||
      data?.dispersionFolio ||
      data?.pagoFolio,
    fallback,
  );
}

function emptyBalance(label: string): MatHomeBalance {
  return {
    availableBalance: 0,
    netBalance: 0,
    pendingAdvance: 0,
    label,
  };
}

async function readBalance(db: Firestore, holderType: "USER" | "CLIENT", holderId: string, rootId: string): Promise<MatHomeBalance> {
  const summary = await readCanonicalBalanceSummary(db, holderType, holderId);
  if (cleanText(summary.rootId) && cleanText(summary.rootId) !== rootId) throw new Error("MAT_LEDGER_SCOPE_DENIED");

  return {
    availableBalance: summary.availableBalance,
    netBalance: summary.netBalance,
    pendingAdvance: summary.pendingAdvance,
    label: holderType,
  };
}

function movementStatus(value: unknown) {
  const raw = cleanText(value || "MOVIMIENTO").toUpperCase();
  if (raw.includes("DISPERSION")) return "DISPERSION";
  if (raw.includes("ADELANTO")) return "ADELANTO";
  if (raw.includes("PAGO")) return "PAGO";
  if (raw.includes("COMISION")) return "COMISION";
  if (raw.includes("AJUSTE")) return "AJUSTE";
  if (raw.includes("DEVOLUCION")) return "DEVOLUCION";
  return raw.replace(/_/g, " ").slice(0, 18);
}

function movementTone(data: any): MatHomeTone {
  const type = cleanText(data?.movementType).toUpperCase();
  if (type.includes("DEVOLUCION")) return "ok";
  if (type.includes("INCIDENCIA")) return "danger";
  if (data?.direction === "IN") return "ok";
  if (data?.direction === "OUT") return "warn";
  return "muted";
}

function movementToHomeItem(doc: any, clientNames: Map<string, string>): MatHomeItem {
  const data = doc.data ? doc.data() : doc;
  const direction = cleanText(data?.direction).toUpperCase();
  const signed = direction === "IN" ? "+" : direction === "OUT" ? "-" : "";
  const type = cleanText(data?.movementType || "MOVIMIENTO").replace(/_/g, " ");
  const folio = getFolio(data, doc.id || "movimiento");
  const clientName = clientNames.get(cleanText(data?.clienteId));
  const caption = `${folio} · ${type}`;

  return {
    id: doc.id || folio,
    title: clientName || type,
    caption,
    amount: `${signed}${formatMoney(data?.amount || 0)}`,
    status: movementStatus(data?.movementType),
    tone: movementTone(data),
    createdAtMillis: getMillis(data?.createdAt),
  };
}

async function readRecentMovements(
  db: Firestore,
  holderType: "USER" | "CLIENT",
  holderId: string,
  rootId: string,
  limit = 8,
  clientNames = new Map<string, string>(),
): Promise<MatHomeItem[]> {
  const statement = await readCanonicalStatement(db, holderType, holderId, 80);
  if (cleanText(statement.summary.rootId) && cleanText(statement.summary.rootId) !== rootId) throw new Error("MAT_LEDGER_SCOPE_DENIED");

  return statement.rows
    .map((item) => ({
      ...item,
      createdAt: item.createdAtMillis ? new Date(item.createdAtMillis) : null,
    }))
    .slice(0, limit)
    .map((item) => movementToHomeItem(item, clientNames));
}

function isActiveDoc(data: any) {
  return Boolean(data) && data.active !== false && data.disabled !== true && !data.isDeleted && !data.deletedAt &&
    !["DELETED", "ELIMINADA", "INACTIVE", "INACTIVO"].includes(String(data.status || "").toUpperCase());
}

function canUserSeeClient(user: any, client: any) {
  const role = normalizeRole(user?.role || user?.supervisorRole);
  const uid = cleanText(user?.uid || user?.id);
  const rootId = cleanText(user?.rootId || uid);

  if (!isActiveDoc(client)) return false;
  if (cleanText(client?.rootId) && cleanText(client?.rootId) !== rootId) return false;
  if (role === "superadmin") return true;

  const fields = [
    client?.adminId,
    client?.managedByUserId,
    client?.ownerId,
    client?.createdBy,
    client?.createdByUid,
    client?.assignedUserId,
    client?.userId,
  ].map((value) => cleanText(value));

  return fields.includes(uid);
}

async function readVisibleClients(db: Firestore, user: any): Promise<MatHomeItem[]> {
  const rootId = cleanText(user?.rootId || user?.uid || user?.id);
  const query = db.collection("clients").where("rootId", "==", rootId).limit(250);
  const clients: any[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < 20; page += 1) {
    const snap = await (cursor ? query.startAfter(cursor) : query).get();
    clients.push(...snap.docs.map(doc => ({ ...(doc.data() as any), id: doc.id })));
    if (snap.docs.length < 250) break;
    cursor = snap.docs[snap.docs.length - 1];
    if (page === 19) throw new Error("MAT_CLIENT_SCOPE_LIMIT");
  }

  return clients
    .filter((client) => canUserSeeClient(user, client))
    .sort((a, b) => getClientName(a, a.id).localeCompare(getClientName(b, b.id), "es"))
    .map((client) => ({
      id: client.id,
      title: getClientName(client, client.id),
      caption: cleanText(client?.razonSocial || client?.nombre || client?.status || "", "Cliente visible"),
      amount: "",
      status: "CLIENTE",
      tone: "info",
      createdAtMillis: getMillis(client?.createdAt),
    }));
}

function solicitudToHomeItem(doc: any): MatHomeItem {
  const data = doc.data ? doc.data() : doc;
  const folio = getFolio(data, doc.id || "solicitud");
  const amount = toMoney(data?.monto ?? data?.amount ?? data?.total ?? 0);

  return {
    id: doc.id || folio,
    title: cleanText(data?.clienteNombre || data?.clientName, getClientName(data, "Cliente")),
    caption: `${folio} · ${getCompanyName(data)}`,
    amount: formatMoney(amount),
    status: cleanText(data?.status || "ACTIVA").toUpperCase(),
    tone: "info",
    createdAtMillis: getMillis(data?.createdAt),
  };
}

async function readRecentSolicitudesForClient(db: Firestore, clienteId: string, rootId: string, limit = 5): Promise<MatHomeItem[]> {
  const snap = await db.collection("solicitudes").where("clienteId", "==", clienteId).limit(60).get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((item) => item.rootId === rootId && !item.isDeleted && !item.deletedAt)
    .sort((a, b) => getMillis((b as any).createdAt) - getMillis((a as any).createdAt))
    .slice(0, limit)
    .map((item) => solicitudToHomeItem(item));
}

async function readRecentSolicitudesForUser(
  db: Firestore,
  user: any,
  visibleClientIds: Set<string>,
  limit = 5,
): Promise<MatHomeItem[]> {
  const rootId = cleanText(user?.rootId || user?.uid || user?.id);
  const snap = await db.collection("solicitudes").where("rootId", "==", rootId).limit(80).get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((item) => {
      const clienteId = cleanText((item as any).clienteId || (item as any).clientId);
      return visibleClientIds.has(clienteId);
    })
    .sort((a, b) => getMillis((b as any).createdAt) - getMillis((a as any).createdAt))
    .slice(0, limit)
    .map((item) => solicitudToHomeItem(item));
}

function dispersionToHomeItem(doc: any): MatHomeItem {
  const data = doc.data ? doc.data() : doc;
  const folio = getFolio(data, doc.id || "dispersion");
  const amount = toMoney(data?.amount ?? data?.monto ?? 0);

  return {
    id: doc.id || folio,
    title: data?.fundingSource?.holderType === "USER" ? "Retiro de utilidad" : cleanText(data?.beneficiaryNombre || data?.beneficiarioNombre || "", "Beneficiario"),
    caption: `${folio}${cleanText(data?.clienteNombre) ? ` · ${cleanText(data?.clienteNombre)}` : ""}`,
    amount: formatMoney(amount),
    status: cleanText(data?.status || "PROCESO").toUpperCase(),
    tone: cleanText(data?.incidenceStatus || data?.incidenciaStatus) ? "danger" : "warn",
    createdAtMillis: getMillis(data?.createdAt),
  };
}

async function readRecentDispersionsForClient(db: Firestore, clienteId: string, rootId: string, limit = 5): Promise<MatHomeItem[]> {
  const byClienteId = await db.collection("clientDispersions").where("clienteId", "==", clienteId).limit(60).get();
  const byClientId = await db.collection("clientDispersions").where("clientId", "==", clienteId).limit(60).get();

  const byId = new Map<string, any>();
  [...byClienteId.docs, ...byClientId.docs].forEach((doc) => {
    byId.set(doc.id, { id: doc.id, ...(doc.data() as any) });
  });

  return Array.from(byId.values())
    .filter(item => item.rootId === rootId && !item.isDeleted && !item.deletedAt && item.fundingSource?.holderType !== "USER")
    .sort((a, b) => getMillis((b as any).createdAt) - getMillis((a as any).createdAt))
    .slice(0, limit)
    .map((item) => dispersionToHomeItem(item));
}

async function readRecentDispersionsForUser(
  db: Firestore,
  user: any,
  visibleClientIds: Set<string>,
  limit = 5,
): Promise<MatHomeItem[]> {
  const rootId = cleanText(user?.rootId || user?.uid || user?.id);
  const snap = await db.collection("clientDispersions").where("rootId", "==", rootId).limit(100).get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((item) => {
      try {
        assertDispersionFundingOwner({ rootId, uid: cleanText(user.uid || user.id), role: cleanText(user.role).toLowerCase(), dispersion: item });
      } catch { return false; }
      if ((item as any).fundingSource?.holderType === "USER") return true;
      const clienteId = cleanText((item as any).clienteId || (item as any).clientId);
      return visibleClientIds.has(clienteId);
    })
    .sort((a, b) => getMillis((b as any).createdAt) - getMillis((a as any).createdAt))
    .slice(0, limit)
    .map((item) => dispersionToHomeItem(item));
}

export async function resolveInternalUserByTelegramId(db: Firestore, telegramUserId: string) {
  const cleanTelegramUserId = cleanText(telegramUserId);

  if (!cleanTelegramUserId) {
    return null;
  }

  const telegramSnap = await db.collection("telegramUsers").doc(cleanTelegramUserId).get();

  if (telegramSnap.exists) {
    const telegramData = telegramSnap.data() || {};

    if (!isActiveDoc(telegramData)) return null;
    if (telegramData.active !== false) {
      const uid = cleanText((telegramData as any).uid || (telegramData as any).userId || "");

      if (uid) {
        const userSnap = await db.collection("users").doc(uid).get();

        if (userSnap.exists) {
          return {
            ...(userSnap.data() as any),
            id: userSnap.id,
            uid: userSnap.id,
            telegramUserId: cleanTelegramUserId,
            telegramUsername: cleanText((telegramData as any).telegramUsername || (telegramData as any).username || ""),
          };
        }
      }
    }
    return null;
  }

  const fallbackSnap = await db.collection("users").where("telegramUserId", "==", cleanTelegramUserId).limit(1).get();

  if (fallbackSnap.empty) return null;

  const doc = fallbackSnap.docs[0];
  return {
    ...(doc.data() as any),
    id: doc.id,
    uid: doc.id,
  };
}

export async function resolveClientLinkByTelegramId(db: Firestore, telegramUserId: string) {
  const cleanTelegramUserId = cleanText(telegramUserId);

  if (!cleanTelegramUserId) {
    return null;
  }

  const directSnap = await db.collection("clientTelegramUsers").doc(cleanTelegramUserId).get();

  if (directSnap.exists) {
    const data = {
      id: directSnap.id,
      ...(directSnap.data() as any),
    };

    if (!isActiveDoc(data)) return null;
    if (cleanText(data.clientId || data.clienteId)) {
      return data;
    }
    return null;
  }

  const fallbackSnap = await db
    .collection("clientTelegramUsers")
    .where("telegramUserId", "==", cleanTelegramUserId)
    .limit(10)
    .get();

  const active = fallbackSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .find((item) => isActiveDoc(item) && cleanText(item.clientId || item.clienteId));

  return active || null;
}

export async function buildMatUserHome({
  db,
  telegramUserId,
  displayName,
  username,
}: {
  db: Firestore;
  telegramUserId: string;
  displayName: string;
  username: string;
}): Promise<MatUserHomeResult> {
  const user = await resolveInternalUserByTelegramId(db, telegramUserId);

  if (!user || !isActiveDoc(user)) {
    return {
      ok: true,
      status: "UNLINKED",
      scope: "USERS",
      linked: false,
      telegramUserId,
      displayName,
      username,
      message: "Usuario Telegram no vinculado a PAY0.",
      balance: emptyBalance("USER"),
      metrics: [
        { label: "Clientes", value: "0" },
        { label: "Solicitudes", value: "0" },
        { label: "Dispersiones", value: "0" },
        { label: "Alertas", value: "0" },
      ],
      movements: [],
      clients: [],
      solicitudes: [],
      dispersiones: [],
    };
  }

  const balance = await readBalance(db, "USER", user.id, cleanText(user.rootId || user.id));
  const visibleClients = await readVisibleClients(db, user);
  const clientNames = new Map(visibleClients.map((client) => [client.id, client.title]));
  const movements = await readRecentMovements(db, "USER", user.id, cleanText(user.rootId || user.id), 6, clientNames);
  const visibleClientIds = new Set(visibleClients.map((client) => client.id));
  const clients = visibleClients;
  const solicitudes = await readRecentSolicitudesForUser(db, user, visibleClientIds, 5);
  const dispersiones = await readRecentDispersionsForUser(db, user, visibleClientIds, 5);

  const metrics: MatHomeMetric[] = [
    { label: "Clientes", value: String(clients.length) },
    { label: "Solicitudes", value: String(solicitudes.length) },
    { label: "Dispersiones", value: String(dispersiones.length) },
    { label: "Alertas", value: String(dispersiones.filter((item) => item.tone === "danger").length) },
  ];

  return {
    ok: true,
    status: "OK",
    scope: "USERS",
    linked: true,
    telegramUserId,
    displayName: cleanText(user?.nombreUsuario || user?.displayName || displayName, displayName),
    username,
    message: "Home MAT usuarios listo.",
    pay0UserId: user.id,
    role: normalizeRole(user?.role || user?.supervisorRole),
    rootId: cleanText(user?.rootId || user.id),
    balance,
    metrics,
    movements,
    clients,
    solicitudes,
    dispersiones,
  };
}

export async function buildMatClientHome({
  db,
  telegramUserId,
  displayName,
  username,
}: {
  db: Firestore;
  telegramUserId: string;
  displayName: string;
  username: string;
}): Promise<MatClientHomeResult> {
  const link = await resolveClientLinkByTelegramId(db, telegramUserId);

  if (!link) {
    return {
      ok: true,
      status: "UNLINKED",
      scope: "CLIENTS",
      linked: false,
      telegramUserId,
      displayName,
      username,
      message: "Cliente Telegram no vinculado a PAY0.",
      balance: emptyBalance("CLIENT"),
      metrics: [
        { label: "Disponible", value: "$0.00" },
        { label: "Adelanto", value: "$0.00" },
        { label: "Neto", value: "$0.00" },
        { label: "Docs", value: "0" },
      ],
      movements: [],
      solicitudes: [],
      dispersiones: [],
    };
  }

  const clienteId = cleanText(link?.clienteId || link?.clientId);
  const clientSnap = await db.collection("clients").doc(clienteId).get();
  const client = clientSnap.exists ? { id: clientSnap.id, ...(clientSnap.data() as any) } : null;

  if (!isActiveDoc(client) || !cleanText(client?.rootId) ||
      (cleanText(link.rootId) && cleanText(link.rootId) !== cleanText(client?.rootId))) {
    return {
      ok: true,
      status: "UNLINKED",
      scope: "CLIENTS",
      linked: false,
      telegramUserId,
      displayName,
      username,
      message: "Cliente PAY0 inactivo o no disponible.",
      clienteId,
      clienteNombre: getClientName(client, clienteId),
      balance: emptyBalance("CLIENT"),
      metrics: [],
      movements: [],
      solicitudes: [],
      dispersiones: [],
    };
  }

  const balance = await readBalance(db, "CLIENT", clienteId, cleanText(client?.rootId));
  const movements = await readRecentMovements(db, "CLIENT", clienteId, cleanText(client?.rootId), 6, new Map([[clienteId, getClientName(client, clienteId)]]));
  const solicitudes = await readRecentSolicitudesForClient(db, clienteId, cleanText(client?.rootId), 5);
  const dispersiones = await readRecentDispersionsForClient(db, clienteId, cleanText(client?.rootId), 5);

  const metrics: MatHomeMetric[] = [
    { label: "Disponible", value: formatMoney(balance.availableBalance) },
    { label: "Adelanto", value: formatMoney(balance.pendingAdvance) },
    { label: "Neto", value: formatMoney(balance.netBalance) },
    { label: "Docs", value: "0" },
  ];

  return {
    ok: true,
    status: "OK",
    scope: "CLIENTS",
    linked: true,
    telegramUserId,
    displayName,
    username,
    message: "Home MAT clientes listo.",
    clienteId,
    clienteNombre: getClientName(client, clienteId),
    balance,
    metrics,
    movements,
    solicitudes,
    dispersiones,
  };
}
