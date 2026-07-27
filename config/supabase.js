/* ==========================================================
   SIGT — SAN SALVADOR SUR
   config/supabase.js
   Credenciales de conexión a Supabase.

   CÓMO PONERLO EN MARCHA:
   1. Crea una cuenta y un proyecto gratis en https://supabase.com
   2. Dentro del proyecto ve a: Project Settings > API
   3. Copia "Project URL" y "anon public" (NO "service_role") y
      pégalas en el archivo .env de la raíz del proyecto:
        VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
        VITE_SUPABASE_ANON_KEY=tu-anon-key
      (si no existe, copia .env.example y renómbralo a .env)
   4. Ejecuta el script supabase/schema.sql en el SQL Editor de tu
      proyecto (crea tablas, catálogos, RLS, auditoría y el bucket)
   5. Crea las cuentas del personal en Authentication > Users > Add user
      y asígnales rol con el UPDATE que viene al final de schema.sql.
      No hay registro público de cuentas.

   SOBRE LA ANON KEY: es pública por diseño (viaja al navegador de
   cualquier visitante). La seguridad real la dan las políticas RLS
   definidas en supabase/schema.sql, no el secreto de esta clave.
   NUNCA pongas aquí ni en el .env la clave "service_role": esa ignora RLS.

   El inicio de sesión NO ocurre en el visor (index.html), sino en el
   panel administrativo (admin.html).
   ========================================================== */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

/** Bucket de Storage donde se guardan las fotografías. */
export const SUPABASE_PHOTOS_BUCKET = "fotos-sigt";

/** Origen del SDK de Supabase (se carga como módulo ES). */
export const SUPABASE_CLIENT_URL = "https://esm.sh/@supabase/supabase-js@2";

/** Minutos de inactividad antes de cerrar la sesión en el panel admin. */
export const SESSION_TIMEOUT_MINUTES = 30;

export function isSupabaseConfigured() {
    return Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
}
