export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <div className="text-lg font-semibold">Pagina no encontrada</div>
        <div className="mt-2 text-sm text-slate-400">La ruta solicitada no existe.</div>
      </div>
    </div>
  );
}