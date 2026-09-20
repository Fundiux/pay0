"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type GlobalLoadingOptions = {
  label?: string;
  progress?: number | null;
  helper?: string;
};

type GlobalLoadingState = {
  active: boolean;
  label: string;
  progress: number | null;
  helper: string;
};

type GlobalLoadingTask<T> = () => Promise<T> | T;

type GlobalLoadingContextValue = {
  show: (options?: GlobalLoadingOptions) => void;
  update: (options?: GlobalLoadingOptions) => void;
  hide: () => void;
  run: <T,>(options: GlobalLoadingOptions | undefined, task: GlobalLoadingTask<T>) => Promise<T>;
};

const defaultState: GlobalLoadingState = {
  active: false,
  label: "LOADING...",
  progress: null,
  helper: "",
};

const GlobalLoadingContext = createContext<GlobalLoadingContextValue | null>(null);

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function buildState(options: GlobalLoadingOptions = {}): GlobalLoadingState {
  return {
    active: true,
    label: options.label || "LOADING...",
    progress: typeof options.progress === "number" ? clampProgress(options.progress) : null,
    helper: options.helper || "",
  };
}

export function Pay0LoadingOverlay({
  active = true,
  label = "LOADING...",
}: {
  active?: boolean;
  label?: string;
}) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/82 px-4 backdrop-blur-sm" role="status" aria-live="polite">
      <div className="flex max-w-[90vw] items-end justify-center gap-4">
        <span className="pay0-bounceball" aria-hidden="true" />

        <span className="select-none text-3xl font-black uppercase tracking-[0.22em] text-[#ffd000] drop-shadow-[0_0_18px_rgba(255,208,0,0.38)] sm:text-4xl">
          {label}
        </span>
      </div>

      <style jsx>{`
        .pay0-bounceball {
          position: relative;
          display: inline-block;
          height: 37px;
          width: 15px;
        }

        .pay0-bounceball::before {
          position: absolute;
          content: "";
          display: block;
          top: 0;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background-color: #ffd000;
          box-shadow: 0 0 22px rgba(255, 208, 0, 0.8);
          transform-origin: 50%;
          animation: pay0-bounce 500ms alternate infinite ease;
        }

        @keyframes pay0-bounce {
          0% {
            top: 30px;
            height: 5px;
            border-radius: 60px 60px 20px 20px;
            transform: scaleX(2);
          }

          35% {
            height: 15px;
            border-radius: 50%;
            transform: scaleX(1);
          }

          100% {
            top: 0;
          }
        }
      `}</style>
    </div>
  );
}

function GlobalLoadingOverlay({ state }: { state: GlobalLoadingState }) {
  return <Pay0LoadingOverlay active={state.active} label={state.label || "LOADING..."} />;
}

export function GlobalLoadingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GlobalLoadingState>(defaultState);

  const api = useMemo<GlobalLoadingContextValue>(() => {
    return {
      show(options = {}) {
        setState(buildState(options));
      },

      update(options = {}) {
        setState((current) => ({
          active: true,
          label: options.label || current.label || "LOADING...",
          progress:
            typeof options.progress === "number"
              ? clampProgress(options.progress)
              : current.progress,
          helper:
            typeof options.helper === "string"
              ? options.helper
              : current.helper,
        }));
      },

      hide() {
        setState(defaultState);
      },

      run: async <T,>(
        options: GlobalLoadingOptions | undefined,
        task: GlobalLoadingTask<T>
      ): Promise<T> => {
        setState(buildState(options || {}));

        try {
          return await task();
        } finally {
          setState(defaultState);
        }
      },
    };
  }, []);

  return (
    <GlobalLoadingContext.Provider value={api}>
      {children}
      <GlobalLoadingOverlay state={state} />
    </GlobalLoadingContext.Provider>
  );
}

export function useGlobalLoading() {
  const ctx = useContext(GlobalLoadingContext);

  if (!ctx) {
    throw new Error("useGlobalLoading debe usarse dentro de GlobalLoadingProvider");
  }

  return ctx;
}
