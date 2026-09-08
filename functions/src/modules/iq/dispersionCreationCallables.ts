import * as admin from "firebase-admin";
import * as crypto from "crypto";
import {
  HttpsError,
  onCall,
} from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { DEFAULT_IQ_ERP_URL } from "./config";
import { assertIqAuthorized } from "./authorization";
import { loadEnabledIqAutomationRoots } from "./automationRuntime";
// H4_D85_A10_A50_A6_HTTP_DIRECT_DISPERSION
import {
  runIqCreateDispersionHttpH4D85A50,
  type IqDispersionCreateItemH4D82A4A1,
  type IqDispersionCreateResultH4D82A4A1,
} from "./dispersionHttpCreateCore";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue =
  admin.firestore.FieldValue;
const IQ_CREDENTIALS_KEY =
  defineSecret("IQ_CREDENTIALS_KEY");

const VERSION = "H4_D82_A4_A1";
const LOCK_WINDOW_MS =
  10 * 60 * 1000;

type AnyDoc = Record<string, any>;

type AuthContext = {
  uid: string;
  role: string;
  rootId: string;
  username: string;
};

type IqAccess = {
  profileId: string;
  profileAlias: string;
  associatedName: string;
  username: string;
  password: string;
  erpUrl: string;
};

type LegReservation = {
  reused: boolean;
  lockToken: string;
  attemptCount: number;
  currentStatus: string;
  currentIqId: string | null;
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function upper(value: unknown): string {
  return clean(value).toUpperCase();
}

function record(
  value: unknown,
): AnyDoc {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as AnyDoc
    : {};
}

function money(value: unknown): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(
    (number + Number.EPSILON) * 100,
  ) / 100;
}

function normalizeErpUrl(
  value: string,
): string {
  const raw =
    clean(value) ||
    DEFAULT_IQ_ERP_URL;

  try {
    const url = new URL(raw);

    return `${url.protocol}//${url.host}`;
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ tiene una URL ERP invalida.",
    );
  }
}

function getEncryptionKey(): Buffer {
  const raw =
    IQ_CREDENTIALS_KEY.value();

  if (
    !raw ||
    raw.trim().length < 16
  ) {
    throw new HttpsError(
      "failed-precondition",
      "IQ_CREDENTIALS_KEY no esta configurada.",
    );
  }

  const trimmed = raw.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(
      trimmed,
      "hex",
    );
  }

  try {
    const decoded = Buffer.from(
      trimmed,
      "base64",
    );

    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fallback SHA-256 below.
  }

  return crypto
    .createHash("sha256")
    .update(trimmed)
    .digest();
}

function decryptSecret(
  data: AnyDoc,
): string {
  const ciphertext = clean(
    data.passwordCiphertext,
  );
  const iv = clean(
    data.passwordIv,
  );
  const tag = clean(
    data.passwordTag,
  );

  if (
    !ciphertext ||
    !iv ||
    !tag
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene contrasena configurada.",
    );
  }

  const decipher =
    crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(iv, "base64"),
    );

  decipher.setAuthTag(
    Buffer.from(tag, "base64"),
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(
        ciphertext,
        "base64",
      ),
    ),
    decipher.final(),
  ]).toString("utf8");
}

function timestampMillis(
  value: unknown,
): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in
      (value as AnyDoc) &&
    typeof (value as AnyDoc)
      .toMillis === "function"
  ) {
    return Number(
      (value as AnyDoc).toMillis(),
    );
  }

  return 0;
}

async function requireAuth(
  request: {
    auth?: {
      uid?: string;
      token?: AnyDoc;
    } | null;
  },
): Promise<AuthContext> {
  await assertIqAuthorized(
    request,
    {
      allowedRoles: [
        "superadmin",
        "admin",
        "operador",
      ],
    },
  );

  const uid = clean(
    request.auth?.uid,
  );

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Sesion requerida.",
    );
  }

  const userSnap = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!userSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "Usuario PAY0 no encontrado.",
    );
  }

  const user = record(
    userSnap.data(),
  );
  const role = clean(
    request.auth?.token?.role ??
      user.role,
  ).toLowerCase();
  const rootId =
    clean(
      request.auth?.token?.rootId ??
        user.rootId ??
        uid,
    ) || uid;

  return {
    uid,
    role,
    rootId,
    username:
      clean(
        user.username ??
          user.name ??
          user.nombre,
      ) || uid,
  };
}

// H4_D87_A58_A48_DISPERSION_CREATE_SCHEDULER
const DISPERSION_CREATE_SCHEDULER_MAX_PER_ROOT = 15;
// H4_D87_A58_A51_PERSISTENT_SCAN_CURSOR
const DISPERSION_CREATE_SCHEDULER_SCAN_PAGE_SIZE = 50;

async function buildDispersionSchedulerAuth(
  principal: AnyDoc,
  expectedRootId: string,
): Promise<AuthContext> {
  const uid = clean(principal.createdBy);

  if (!uid) {
    throw new HttpsError(
      "failed-precondition",
      "La dispersion no conserva usuario creador.",
    );
  }

  const userSnap = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!userSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "El usuario creador de la dispersion ya no existe.",
    );
  }

  const user = record(userSnap.data());
  const role = clean(user.role).toLowerCase();
  const rootId =
    clean(user.rootId ?? uid) || uid;

  const inactive =
    user.active === false ||
    user.isActive === false ||
    user.deleted === true ||
    user.isDeleted === true ||
    Boolean(user.deletedAt);

  if (
    inactive ||
    !["superadmin", "admin", "operador"].includes(role)
  ) {
    throw new HttpsError(
      "permission-denied",
      "El usuario creador esta inactivo o ya no tiene un rol permitido.",
    );
  }

  const principalRootId =
    clean(principal.rootId);

  if (
    rootId !== expectedRootId ||
    (
      principalRootId &&
      principalRootId !== expectedRootId
    )
  ) {
    throw new HttpsError(
      "permission-denied",
      "El usuario creador ya no pertenece al root de la dispersion.",
    );
  }

  return {
    uid,
    role,
    rootId,
    username:
      clean(
        user.username ??
          user.name ??
          user.nombre ??
          user.displayName ??
          user.email,
      ) || uid,
  };
}

