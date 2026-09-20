import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { db, getMyUser, requireAuth } from "../sharedCallables/helpers";
import {
  allocatePayment,
  assertMinor,
  AssetKind,
  AssetMovement,
  AssetSource,
  InterestModel,
  interestForPeriod,
  MovementType,
  projectAsset,
  remainingLinkableAmount,
} from "./domain";
import { logActivityBatch, logActivityTx } from "../../utils/logActivity";

const clean = (value: unknown, max = 180) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const kinds = new Set(["VEHICLE", "LOAN"]);
const sources = new Set([
  "MANUAL",
  "PAY0",
  "CASH",
  "EXTERNAL_TRANSFER",
  "DOCUMENT_IMPORT",
  "OTHER",
]);
const movementTypes = new Set([
  "VEHICLE_INVESTMENT",
  "VEHICLE_PRINCIPAL_RETURN",
  "VEHICLE_PROFIT",
  "LOAN_ORIGINATED",
  "INTEREST_ACCRUED",
  "INTEREST_CAPITALIZED",
  "INTEREST_PAYMENT",
  "PRINCIPAL_PAYMENT",
]);
const movementPriority: Record<string, number> = {
  VEHICLE_INVESTMENT: 10,
  LOAN_ORIGINATED: 10,
  INTEREST_ACCRUED: 20,
  INTEREST_CAPITALIZED: 30,
  INTEREST_PAYMENT: 40,
  PRINCIPAL_PAYMENT: 50,
  VEHICLE_PRINCIPAL_RETURN: 40,
  VEHICLE_PROFIT: 50,
};
const timestampMillis = (value: any) =>
  Number(value?.toMillis?.() || value?.getTime?.() || 0);
const compareMovements = (a: any, b: any) =>
  clean(a.effectiveDate).localeCompare(clean(b.effectiveDate)) ||
  (Number.isSafeInteger(a.sequence) && Number.isSafeInteger(b.sequence)
    ? a.sequence - b.sequence
    : timestampMillis(a.createdAt) - timestampMillis(b.createdAt)) ||
  (movementPriority[clean(a.movementType, 60)] || 999) -
    (movementPriority[clean(b.movementType, 60)] || 999) ||
  clean(a.id).localeCompare(clean(b.id));

async function context(request: any) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  if (!user || user.active === false || user.disabled === true)
    throw new HttpsError("permission-denied", "Usuario no disponible.");
  const role = clean(user.role, 40).toLowerCase();
  if (role !== "superadmin" && user.systemAccess?.assets !== true) {
    throw new HttpsError(
      "permission-denied",
      "Tu cuenta no tiene acceso al sistema ASSETS.",
    );
  }
  return { uid, rootId: clean(user.rootId || uid, 128) };
}
async function ownedPosition(uid: string, id: string) {
  const snap = await db.doc(`assetPositions/${id}`).get();
  if (!snap.exists || snap.data()?.ownerUid !== uid)
    throw new HttpsError("not-found", "Posición no encontrada.");
  return { ref: snap.ref, row: snap.data()! };
}
async function movementsFor(uid: string, positionId: string) {
  const snap = await db
    .collection("assetMovements")
    .where("ownerUid", "==", uid)
    .where("positionId", "==", positionId)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as any)
    .sort(compareMovements);
}

