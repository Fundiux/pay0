"use client";

type UiProgressBarProps = {
  active?: boolean;
  label?: string;
  progress?: number | null;
  helper?: string;
  className?: string;
};

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function UiProgressBar({
  active = true,
  label = "Procesando...",
  progress = null,
  helper,
  className = "",
}: UiProgressBarProps) {
  if (!active) return null;

  const hasProgress = typeof progress === "number";
  const pct = hasProgress ? clampProgress(progress || 0) : null;

  return (
    <div className={`rounded-xl border border-cyan-300/20 bg-cyan-500/10 p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-cyan-100">{label}</span>
        <span className="rounded-full border border-cyan-300/20 bg-black/20 px-2 py-0.5 font-mono text-cyan-100">
          {hasProgress ? `${pct}%` : "..."}
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-black/30 ring-1 ring-white/10">
        {hasProgress ? (
          <div
            className="h-full rounded-full bg-cyan-300 transition-all duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-300" />
        )}
      </div>

      {helper ? <div className="mt-2 text-[11px] text-slate-400">{helper}</div> : null}
    </div>
  );
}
