// Se muestra al navegar entre pantallas mientras el servidor prepara los datos (evita la sensación de "congelado" en el celular).
const block = "animate-pulse rounded-xl bg-slate-200/70";

export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando">
      <div className="space-y-2">
        <div className={`${block} h-8 w-56`} />
        <div className={`${block} h-4 w-80 max-w-full`} />
      </div>
      <div className={`${block} h-14 w-full`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${block} h-24`} />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${block} h-52`} />
        <div className={`${block} h-52`} />
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
