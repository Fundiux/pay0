import summary from "../../evals/hugo/phase4-summary.json";

export default function HugoEvalDiagnostics() {
  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
    <h2 className="font-semibold text-white">Evaluación controlada de Hugo</h2>
    <p className="mt-1 text-xs text-slate-500">Última ejecución sintética: {summary.evalRunId}. {summary.pairedCases} casos emparejados; revisión humana pendiente en {summary.humanReviewsPending}.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded bg-slate-950 p-3"><p className="text-xs text-slate-500">Fase 3 · legacy-v1</p><p>{summary.legacyPhase3.passCriteria} cumplen · {summary.legacyPhase3.fail} fallan · {summary.legacyPhase3.needsHumanReview} revisión</p></div>
      {(["legacy-v1", "hugo-v2"] as const).map(version => <div key={version} className="rounded bg-slate-950 p-3"><p className="text-xs text-slate-500">Fase 4 · {version}</p><p>{summary.phase4[version].passCriteria} cumplen · {summary.phase4[version].fail} fallan · {summary.phase4[version].needsHumanReview} revisión</p><p className="text-xs text-amber-300">Fallos críticos: {summary.phase4CriticalFailures[version]}</p></div>)}</div>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Categoría</th><th className="p-2">legacy-v1</th><th className="p-2">hugo-v2</th></tr></thead><tbody>{Object.entries(summary.byCategory).map(([category, scores]) => <tr key={category} className="border-t border-slate-800"><td className="p-2">{category}</td><td className="p-2">{scores["legacy-v1"].pass} P · {scores["legacy-v1"].fail} F · {scores["legacy-v1"].review} R</td><td className="p-2">{scores["hugo-v2"].pass} P · {scores["hugo-v2"].fail} F · {scores["hugo-v2"].review} R</td></tr>)}</tbody></table></div>
    <p className="mt-2 text-xs text-slate-500">Los criterios automáticos y la revisión humana se muestran por separado; no existe una puntuación única de inteligencia.</p>
  </section>;
}
