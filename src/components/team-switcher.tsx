"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { selectTeamAction } from "@/app/actions";

export type TeamSwitcherProps = { options: { value: string; label: string }[]; selected: string };

/**
 * Selector del equipo que se está viendo. Con una sola opción solo muestra el nombre.
 * El servidor valida la elección contra los equipos permitidos: aquí no se decide ningún permiso.
 */
export function TeamSwitcher({ options, selected }: TeamSwitcherProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (options.length === 0) return null;
  const current = options.find((o) => o.value === selected) ?? options[0]!;

  if (options.length === 1) {
    return <span className="max-w-40 truncate rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 sm:max-w-64">{current.label}</span>;
  }
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
      <span className="hidden sm:inline">Ver:</span>
      <select
        aria-label="Equipo a ver"
        value={current.value}
        disabled={pending}
        className="input !min-h-9 max-w-40 truncate !py-1 text-sm font-medium text-slate-800 sm:max-w-64"
        onChange={(e) => {
          const fd = new FormData();
          fd.set("team", e.target.value);
          start(async () => {
            await selectTeamAction(fd);
            router.refresh();
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
