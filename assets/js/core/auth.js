/* ==========================================================
   SIGT — SAN SALVADOR SUR
   auth.js  —  Puerta de acceso al visor

   El mapa y todos los datos quedan detrás de esta puerta: mientras
   no haya una sesión válida, el visor ni siquiera se construye.

   Controles:
     - Autenticación con Supabase Auth (JWT y refresh los maneja el
       SDK; las contraseñas nunca pasan por código propio).
     - Verificación del perfil y rol contra la tabla `usuarios`.
     - Cuentas desactivadas quedan fuera aunque la contraseña sea
       correcta.
     - Cierre de sesión por inactividad.
     - Mensaje de error genérico: no revela si un correo existe.
   ========================================================== */

import { cleanText, isValidEmail, SessionGuard } from "../utils/security.js";
import { getSupabase, isSupabaseConfigured, getSessionAndProfile, puedeEditar, esAdmin } from "./sigt-client.js";
import { SESSION_TIMEOUT_MINUTES } from "../../../config/supabase.js";

export class AuthGate {
    constructor({ onAuthenticated }) {
        this.onAuthenticated = onAuthenticated;
        this.supabase = null;
        this.session = null;
        this.perfil = null;
        this.sessionGuard = null;
        this.appIniciada = false;
    }

    /* ---------- API para el resto de la aplicación ---------- */
    getSupabaseClient() { return this.supabase; }
    getPerfil() { return this.perfil; }
    getUserId() { return this.session?.user?.id || null; }
    puedeEditar() { return puedeEditar(this.perfil); }
    esAdmin() { return esAdmin(this.perfil); }

    async start() {
        const form = document.getElementById("loginForm");
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            this.login();
        });

        const passwordInput = document.getElementById("loginPassword");
        const togglePassword = document.getElementById("toggleLoginPassword");
        togglePassword.addEventListener("click", () => {
            const visible = passwordInput.type === "text";
            passwordInput.type = visible ? "password" : "text";
            togglePassword.setAttribute("aria-pressed", String(!visible));
            togglePassword.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
            togglePassword.innerHTML = `<i class="fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}"></i>`;
        });

        // Mensaje heredado de un cierre de sesión por inactividad
        const aviso = sessionStorage.getItem("sigt_aviso");
        if (aviso) {
            this.error(aviso);
            sessionStorage.removeItem("sigt_aviso");
        }

        if (!isSupabaseConfigured()) {
            this.error("Configure config/supabase.js y ejecute supabase/schema.sql antes de usar el sistema.");
            document.getElementById("loginSubmit").disabled = true;
            return;
        }

        try {
            this.supabase = await getSupabase();
        } catch {
            this.error("No se pudo conectar con el servidor. Revise su conexión a internet.");
            return;
        }

        // Reanudar sesión previa si sigue vigente
        const { session, perfil } = await getSessionAndProfile(this.supabase);
        if (session && perfil && perfil.activo) {
            this.session = session;
            this.perfil = perfil;
            await this.entrar();
        }

        this.supabase.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") this.salir();
        });
    }

    error(msg) {
        const el = document.getElementById("loginError");
        if (el) el.textContent = msg;
    }

    async login() {
        const email = cleanText(document.getElementById("loginEmail").value, 200);
        const password = document.getElementById("loginPassword").value;
        const btn = document.getElementById("loginSubmit");

        this.error("");

        if (!isValidEmail(email)) {
            this.error("Ingrese un correo electrónico válido.");
            return;
        }
        if (!password || password.length < 8) {
            this.error("La contraseña debe tener al menos 8 caracteres.");
            return;
        }

        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Verificando…`;

        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Ingresar`;
        document.getElementById("loginPassword").value = "";

        if (error) {
            // Respuesta idéntica para usuario inexistente y contraseña errónea.
            this.error("Credenciales incorrectas o cuenta sin acceso.");
            return;
        }

        const { perfil } = await getSessionAndProfile(this.supabase);
        if (!perfil || !perfil.activo) {
            await this.supabase.auth.signOut();
            this.error("Su cuenta está desactivada. Contacte al administrador.");
            return;
        }

        this.session = data.session;
        this.perfil = perfil;
        await this.entrar();
    }

    async entrar() {
        document.getElementById("loginScreen").style.display = "none";
        document.getElementById("appShell").hidden = false;

        document.getElementById("adminUserName").textContent =
            this.perfil.nombre_completo || this.session.user.email;

        const badge = document.getElementById("adminUserRole");
        badge.textContent = this.perfil.rol_id;
        badge.className = `admin-role-badge role-${this.perfil.rol_id}`;

        // La pestaña de administración solo existe para el rol admin.
        // (RLS vuelve a verificarlo en el servidor.)
        if (this.esAdmin()) {
            document.querySelectorAll(".admin-only").forEach(el => { el.hidden = false; });
        }

        document.getElementById("btnLogout").addEventListener("click", () => this.logout());

        this.sessionGuard = new SessionGuard(() => this.logout(true), SESSION_TIMEOUT_MINUTES);
        this.sessionGuard.start();

        // Construir el visor una sola vez
        if (!this.appIniciada) {
            this.appIniciada = true;
            await this.onAuthenticated();
        }
    }

    salir() {
        this.sessionGuard?.stop();
        this.session = null;
        this.perfil = null;
        document.getElementById("appShell").hidden = true;
        document.getElementById("loginScreen").style.display = "flex";
    }

    async logout(porInactividad = false) {
        if (porInactividad) {
            sessionStorage.setItem("sigt_aviso", "Su sesión se cerró por inactividad.");
        }
        await this.supabase.auth.signOut();
        // Recargar deja la aplicación sin datos del usuario anterior en memoria.
        window.location.reload();
    }
}