function isDispersionCreateSchedulerCandidate(
  principal: AnyDoc,
  rootId: string,
): boolean {
  if (clean(principal.rootId) !== rootId) {
    return false;
  }

  if (
    clean(principal.forwardOnlyVersion) !==
      "H4_D82_A3_A2_FORWARD_ONLY_V1" ||
    upper(principal.reservationStatus) !==
      "SALDO_RESERVADO" ||
    principal.reservationReleased === true ||
    isTerminalPrincipal(principal)
  ) {
    return false;
  }

  const operationTypeKey = upper(
    principal.operationTypeKey ??
      principal.dispersionType ??
      principal.tipo,
  );

  if (
    !["TRANSFERENCIA", "TDC"].includes(
      operationTypeKey,
    )
  ) {
    return false;
  }

  const iqStatus = upper(
    principal.iqGenerationStatus,
  );

  if (
    [
      "IQ_GENERADA",
      "IQ_REQUIERE_REVISION",
    ].includes(iqStatus)
  ) {
    return false;
  }

  return Boolean(clean(principal.createdBy));
}

async function verifyDespachoAccess(
  auth: AuthContext,
  despachoId: string,
) {
  const despachoSnap = await db
    .collection("despachos")
    .doc(despachoId)
    .get();

  if (!despachoSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "El despacho del tramo no existe.",
    );
  }

  const despacho = record(
    despachoSnap.data(),
  );

  if (
    clean(despacho.rootId) &&
    clean(despacho.rootId) !==
      auth.rootId
  ) {
    throw new HttpsError(
      "permission-denied",
      "El despacho esta fuera de scope.",
    );
  }

  if (
    despacho.active === false ||
    despacho.activo === false
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El despacho esta inactivo.",
    );
  }

  if (auth.role !== "superadmin") {
    const accessSnap = await db
      .collection(
        "userDespachoAccess",
      )
      .doc(auth.uid)
      .collection("despachos")
      .doc(despachoId)
      .get();

    if (
      !accessSnap.exists ||
      record(
        accessSnap.data(),
      ).active !== true
    ) {
      throw new HttpsError(
        "permission-denied",
        "El usuario no tiene acceso activo al despacho del tramo.",
      );
    }
  }

  const marker = upper(
    [
      despacho.integrationType,
      despacho.integracion,
      despacho.channel,
      despacho.canal,
      despacho.provider,
      despacho.proveedor,
      despacho.dispersionChannel,
      despacho.tipoIntegracion,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const dispatchProfileId =
    clean(
      despacho.iqCredentialProfileId ??
        despacho.iqProfileId ??
        despacho.credentialProfileId,
    );
  // H4-D85 A10-A48-A4:
  // despachoId conserva la procedencia contable y puede aportar
  // un perfil IQ especifico. El canal de ejecucion NO se deduce
  // de flags del catalogo; se hereda del saldo reservado.

  return {
    despacho,
    dispatchProfileId,
  };
}

async function getIqDispersionDespachoDiagnostic(
  auth: AuthContext,
  despachoId: string,
  sourceChannel: string,
) {
  const despachoSnap = await db
    .collection("despachos")
    .doc(despachoId)
    .get();

  if (!despachoSnap.exists) {
    return {
      despachoNombre:
        "DESPACHO NO ENCONTRADO",
      exists: false,
      active: null,
      rootMatch: null,
      iqEnabled: false,
      iqEnabledFlag: false,
      usesIq: false,
      iqDispersionEnabled: false,
      integrationMarker: "",
      credentialProfileConfigured:
        false,
    };
  }

  const despacho = record(
    despachoSnap.data(),
  );

  const integrationMarker = upper(
    [
      despacho.integrationType,
      despacho.integracion,
      despacho.channel,
      despacho.canal,
      despacho.provider,
      despacho.proveedor,
      despacho.dispersionChannel,
      despacho.tipoIntegracion,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const profileId = clean(
    despacho.iqCredentialProfileId ??
      despacho.iqProfileId ??
      despacho.credentialProfileId,
  );

  const iqEnabled =
    upper(sourceChannel) === "IQ";

  return {
    despachoNombre:
      clean(
        despacho.nombre ??
          despacho.name ??
          despacho.alias,
      ) || "DESPACHO",
    exists: true,
    active:
      despacho.active !== false &&
      despacho.activo !== false,
    rootMatch:
      !clean(despacho.rootId) ||
      clean(despacho.rootId) ===
        auth.rootId,
    iqEnabled,
    iqEnabledFlag:
      despacho.iqEnabled === true,
    usesIq:
      despacho.usesIq === true,
    iqDispersionEnabled:
      despacho.iqDispersionEnabled ===
      true,
    integrationMarker,
    credentialProfileConfigured:
      Boolean(profileId),
  };
}

async function loadIqAccess(
  auth: AuthContext,
  despachoId: string,
  sourceChannel: string,
): Promise<IqAccess> {
  const canonicalSourceChannel =
    upper(sourceChannel);

  if (canonicalSourceChannel !== "IQ") {
    throw new HttpsError(
      "failed-precondition",
      "El tramo no proviene de saldo con canal IQ.",
    );
  }
  const {
    despacho,
    dispatchProfileId,
  } = await verifyDespachoAccess(
    auth,
    despachoId,
  );
  const accessSnap = await db
    .collection("iqUserAccess")
    .doc(auth.uid)
    .get();
  const access = record(
    accessSnap.data(),
  );

  if (
    !accessSnap.exists ||
    access.active !== true ||
    access.iqEnabled !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "El usuario no tiene acceso IQ activo.",
    );
  }

  if (
    clean(access.rootId) &&
    clean(access.rootId) !==
      auth.rootId
  ) {
    throw new HttpsError(
      "permission-denied",
      "El acceso IQ esta fuera de scope.",
    );
  }

  const allowedModules =
    record(access.allowedModules);

  if (
    auth.role !== "superadmin" &&
    allowedModules.dispersiones !==
      true &&
    allowedModules.dispersions !==
      true &&
    allowedModules.walletDispersiones !==
      true &&
    allowedModules.wallet !== true
  ) {
    throw new HttpsError(
      "permission-denied",
      "El usuario no tiene habilitado el modulo IQ Dispersiones.",
    );
  }

  const profileId =
    dispatchProfileId ||
    clean(
      access.iqCredentialProfileId,
    );

  if (!profileId) {
    throw new HttpsError(
      "failed-precondition",
      "El despacho o usuario no tiene cuenta IQ asignada.",
    );
  }

  const profileSnap = await db
    .collection(
      "iqCredentialProfiles",
    )
    .doc(profileId)
    .get();

  if (!profileSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ asignada no existe.",
    );
  }

  const profile = record(
    profileSnap.data(),
  );

  if (
    clean(profile.rootId) !==
    auth.rootId
  ) {
    throw new HttpsError(
      "permission-denied",
      "La cuenta IQ esta fuera de scope.",
    );
  }

  if (
    profile.active !== true ||
    profile.hasPassword !== true
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ esta inactiva o incompleta.",
    );
  }

  const username = clean(
    profile.username,
  );

  if (!username) {
    throw new HttpsError(
      "failed-precondition",
      "La cuenta IQ no tiene usuario configurado.",
    );
  }

  return {
    profileId,
    profileAlias:
      clean(profile.alias) ||
      profileId,
    associatedName:
      clean(
        despacho.iqAssociatedName ??
          despacho.associatedName ??
          access.associatedName,
      ) || username,
    username,
    password:
      decryptSecret(profile),
    erpUrl: normalizeErpUrl(
      clean(profile.erpUrl),
    ),
  };
}

