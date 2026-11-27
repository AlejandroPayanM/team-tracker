"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createTeamAction,
  createUserAction,
  deleteTeamAction,
  deleteUserAction,
  renameTeamAction,
  resetPasswordAction,
  updateUserAction,
  type AdminState,
} from "@/app/admin-actions";
import { Dialog, useDialog } from "@/components/dialog";
import { SubmitButton } from "@/components/forms";

const initial: AdminState = {};
const checkbox = "h-5 w-5 shrink-0 rounded border-slate-300 accent-indigo-600";

type TeamRef = { id: string; name: string };

function Msg({ state }: { state: AdminState }) {
  if (state.error) return <p role="alert" className="break-words text-sm text-red-600">{state.error}</p>;
  if (state.ok && !state.tempPassword) return <p className="break-words text-sm text-emerald-700">{state.ok}</p>;
  return null;
}

/** Cierra el diálogo cuando la acción terminó bien (salvo que haya algo que mostrar, como una contraseña temporal). */
function useCloseOnOk(state: AdminState) {
  const dialog = useDialog();
  useEffect(() => {
    if (state.ok && !state.tempPassword) dialog?.close();
  }, [state, dialog]);
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">{children}</div>;
}

/** Contraseña temporal: se muestra una sola vez (no queda guardada en ningún lado). */
function Credentials({ state }: { state: AdminState }) {
  const [copied, setCopied] = useState(false);
  if (!state.tempPassword) return null;
  const text = `Correo: ${state.email}\nContraseña temporal: ${state.tempPassword}`;
  return (
    <div className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
      <p className="font-semibold text-emerald-900">{state.ok}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-emerald-800">Correo</dt>
        <dd className="break-all font-medium">{state.email}</dd>
        <dt className="text-emerald-800">Contraseña</dt>
        <dd>
          <code className="select-all break-all rounded bg-white px-2 py-0.5 font-mono">{state.tempPassword}</code>
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
        >
          {copied ? "Copiado ✓" : "Copiar correo y contraseña"}
        </button>
        <span className="text-xs text-emerald-800">No se vuelve a mostrar. Tendrá que cambiarla al entrar.</span>
      </div>
    </div>
  );
}

// ───────── Equipos ─────────

export function NewTeamDialog({ unassigned, primary }: { unassigned: number; primary?: boolean }) {
  return (
    <Dialog label="+ Nuevo equipo" title="Nuevo equipo" description="Un equipo o célula agrupa a las personas a las que das seguimiento." triggerClassName={primary ? "btn" : "btn btn-sm"}>
      <NewTeamForm unassigned={unassigned} />
    </Dialog>
  );
}

function NewTeamForm({ unassigned }: { unassigned: number }) {
  const [state, action] = useActionState(createTeamAction, initial);
  useCloseOnOk(state);
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Nombre
        <input name="name" required minLength={2} maxLength={60} autoFocus className="input mt-1" placeholder="Ej. Plataforma" />
      </label>
      {unassigned > 0 && (
        <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <input type="checkbox" name="adopt" className={`${checkbox} mt-0.5`} />
          <span>
            Mover a este equipo a las <strong>{unassigned}</strong> persona(s) que hoy no tienen equipo
          </span>
        </label>
      )}
      <Msg state={state} />
      <Footer>
        <SubmitButton className="btn w-full sm:w-auto">Crear equipo</SubmitButton>
      </Footer>
    </form>
  );
}

export function RenameTeamDialog({ id, name }: TeamRef) {
  return (
    <Dialog label="Renombrar" title="Renombrar equipo">
      <RenameForm id={id} name={name} />
    </Dialog>
  );
}

function RenameForm({ id, name }: TeamRef) {
  const [state, action] = useActionState(renameTeamAction, initial);
  useCloseOnOk(state);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input name="name" defaultValue={name} required minLength={2} maxLength={60} autoFocus className="input" aria-label="Nombre del equipo" />
      <Msg state={state} />
      <Footer>
        <SubmitButton className="btn w-full sm:w-auto">Guardar</SubmitButton>
      </Footer>
    </form>
  );
}

export function DeleteTeamButton({ id, name, people }: TeamRef & { people: number }) {
  return (
    <form action={deleteTeamAction}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton
        className="rounded-md px-2 py-1.5 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600"
        confirm={`¿Eliminar el equipo «${name}»? ${people ? `Sus ${people} persona(s) quedarán sin equipo (no se borran).` : "Está vacío."}`}
      >
        Eliminar
      </SubmitButton>
    </form>
  );
}

// ───────── Usuarios ─────────

const ROLES = [
  { value: "MANAGER", label: "Líder de equipo", hint: "Ve y administra a las personas de sus equipos." },
  { value: "VIEWER", label: "Solo lectura", hint: "Consulta sus equipos, sin modificar nada." },
  { value: "ADMIN", label: "Administrador", hint: "Ve todo y administra equipos, usuarios e integraciones." },
] as const;

function RolePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">¿Qué podrá hacer?</legend>
      {ROLES.map((r) => (
        <label
          key={r.value}
          className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
            value === r.value ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <input type="radio" name="role" value={r.value} checked={value === r.value} onChange={() => onChange(r.value)} className="mt-1 h-4 w-4 shrink-0 accent-indigo-600" />
          <span className="min-w-0 text-sm">
            <span className="block font-semibold">{r.label}</span>
            <span className="block text-slate-500">{r.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function TeamChecks({ teams, selected }: { teams: TeamRef[]; selected?: string[] }) {
  if (teams.length === 0) return <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Todavía no hay equipos. Crea uno en la pestaña «Equipos» y vuelve aquí.</p>;
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">¿Qué equipos podrá ver?</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {teams.map((t) => (
          <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm hover:bg-slate-50">
            <input type="checkbox" name="teamIds" value={t.id} defaultChecked={selected?.includes(t.id)} className={checkbox} />
            <span className="min-w-0 break-words">{t.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function NewUserDialog({ teams, primary }: { teams: TeamRef[]; primary?: boolean }) {
  return (
    <Dialog label="+ Nuevo usuario" title="Nuevo usuario" description="Le damos una contraseña temporal que tendrá que cambiar al entrar." triggerClassName={primary ? "btn" : "btn btn-sm"}>
      <NewUserForm teams={teams} />
    </Dialog>
  );
}

function NewUserForm({ teams }: { teams: TeamRef[] }) {
  const [state, action] = useActionState(createUserAction, initial);
  const [role, setRole] = useState("MANAGER");
  if (state.tempPassword) return <Credentials state={state} />;
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Nombre
          <input name="name" required maxLength={100} autoFocus className="input mt-1" autoComplete="off" />
        </label>
        <label className="text-sm font-medium">
          Correo
          <input name="email" type="email" required maxLength={200} className="input mt-1" autoComplete="off" />
        </label>
      </div>
      <RolePicker value={role} onChange={setRole} />
      {role !== "ADMIN" && <TeamChecks teams={teams} />}
      <Msg state={state} />
      <Footer>
        <SubmitButton className="btn w-full sm:w-auto">Crear usuario</SubmitButton>
      </Footer>
    </form>
  );
}

export function EditUserDialog({ id, name, email, role, teamIds, teams, self }: { id: string; name: string; email: string; role: string; teamIds: string[]; teams: TeamRef[]; self: boolean }) {
  return (
    <Dialog label="Editar" title={name} description={email}>
      <EditUserForm id={id} role={role} teamIds={teamIds} teams={teams} self={self} />
      <hr className="border-slate-100" />
      <UserDanger id={id} email={email} self={self} />
    </Dialog>
  );
}

function EditUserForm({ id, role: initialRole, teamIds, teams, self }: { id: string; role: string; teamIds: string[]; teams: TeamRef[]; self: boolean }) {
  const [state, action] = useActionState(updateUserAction, initial);
  const [role, setRole] = useState(initialRole);
  useCloseOnOk(state);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <RolePicker value={role} onChange={setRole} />
      {role !== "ADMIN" ? <TeamChecks teams={teams} selected={teamIds} /> : <p className="text-sm text-slate-500">Un administrador ve todos los equipos.</p>}
      {self && role !== "ADMIN" && <p className="text-sm text-amber-700">No puedes quitarte a ti mismo el rol de administrador.</p>}
      <Msg state={state} />
      <Footer>
        <SubmitButton className="btn w-full sm:w-auto">Guardar cambios</SubmitButton>
      </Footer>
    </form>
  );
}

function UserDanger({ id, email, self }: { id: string; email: string; self: boolean }) {
  const [resetState, resetAction] = useActionState(resetPasswordAction, initial);
  const [delState, delAction] = useActionState(deleteUserAction, initial);
  useCloseOnOk(delState);
  if (self) return <p className="text-sm text-slate-500">Esta es tu cuenta: cambia tu contraseña desde «Mi cuenta».</p>;
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Acceso</h3>
      {resetState.tempPassword ? (
        <Credentials state={resetState} />
      ) : (
        <form action={resetAction} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-slate-500">Si olvidó su contraseña: genera una nueva temporal y se cierran sus sesiones.</p>
          <SubmitButton className="btn-ghost w-full sm:w-auto" confirm={`¿Restablecer la contraseña de ${email}? Se cerrarán sus sesiones.`}>
            Restablecer contraseña
          </SubmitButton>
          <Msg state={resetState} />
        </form>
      )}
      <form action={delAction} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <SubmitButton className="btn-danger w-full sm:w-auto" confirm={`¿Eliminar a ${email}? No se puede deshacer.`}>
          Eliminar usuario
        </SubmitButton>
        <Msg state={delState} />
      </form>
    </div>
  );
}
