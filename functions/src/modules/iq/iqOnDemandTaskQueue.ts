import { getFunctions } from "firebase-admin/functions";

export type IqOnDemandEnqueueResult = {
  enqueued: boolean;
  duplicate: boolean;
  taskId: string;
};

export type EnqueueIqOnDemandTaskInput<
  T extends Record<string, unknown>,
> = {
  functionName: string;
  taskId: string;
  data: T;
  scheduleDelaySeconds?: number;
  dispatchDeadlineSeconds?: number;
};

function normalizeIqTaskIdH4D64(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 400);

  return normalized || `iq-task-${Date.now()}`;
}

function isTaskAlreadyExistsH4D64(error: unknown): boolean {
  const code = String(
    (error as any)?.code ??
    (error as any)?.errorInfo?.code ??
    "",
  ).toLowerCase();

  const message = String(
    (error as any)?.message ??
    error ??
    "",
  ).toLowerCase();

  return (
    code.includes("task-already-exists") ||
    code.includes("already-exists") ||
    message.includes("task-already-exists") ||
    message.includes("already exists") ||
    message.includes("already_exists")
  );
}

// H4_D64_A2_SHARED_IQ_ON_DEMAND_QUEUE
export async function enqueueIqOnDemandTaskH4D64<
  T extends Record<string, unknown>,
>(
  input: EnqueueIqOnDemandTaskInput<T>,
): Promise<IqOnDemandEnqueueResult> {
  const functionName = String(input.functionName ?? "").trim();

  if (!functionName) {
    throw new Error(
      "H4_D64_A2: Falta el nombre de la funcion de tarea.",
    );
  }

  const taskId = normalizeIqTaskIdH4D64(input.taskId);
  const scheduleDelaySeconds = Math.max(
    0,
    Math.floor(Number(input.scheduleDelaySeconds ?? 0) || 0),
  );

  const dispatchDeadlineSeconds = Math.max(
    15,
    Math.min(
      1800,
      Math.floor(Number(input.dispatchDeadlineSeconds ?? 540) || 540),
    ),
  );

  const queue = getFunctions().taskQueue(functionName);

  try {
    await queue.enqueue(
      input.data,
      {
        id: taskId,
        scheduleDelaySeconds,
        dispatchDeadlineSeconds,
      },
    );

    return {
      enqueued: true,
      duplicate: false,
      taskId,
    };
  } catch (error) {
    if (isTaskAlreadyExistsH4D64(error)) {
      return {
        enqueued: false,
        duplicate: true,
        taskId,
      };
    }

    throw error;
  }
}