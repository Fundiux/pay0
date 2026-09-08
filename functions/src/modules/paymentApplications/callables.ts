import { randomUUID } from "node:crypto";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/tasks";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue } from "firebase-admin/firestore";
import { assertAuthorized } from "../../utils/authGuard";
import {
  db,
  getActivityAdminId,
  getMyUser,
  getRootId,
  requireAuth,
  requireRole,
} from "../sharedCallables/helpers";
import { normalizePaymentApplicationBatchInput } from "./domain";
import {
  applyPaymentApplicationBatchAtomic,
  reservePaymentApplicationBatch,
  type PaymentApplicationActor,
} from "./service";
import { preparePaymentApplicationIqPlan, resumePaymentApplicationIqPlan } from "./iqPlan";
import {
  executePaymentApplicationIqPlan,
  diagnosePaymentApplicationIqMethods,
  resolvePaymentApplicationIqFolio,
  IQ_PAYMENT_APPLICATION_SECRETS,
} from "./iqExecution";
import { enqueueIqOnDemandTaskH4D64 } from "../iq/iqOnDemandTaskQueue";
import {
  isIqAutomationFlowEnabled,
  loadEnabledIqAutomationRoots,
} from "../iq/automationRuntime";

async function resolveActor(request: any): Promise<PaymentApplicationActor> {
  const uid = requireAuth(request);
  const me = await getMyUser(uid);
  const role = requireRole(me, ["superadmin", "admin", "operador"]) as PaymentApplicationActor["role"];
  assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "pagos", requiredAction: ["create", "conciliate"] });
  const rootId = await getRootId(uid);
  const adminId = getActivityAdminId(me, uid, rootId);

  return {
    uid,
    rootId,
    role,
    adminId,
    displayName: String(me?.name || me?.displayName || me?.email || uid),
    username: String(me?.username || ""),
  };
}

export const reservePagoApplicationBatch = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const actor = await resolveActor(request);
    const batch = normalizePaymentApplicationBatchInput(request.data || {});
    return reservePaymentApplicationBatch({ actor, batch });
  },
);

export const applyPagoToSolicitudesAtomic = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const actor = await resolveActor(request);
    const batch = normalizePaymentApplicationBatchInput(request.data || {});
    return applyPaymentApplicationBatchAtomic({ actor, batch });
  },
);

export const applyPagoToSolicitud = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const actor = await resolveActor(request);
    const data = request.data || {};
    const batch = normalizePaymentApplicationBatchInput({
      pagoId: data.pagoId,
      idempotencyKey:
        String(data.idempotencyKey || "").trim() ||
        `legacy-${actor.uid}-${randomUUID()}`,
      aplicaciones: [
        {
          solicitudId: data.solicitudId,
          montoAplicado: data.montoAplicado,
        },
      ],
    });
    return applyPaymentApplicationBatchAtomic({ actor, batch });
  },
);

export const preparePagoApplicationIqPlan = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const actor = await resolveActor(request);
    const batch = normalizePaymentApplicationBatchInput(request.data || {});
    return preparePaymentApplicationIqPlan({ actor, batch });
  },
);

export const resumePagoApplicationIqPlan = onCall(
  {
    cors: true,
    timeoutSeconds: 300,
    memory: "256MiB",
    secrets: IQ_PAYMENT_APPLICATION_SECRETS,
  },
  async (request) => {
    const actor = await resolveActor(request);

    const result = await resumePaymentApplicationIqPlan({
      actor,
      pagoId: request.data?.pagoId,
    });

    if (
      result.status === "IQ_APPLIED" &&
      result.iqExecutionStatus === "SUCCEEDED" &&
      result.plan?.iqApplicationFolioResolveRequired === true &&
      !String(result.plan?.iqApplicationId || "").trim()
    ) {
      await resolvePaymentApplicationIqFolio({
        actor,
        planId: result.planId,
      });

      return resumePaymentApplicationIqPlan({
        actor,
        pagoId: request.data?.pagoId,
      });
    }

    return result;
  },
);


