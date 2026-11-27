"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { movePersonAction, setTeamLeaderAction } from "@/app/admin-actions";
import { DeleteTeamButton, RenameTeamDialog } from "@/components/admin-forms";

export type BoardTeam = {
  id: string;
  name: string;
  leaderId: string | null;
  /** Quién puede ser líder de este equipo (administradores y líderes con acceso). */
  leaderOptions: { id: string; name: string }[];
};
export type BoardPerson = { id: string; name: string; teamId: string | null };

const NONE = "none";

/**
 * Tablero de equipos: una columna por equipo. Las personas se arrastran entre columnas, se mueven con el selector «⇄»
 * (sirve en el celular) o se agregan desde «+ Agregar». Cada cambio se ve al instante y se confirma en el servidor;
 * si el servidor lo rechaza, se deshace y se explica por qué.
 */
export function TeamBoard({ teams, people: serverPeople, isAdmin }: { teams: BoardTeam[]; people: BoardPerson[]; isAdmin: boolean }) {
  const [people, setPeople] = useState(serverPeople);
  const [leaders, setLeaders] = useState<Record<string, string | null>>(() => Object.fromEntries(teams.map((t) => [t.id, t.leaderId])));
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => setPeople(serverPeople), [serverPeople]);
  useEffect(() => setLeaders(Object.fromEntries(teams.map((t) => [t.id, t.leaderId]))), [teams]);

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const move = (id: string, teamId: string | null) => {
    const before = people;
    if (before.find((p) => p.id === id)?.teamId === teamId) return;
    setError(null);
    setPeople((list) => list.map((p) => (p.id === id ? { ...p, teamId } : p)));
    start(async () => {
      const r = await movePersonAction(id, teamId);
      if (r.error) {
        setPeople(before);
        setError(r.error);
      }
    });
  };

  const setLeader = (teamId: string, userId: string | null) => {
    const before = leaders[teamId] ?? null;
    setError(null);
    setLeaders((l) => ({ ...l, [teamId]: userId }));
    start(async () => {
      const r = await setTeamLeaderAction(teamId, userId);
      if (r.error) {
        setLeaders((l) => ({ ...l, [teamId]: before }));
        setError(r.error);
      }
    });
  };

  const columns: { key: string; team: BoardTeam | null }[] = [...teams.map((t) => ({ key: t.id, team: t })), ...(isAdmin ? [{ key: NONE, team: null }] : [])];

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {columns.map(({ key, team }) => {
          const here = people.filter((p) => (team ? p.teamId === team.id : p.teamId === null));
          return (
            <Column
              key={key}
              team={team}
              people={here}
              everyone={people}
              teams={teams}
              teamName={teamName}
              leaderId={team ? (leaders[team.id] ?? null) : null}
              isAdmin={isAdmin}
              highlight={over === key}
              onSetLeader={(u) => team && setLeader(team.id, u)}
              onMove={move}
              onOver={(on) => setOver((cur) => (on ? key : cur === key ? null : cur))}
            />
          );
        })}
      </div>
    </div>
  );
}

function Column({
  team,
  people,
  everyone,
  teams,
  teamName,
  leaderId,
  isAdmin,
  highlight,
  onSetLeader,
  onMove,
  onOver,
}: {
  team: BoardTeam | null;
  people: BoardPerson[];
  everyone: BoardPerson[];
  teams: BoardTeam[];
  teamName: Map<string, string>;
  leaderId: string | null;
  isAdmin: boolean;
  highlight: boolean;
  onSetLeader: (userId: string | null) => void;
  onMove: (id: string, teamId: string | null) => void;
  onOver: (on: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const target = team?.id ?? null;
  const needle = q.trim().toLowerCase();
  const candidates = everyone.filter((p) => p.teamId !== target && (!needle || p.name.toLowerCase().includes(needle)));
  const leaderName = team?.leaderOptions.find((u) => u.id === leaderId)?.name;

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onMove(id, target);
      }}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border p-4 transition sm:p-5 ${
        team ? "bg-white shadow-xs" : "border-dashed border-amber-300 bg-amber-50/40"
      } ${highlight ? "border-indigo-500 ring-2 ring-indigo-200" : team ? "border-slate-200" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold">{team ? team.name : "Sin equipo"}</h2>
          <p className="text-xs text-slate-500">
            {people.length} persona(s){!team && " · solo tú las ves"}
          </p>
        </div>
        {team && isAdmin && (
          <div className="flex shrink-0 items-center gap-1">
            <RenameTeamDialog id={team.id} name={team.name} />
            <DeleteTeamButton id={team.id} name={team.name} people={people.length} />
          </div>
        )}
      </div>

      {team && (
        <div className="text-xs text-slate-600">
          {isAdmin ? (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Líder:</span>
              <select
                value={leaderId ?? ""}
                onChange={(e) => onSetLeader(e.target.value || null)}
                className="input !min-h-9 !w-auto max-w-full !py-1 text-sm"
                aria-label={`Líder de ${team.name}`}
              >
                <option value="">Sin líder</option>
                {team.leaderOptions.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              <span className="font-medium">Líder:</span> {leaderName ?? "sin designar"}
            </p>
          )}
        </div>
      )}

      <ul className="min-h-16 flex-1 space-y-1.5" aria-label={`Personas de ${team ? team.name : "sin equipo"}`}>
        {people.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-400">
            {team ? "Arrastra personas aquí o usa «+ Agregar»." : "Todas tienen equipo."}
          </li>
        )}
        {people.map((p) => (
          <li
            key={p.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", p.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            className="group flex cursor-grab items-center gap-1 rounded-lg border border-slate-200 bg-white py-1 pl-3 pr-1 shadow-xs active:cursor-grabbing"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            <label className="relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Mover a otro equipo">
              <span aria-hidden className="text-base leading-none">⇄</span>
              <select
                aria-label={`Mover a ${p.name} a otro equipo`}
                value=""
                onChange={(e) => onMove(p.id, e.target.value === NONE ? null : e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                <option value="" disabled>Mover a…</option>
                {teams
                  .filter((t) => t.id !== p.teamId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                {isAdmin && p.teamId && <option value={NONE}>Sin equipo</option>}
              </select>
            </label>
            {isAdmin && team && (
              <button
                type="button"
                onClick={() => onMove(p.id, null)}
                aria-label={`Quitar a ${p.name} del equipo`}
                title="Quitar del equipo"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {team && (
        <div className="border-t border-slate-100 pt-3">
          {!adding ? (
            <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
              + Agregar
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar persona…"
                  aria-label="Buscar persona para agregar"
                  className="input"
                />
                <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => (setAdding(false), setQ(""))}>
                  Listo
                </button>
              </div>
              {candidates.length === 0 ? (
                <p className="text-sm text-slate-400">No hay más personas para agregar.</p>
              ) : (
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                  {candidates.slice(0, 30).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onMove(p.id, team.id)}
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-indigo-50"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        <span className="shrink-0 text-xs text-slate-500">{p.teamId ? `de ${teamName.get(p.teamId) ?? "otro equipo"}` : "sin equipo"}</span>
                        <span aria-hidden className="shrink-0 text-indigo-600">+</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
