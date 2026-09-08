"use client";

import { useMemo, useState } from "react";
import NoAccess from "@/components/NoAccess";
import ActivityLog from "@/components/ActivityLog";
import DateScopeBar from "@/components/DateScopeBar";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { CustomRange, DateScopeMode, getScopeRange, shiftBaseDate } from "@/lib/dateScope";
import {
  ACTIVITY_EVENT_SELECT_KEYS,
  getActivityEventLabel,
} from "@/lib/activityEventLabels";

export default function ActivityLogPage() {
  const { profile } = useUserProfile();
  const { canAccess: canViewActivity } = useModuleAccess(profile, "actividad", "view");

  const [mode, setMode] = useState<DateScopeMode>("day");
  const [baseDate, setBaseDate] = useState(new Date());
  const [customRange, setCustomRange] = useState<CustomRange>({});
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("TODOS");
  const [includeAccess, setIncludeAccess] = useState(true);

  const range = useMemo(() => getScopeRange(mode, baseDate, customRange), [mode, baseDate, customRange]);

  const eventOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "TODOS", label: "Todos los eventos" },
      ...ACTIVITY_EVENT_SELECT_KEYS.map((eventKey) => ({
        value: eventKey,
        label: getActivityEventLabel(eventKey),
      })),
    ],
    []
  );

  if (!canViewActivity) {
    return <NoAccess message="No tienes acceso a Actividad." />;
  }

  return (
    <div className="mx-auto w-[98%] py-4 text-white">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="w-full xl:max-w-[360px]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por folio pago actor o descripcion..."
            className="w-full rounded-xl border border-white/10 bg-[#1a2336] px-4 py-3 text-[12px] text-white outline-none transition focus:border-sky-500/50"
          />
        </div>

        <DateScopeBar
          className="flex-1"
          mode={mode}
          baseDate={baseDate}
          customRange={customRange}
          onModeChange={(m) => {
            setMode(m);
            if (m !== "custom") {
              setCustomRange({});
              setBaseDate(new Date());
            }
          }}
          onNavigate={(direction) => setBaseDate((prev) => shiftBaseDate(mode, prev, direction))}
          onCustomRangeChange={(rangeValue) => {
            setCustomRange(rangeValue);
            if (rangeValue.start && rangeValue.end) {
              setMode("custom");
            }
          }}
        />

        <div className="flex flex-col gap-2 md:flex-row md:items-center xl:justify-end">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#1a2336] px-3 py-3 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={includeAccess}
              onChange={(e) => setIncludeAccess(e.target.checked)}
            />
            Accesos
          </label>

          <div className="min-w-[240px]">
            <UiSelect
              value={eventFilter}
              onChange={setEventFilter}
              options={eventOptions}
              placeholder="Todos los eventos"
            />
          </div>
        </div>
      </div>

      <ActivityLog
        from={range.from}
        to={range.to}
        hideAuthEvents={!includeAccess}
        title="Actividad del sistema"
        searchTerm={search}
        eventFilter={eventFilter}
        showInternalFilters={false}
        showHeader={false}
        rowDividers={true}
        flat={true}
      />
    </div>
  );
}