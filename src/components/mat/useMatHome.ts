"use client";

import { useEffect, useState } from "react";
import { getTelegramInitData } from "@/lib/telegramMiniApp";
import {
  getMatClientHome,
  getMatUserHome,
  type MatClientHomeResult,
  type MatUserHomeResult,
} from "@/services/telegramMiniApp";

export type MatHomeMode = "LOCAL" | "TELEGRAM";

export interface MatHomeState<T> {
  home: T | null;
  loading: boolean;
  error: string;
  mode: MatHomeMode;
}

export function useMatUserHome(): MatHomeState<MatUserHomeResult> {
  const [state, setState] = useState<MatHomeState<MatUserHomeResult>>({
    home: null,
    loading: false,
    error: "",
    mode: "LOCAL",
  });

  useEffect(() => {
    let cancelled = false;
    const initData = getTelegramInitData();

    if (!initData) {
      setState({ home: null, loading: false, error: "", mode: "LOCAL" });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: "", mode: "TELEGRAM" }));

    getMatUserHome({ initData, botScope: "USERS" })
      .then((home) => {
        if (cancelled) return;
        setState({ home, loading: false, error: "", mode: "TELEGRAM" });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[MAT] getMatUserHome error", error);
        setState({
          home: null,
          loading: false,
          error: "No se pudo cargar home usuarios.",
          mode: "TELEGRAM",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function useMatClientHome(): MatHomeState<MatClientHomeResult> {
  const [state, setState] = useState<MatHomeState<MatClientHomeResult>>({
    home: null,
    loading: false,
    error: "",
    mode: "LOCAL",
  });

  useEffect(() => {
    let cancelled = false;
    const initData = getTelegramInitData();

    if (!initData) {
      setState({ home: null, loading: false, error: "", mode: "LOCAL" });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: "", mode: "TELEGRAM" }));

    getMatClientHome({ initData, botScope: "CLIENTS" })
      .then((home) => {
        if (cancelled) return;
        setState({ home, loading: false, error: "", mode: "TELEGRAM" });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[MAT] getMatClientHome error", error);
        setState({
          home: null,
          loading: false,
          error: "No se pudo cargar home clientes.",
          mode: "TELEGRAM",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}