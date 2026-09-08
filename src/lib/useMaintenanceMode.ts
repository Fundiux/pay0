import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

export type MaintenanceState = {
  enabled: boolean;
  reason: string;
  loading: boolean;
};

export function useMaintenanceMode(): MaintenanceState {
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState("Sistema activo");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, "system", "publicAccess");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? ((snap.data() as any) || {}) : {};
        setEnabled(data.enabled !== false);
        setReason(String(data.reason || (data.enabled === false ? "Sistema en mantenimiento" : "Sistema activo")));
        setLoading(false);
      },
      () => {
        setEnabled(true);
        setReason("Sistema activo");
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return { enabled, reason, loading };
}