export const listAssetOverview = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid } = await context(request);
    const [positionsSnap, movementsSnap, documentsSnap] = await Promise.all([
      db.collection("assetPositions").where("ownerUid", "==", uid).get(),
      db.collection("assetMovements").where("ownerUid", "==", uid).get(),
      db.collection("assetDocuments").where("ownerUid", "==", uid).get(),
    ]);
    const movements = movementsSnap.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as any,
    );
    const positions = positionsSnap.docs.map((doc) => {
      const row = doc.data();
      const ledger = movements
        .filter((movement) => movement.positionId === doc.id)
        .sort(compareMovements);
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const classification = metadata.dataClassification ||
        (metadata.dataset === "UPRO_V1" || row.kind === "LOAN"
          ? "REAL"
          : "REVIEW_REQUIRED");
      const includedInMetrics =
        metadata.excludedFromMetrics !== true &&
        classification !== "TEST" &&
        classification !== "REVIEW_REQUIRED";
      return {
        id: doc.id,
        ...row,
        includedInMetrics,
        dataClassification: classification,
        snapshot: projectAsset(row.kind, ledger),
      };
    });
    const includedPositions = positions.filter((position: any) => position.includedInMetrics);
    const totals = includedPositions.reduce(
      (sum, position: any) => ({
        workingMinor:
          sum.workingMinor + position.snapshot.outstandingPrincipalMinor,
        recoveredPrincipalMinor:
          sum.recoveredPrincipalMinor +
          position.snapshot.recoveredPrincipalMinor,
        realizedProfitMinor:
          sum.realizedProfitMinor + position.snapshot.realizedProfitMinor,
        pendingInterestMinor:
          sum.pendingInterestMinor + position.snapshot.pendingInterestMinor,
      }),
      {
        workingMinor: 0,
        recoveredPrincipalMinor: 0,
        realizedProfitMinor: 0,
        pendingInterestMinor: 0,
      },
    );
    return {
      ok: true,
      positions,
      movements: movements.sort((a, b) => compareMovements(b, a)),
      documents: documentsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })),
      totals,
      excludedPositionCount: positions.length - includedPositions.length,
    };
  },
);