function isTerminalPrincipal(
  principal: AnyDoc,
) {
  return [
    principal.status,
    principal.estado,
    principal.incidentStatus,
    principal.reservationStatus,
  ]
    .map(upper)
    .some((value) =>
      [
        "RECHAZADA",
        "RECHAZADO",
        "CANCELADA",
        "CANCELADO",
        "CANCELACION_APLICADA",
        "DEVOLUCION_APLICADA",
        "REINTEGRADA",
        "REINTEGRADO",
        "RESERVA_LIBERADA",
      ].includes(value),
    );
}

function destinationFromMethod(
  method: AnyDoc,
  operationTypeKey: string,
) {
  const kind = upper(
    method.destinationKind ??
      method.tipoDestino ??
      method.tipo,
  );

  const clabe = clean(
    method.clabe ??
      method.CLABE ??
      method.bankClabe,
  ).replace(/\D/g, "");

  const card = clean(
    method.cardNumber ??
      method.numeroTarjeta ??
      method.tarjeta,
  ).replace(/\D/g, "");

  const validClabe =
    clabe.length === 18;

  const validCard =
    card.length >= 15 &&
    card.length <= 19;

  const cardKinds = [
    "TARJETA",
    "CARD",
    "TDC",
    "DEBITO",
    "DEBIT",
    "CREDITO",
    "CREDIT",
  ];

  const prefersCard =
    cardKinds.includes(kind);

  const prefersClabe =
    kind === "CLABE";

  if (
    operationTypeKey ===
    "TRANSFERENCIA"
  ) {
    // El tipo de operacion IQ puede ser TRANSFERENCIA,
    // pero la cuenta destino del beneficiario puede ser
    // una CLABE o una tarjeta bancaria.
    if (
      prefersCard &&
      validCard
    ) {
      return {
        kind: "TARJETA",
        last4: card.slice(-4),
      };
    }

    if (
      prefersClabe &&
      validClabe
    ) {
      return {
        kind: "CLABE",
        last4: clabe.slice(-4),
      };
    }

    if (
      validClabe &&
      !validCard
    ) {
      return {
        kind: "CLABE",
        last4: clabe.slice(-4),
      };
    }

    if (
      validCard &&
      !validClabe
    ) {
      return {
        kind: "TARJETA",
        last4: card.slice(-4),
      };
    }

    if (validClabe) {
      return {
        kind: "CLABE",
        last4: clabe.slice(-4),
      };
    }

    if (validCard) {
      return {
        kind: "TARJETA",
        last4: card.slice(-4),
      };
    }

    throw new HttpsError(
      "failed-precondition",
      "La dispersion por transferencia requiere una CLABE valida de 18 digitos o una tarjeta valida de 15 a 19 digitos.",
    );
  }

  if (
    operationTypeKey === "TDC"
  ) {
    if (!validCard) {
      throw new HttpsError(
        "failed-precondition",
        "La dispersion TDC requiere un numero de tarjeta valido.",
      );
    }

    return {
      kind: "TARJETA",
      last4: card.slice(-4),
    };
  }

  throw new HttpsError(
    "failed-precondition",
    "H4-D82-A4-A1 solo genera Transferencia y TDC. Efectivo se habilitara al mapear Caja y Comentarios.",
  );
}
function pricingPercentage(
  principal: AnyDoc,
  operationTypeKey: string,
) {
  if (
    operationTypeKey ===
      "TRANSFERENCIA" ||
    operationTypeKey === "TDC"
  ) {
    const candidates = [
      principal.iqPercentage,
      principal.despachoCostRate,
      principal.dispatchCostRate,
      principal.pricing?.despachoRate,
      principal.pricing?.dispatchRate,
      principal.pricingSnapshot
        ?.despachoRate,
      principal.pricingSnapshot
        ?.dispatchRate,
    ];

    for (const value of candidates) {
      const number = Number(value);

      if (
        Number.isFinite(number) &&
        number >= 0
      ) {
        return String(
          Math.round(
            (number +
              Number.EPSILON) *
              10000,
          ) / 10000,
        );
      }
    }

    return "0";
  }

  return "0";
}

