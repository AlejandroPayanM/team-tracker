"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addNoteAction,
  createMemberAction,
  deleteMemberAction,
  loginAction,
  syncNowAction,
  testConnectionsAction,
  updateMemberAction,
  type FormState,
} from "@/app/actions";

export function SubmitButton({
  children,
  className = "btn",
  confirm,
}: {
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Procesando…" : children}
    </button>
  );
}

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-700">{state.ok}</p>;
  return null;
}

const initial: FormState = {};

export function LoginForm() {
  const [state, action] = useActionState(loginAction, initial);
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium">
        Correo
        <input name="email" type="email" autoComplete="username" required className="input mt-1" />
      </label>
      <label className="block text-sm font-medium">
        Contraseña
        <input name="password" type="password" autoComplete="current-password" required className="input mt-1" />
      </label>
      <Msg state={state} />
      <SubmitButton className="btn w-full">Entrar</SubmitButton>
    </form>
  );
}

type MemberDefaults = {
  id?: string;
  name?: string;
  email?: string;
  githubLogin?: string | null;
  zohoEmail?: string | null;
  position?: string | null;
};

export function MemberForm({ member }: { member?: MemberDefaults }) {
  const [state, action] = useActionState(member?.id ? updateMemberAction : createMemberAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {member?.id && <input type="hidden" name="id" value={member.id} />}
      <label className="text-sm font-medium">
        Nombre
        <input name="name" required defaultValue={member?.name} className="input mt-1" maxLength={100} />
      </label>
      <label className="text-sm font-medium">
        Correo (el mismo de GitHub/Zoho)
        <input name="email" type="email" required defaultValue={member?.email} className="input mt-1" />
      </label>
      <label className="text-sm font-medium">
        Usuario de GitHub <span className="font-normal text-slate-500">(opcional, se intenta detectar)</span>
        <input name="githubLogin" defaultValue={member?.githubLogin ?? ""} className="input mt-1" placeholder="octocat" />
      </label>
      <label className="text-sm font-medium">
        Puesto <span className="font-normal text-slate-500">(opcional)</span>
        <input name="position" defaultValue={member?.position ?? ""} className="input mt-1" maxLength={100} />
      </label>
      <label className="text-sm font-medium sm:col-span-2">
        Correo en Zoho <span className="font-normal text-slate-500">(solo si es distinto al correo de arriba)</span>
        <input name="zohoEmail" type="email" defaultValue={member?.zohoEmail ?? ""} className="input mt-1" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <SubmitButton>{member?.id ? "Guardar cambios" : "Agregar compañero"}</SubmitButton>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function NoteForm({ memberId }: { memberId: string }) {
  const [state, action] = useActionState(addNoteAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="memberId" value={memberId} />
      <textarea name="body" required maxLength={2000} rows={3} className="input" placeholder="Nota de seguimiento, acuerdo o tema pendiente…" />
      <div className="flex flex-wrap items-center gap-2">
        <select name="kind" className="input w-auto" defaultValue="NOTE">
          <option value="NOTE">Nota</option>
          <option value="ACTION">Acuerdo / pendiente</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          Fecha límite
          <input name="dueDate" type="date" className="input w-auto" />
        </label>
        <SubmitButton>Agregar</SubmitButton>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function DeleteMemberForm({ id, email }: { id: string; email: string }) {
  const [state, action] = useActionState(deleteMemberAction, initial);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-slate-600">
        Elimina definitivamente a este compañero y su historial de seguimiento (notas). Los PRs quedan sin asignar.
        Escribe <strong>{email}</strong> para confirmar.
      </p>
      <div className="flex gap-2">
        <input name="confirm" className="input" autoComplete="off" />
        <SubmitButton className="btn-danger">Eliminar</SubmitButton>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function IntegrationPanel() {
  const [syncState, syncAction] = useActionState(syncNowAction, initial);
  const [testState, testAction] = useActionState(testConnectionsAction, initial);
  return (
    <div className="space-y-4">
      <form action={testAction} className="space-y-2">
        <SubmitButton className="btn-ghost">Probar conexiones</SubmitButton>
        <Msg state={testState} />
      </form>
      <form action={syncAction} className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Sincronizar ahora</SubmitButton>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="full" /> Completa (reconsulta todo el periodo)
          </label>
        </div>
        <Msg state={syncState} />
      </form>
    </div>
  );
}
