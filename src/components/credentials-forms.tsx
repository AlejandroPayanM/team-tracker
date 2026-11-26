"use client";

import { useActionState, useId, useState } from "react";
import { removeCredentialsAction, saveGithubCredentialsAction, saveZohoCredentialsAction, type FormState } from "@/app/actions";
import { SubmitButton } from "@/components/forms";

export type FieldInfo = {
  source: "app" | "env" | "none" | "unreadable";
  /** Para mostrar: secretos enmascarados ("•••• 1a2b"), el resto tal cual. */
  display: string | null;
  secret: boolean;
  /** "26/11/26, 12:08 p.m. · alguien@correo" cuando está guardado en la app. */
  meta: string | null;
};

const initial: FormState = {};

/**
 * Tarjeta de una integración: muestra su estado y, solo si se pulsa «Configurar», despliega el formulario
 * de credenciales. El formulario sigue montado mientras está oculto, así que no pierde lo escrito.
 */
export function IntegrationCard({
  title,
  summary,
  canConfigure,
  children,
}: {
  title: string;
  summary: React.ReactNode;
  canConfigure: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {canConfigure && (
          <button type="button" className="btn-ghost" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
            {open ? "Ocultar" : "Configurar"}
          </button>
        )}
      </header>
      <div className="p-4">
        {summary}
        {canConfigure && (
          <div id={panelId} hidden={!open} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

function Msg({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-600">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-emerald-700">{state.ok}</p>;
  return null;
}

function SourceBadge({ info }: { info: FieldInfo }) {
  const map = {
    app: ["bg-emerald-100 text-emerald-800", "guardado en la app"],
    env: ["bg-sky-100 text-sky-800", "variable de entorno"],
    none: ["bg-amber-100 text-amber-800", "sin configurar"],
    unreadable: ["bg-red-100 text-red-800", "no se pudo descifrar"],
  } as const;
  const [cls, label] = map[info.source];
  return <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function Field({
  name,
  label,
  info,
  hint,
  disabled,
  type = "text",
}: {
  name: string;
  label: string;
  info: FieldInfo;
  hint?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      <span>
        {label}
        <SourceBadge info={info} />
      </span>
      {info.secret ? (
        <input
          name={name}
          type="password"
          autoComplete="off"
          disabled={disabled}
          placeholder={
            disabled
              ? "Bloqueado: falta APP_ENCRYPTION_KEY"
              : info.display
                ? `${info.display} — déjalo vacío para no cambiarlo`
                : "Pega aquí el valor"
          }
          className="input mt-1 font-mono"
        />
      ) : (
        <input name={name} type={type} autoComplete="off" defaultValue={info.display ?? ""} className="input mt-1" />
      )}
      {(hint || info.meta) && (
        <span className="mt-0.5 block text-xs font-normal text-slate-500">
          {hint}
          {hint && info.meta ? " · " : ""}
          {info.meta}
        </span>
      )}
    </label>
  );
}

function RemoveButton({ group, anyStored }: { group: "github" | "zoho"; anyStored: boolean }) {
  if (!anyStored) return null;
  return (
    <form action={removeCredentialsAction}>
      <input type="hidden" name="group" value={group} />
      <SubmitButton
        className="btn-danger"
        confirm="¿Quitar lo guardado en la app para esta integración? Si existen variables de entorno, se usarán esas; si no, la integración quedará sin configurar."
      >
        Quitar lo guardado en la app
      </SubmitButton>
    </form>
  );
}

export function GithubCredentialsForm({
  token,
  org,
  encryptionReady,
}: {
  token: FieldInfo;
  org: FieldInfo;
  encryptionReady: boolean;
}) {
  const [state, action] = useActionState(saveGithubCredentialsAction, initial);
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <Field name="token" label="Token de GitHub" info={token} disabled={!encryptionReady} hint="Se prueba contra GitHub antes de guardarse" />
        <Field name="org" label="Organización" info={org} hint="Vacío = buscar en todo lo que el token pueda ver" />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="skipTest" /> Guardar sin probar
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Guardar y probar</SubmitButton>
          <Msg state={state} />
        </div>
      </form>
      <RemoveButton group="github" anyStored={token.source === "app" || org.source === "app"} />
    </div>
  );
}

export type ZohoFields = Record<"dc" | "clientId" | "clientSecret" | "refreshToken" | "portalId" | "portalName", FieldInfo>;

export function ZohoCredentialsForm({ fields, encryptionReady }: { fields: ZohoFields; encryptionReady: boolean }) {
  const [state, action] = useActionState(saveZohoCredentialsAction, initial);
  const dc = fields.dc.display ?? "com";
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <label className="block text-sm font-medium">
          <span>
            Data center
            <SourceBadge info={fields.dc} />
          </span>
          <select name="dc" defaultValue={dc} className="input mt-1">
            {["com", "eu", "in", "com.au", "jp"].map((d) => (
              <option key={d} value={d}>
                zoho.{d}
              </option>
            ))}
          </select>
        </label>
        <Field name="clientId" label="Client ID" info={fields.clientId} />
        <Field name="clientSecret" label="Client Secret" info={fields.clientSecret} disabled={!encryptionReady} />
        <Field name="refreshToken" label="Refresh token" info={fields.refreshToken} disabled={!encryptionReady} />
        <Field name="portalId" label="ID del portal" info={fields.portalId} hint="Numérico" />
        <Field name="portalName" label="Nombre del portal (opcional)" info={fields.portalName} hint="Para armar links a las tareas" />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="skipTest" /> Guardar sin probar
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Guardar y probar</SubmitButton>
          <Msg state={state} />
        </div>
      </form>
      <RemoveButton group="zoho" anyStored={Object.values(fields).some((f) => f.source === "app")} />
    </div>
  );
}
