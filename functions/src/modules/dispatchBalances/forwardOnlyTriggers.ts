import { getFirestore } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import {
  H4_D82_A3_A2_FORWARD_ONLY_VERSION,
  releaseForwardOnlyDispersionTx,
  terminalDispersion,
} from "./forwardOnly";

type AnyDoc = Record<string, any>;

function record(value: unknown): AnyDoc {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value as AnyDoc
    : {};
}

export const releaseForwardOnlyDispersionReservationOnTerminal =
  onDocumentUpdated(
    {
      document:
        "clientDispersions/{dispersionId}",
      region: "us-central1",
      timeoutSeconds: 60,
      memory: "256MiB",
    },
    async (event) => {
      const before = record(
        event.data?.before.data(),
      );
      const after = record(
        event.data?.after.data(),
      );

      if (
        String(
          after.forwardOnlyVersion || "",
        ).trim() !==
          H4_D82_A3_A2_FORWARD_ONLY_VERSION ||
        after.reservationReleased === true ||
        terminalDispersion(before) ||
        !terminalDispersion(after)
      ) {
        return;
      }

      const ref = event.data?.after.ref;

      if (!ref) return;

      const db = getFirestore();

      await db.runTransaction(
        async (tx) => {
          const snap = await tx.get(ref);

          if (!snap.exists) return;

          const current = record(
            snap.data(),
          );

          if (
            current.reservationReleased ===
              true ||
            !terminalDispersion(current)
          ) {
            return;
          }

          await releaseForwardOnlyDispersionTx({
            tx,
            db,
            dispersionRef: ref,
            dispersion: current,
            actorUsername:
              "PAY0_FORWARD_ONLY_TRIGGER",
          });
        },
      );
    },
  );
