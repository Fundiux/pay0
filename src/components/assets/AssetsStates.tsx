export function AssetsLoading() { return <div className="py-24 text-center text-sm text-stone-500">Cargando patrimonio…</div>; }
export function AssetsError({ message }: { message: string }) { return <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-5 text-sm text-red-200">{message}</div>; }
export function AssetsEmpty({ children }: { children: React.ReactNode }) { return <div className="rounded-2xl border border-dashed border-emerald-900 bg-emerald-950/10 p-10 text-center text-sm text-stone-500">{children}</div>; }