function fingerprintForLeg(
  input: {
    rootId: string;
    principalId: string;
    legId: string;
    despachoId: string;
    operationTypeKey: string;
    amount: number;
    destinationLast4: string;
    currency: string;
  },
) {
  return crypto
    .createHash("sha256")
    .update(
      [
        VERSION,
        input.rootId,
        input.principalId,
        input.legId,
        input.despachoId,
        input.operationTypeKey,
        input.amount.toFixed(2),
        input.destinationLast4,
        input.currency,
      ].join("|"),
    )
    .digest("hex");
}

async function reserveLeg(
  legRef:
    admin.firestore.DocumentReference,
  fingerprint: string,
  auth: AuthContext,
  profileId: string,
): Promise<LegReservation> {
  return db.runTransaction(
    async (tx) => {
      const snap =
        await tx.get(legRef);

      if (!snap.exists) {
        throw new HttpsError(
          "not-found",
          "El tramo ya no existe.",
        );
      }

      const leg = record(
        snap.data(),
      );
      const status = upper(
        leg.iqCreationStatus,
      );
      const iqId =
        clean(
          leg.iqDispersionId ??
            leg.iqDispersionFolio,
        ) || null;

      if (
        [
          "CREATED",
          "CREATED_PENDING_FOLIO",
        ].includes(status)
      ) {
        return {
          reused: true,
          lockToken: "",
          attemptCount: Number(
            leg.iqCreationAttemptCount ||
              1,
          ),
          currentStatus: status,
          currentIqId: iqId,
        };
      }

      if (
        leg.iqCreationRetryBlocked ===
          true ||
        status === "OUTCOME_UNKNOWN"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "El tramo ya fue enviado y su resultado es incierto. El reintento esta bloqueado para evitar duplicados.",
        );
      }

      if (
        upper(leg.status) !==
        "SALDO_RESERVADO" ||
        leg.reservationReleased ===
          true
      ) {
        throw new HttpsError(
          "failed-precondition",
          "El tramo no conserva una reserva activa.",
        );
      }

      const lockAt = timestampMillis(
        leg.iqCreationLockAt,
      );
      const lockActive =
        upper(
          leg.iqCreationStatus,
        ) === "PREPARING" &&
        lockAt > 0 &&
        Date.now() - lockAt <
          LOCK_WINDOW_MS;

      if (lockActive) {
        throw new HttpsError(
          "aborted",
          "Otro proceso esta generando este tramo en IQ.",
        );
      }

      const existingFingerprint =
        clean(
          leg.iqCreationFingerprint,
        );

      if (
        existingFingerprint &&
        existingFingerprint !==
          fingerprint &&
        Number(
          leg.iqCreationAttemptCount ||
            0,
        ) > 0
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Los datos del tramo cambiaron despues de un intento IQ. Requiere revision manual.",
        );
      }

      const lockToken =
        crypto.randomUUID();
      const attemptCount =
        Number(
          leg.iqCreationAttemptCount ||
            0,
        ) + 1;

      tx.set(
        legRef,
        {
          iqCreationVersion:
            VERSION,
          iqCreationStatus:
            "PREPARING",
          iqCreationFingerprint:
            fingerprint,
          iqCreationLockToken:
            lockToken,
          iqCreationLockAt:
            FieldValue.serverTimestamp(),
          iqCreationAttemptCount:
            attemptCount,
          iqCredentialProfileId:
            profileId,
          iqCreationRequestedBy:
            auth.uid,
          iqCreationRequestedByName:
            auth.username,
          iqCreationRequestedAt:
            FieldValue.serverTimestamp(),
          updatedAt:
            FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        reused: false,
        lockToken,
        attemptCount,
        currentStatus:
          "PREPARING",
        currentIqId: null,
      };
    },
  );
}