// H4_D80_A7B_ASYNC_PAYMENT_APPLICATION_EXECUTION
type PaymentApplicationIqDispatchActor = {
  uid: string;
  rootId: string;
  role: PaymentApplicationActor["role"];
  adminId: string;
  displayName: string;
  username: string;
};

type PaymentApplicationIqDispatchPayload = {
  planId: string;
  planHash: string;
  generation: string;
  actor: PaymentApplicationIqDispatchActor;
};

const PAYMENT_APPLICATION_IQ_TASK =
  "processPagoApplicationIqPlanOnDemandTask";

function cleanDispatchText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDispatchUpper(value: unknown): string {
  return cleanDispatchText(value).toUpperCase();
}

function dispatchActorPayload(
  actor: PaymentApplicationActor,
): PaymentApplicationIqDispatchActor {
  return {
    uid: actor.uid,
    rootId: actor.rootId,
    role: actor.role,
    adminId: actor.adminId,
    displayName: actor.displayName,
    username: actor.username,
  };
}

function dispatchResponse(params: {
  planId: string;
  planHash: string;
  reservationId: string;
  taskId: string;
  generation: string;
  duplicate: boolean;
  reused?: boolean;
  completed?: boolean;
  iqApplicationId?: string;
  message: string;
}) {
  return {
    ok: true,
    queued: !params.completed,
    reused: params.reused === true,
    planId: params.planId,
    planHash: params.planHash,
    reservationId: params.reservationId,
    attemptId: "",
    attemptNumber: 0,
    status: params.completed
      ? "IQ_APPLIED"
      : "IQ_IN_PROGRESS",
    iqExecutionStatus: params.completed
      ? "SUCCEEDED"
      : "IN_PROGRESS",
    iqActionExecuted: params.completed === true,
    iqApplicationId:
      cleanDispatchText(params.iqApplicationId),
    message: params.message,
    browserResult: {
      dispatchStatus: params.completed
        ? "COMPLETED_REUSED"
        : "QUEUED",
      taskId: params.taskId,
      generation: params.generation,
      duplicate: params.duplicate,
    },
  };
}

