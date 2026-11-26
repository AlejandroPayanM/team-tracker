import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <p className="text-5xl font-semibold tracking-tight text-indigo-600">404</p>
        <h1 className="mt-3 text-lg font-semibold">No encontramos esa página</h1>
        <p className="mt-1 text-sm text-slate-500">Puede que el enlace ya no exista o que la persona haya sido eliminada.</p>
        <Link href="/" className="btn mt-6">
          Ir al resumen
        </Link>
      </div>
    </main>
  );
}
