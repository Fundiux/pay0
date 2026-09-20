import { Pay0LoadingOverlay } from "@/components/GlobalLoading";

export function AssetsLoading() { return <Pay0LoadingOverlay label="CARGANDO..."/>; }
export function AssetsError({ message }: { message: string }) { return <div className="rounded-xl border border-red-400/25 bg-red-400/[0.06] p-4 text-sm text-[var(--assets-negative)]">{message}</div>; }
export function AssetsEmpty({ children }: { children: React.ReactNode }) { return <div className="rounded-xl border border-dashed border-[var(--assets-border)] p-6 text-center text-sm text-[var(--assets-muted)]">{children}</div>; }