async function persistLegResult(
  legRef:
    admin.firestore.DocumentReference,
  reservation: LegReservation,
  result:
    IqDispersionCreateResultH4D82A4A1,
  access: IqAccess,
) {
  const status = result.outcome;
  const retryBlocked =
    status ===
      "CREATED_PENDING_FOLIO" ||
    status === "OUTCOME_UNKNOWN";
  const created =
    status === "CREATED" ||
    status ===
      "CREATED_PENDING_FOLIO";

  await db.runTransaction(
    async (tx) => {
      const snap =
        await tx.get(legRef);

      if (!snap.exists) {
        throw new HttpsError(
          "not-found",
          "El tramo desaparecio antes de guardar el resultado IQ.",
        );
      }

      const leg = record(
        snap.data(),
      );

      if (
        clean(
          leg.iqCreationLockToken,
        ) !== reservation.lockToken
      ) {
        throw new HttpsError(
          "aborted",
          "El lock del tramo cambio durante la ejecucion IQ.",
        );
      }

      tx.set(
        legRef,
        {
          iqCreationVersion:
            VERSION,
          iqCreationStatus: status,
          iqCreationOutcome:
            result.outcome,
          iqCreationSubmitClicked:
            result.submitClicked,
          iqCreationPostAccepted:
            result.postAccepted,
          iqCreationRetryBlocked:
            retryBlocked,
          iqDispersionId:
            result.iqId || null,
          iqDispersionFolio:
            result.iqId || null,
          iqCreationResultPath:
            result.resultPath ||
            null,
          iqCreationResponseMessage:
            result.responseMessage ||
            null,
          iqCreationWriteContract:
            result.writeContract ??
            null,
          iqCreationSelected:
            result.selected,
          iqCreationDestinationVerified:
            result.destinationVerified,
          iqCreationErrors:
            result.errors.slice(
              0,
              20,
            ),
          iqCredentialProfileId:
            access.profileId,
          iqCredentialProfileAlias:
            access.profileAlias ||
            null,
          iqCreationLastError:
            created
              ? null
              : result.responseMessage ||
                result.errors.join(
                  " | ",
                ) ||
                null,
          iqCreationFinishedAt:
            FieldValue.serverTimestamp(),
          iqCreationLockToken:
            FieldValue.delete(),
          iqCreationLockAt:
            FieldValue.delete(),
          updatedAt:
            FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    },
  );
}

async function aggregatePrincipal(
  principalRef:
    admin.firestore.DocumentReference,
  principalId: string,
) {
  const legsSnap = await db
    .collection(
      "clientDispersionLegs",
    )
    .where(
      "principalDispersionId",
      "==",
      principalId,
    )
    .get();

  const legs = legsSnap.docs
    .map((doc) =>
      record(doc.data()),
    )
    .filter(
      (leg) =>
        Boolean(
          clean(
            leg.iqCreationVersion,
          ),
        ),
    );
  // H4_D87_A58_A49_PRINCIPAL_IQ_FOLIOS
  // Los legs son la fuente de verdad del folio externo.
  // El principal conserva la proyeccion para UI,
  // filtros, exportacion y seguimiento.
  const iqFolios = Array.from(
    new Set(
      legs
        .map((leg) =>
          clean(
            leg.iqDispersionFolio ??
              leg.iqDispersionId,
          ),
        )
        .filter(Boolean),
    ),
  );

  const statuses = legs.map(
    (leg) =>
      upper(
        leg.iqCreationStatus,
      ),
  );
  const createdCount =
    statuses.filter((status) =>
      [
        "CREATED",
        "CREATED_PENDING_FOLIO",
      ].includes(status),
    ).length;
  const reviewCount =
    statuses.filter(
      (status) =>
        status ===
        "OUTCOME_UNKNOWN",
    ).length;
  const failedCount =
    statuses.filter(
      (status) =>
        status ===
        "FAILED_SAFE",
    ).length;

  let aggregateStatus =
    "IQ_PENDIENTE";

  if (
    legs.length > 0 &&
    createdCount === legs.length
  ) {
    aggregateStatus =
      "IQ_GENERADA";
  } else if (reviewCount > 0) {
    aggregateStatus =
      "IQ_REQUIERE_REVISION";
  } else if (createdCount > 0) {
    aggregateStatus =
      "IQ_PARCIAL";
  } else if (failedCount > 0) {
    aggregateStatus =
      "IQ_ERROR_SEGURO";
  }

  await principalRef.set(
    {
      iqGenerationVersion:
        VERSION,
      iqGenerationStatus:
        aggregateStatus,

      // H4_D87_A58_A49_PRINCIPAL_IQ_FOLIOS
      iqDispersionFolios:
        iqFolios,
      iqDispersionFolio:
        iqFolios.length === 1
          ? iqFolios[0]
          : null,
      iqDispersionId:
        iqFolios.length === 1
          ? iqFolios[0]
          : null,
      iqGenerationLegCount:
        legs.length,
      iqGenerationCreatedCount:
        createdCount,
      iqGenerationReviewCount:
        reviewCount,
      iqGenerationFailedCount:
        failedCount,
      iqGenerationUpdatedAt:
        FieldValue.serverTimestamp(),
      updatedAt:
        FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    aggregateStatus,
    legCount: legs.length,
    createdCount,
    reviewCount,
    failedCount,
  };
}


// H4_D87_A58_A18_DISPERSION_CREATE_CORE
export async function runCreateClientDispersionIqCore(input: {
  auth: AuthContext;
  dispersionId: string;
  previewOnly?: boolean;
}) {
  const auth = input.auth;
  const dispersionId = clean(input.dispersionId);
  const previewOnly = input.previewOnly === true;

  if (!dispersionId) {
    throw new HttpsError(
      "invalid-argument",
      "dispersionId requerido.",
    );
  }

  const principalRef = db
    .collection(
      "clientDispersions",
    )
    .doc(dispersionId);
  const principalSnap =
    await principalRef.get();
  
  if (!principalSnap.exists) {
    throw new HttpsError(
      "not-found",
      "La dispersion principal no existe.",
    );
  }
  
  const principal = record(
    principalSnap.data(),
  );
  
  if (
    clean(principal.rootId) !==
    auth.rootId
  ) {
    throw new HttpsError(
      "permission-denied",
      "La dispersion esta fuera de scope.",
    );
  }
  
  if (
    clean(
      principal.forwardOnlyVersion,
    ) !==
      "H4_D82_A3_A2_FORWARD_ONLY_V1" ||
    principal.reservationReleased ===
      true ||
    isTerminalPrincipal(principal)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La dispersion no tiene una reserva forward-only activa.",
    );
  }
  
  const operationTypeKey =
    upper(
      principal.operationTypeKey ??
        principal.dispersionType ??
        principal.tipo,
    );
  
  if (
    ![
      "TRANSFERENCIA",
      "TDC",
    ].includes(operationTypeKey)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Por ahora IQ solo genera Transferencia y TDC. Efectivo sigue bloqueado hasta mapear Caja y Comentarios.",
    );
  }
  
  const clientId = clean(
    principal.clientId ??
      principal.clienteId,
  );
  const beneficiaryId =
    clean(
      principal.beneficiaryId,
    );
  const methodId = clean(
    principal.methodId,
  );
  
  if (
    !clientId ||
    !beneficiaryId ||
    !methodId
  ) {
    throw new HttpsError(
      "failed-precondition",
      "La dispersion no conserva cliente, beneficiario y metodo canonicos.",
    );
  }
  
  const [
    clientSnap,
    beneficiarySnap,
    methodSnap,
    legsSnap,
  ] = await Promise.all([
    db.collection("clients")
      .doc(clientId)
      .get(),
    db.collection(
      "clientBeneficiaries",
    )
      .doc(beneficiaryId)
      .get(),
    db.collection(
      "clientBeneficiaryMethods",
    )
      .doc(methodId)
      .get(),
    db.collection(
      "clientDispersionLegs",
    )
      .where(
        "principalDispersionId",
        "==",
        dispersionId,
      )
      .get(),
  ]);
  
  if (
    !clientSnap.exists ||
    !beneficiarySnap.exists ||
    !methodSnap.exists
  ) {
    throw new HttpsError(
      "failed-precondition",
      "No se encontro el expediente completo de cliente, beneficiario y metodo.",
    );
  }
  
  const client = record(
    clientSnap.data(),
  );
  const beneficiary = record(
    beneficiarySnap.data(),
  );
  const method = record(
    methodSnap.data(),
  );
  const destination =
    destinationFromMethod(
      method,
      operationTypeKey,
    );
  
  const beneficiaryCandidates = [
    beneficiary.iqNombre,
    beneficiary.nombre,
    beneficiary.name,
    principal.beneficiaryNombre,
  ]
    .map(clean)
    .filter(
      (value, index, all) =>
        Boolean(value) &&
        all.indexOf(value) === index,
    );
  
  if (beneficiaryCandidates.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "El beneficiario no tiene nombre operativo para resolverlo en IQ.",
    );
  }
  
  const clientCandidates = [
    beneficiary.iqClientName,
    beneficiary.iqNombre,
    beneficiary.nombre,
    beneficiary.name,
    client.iqClientName,
    client.iqNombre,
    principal.beneficiaryNombre,
    principal.clientName,
    principal.clienteNombre,
    client.nombre,
    client.razonSocial,
    client.name,
  ]
    .map(clean)
    .filter(
      (value, index, all) =>
        Boolean(value) &&
        all.indexOf(value) ===
          index,
    );
  
  if (
    clientCandidates.length === 0
  ) {
    throw new HttpsError(
      "failed-precondition",
      "No existe un nombre para localizar al cliente/beneficiario en IQ.",
    );
  }
  
  const legDocs =
    legsSnap.docs
      .filter((doc) => {
        const leg = record(
          doc.data(),
        );
  
        return (
          upper(leg.status) ===
            "SALDO_RESERVADO" &&
          leg.reservationReleased !==
            true
        );
      })
      .sort(
        (a, b) =>
          Number(
            record(a.data())
              .legIndex || 0,
          ) -
          Number(
            record(b.data())
              .legIndex || 0,
          ),
      );
  
  if (legDocs.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "La dispersion no tiene tramos reservados disponibles.",
    );
  }
  
  if (previewOnly) {
    const previewLegs: AnyDoc[] = [];
    let previewEligibleCount = 0;
  
    for (const legDoc of legDocs) {
      const leg = record(
        legDoc.data(),
      );
      const despachoId = clean(
        leg.despachoId,
      );
  
      if (!despachoId) {
        previewLegs.push({
          legId: legDoc.id,
          legIndex: Number(
            leg.legIndex || 0,
          ),
          status: "SKIPPED",
          reason:
            "TRAMO_SIN_DESPACHO",
          diagnostic: {
            despachoNombre:
              clean(
                leg.despachoName,
              ) || "SIN DESPACHO",
            exists: null,
            active: null,
            rootMatch: null,
            iqEnabled: false,
            iqEnabledFlag: false,
            usesIq: false,
            iqDispersionEnabled:
              false,
            integrationMarker: "",
            credentialProfileConfigured:
              false,
          },
        });
        continue;
      }
  
      let access: IqAccess;
  
      try {
        access =
          await loadIqAccess(
            auth,
            despachoId,
            clean(leg.channel),
          );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);
  
        const diagnostic =
          await getIqDispersionDespachoDiagnostic(
            auth,
            despachoId,
            clean(leg.channel),
          );
  
        previewLegs.push({
          legId: legDoc.id,
          legIndex: Number(
            leg.legIndex || 0,
          ),
          despachoId,
          despachoName:
            clean(
              leg.despachoName,
            ) ||
            diagnostic.despachoNombre,
          status:
            /no esta configurado como canal IQ|no proviene de saldo con canal IQ/i.test(
              message,
            )
              ? "NON_IQ_CHANNEL"
              : "BLOCKED",
          reason: message,
          diagnostic,
        });
        continue;
      }
  
      const amount = money(
        leg.principalAmount,
      );
      const currency =
        upper(
          leg.currency ??
            principal.routingCurrency ??
            "MXN",
        ) || "MXN";
  
      if (amount <= 0) {
        throw new HttpsError(
          "failed-precondition",
          `El tramo ${legDoc.id} no tiene monto principal valido.`,
        );
      }
  
      const diagnostic =
        await getIqDispersionDespachoDiagnostic(
          auth,
          despachoId,
          clean(leg.channel),
        );
  
      previewEligibleCount += 1;
      previewLegs.push({
        legId: legDoc.id,
        legIndex: Number(
          leg.legIndex || 0,
        ),
        despachoId,
        despachoName:
          clean(
            leg.despachoName,
          ) || despachoId,
        status: "READY",
        amount,
        currency,
        operationTypeKey,
        percentageLabel:
          pricingPercentage(
            principal,
            operationTypeKey,
          ),
        destinationKind:
          destination.kind,
        destinationLast4:
          destination.last4,
        associatedName:
          access.associatedName,
        iqCredentialProfileId:
          access.profileId,
        iqCredentialProfileAlias:
          access.profileAlias,
        diagnostic,
      });
    }
  
    return {
      ok: true,
      data: {
        version: VERSION,
        previewOnly: true,
        dispersionId,
        folio:
          clean(
            principal.folio,
          ) || null,
        operationTypeKey,
        destination: {
          kind:
            destination.kind,
          last4:
            destination.last4,
        },
        eligibleCount:
          previewEligibleCount,
        legs: previewLegs,
      },
      message:
        previewEligibleCount > 0
          ? `Prevalidacion IQ lista: ${previewEligibleCount} tramo(s) elegible(s). No se envio informacion a IQ.`
          : "Prevalidacion IQ bloqueada: ningun tramo READY. No se envio informacion a IQ.",
    };
  }
  
  const results: AnyDoc[] = [];
  let eligibleCount = 0;
  
  for (const legDoc of legDocs) {
    const leg = record(
      legDoc.data(),
    );
    const despachoId = clean(
      leg.despachoId,
    );
  
    if (!despachoId) {
      results.push({
        legId: legDoc.id,
        status: "SKIPPED",
        reason:
          "TRAMO_SIN_DESPACHO",
      });
      continue;
    }
  
    let access: IqAccess;
  
    try {
      access =
        await loadIqAccess(
          auth,
          despachoId,
          clean(leg.channel),
        );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
  
      if (
        /no esta configurado como canal IQ|no proviene de saldo con canal IQ/i.test(
          message,
        )
      ) {
        results.push({
          legId: legDoc.id,
          despachoId,
          status:
            "NON_IQ_CHANNEL",
          reason: message,
        });
        continue;
      }
  
      throw error;
    }
  
    eligibleCount += 1;
  
    const amount = money(
      leg.principalAmount,
    );
    const currency =
      upper(
        leg.currency ??
          principal.routingCurrency ??
          "MXN",
      ) || "MXN";
  
    if (amount <= 0) {
      throw new HttpsError(
        "failed-precondition",
        `El tramo ${legDoc.id} no tiene monto principal valido.`,
      );
    }
  
    const item:
      IqDispersionCreateItemH4D82A4A1 =
      {
        associatedName:
          access.associatedName,
        clientCandidates,
        beneficiaryCandidates,
        clientIqId:
          clean(
            record(client.iqLink).clientId ??
              client.iqClientId,
          ) || null,
        currency,
        operationTypeKey:
          operationTypeKey as
            | "TRANSFERENCIA"
            | "TDC",
        percentageLabel:
          pricingPercentage(
            principal,
            operationTypeKey,
          ),
        amount,
        expectedDestinationLast4:
          destination.last4,
        reference:
          clean(
            principal.folio,
          ) || dispersionId,
      };
  
    const fingerprint =
      fingerprintForLeg({
        rootId: auth.rootId,
        principalId:
          dispersionId,
        legId: legDoc.id,
        despachoId,
        operationTypeKey,
        amount,
        destinationLast4:
          destination.last4,
        currency,
      });
  
    const reservation =
      await reserveLeg(
        legDoc.ref,
        fingerprint,
        auth,
        access.profileId,
      );
  
    if (reservation.reused) {
      results.push({
        legId: legDoc.id,
        despachoId,
        status:
          reservation.currentStatus,
        reused: true,
        iqId:
          reservation.currentIqId,
      });
      continue;
    }
  
    const iqResult =
      await runIqCreateDispersionHttpH4D85A50(
        {
          apiOrigin:
            clean(
              process.env.PAY0_IQ_API_ORIGIN,
            ) ||
            "https://iq-produccion-ccc570f75402.herokuapp.com",
          username:
            access.username,
          password:
            access.password,
          item,
        },
      );
  
    await persistLegResult(
      legDoc.ref,
      reservation,
      iqResult,
      access,
    );
  
    results.push({
      legId: legDoc.id,
      despachoId,
      status:
        iqResult.outcome,
      reused: false,
      iqId:
        iqResult.iqId,
      submitClicked:
        iqResult.submitClicked,
      postAccepted:
        iqResult.postAccepted,
      message:
        iqResult.responseMessage,
      writeContract:
        iqResult.writeContract ??
        null,
      errors:
        iqResult.errors,
    });
  
    if (
      iqResult.outcome ===
      "OUTCOME_UNKNOWN"
    ) {
      break;
    }
  }
  
  if (eligibleCount === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Ningun tramo reservado pertenece a un despacho configurado como IQ.",
    );
  }
  
  const aggregate =
    await aggregatePrincipal(
      principalRef,
      dispersionId,
    );
  
  await db
    .collection("activityLog")
    .doc()
    .set({
      rootId: auth.rootId,
      type:
        "DISPERSION_IQ_GENERACION",
      eventType:
        "DISPERSION_IQ_GENERACION",
      actorUid: auth.uid,
      actorUsername:
        auth.username,
      actorRole: auth.role,
      entityType:
        "DISPERSION",
      entityId: dispersionId,
      referenceId:
        dispersionId,
      amount: money(
        principal.amount,
      ),
      description:
        `Generacion IQ solicitada para dispersion ${clean(principal.folio) || dispersionId}. Estado: ${aggregate.aggregateStatus}.`,
      text:
        `Generacion IQ solicitada para dispersion ${clean(principal.folio) || dispersionId}. Estado: ${aggregate.aggregateStatus}.`,
      createdBy: auth.uid,
      createdAt:
        FieldValue.serverTimestamp(),
    });
  
  return {
    ok: true,
    data: {
      version: VERSION,
      dispersionId,
      folio:
        clean(
          principal.folio,
        ) || null,
      eligibleCount,
      results,
      ...aggregate,
    },
    message:
      aggregate.aggregateStatus ===
      "IQ_GENERADA"
        ? "Todos los tramos IQ quedaron generados."
        : aggregate.aggregateStatus ===
            "IQ_REQUIERE_REVISION"
          ? "IQ recibio al menos un tramo con resultado incierto. El reintento quedo bloqueado."
          : "La generacion IQ termino con tramos pendientes o fallidos.",
  };
}

