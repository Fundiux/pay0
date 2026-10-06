"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { traceReactiveOperation } from "@/lib/operationTiming";
import { createOperationSubscriptions, replaceOperationRow, type OperationRow } from "@/lib/liveOperationRows";

/** Callable pagination remains authoritative; watch only the loaded documents. */
export function useLiveOperationRows<T extends OperationRow>(input: {
  collectionName: "solicitudes" | "pagos";
  scopeKey: string;
  enabled: boolean;
  rows: T[];
  setRows: Dispatch<SetStateAction<T[]>>;
  onError: (message: string) => void;
}) {
  const callbacks = useRef(input);
  callbacks.current = input;
  const manager = useRef<ReturnType<typeof createOperationSubscriptions> | null>(null);
  const idsKey = JSON.stringify(input.rows.map((row) => row.id).sort());

  useEffect(() => {
    if (!input.enabled) return;
    let live = true;
    const subscriptions = createOperationSubscriptions((id) => onSnapshot(
      doc(db, input.collectionName, id),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!live || snapshot.metadata.fromCache) return;
        const data = snapshot.exists() ? { ...snapshot.data(), id } : null;
        callbacks.current.setRows((rows) => replaceOperationRow(rows, id, data));
        if (data) traceReactiveOperation(id, data);
      },
      (error) => {
        if (!live) return;
        if (error.code === "permission-denied") {
          callbacks.current.setRows((rows) => replaceOperationRow(rows, id, null));
        }
        callbacks.current.onError("No se pudo mantener la actualización en tiempo real. Revisa tu conexión y permisos.");
      },
    ));
    manager.current = subscriptions;
    subscriptions.reconcile(callbacks.current.rows.map((row) => row.id));
    return () => {
      live = false;
      subscriptions.dispose();
      if (manager.current === subscriptions) manager.current = null;
    };
  }, [input.collectionName, input.scopeKey, input.enabled]);

  useEffect(() => {
    manager.current?.reconcile(JSON.parse(idsKey));
  }, [idsKey]);
}