async function enqueuePaymentApplicationIqExecution(
  actor: PaymentApplicationActor,
  data: Record<string, unknown>,
) {
  const planId = cleanDispatchText(data.planId);
  const planHash = cleanDispatchText(data.planHash).toLowerCase();
  const dispatchOrigin =
    cleanDispatchUpper(data.origin) === "AUTOMATIC"
      ? "AUTOMATIC"
      : "MANUAL";

  if (
    !planId ||
    !/^[a-f0-9]{64}$/.test(planHash) ||
    data.confirmExecution !== true
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Falta planId, planHash valido o confirmExecution=true.",
    );
  }

  const planRef = db
    .collection("pagoApplicationIqPlans")
    .doc(planId);

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);

    if (!snap.exists) {
      throw new HttpsError(
        "not-found",
        "Plan IQ no existe.",
      );
    }

    const plan = snap.data() || {};

    if (cleanDispatchText(plan.rootId) !== actor.rootId) {
      throw new HttpsError(
        "permission-denied",
        "Plan IQ fuera del alcance autorizado.",
      );
    }

    const createdBy = cleanDispatchText(plan.createdBy);

    if (
      createdBy &&
      createdBy !== actor.uid &&
      actor.role !== "superadmin"
    ) {
      throw new HttpsError(
        "permission-denied",
        "El plan IQ pertenece a otro usuario.",
      );
    }

    if (
      cleanDispatchText(plan.planHash).toLowerCase() !==
      planHash
    ) {
      throw new HttpsError(
        "already-exists",
        "El hash no coincide con el plan prevalidado.",
      );
    }

    const executionStatus =
      cleanDispatchUpper(plan.iqExecutionStatus);

    if (executionStatus === "SUCCEEDED") {
      return {
        completed: true,
        reservationId:
          cleanDispatchText(plan.reservationId),
        taskId:
          cleanDispatchText(plan.iqExecutionDispatchTaskId),
        generation:
          cleanDispatchText(plan.iqExecutionDispatchGeneration),
        iqApplicationId:
          cleanDispatchText(plan.iqApplicationId),
      };
    }

    if (
      [
        "UNKNOWN_REVIEW_REQUIRED",
        "REJECTED_REVIEW_REQUIRED",
      ].includes(executionStatus)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El plan requiere revision antes de cualquier nueva ejecucion.",
      );
    }

    if (executionStatus === "IN_PROGRESS") {
      return {
        existing: true,
        reservationId:
          cleanDispatchText(plan.reservationId),
        taskId:
          cleanDispatchText(plan.iqExecutionDispatchTaskId),
        generation:
          cleanDispatchText(plan.iqExecutionDispatchGeneration),
      };
    }

    if (
      !["NOT_EXECUTED", "FAILED_SAFE"].includes(
        executionStatus,
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El plan no esta disponible para ejecucion.",
      );
    }

    if (
      cleanDispatchUpper(plan.prevalidationStatus) !==
      "PASSED"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "El plan no tiene prevalidacion aprobada.",
      );
    }

    const dispatchStatus =
      cleanDispatchUpper(plan.iqExecutionDispatchStatus);

    if (
      ["QUEUING", "QUEUED", "RUNNING"].includes(
        dispatchStatus,
      )
    ) {
      return {
        existing: true,
        reservationId:
          cleanDispatchText(plan.reservationId),
        taskId:
          cleanDispatchText(plan.iqExecutionDispatchTaskId),
        generation:
          cleanDispatchText(plan.iqExecutionDispatchGeneration),
      };
    }

    const dispatchAttempt =
      Math.max(
        0,
        Math.floor(
          Number(plan.iqExecutionDispatchAttemptCount) || 0,
        ),
      ) + 1;

    const generation =
      String(dispatchAttempt) + "-" + randomUUID();

    const taskId = [
      "iq-payment-application",
      planId,
      String(dispatchAttempt),
      planHash.slice(0, 12),
    ].join("-");

    tx.set(
      planRef,
      {
        iqExecutionDispatchVersion: "H4-D80-A7B",
        iqExecutionDispatchStatus: "QUEUING",
        iqExecutionDispatchAttemptCount:
          dispatchAttempt,
        iqExecutionDispatchGeneration:
          generation,
        iqExecutionDispatchTaskId: taskId,
        iqExecutionDispatchRequestedAt:
          FieldValue.serverTimestamp(),
        iqExecutionDispatchRequestedBy:
          actor.uid,
        iqExecutionDispatchRequestedByRole:
          actor.role,
        iqExecutionDispatchOrigin:
          dispatchOrigin,
        updatedAt:
          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return {
      existing: false,
      completed: false,
      reservationId:
        cleanDispatchText(plan.reservationId),
      taskId,
      generation,
    };
  });

  if (claimed.completed) {
    return dispatchResponse({
      planId,
      planHash,
      reservationId: claimed.reservationId,
      taskId: claimed.taskId,
      generation: claimed.generation,
      duplicate: true,
      reused: true,
      completed: true,
      iqApplicationId: claimed.iqApplicationId,
      message:
        "La aplicacion IQ ya estaba confirmada.",
    });
  }

  if (claimed.existing) {
    return dispatchResponse({
      planId,
      planHash,
      reservationId: claimed.reservationId,
      taskId: claimed.taskId,
      generation: claimed.generation,
      duplicate: true,
      message:
        "La ejecucion IQ ya estaba encolada o en curso.",
    });
  }

  try {
    const enqueueResult =
      await enqueueIqOnDemandTaskH4D64({
        functionName:
          PAYMENT_APPLICATION_IQ_TASK,
        taskId: claimed.taskId,
        data: {
          planId,
          planHash,
          generation: claimed.generation,
          actor: dispatchActorPayload(actor),
        } as unknown as Record<string, unknown>,
        scheduleDelaySeconds: 2,
        dispatchDeadlineSeconds: 540,
      });

    await planRef.set(
      {
        iqExecutionDispatchStatus: "QUEUED",
        iqExecutionDispatchTaskId:
          enqueueResult.taskId,
        iqExecutionDispatchDuplicate:
          enqueueResult.duplicate,
        iqExecutionDispatchQueuedAt:
          FieldValue.serverTimestamp(),
        updatedAt:
          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return dispatchResponse({
      planId,
      planHash,
      reservationId: claimed.reservationId,
      taskId: enqueueResult.taskId,
      generation: claimed.generation,
      duplicate: enqueueResult.duplicate,
      message:
        "Ejecucion IQ encolada. PAY0 ya no espera al navegador.",
    });
  } catch (error: any) {
    await planRef.set(
      {
        iqExecutionDispatchStatus:
          "ENQUEUE_ERROR",
        iqExecutionDispatchLastError:
          cleanDispatchText(
            error?.message ||
            "No se pudo encolar la ejecucion IQ.",
          ),
        iqExecutionDispatchLastErrorAt:
          FieldValue.serverTimestamp(),
        updatedAt:
          FieldValue.serverTimestamp(),
      },
      { merge: true },
    ).catch(() => undefined);

    throw error;
  }
}

export const executePagoApplicationIqPlan = onCall(
  {
    cors: true,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const actor = await resolveActor(request);

    return enqueuePaymentApplicationIqExecution(
      actor,
      (request.data || {}) as Record<string, unknown>,
    );
  },
);

export const processPagoApplicationIqPlanOnDemandTask =
  onTaskDispatched(
    {
      region: "us-central1",
      timeoutSeconds: 540,
      memory: "2GiB",
      maxInstances: 1,
      concurrency: 1,
      secrets: IQ_PAYMENT_APPLICATION_SECRETS,
      retryConfig: {
        maxAttempts: 1,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 60,
      },
      rateLimits: {
        maxConcurrentDispatches: 1,
        maxDispatchesPerSecond: 1,
      },
    },
    async (request) => {
      const data =
        (request.data || {}) as Record<string, any>;

      const planId =
        cleanDispatchText(data.planId);

      const planHash =
        cleanDispatchText(data.planHash)
          .toLowerCase();

      const generation =
        cleanDispatchText(data.generation);

      const actorPayload =
        data.actor &&
        typeof data.actor === "object"
          ? data.actor
          : {};

      const uid =
        cleanDispatchText(actorPayload.uid);

      if (
        !planId ||
        !/^[a-f0-9]{64}$/.test(planHash) ||
        !generation ||
        !uid
      ) {
        console.warn(
          "H4_D80_A7B_INVALID_TASK",
          {
            planId,
            generation,
            uid,
          },
        );

        return;
      }

      const planRef = db
        .collection("pagoApplicationIqPlans")
        .doc(planId);

      const planSnap = await planRef.get();

      if (!planSnap.exists) {
        console.warn(
          "H4_D80_A7B_PLAN_NOT_FOUND",
          { planId },
        );

        return;
      }

      const plan = planSnap.data() || {};

      if (
        cleanDispatchText(
          plan.iqExecutionDispatchGeneration,
        ) !== generation
      ) {
        console.info(
          "H4_D80_A7B_STALE_TASK_OMITTED",
          { planId, generation },
        );

        return;
      }

      if (
        cleanDispatchUpper(plan.iqExecutionStatus) ===
        "SUCCEEDED"
      ) {
        await planRef.set(
          {
            iqExecutionDispatchStatus:
              "COMPLETED_REUSED",
            iqExecutionDispatchCompletedAt:
              FieldValue.serverTimestamp(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return;
      }

      const userSnap = await db
        .collection("users")
        .doc(uid)
        .get();

      const user = userSnap.exists
        ? userSnap.data() || {}
        : {};

      const currentRole =
        cleanDispatchText(user.role)
          .toLowerCase();

      const inactive =
        !userSnap.exists ||
        user.active === false ||
        user.deleted === true ||
        Boolean(user.deletedAt) ||
        ![
          "superadmin",
          "admin",
          "operador",
        ].includes(currentRole);

      if (inactive) {
        await planRef.set(
          {
            iqExecutionDispatchStatus:
              "AUTH_STOPPED",
            iqExecutionDispatchLastError:
              "Usuario inexistente, inactivo o sin rol permitido.",
            iqExecutionDispatchCompletedAt:
              FieldValue.serverTimestamp(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return;
      }

      const currentRootId =
        await getRootId(uid);

      if (
        cleanDispatchText(plan.rootId) !==
        currentRootId
      ) {
        await planRef.set(
          {
            iqExecutionDispatchStatus:
              "SCOPE_STOPPED",
            iqExecutionDispatchLastError:
              "El root actual no coincide con el plan.",
            iqExecutionDispatchCompletedAt:
              FieldValue.serverTimestamp(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return;
      }

      const actor: PaymentApplicationActor = {
        uid,
        rootId: currentRootId,
        role:
          currentRole as PaymentApplicationActor["role"],
        adminId:
          cleanDispatchText(
            user.adminId ||
            actorPayload.adminId ||
            uid,
          ),
        displayName:
          cleanDispatchText(
            user.name ||
            user.displayName ||
            user.email ||
            actorPayload.displayName ||
            uid,
          ),
        username:
          cleanDispatchText(
            user.username ||
            actorPayload.username,
          ),
      };

      // H4_D87_A59_R3_EXECUTION_GATE
      // El scheduler ya valido Master + aplicacionPagos al encolar.
      // Esta segunda comprobacion evita que una tarea AUTOMATIC
      // ya encolada ejecute IQ si el usuario apago la automatizacion
      // antes de que Cloud Tasks alcance a despacharla.
      const dispatchOrigin =
        cleanDispatchUpper(
          plan.iqExecutionDispatchOrigin,
        );

      if (dispatchOrigin === "AUTOMATIC") {
        const automationStillEnabled =
          await isIqAutomationFlowEnabled(
            currentRootId,
            "aplicacionPagos",
          );

        if (!automationStillEnabled) {
          await planRef.set(
            {
              iqExecutionDispatchStatus:
                "AUTOMATION_PAUSED",
              iqExecutionDispatchLastError: null,
              iqExecutionDispatchAutomationPausedAt:
                FieldValue.serverTimestamp(),
              iqExecutionDispatchCompletedAt:
                FieldValue.serverTimestamp(),
              updatedAt:
                FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          console.info(
            "H4_D87_A59_R3_AUTOMATION_PAUSED",
            {
              planId,
              generation,
              rootId: currentRootId,
            },
          );

          return;
        }
      }
      await planRef.set(
        {
          iqExecutionDispatchStatus: "RUNNING",
          iqExecutionDispatchStartedAt:
            FieldValue.serverTimestamp(),
          updatedAt:
            FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      try {
        const result =
          await executePaymentApplicationIqPlan({
            actor,
            planId,
            planHash,
            confirmExecution: true,
          });

        const resultStatus =
          cleanDispatchUpper(
            result.iqExecutionStatus,
          );

        await planRef.set(
          {
            iqExecutionDispatchStatus:
              resultStatus === "SUCCEEDED"
                ? "COMPLETED"
                : resultStatus === "FAILED_SAFE"
                  ? "FAILED_SAFE"
                  : resultStatus.includes(
                      "REVIEW_REQUIRED",
                    )
                    ? "REVIEW_REQUIRED"
                    : "COMPLETED_WITH_STATUS",
            iqExecutionDispatchResultStatus:
              resultStatus,
            iqExecutionDispatchMessage:
              cleanDispatchText(result.message),
            iqExecutionDispatchCompletedAt:
              FieldValue.serverTimestamp(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } catch (error: any) {
        const message =
          cleanDispatchText(
            error?.message ||
            "La tarea IQ termino con error.",
          );

        await planRef.set(
          {
            iqExecutionDispatchStatus: "FAILED",
            iqExecutionDispatchLastError:
              message,
            iqExecutionDispatchLastErrorAt:
              FieldValue.serverTimestamp(),
            iqExecutionDispatchCompletedAt:
              FieldValue.serverTimestamp(),
            updatedAt:
              FieldValue.serverTimestamp(),
          },
          { merge: true },
        ).catch(() => undefined);

        console.error(
          "H4_D80_A7B_TASK_FAILED",
          {
            planId,
            generation,
            message,
          },
        );

        // No lanzar: la tarea no debe repetir automaticamente un POST IQ.
      }
    },
  );


export const diagnosePagoApplicationIqMethods = onCall(
  {
    cors: true,
    timeoutSeconds: 300,
    memory: "2GiB",
    concurrency: 1,
    secrets: IQ_PAYMENT_APPLICATION_SECRETS,
  },
  async (request) => {
    const actor = await resolveActor(request);
    const data = request.data || {};
    return diagnosePaymentApplicationIqMethods({
      actor,
      planId: data.planId,
      planHash: data.planHash,
    });
  },
);

// H4_D87_A59_PAYMENT_APPLICATION_AUTOMATION
const PAYMENT_APPLICATION_AUTOMATION_SCAN_PAGE_SIZE = 100;
const PAYMENT_APPLICATION_AUTOMATION_MAX_PER_ROOT = 10;

function isPaymentApplicationAutomationCandidate(
  pago: Record<string, any>,
  rootId: string,
): boolean {
  if (cleanDispatchText(pago.rootId) !== rootId) {
    return false;
  }

  // H4_D87_A59_R2_FORWARD_ONLY
  // Solo operaciones creadas por una version que conoce
  // explicitamente esta automatizacion pueden entrar aqui.
  // Los historicos sin esta marca quedan excluidos.
  if (
    pago.iqPaymentApplicationAutomationEligible !== true
  ) {
    return false;
  }

  const pagoIqFolio =
    cleanDispatchText(
      pago.iqDepositId ||
      pago.iqDepositFolio ||
      pago.iqPagoDepositId ||
      pago.iqPagoDepositFolio,
    );

  // No existe Aplicacion de pagos IQ automatica si el
  // deposito no tiene un folio IQ numerico valido.
  if (!/^\d{3,20}$/.test(pagoIqFolio)) {
    return false;
  }
  const applicationStatus =
    cleanDispatchUpper(
      pago.iqPaymentApplicationStatus,
    );

  const executionStatus =
    cleanDispatchUpper(
      pago.iqPaymentApplicationExecutionStatus,
    );

  if (
    applicationStatus ===
    "PAY0_APPLIED_PENDING_IQ_PLAN"
  ) {
    return true;
  }

  if (
    applicationStatus === "PREVALIDATED" &&
    (
      !executionStatus ||
      executionStatus === "NOT_EXECUTED"
    )
  ) {
    return true;
  }

  return false;
}

async function buildPaymentApplicationAutomationActor(
  params: {
    rootId: string;
    createdBy: string;
    adminId?: string;
  },
): Promise<PaymentApplicationActor> {
  const uid =
    cleanDispatchText(params.createdBy);

  if (!uid) {
    throw new Error(
      "La reserva no tiene createdBy para continuar automaticamente.",
    );
  }

  const userSnap = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!userSnap.exists) {
    throw new Error(
      "El usuario creador de la aplicacion ya no existe.",
    );
  }

  const user = userSnap.data() || {};

  const role =
    cleanDispatchText(user.role)
      .toLowerCase();

  if (
    user.active === false ||
    user.deleted === true ||
    Boolean(user.deletedAt) ||
    ![
      "superadmin",
      "admin",
      "operador",
    ].includes(role)
  ) {
    throw new Error(
      "El usuario creador esta inactivo o sin rol permitido.",
    );
  }

  const currentRootId =
    await getRootId(uid);

  if (
    cleanDispatchText(currentRootId) !==
    params.rootId
  ) {
    throw new Error(
      "El usuario creador ya no pertenece al mismo root.",
    );
  }

  return {
    uid,
    rootId: params.rootId,
    role:
      role as PaymentApplicationActor["role"],
    adminId:
      cleanDispatchText(
        params.adminId ||
        user.adminId ||
        uid,
      ),
    displayName:
      cleanDispatchText(
        user.name ||
        user.displayName ||
        user.email ||
        uid,
      ),
    username:
      cleanDispatchText(
        user.username,
      ),
  };
}

async function processPaymentApplicationAutomationCandidate(
  params: {
    rootId: string;
    pagoId: string;
    pago: Record<string, any>;
  },
) {
  const reservationId =
    cleanDispatchText(
      params.pago
        .iqPaymentApplicationReservationId ||
      params.pago
        .lastPaymentApplicationReservationId,
    );

  if (!reservationId) {
    throw new Error(
      "El pago no tiene reserva de aplicacion IQ.",
    );
  }

  const reservationSnap = await db
    .collection("pagoApplicationReservations")
    .doc(reservationId)
    .get();

  if (!reservationSnap.exists) {
    throw new Error(
      "La reserva de aplicacion no existe.",
    );
  }

  const reservation =
    reservationSnap.data() || {};

  if (
    cleanDispatchText(reservation.rootId) !==
      params.rootId ||
    cleanDispatchText(reservation.pagoId) !==
      params.pagoId
  ) {
    throw new Error(
      "La reserva no coincide con el pago/root.",
    );
  }

  const actor =
    await buildPaymentApplicationAutomationActor({
      rootId: params.rootId,
      createdBy:
        cleanDispatchText(
          reservation.createdBy,
        ),
      adminId:
        cleanDispatchText(
          reservation.adminId,
        ),
    });

  // Reutiliza exactamente la misma preparacion/reanudacion
  // que ya utiliza el flujo manual.
  const planResult =
    await resumePaymentApplicationIqPlan({
      actor,
      pagoId: params.pagoId,
    });

  const executionStatus =
    cleanDispatchUpper(
      planResult.iqExecutionStatus,
    );

  // El automatico solamente puede arrancar un plan limpio.
  //
  // SUCCEEDED:
  // ya terminado.
  //
  // IN_PROGRESS:
  // ya existe ejecucion.
  //
  // FAILED_SAFE:
  // queda para revision/reintento manual.
  //
  // UNKNOWN_REVIEW_REQUIRED / REJECTED_REVIEW_REQUIRED:
  // STOP absoluto; nunca repetir automaticamente.
  if (executionStatus !== "NOT_EXECUTED") {
    return {
      action: "SKIPPED",
      executionStatus,
      planId: planResult.planId,
    };
  }

  // Mismo dispatcher utilizado por el boton manual.
  // Este NO ejecuta directamente el POST:
  // crea/reutiliza la misma Cloud Task canonica.
  const result =
    await enqueuePaymentApplicationIqExecution(
      actor,
      {
        planId: planResult.planId,
        planHash: planResult.planHash,
        confirmExecution: true,
        origin: "AUTOMATIC",
      },
    );

  return {
    action:
      result.queued === true
        ? "QUEUED"
        : "REUSED",
    executionStatus:
      cleanDispatchUpper(
        result.iqExecutionStatus,
      ),
    planId: planResult.planId,
  };
}

export const processIqPaymentApplicationExecution =
  onSchedule(
    {
      schedule: "every 5 minutes",
      region: "us-central1",
      timeZone: "America/Mexico_City",
      timeoutSeconds: 300,
      memory: "512MiB",
      maxInstances: 1,
      concurrency: 1,
    },
    async () => {
      // Gate canonico:
      // Master IQ + automation.aplicacionPagos + ventana + intervalo.
      const enabledRoots =
        await loadEnabledIqAutomationRoots({
          process:
            "paymentApplicationExecution",
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

        const configData =
          configSnap.exists
            ? configSnap.data() || {}
            : {};

        const automationRuntime =
          configData.automationRuntime &&
          typeof configData.automationRuntime ===
            "object"
            ? configData.automationRuntime
            : {};

        const processRuntime =
          automationRuntime
            .paymentApplicationExecution &&
          typeof automationRuntime
            .paymentApplicationExecution ===
            "object"
            ? automationRuntime
                .paymentApplicationExecution
            : {};

        const storedCursorId =
          cleanDispatchText(
            processRuntime.scanCursorId,
          );

        let cursorSnap: any = null;

        if (storedCursorId) {
          const candidateCursorSnap =
            await db
              .collection("pagos")
              .doc(storedCursorId)
              .get();

          if (
            candidateCursorSnap.exists &&
            cleanDispatchText(
              candidateCursorSnap
                .data()
                ?.rootId,
            ) === rootId
          ) {
            cursorSnap =
              candidateCursorSnap;
          }
        }

        let query = db
          .collection("pagos")
          .where(
            "rootId",
            "==",
            rootId,
          )
          .limit(
            PAYMENT_APPLICATION_AUTOMATION_SCAN_PAGE_SIZE,
          );

        if (cursorSnap) {
          query =
            query.startAfter(
              cursorSnap,
            );
        }

        let snap =
          await query.get();

        // Si el cursor llego al final o quedo obsoleto,
        // vuelve a la primera pagina en la misma corrida.
        if (
          snap.empty &&
          storedCursorId
        ) {
          snap = await db
            .collection("pagos")
            .where(
              "rootId",
              "==",
              rootId,
            )
            .limit(
              PAYMENT_APPLICATION_AUTOMATION_SCAN_PAGE_SIZE,
            )
            .get();
        }

        const candidates =
          snap.docs
            .map((doc) => ({
              id: doc.id,
              data: {
                id: doc.id,
                ...(doc.data() || {}),
              },
            }))
            .filter((item) =>
              isPaymentApplicationAutomationCandidate(
                item.data,
                rootId,
              ),
            )
            .slice(
              0,
              PAYMENT_APPLICATION_AUTOMATION_MAX_PER_ROOT,
            );

        let queued = 0;
        let skipped = 0;
        let errors = 0;

        for (
          const candidate of candidates
        ) {
          const pagoRef = db
            .collection("pagos")
            .doc(candidate.id);

          try {
            const result =
              await processPaymentApplicationAutomationCandidate(
                {
                  rootId,
                  pagoId:
                    candidate.id,
                  pago:
                    candidate.data,
                },
              );

            if (
              result.action ===
              "QUEUED"
            ) {
              queued += 1;
            } else {
              skipped += 1;
            }

            await pagoRef.set(
              {
                iqPaymentApplicationAutomationLastAction:
                  result.action,

                iqPaymentApplicationAutomationLastExecutionStatus:
                  result.executionStatus,

                iqPaymentApplicationAutomationLastPlanId:
                  result.planId,

                iqPaymentApplicationAutomationLastError:
                  null,

                iqPaymentApplicationAutomationLastAttemptAt:
                  FieldValue.serverTimestamp(),

                iqPaymentApplicationUpdatedAt:
                  FieldValue.serverTimestamp(),
              },
              { merge: true },
            );
          } catch (error) {
            errors += 1;

            const message =
              error instanceof Error
                ? error.message
                : String(error);

            console.error(
              "PAYMENT_APPLICATION_AUTOMATION_ITEM_ERROR",
              {
                rootId,
                pagoId:
                  candidate.id,
                message,
              },
            );

            await pagoRef
              .set(
                {
                  iqPaymentApplicationAutomationLastAction:
                    "ERROR",

                  iqPaymentApplicationAutomationLastError:
                    message,

                  iqPaymentApplicationAutomationLastErrorAt:
                    FieldValue.serverTimestamp(),

                  iqPaymentApplicationAutomationLastAttemptAt:
                    FieldValue.serverTimestamp(),

                  iqPaymentApplicationUpdatedAt:
                    FieldValue.serverTimestamp(),
                },
                { merge: true },
              )
              .catch(
                () => undefined,
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
          PAYMENT_APPLICATION_AUTOMATION_SCAN_PAGE_SIZE;

        await configRef.set(
          {
            automationRuntime: {
              paymentApplicationExecution: {
                scanCursorId:
                  reachedEnd
                    ? null
                    : lastDoc?.id ??
                      null,

                scanPageSize:
                  PAYMENT_APPLICATION_AUTOMATION_SCAN_PAGE_SIZE,

                lastScanCount:
                  snap.docs.length,

                lastCandidateCount:
                  candidates.length,

                lastQueuedCount:
                  queued,

                lastSkippedCount:
                  skipped,

                lastErrorCount:
                  errors,

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

// H4_D87_A59_PAYMENT_APPLICATION_AUTOMATION_END
