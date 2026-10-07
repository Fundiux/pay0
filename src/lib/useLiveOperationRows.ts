"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { buildOperationDiscoveryQuery } from "@/lib/operationDiscovery";
import { traceReactiveOperation } from "@/lib/operationTiming";
import { createOperationSubscriptions, replaceOperationRow, mergeDiscoveredOperationRows, operationBelongsToScope, type OperationScope, type OperationDiscoverySeed, type OperationRow } from "@/lib/liveOperationRows";

/** Callable pagination seeds the dataset; scoped discovery adds new documents. */
export function useLiveOperationRows<T extends OperationRow>(input: {
  collectionName: "solicitudes" | "pagos";
  scopeKey: string;
  enabled: boolean;
  rows: T[];
  scope?: OperationScope;
  discovery?: OperationDiscoverySeed | null;
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
        const incoming = snapshot.exists() ? { ...snapshot.data(), id } : null;
        const data = incoming && (!callbacks.current.scope || operationBelongsToScope(incoming, input.collectionName, callbacks.current.scope)) ? incoming : null;
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

  const discoveryKey = JSON.stringify(input.discovery);
  useEffect(() => {
    if (!input.enabled || !input.scope || !input.discovery || input.discovery.scopeKey !== input.scopeKey) return;
    const discoveryQuery = buildOperationDiscoveryQuery(db, input.collectionName, input.scope, input.discovery);
    if (!discoveryQuery) return;
    let live = true;
    let reconcileAll = true;
    const unsubscribe = onSnapshot(discoveryQuery, { includeMetadataChanges: true }, (snapshot) => {
      if (!live) return;
      if (snapshot.metadata.fromCache) { reconcileAll = true; return; }
      const documents = reconcileAll ? snapshot.docs : snapshot.docChanges()
        .filter((change) => change.type !== "removed").map((change) => change.doc);
      reconcileAll = false;
      const incoming = documents.map((document) => ({ ...document.data(), id: document.id }));
      // One state update per batch; no loading flags, remount or route refresh.
      callbacks.current.setRows((rows) => mergeDiscoveredOperationRows(rows, incoming));
      // Subscribe immediately, closing the gap before React's next effect.
      manager.current?.reconcile([...new Set([...callbacks.current.rows.map((row) => row.id), ...incoming.map((row) => row.id)])]);
    }, () => {
      if (live) callbacks.current.onError("No se pudieron detectar nuevos registros. Revisa tu conexión y permisos.");
    });
    return () => { live = false; unsubscribe(); };
  }, [input.enabled, input.collectionName, input.scopeKey, discoveryKey]);

  useEffect(() => {
    manager.current?.reconcile(JSON.parse(idsKey));
  }, [idsKey]);
}