export const createClientDispersionIq =
  onCall(
    {
      cors: true,
      timeoutSeconds: 540,
      memory: "2GiB",
      maxInstances: 1,
      concurrency: 1,
      secrets: [
        IQ_CREDENTIALS_KEY,
      ],
    },
    async (request) => {
      const auth =
        await requireAuth(request);
      const dispersionId = clean(
        request.data?.dispersionId,
      );
      const confirm =
        request.data?.confirm === true;
      const previewOnly =
        request.data?.previewOnly === true;

      if (!dispersionId) {
        throw new HttpsError(
          "invalid-argument",
          "dispersionId requerido.",
        );
      }

      if (
        !previewOnly &&
        !confirm
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Confirma explicitamente la generacion en IQ.",
        );
      }

      return await runCreateClientDispersionIqCore({
        auth,
        dispersionId,
        previewOnly,
      });
    },
  );

// H4_D87_A58_A48_DISPERSION_CREATE_SCHEDULER_RUNNER
export const processIqDispersionCreate =
  onSchedule(
    {
      schedule: "every 5 minutes",
      region: "us-central1",
      timeZone: "America/Mexico_City",
      timeoutSeconds: 540,
      memory: "2GiB",
      maxInstances: 1,
      concurrency: 1,
      secrets: [
        IQ_CREDENTIALS_KEY,
      ],
    },
    async () => {
      const enabledRoots =
        await loadEnabledIqAutomationRoots({
          process: "dispersionCreate",
          purpose: "CREATION",
        });

      if (enabledRoots.size === 0) {
        return;
      }

      for (
        const rootId of enabledRoots.keys()
      ) {
        const configRef = db
          .collection("iqIntegrationConfigs")
          .doc(rootId);

        const configSnap =
          await configRef.get();

        const configRaw = configSnap.exists
          ? record(configSnap.data())
          : {};
        const automationRuntime = record(
          configRaw.automationRuntime,
        );
        const dispersionRuntime = record(
          automationRuntime.dispersionCreate,
        );
        const storedCursorId = clean(
          dispersionRuntime.scanCursorId,
        );

        let cursorSnap:
          | admin.firestore.DocumentSnapshot
          | null = null;

        if (storedCursorId) {
          const candidateCursorSnap =
            await db
              .collection("clientDispersions")
              .doc(storedCursorId)
              .get();

          if (
            candidateCursorSnap.exists &&
            clean(
              record(
                candidateCursorSnap.data(),
              ).rootId,
            ) === rootId
          ) {
            cursorSnap = candidateCursorSnap;
          }
        }

        let query = db
          .collection("clientDispersions")
          .where("rootId", "==", rootId)
          .limit(
            DISPERSION_CREATE_SCHEDULER_SCAN_PAGE_SIZE,
          );

        if (cursorSnap) {
          query = query.startAfter(
            cursorSnap,
          );
        }

        let snap = await query.get();

        // Cursor stale/deleted or end reached:
        // restart from the first page in the same run.
        if (
          snap.empty &&
          storedCursorId
        ) {
          snap = await db
            .collection("clientDispersions")
            .where("rootId", "==", rootId)
            .limit(
              DISPERSION_CREATE_SCHEDULER_SCAN_PAGE_SIZE,
            )
            .get();
        }

        const candidates = snap.docs
          .map((doc) => ({
            id: doc.id,
            data: record(doc.data()),
          }))
          .filter((item) =>
            isDispersionCreateSchedulerCandidate(
              item.data,
              rootId,
            ),
          )
          .slice(
            0,
            DISPERSION_CREATE_SCHEDULER_MAX_PER_ROOT,
          );

        for (const candidate of candidates) {
          try {
            const auth =
              await buildDispersionSchedulerAuth(
                candidate.data,
                rootId,
              );

            await runCreateClientDispersionIqCore({
              auth,
              dispersionId: candidate.id,
              previewOnly: false,
            });
          } catch (error) {
            console.error(
              "H4_D87_A58_A48_DISPERSION_CREATE_ITEM_ERROR",
              {
                rootId,
                dispersionId: candidate.id,
                message:
                  error instanceof Error
                    ? error.message
                    : String(error),
              },
            );
          }
        }

        const lastDoc =
          snap.docs.length > 0
            ? snap.docs[
                snap.docs.length - 1
              ]
            : null;

        const reachedEnd =
          snap.docs.length <
          DISPERSION_CREATE_SCHEDULER_SCAN_PAGE_SIZE;

        await configRef.set(
          {
            automationRuntime: {
              dispersionCreate: {
                scanCursorId:
                  reachedEnd
                    ? null
                    : lastDoc?.id ?? null,
                scanPageSize:
                  DISPERSION_CREATE_SCHEDULER_SCAN_PAGE_SIZE,
                lastScanCount:
                  snap.docs.length,
                lastCandidateCount:
                  candidates.length,
                scanCursorUpdatedAt:
                  FieldValue.serverTimestamp(),
              },
            },
          },
          { merge: true },
        );
      }
    },
  );

