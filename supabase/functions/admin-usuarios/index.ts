/* ==========================================================
   SIGT — SAN SALVADOR SUR
   Edge Function: admin-usuarios

   Permite crear, modificar y eliminar cuentas desde el propio
   sistema, sin entrar al panel de Supabase.

   POR QUÉ UNA FUNCIÓN Y NO CÓDIGO EN EL NAVEGADOR
   -----------------------------------------------
   Crear cuentas exige la clave `service_role`, que ignora TODAS las
   políticas de seguridad (RLS). Si esa clave viajara al navegador,
   cualquiera que abriera el código fuente tendría control total de la
   base de datos: leer, alterar o borrar todo.

   Por eso la clave vive solo aquí, en el servidor. Esta función:
     1. Comprueba el JWT de quien llama (sesión real y vigente).
     2. Verifica en la tabla `usuarios` que tenga rol 'admin' y esté
        activo. Un editor o consulta recibe 403.
     3. Recién entonces usa la API de administración.

   DESPLIEGUE
   ----------
     npx supabase login
     npx supabase link --project-ref TU_REFERENCIA
     npx supabase functions deploy admin-usuarios

   No hace falta configurar secretos: SUPABASE_URL y
   SUPABASE_SERVICE_ROLE_KEY ya existen en el entorno de las
   Edge Functions.
   ========================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), {
        status,
        headers: { ...cors, "Content-Type": "application/json" }
    });

const ROLES_VALIDOS = ["admin", "editor", "consulta"];

function correoValido(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    /* ---------- 1. ¿Quién llama? ---------- */
    const cabecera = req.headers.get("Authorization") || "";
    const token = cabecera.replace("Bearer ", "").trim();
    if (!token) return json({ error: "No autorizado." }, 401);

    const { data: { user }, error: errUser } = await admin.auth.getUser(token);
    if (errUser || !user) return json({ error: "Sesión inválida o expirada." }, 401);

    /* ---------- 2. ¿Es administrador activo? ---------- */
    const { data: perfil } = await admin
        .from("usuarios")
        .select("rol_id, activo")
        .eq("id", user.id)
        .maybeSingle();

    if (!perfil || !perfil.activo || perfil.rol_id !== "admin") {
        return json({ error: "Se requiere rol de administrador." }, 403);
    }

    /* ---------- 3. Ejecutar la acción ---------- */
    let cuerpo: Record<string, string> = {};
    try {
        cuerpo = await req.json();
    } catch {
        return json({ error: "Petición mal formada." }, 400);
    }

    const accion = String(cuerpo.accion || "");

    try {
        // ---- CREAR CUENTA ----
        if (accion === "crear") {
            const email = String(cuerpo.email || "").trim().toLowerCase();
            const password = String(cuerpo.password || "");
            const nombre = String(cuerpo.nombre_completo || "").trim().slice(0, 200);
            const rol = String(cuerpo.rol_id || "consulta");

            if (!correoValido(email)) return json({ error: "Correo electrónico inválido." }, 400);
            if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
            if (!ROLES_VALIDOS.includes(rol)) return json({ error: "Rol inválido." }, 400);

            const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,               // sin correo de verificación
                user_metadata: { nombre_completo: nombre || email }
            });

            if (errCrear) {
                const msg = /already been registered|already exists/i.test(errCrear.message)
                    ? "Ya existe una cuenta con ese correo."
                    : errCrear.message;
                return json({ error: msg }, 400);
            }

            // El trigger handle_new_user crea el perfil con rol 'consulta';
            // aquí se ajusta al rol y nombre solicitados.
            await admin.from("usuarios")
                .update({ nombre_completo: nombre || email, rol_id: rol, activo: true })
                .eq("id", creado.user.id);

            return json({ ok: true, id: creado.user.id, email });
        }

        // ---- CAMBIAR CONTRASEÑA ----
        if (accion === "password") {
            const id = String(cuerpo.id || "");
            const password = String(cuerpo.password || "");
            if (!id) return json({ error: "Falta el usuario." }, 400);
            if (password.length < 8) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);

            const { error } = await admin.auth.admin.updateUserById(id, { password });
            if (error) return json({ error: error.message }, 400);
            return json({ ok: true });
        }

        // ---- ELIMINAR CUENTA ----
        if (accion === "eliminar") {
            const id = String(cuerpo.id || "");
            if (!id) return json({ error: "Falta el usuario." }, 400);
            if (id === user.id) return json({ error: "No puede eliminar su propia cuenta." }, 400);

            const { error } = await admin.auth.admin.deleteUser(id);
            if (error) return json({ error: error.message }, 400);
            return json({ ok: true });
        }

        // ---- LISTAR (correo incluido: la tabla usuarios no lo guarda) ----
        if (accion === "listar") {
            const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
            if (error) return json({ error: error.message }, 400);

            const correos: Record<string, string> = {};
            data.users.forEach(u => { correos[u.id] = u.email || ""; });
            return json({ ok: true, correos });
        }

        return json({ error: "Acción no reconocida." }, 400);

    } catch (e) {
        return json({ error: (e as Error).message || "Error interno." }, 500);
    }
});