export const createAssetPosition = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid, rootId } = await context(request);
    const kind = clean(request.data?.kind, 20).toUpperCase() as AssetKind;
    const name = clean(request.data?.name, 120);
    const idempotencyKey = clean(request.data?.idempotencyKey, 160);
    if (!kinds.has(kind) || !name || !idempotencyKey)
      throw new HttpsError(
        "invalid-argument",
        "Tipo, nombre e idempotencia son obligatorios.",
      );
    const keyRef = db.doc(
        `assetIdempotency/${hash(`${uid}:POSITION:${idempotencyKey}`)}`,
      ),
      positionRef = db.collection("assetPositions").doc();
    const initialMinor = request.data?.initialMinor
      ? assertMinor(request.data.initialMinor, "initialMinor")
      : 0;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(keyRef);
      if (existing.exists) return;
      tx.create(positionRef, {
        ownerUid: uid,
        rootId,
        kind,
        name,
        status: clean(request.data?.status || "ACTIVE", 30),
        counterpartyName: clean(request.data?.counterpartyName, 160) || null,
        interestModel:
          kind === "LOAN"
            ? clean(request.data?.interestModel || "NONE", 60)
            : null,
        rateBasisPoints:
          kind === "LOAN" ? Number(request.data?.rateBasisPoints || 0) : 0,
        paymentRule:
          kind === "LOAN"
            ? clean(request.data?.paymentRule || "MANUAL", 30)
            : null,
        metadata: {
          ...(request.data?.metadata && typeof request.data.metadata === "object"
            ? request.data.metadata
            : {}),
          dataClassification: "REAL",
          financialTruthConfirmed: true,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(keyRef, {
        ownerUid: uid,
        targetType: "assetPosition",
        targetId: positionRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (initialMinor) {
        const movementRef = db.collection("assetMovements").doc();
        tx.create(movementRef, {
          ownerUid: uid,
          rootId,
          positionId: positionRef.id,
          movementType:
            kind === "LOAN" ? "LOAN_ORIGINATED" : "VEHICLE_INVESTMENT",
          amountMinor: initialMinor,
          sequence: 0,
          source: "MANUAL",
          effectiveDate: clean(
            request.data?.effectiveDate ||
              new Date().toISOString().slice(0, 10),
            10,
          ),
          description: "Apertura de posición",
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      logActivityTx(tx, db, {
        event: "ASSET_POSITION_CREATED",
        rootId,
        actorUid: uid,
        actorRole: "user",
        referenceId: positionRef.id,
        referenceType: "assetPosition",
        amount: initialMinor / 100,
        description: `Posición ${kind} creada: ${name}.`,
      });
    });
    const existing = await keyRef.get();
    return {
      ok: true,
      positionId: existing.data()?.targetId || positionRef.id,
    };
  },
);

export const recordAssetMovement = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid, rootId } = await context(request);
    const positionId = clean(request.data?.positionId);
    const movementType = clean(
      request.data?.movementType,
      60,
    ).toUpperCase() as MovementType;
    const source = clean(
      request.data?.source || "MANUAL",
      40,
    ).toUpperCase() as AssetSource;
    const idempotencyKey = clean(request.data?.idempotencyKey, 160);
    const amountMinor = assertMinor(request.data?.amountMinor);
    if (
      !positionId ||
      !movementTypes.has(movementType) ||
      !sources.has(source) ||
      !idempotencyKey
    )
      throw new HttpsError(
        "invalid-argument",
        "Movimiento, origen e idempotencia son obligatorios.",
      );
    const positionRef = db.doc(`assetPositions/${positionId}`),
      keyRef = db.doc(
        `assetIdempotency/${hash(`${uid}:MOVEMENT:${idempotencyKey}`)}`,
      ),
      movementRef = db.collection("assetMovements").doc();
    await db.runTransaction(async (tx) => {
      const [existing, positionSnap, ledgerSnap] = await Promise.all([
        tx.get(keyRef),
        tx.get(positionRef),
        tx.get(
          db
            .collection("assetMovements")
            .where("ownerUid", "==", uid)
            .where("positionId", "==", positionId),
        ),
      ]);
      if (existing.exists) return;
      const position = positionSnap.data();
      if (!position || position.ownerUid !== uid)
        throw new HttpsError("not-found", "Posición no encontrada.");
      const current = ledgerSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as unknown as AssetMovement)
        .sort(compareMovements);
      const next = projectAsset(position.kind, [
        ...current,
        {
          movementType,
          source,
          amountMinor,
          sequence: current.length,
          effectiveDate: clean(request.data?.effectiveDate, 10),
        } as AssetMovement,
      ]);
      tx.create(movementRef, {
        ownerUid: uid,
        rootId,
        positionId,
        movementType,
        amountMinor,
        sequence: current.length,
        source,
        effectiveDate: clean(
          request.data?.effectiveDate || new Date().toISOString().slice(0, 10),
          10,
        ),
        description: clean(request.data?.description, 500) || null,
        pay0PaymentId: clean(request.data?.pay0PaymentId) || null,
        documentIds: Array.isArray(request.data?.documentIds)
          ? request.data.documentIds
              .map((id: unknown) => clean(id))
              .filter(Boolean)
              .slice(0, 20)
          : [],
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.create(keyRef, {
        ownerUid: uid,
        targetType: "assetMovement",
        targetId: movementRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        positionRef,
        { snapshot: next, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      logActivityTx(tx, db, {
        event: "ASSET_MOVEMENT_RECORDED",
        rootId,
        actorUid: uid,
        actorRole: "user",
        referenceId: movementRef.id,
        referenceType: "assetMovement",
        relatedEntityId: positionId,
        relatedEntityType: "assetPosition",
        amount: amountMinor / 100,
        description: `${movementType} registrado con origen ${source}.`,
      });
    });
    const existing = await keyRef.get();
    return {
      ok: true,
      movementId: existing.data()?.targetId || movementRef.id,
    };
  },
);

export const accrueAssetLoanInterest = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid, rootId } = await context(request);
    const positionId = clean(request.data?.positionId),
      periodKey = clean(request.data?.periodKey, 30);
    if (!positionId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey))
      throw new HttpsError(
        "invalid-argument",
        "Posición y periodo mensual válidos son obligatorios.",
      );
    const positionRef = db.doc(`assetPositions/${positionId}`),
      key = `INTEREST:${positionId}:${periodKey}`;
    const keyRef = db.doc(`assetIdempotency/${hash(`${uid}:${key}`)}`),
      movementRef = db.collection("assetMovements").doc();
    let amountMinor = 0;
    let duplicate = false;
    await db.runTransaction(async (tx) => {
      const [existing, positionSnap, ledgerSnap] = await Promise.all([
        tx.get(keyRef),
        tx.get(positionRef),
        tx.get(
          db
            .collection("assetMovements")
            .where("ownerUid", "==", uid)
            .where("positionId", "==", positionId),
        ),
      ]);
      if (existing.exists) {
        duplicate = true;
        const previous = await tx.get(
          db.doc(`assetMovements/${existing.data()?.targetId}`),
        );
        amountMinor = Number(previous.data()?.amountMinor || 0);
        return;
      }
      const position = positionSnap.data();
      if (!position || position.ownerUid !== uid)
        throw new HttpsError("not-found", "Posición no encontrada.");
      if (position.kind !== "LOAN")
        throw new HttpsError(
          "failed-precondition",
          "La posición no es un préstamo.",
        );
      const ledger = ledgerSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as unknown as AssetMovement)
        .sort(compareMovements);
      const snapshot = projectAsset("LOAN", ledger);
      amountMinor = interestForPeriod({
        model: position.interestModel as InterestModel,
        outstandingPrincipalMinor: snapshot.outstandingPrincipalMinor,
        rateBasisPoints: Number(position.rateBasisPoints || 0),
      });
      if (!amountMinor) return;
      const accrued: AssetMovement = {
        movementType: "INTEREST_ACCRUED",
        amountMinor,
        source: "MANUAL",
        effectiveDate: `${periodKey}-01`,
        sequence: ledger.length,
        interestPeriodKey: periodKey,
      };
      tx.create(movementRef, {
        ownerUid: uid,
        rootId,
        positionId,
        ...accrued,
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.create(keyRef, {
        ownerUid: uid,
        targetType: "assetMovement",
        targetId: movementRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        positionRef,
        {
          snapshot: projectAsset("LOAN", [...ledger, accrued]),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    const existing = await keyRef.get();
    return {
      ok: true,
      amountMinor,
      movementId: existing.data()?.targetId || null,
      duplicate,
      skipped: amountMinor === 0,
    };
  },
);

export const previewAssetPaymentAllocation = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid } = await context(request);
    const positionId = clean(request.data?.positionId);
    const { row } = await ownedPosition(uid, positionId);
    const snapshot = projectAsset(
      row.kind,
      await movementsFor(uid, positionId),
    );
    return {
      ok: true,
      allocation: allocatePayment({
        amountMinor: request.data?.amountMinor,
        pendingInterestMinor: snapshot.pendingInterestMinor,
        outstandingPrincipalMinor: snapshot.outstandingPrincipalMinor,
        rule: clean(request.data?.rule || row.paymentRule || "MANUAL") as any,
        interestMinor: request.data?.interestMinor,
        principalMinor: request.data?.principalMinor,
      }),
      snapshot,
    };
  },
);

export const linkPay0PaymentToAsset = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid, rootId } = await context(request);
    const pagoId = clean(request.data?.pagoId),
      positionId = clean(request.data?.positionId),
      idempotencyKey = clean(request.data?.idempotencyKey);
    const amountMinor = assertMinor(request.data?.amountMinor);
    if (!pagoId || !positionId || !idempotencyKey)
      throw new HttpsError(
        "invalid-argument",
        "Pago, posición e idempotencia son obligatorios.",
      );
    const [{ row: position }, pagoSnap] = await Promise.all([
      ownedPosition(uid, positionId),
      db.doc(`pagos/${pagoId}`).get(),
    ]);
    const pago = pagoSnap.data();
    if (
      !pago ||
      pago.rootId !== rootId ||
      ![pago.createdBy, pago.adminId, pago.rootId].includes(uid)
    )
      throw new HttpsError("permission-denied", "Pago PAY0 fuera de alcance.");
    const totalMinor = Math.round(
      Number(pago.montoTotal ?? pago.monto ?? pago.amount ?? 0) * 100,
    );
    if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0)
      throw new HttpsError(
        "failed-precondition",
        "El pago no tiene un monto canónico.",
      );
    const positionRef = db.doc(`assetPositions/${positionId}`),
      linkRef = db.doc(`assetPaymentLinks/${hash(`${uid}:${pagoId}`)}`),
      keyRef = db.doc(
        `assetIdempotency/${hash(`${uid}:PAY0_LINK:${idempotencyKey}`)}`,
      );
    const movementIds: string[] = [];
    await db.runTransaction(async (tx) => {
      const [link, key, positionSnap, ledgerSnap] = await Promise.all([
        tx.get(linkRef),
        tx.get(keyRef),
        tx.get(positionRef),
        tx.get(
          db
            .collection("assetMovements")
            .where("ownerUid", "==", uid)
            .where("positionId", "==", positionId),
        ),
      ]);
      if (key.exists) return;
      const latestPosition = positionSnap.data();
      if (!latestPosition || latestPosition.ownerUid !== uid)
        throw new HttpsError("not-found", "Posición no encontrada.");
      const ledger = ledgerSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as unknown as AssetMovement)
        .sort(compareMovements);
      const snapshot = projectAsset(latestPosition.kind, ledger);
      const allocation = allocatePayment({
        amountMinor,
        pendingInterestMinor: snapshot.pendingInterestMinor,
        outstandingPrincipalMinor: snapshot.outstandingPrincipalMinor,
        rule: clean(
          request.data?.rule || latestPosition.paymentRule || "MANUAL",
        ) as any,
        interestMinor: request.data?.interestMinor,
        principalMinor: request.data?.principalMinor,
      });
      const linkedMinor = Number(link.data()?.linkedMinor || 0);
      if (amountMinor > remainingLinkableAmount(totalMinor, linkedMinor))
        throw new HttpsError(
          "failed-precondition",
          "El pago PAY0 ya no tiene saldo suficiente para vincular.",
        );
      const additions: AssetMovement[] = [];
      for (const [movementType, part] of [
        ["INTEREST_PAYMENT", allocation.interestMinor],
        ["PRINCIPAL_PAYMENT", allocation.principalMinor],
      ] as const) {
        if (!part) continue;
        const ref = db.collection("assetMovements").doc();
        const sequence = ledger.length + additions.length;
        movementIds.push(ref.id);
        additions.push({
          movementType,
          amountMinor: part,
          source: "PAY0",
          sequence,
          effectiveDate: clean(
            request.data?.effectiveDate ||
              new Date().toISOString().slice(0, 10),
            10,
          ),
        });
        tx.create(ref, {
          ownerUid: uid,
          rootId,
          positionId,
          movementType,
          amountMinor: part,
          sequence,
          source: "PAY0",
          pay0PaymentId: pagoId,
          effectiveDate: clean(
            request.data?.effectiveDate ||
              new Date().toISOString().slice(0, 10),
            10,
          ),
          description: `Aplicación de pago PAY0 ${pago.folio || pagoId}`,
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(
        positionRef,
        {
          snapshot: projectAsset(latestPosition.kind, [
            ...ledger,
            ...additions,
          ]),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(
        linkRef,
        {
          ownerUid: uid,
          rootId,
          pagoId,
          totalMinor,
          linkedMinor: linkedMinor + amountMinor,
          remainingLinkableAmount: totalMinor - linkedMinor - amountMinor,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: link.data()?.createdAt || FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.create(keyRef, {
        ownerUid: uid,
        targetType: "assetPaymentLink",
        targetId: linkRef.id,
        movementIds,
        createdAt: FieldValue.serverTimestamp(),
      });
      logActivityTx(tx, db, {
        event: "ASSET_PAY0_PAYMENT_LINKED",
        rootId,
        actorUid: uid,
        actorRole: "user",
        referenceId: linkRef.id,
        referenceType: "assetPaymentLink",
        relatedEntityId: pagoId,
        relatedEntityType: "pago",
        amount: amountMinor / 100,
        description: `Pago PAY0 vinculado a ${position.name}.`,
      });
    });
    const state = (await linkRef.get()).data();
    return {
      ok: true,
      movementIds,
      remainingLinkableAmount: state?.remainingLinkableAmount || 0,
    };
  },
);

export const createAssetDocumentDraft = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid, rootId } = await context(request);
    const ref = db.collection("assetDocuments").doc();
    const relatedPositionId = clean(request.data?.positionId) || null;
    if (relatedPositionId) await ownedPosition(uid, relatedPositionId);
    await ref.create({
      ownerUid: uid,
      rootId,
      positionId: relatedPositionId,
      operationId: clean(request.data?.operationId) || null,
      movementId: clean(request.data?.movementId) || null,
      documentType: clean(request.data?.documentType || "OTHER", 60),
      status: "DRAFT_REVIEW_REQUIRED",
      extraction: {
        status: "NOT_STARTED",
        proposedData: null,
        reviewedBy: null,
        reviewedAt: null,
      },
      originalName: clean(request.data?.originalName, 180),
      storagePath: null,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, documentId: ref.id };
  },
);

export const seedUproAssetPortfolio = onCall(
  { region: "us-central1", cors: true },
  async (request) => {
    const { uid, rootId } = await context(request);
    const seedRef = db.doc(`assetSeeds/${hash(`${uid}:UPRO_V1`)}`);
    const existing = await seedRef.get();
    const vehicles = [
      {
        key: "DUSTER",
        name: "Duster Intens TM 2025",
        principal: 12_000_000,
        profit: 1_200_000,
        liquidated: true,
        administrativeOwner: "Carlos",
        economicShareBps: 5_000,
      },
      {
        key: "KWID",
        name: "Kwid Iconic TM 2025",
        principal: 7_500_000,
        profit: 0,
        liquidated: false,
        administrativeOwner: "Eliud / Carlos",
        economicShareBps: 5_000,
      },
      {
        key: "ARKANA",
        name: "Arkana Esprit Alpine 2025",
        principal: 16_250_000,
        profit: 1_293_000,
        liquidated: true,
        administrativeOwner: "Carlos 100% (administrativo)",
        economicShareBps: 5_000,
      },
    ];
    const batch = db.batch();
    for (const vehicle of vehicles) {
      const operationId = hash(`${uid}:UPRO_OPERATION:${vehicle.key}`),
        positionId = hash(`${uid}:UPRO_POSITION:${vehicle.key}`);
      batch.set(db.doc(`assetOperations/${operationId}`), {
        ownerUid: uid,
        rootId,
        kind: "VEHICLE",
        name: `U-PRO ${vehicle.name}`,
        status: vehicle.liquidated ? "LIQUIDATED" : "ACTIVE",
        totalAssetValueMinor: vehicle.principal * 2,
        administrativeOwner: vehicle.administrativeOwner,
        source: "MANUAL_CONFIRMED",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(db.doc(`assetPositions/${positionId}`), {
        ownerUid: uid,
        rootId,
        operationId,
        kind: "VEHICLE",
        name: vehicle.name,
        status: vehicle.liquidated ? "LIQUIDATED" : "ACTIVE",
        counterpartyName: "U-PRO",
        economicShareBps: vehicle.economicShareBps,
        metadata: {
          dataset: "UPRO_V1",
          dataClassification: "REAL",
          administrativeOwner: vehicle.administrativeOwner,
          financialTruthConfirmed: true,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const openingId = hash(`${uid}:${positionId}:OPENING`);
      batch.set(db.doc(`assetMovements/${openingId}`), {
        ownerUid: uid,
        rootId,
        operationId,
        positionId,
        movementType: "VEHICLE_INVESTMENT",
        amountMinor: vehicle.principal,
        sequence: 0,
        source: "MANUAL",
        effectiveDate: "2026-09-20",
        description: "Capital económico confirmado U-PRO",
        createdBy: uid,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (vehicle.liquidated) {
        const returnId = hash(`${uid}:${positionId}:RETURN`),
          profitId = hash(`${uid}:${positionId}:PROFIT`);
        batch.set(db.doc(`assetMovements/${returnId}`), {
          ownerUid: uid,
          rootId,
          operationId,
          positionId,
          movementType: "VEHICLE_PRINCIPAL_RETURN",
          amountMinor: vehicle.principal,
          sequence: 1,
          source: "EXTERNAL_TRANSFER",
          effectiveDate: "2026-09-20",
          description: "Recuperación de capital confirmada U-PRO",
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(db.doc(`assetMovements/${profitId}`), {
          ownerUid: uid,
          rootId,
          operationId,
          positionId,
          movementType: "VEHICLE_PROFIT",
          amountMinor: vehicle.profit,
          sequence: 2,
          source: "EXTERNAL_TRANSFER",
          effectiveDate: "2026-09-20",
          description: "Utilidad realizada confirmada U-PRO",
          createdBy: uid,
          createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
    batch.set(seedRef, {
      ownerUid: uid,
      rootId,
      dataset: "UPRO_V1",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    logActivityBatch(batch, db, {
      event: "ASSET_PORTFOLIO_SEEDED",
      rootId,
      actorUid: uid,
      actorRole: "user",
      referenceId: seedRef.id,
      referenceType: "assetSeed",
      description:
        "Portafolio U-PRO V1 cargado con propiedad económica confirmada.",
    });
    await batch.commit();
    return { ok: true, alreadySeeded: existing.exists };
  },
);
