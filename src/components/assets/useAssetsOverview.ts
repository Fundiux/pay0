"use client";

import { useCallback, useEffect, useState } from "react";
import { listAssetOverview, type AssetOverview } from "@/services/assets";

export function useAssetsOverview() {
  const [data, setData] = useState<AssetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await listAssetOverview()); setError(""); }
    catch (value: any) { setError(value?.message || "No se pudo cargar ASSETS."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}
