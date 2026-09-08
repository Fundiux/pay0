"use client";

import { useMemo } from "react";
import { mergeModules } from "@/lib/roles";

export function useModuleAccess(profile: any, moduleKey: string, actionKey: string = "view") {
  const modules = useMemo(
    () => mergeModules(profile?.role, profile?.modules),
    [profile]
  );

  const canAccess = !!modules?.[moduleKey]?.[actionKey];

  return {
    modules,
    canAccess,
  };
}
