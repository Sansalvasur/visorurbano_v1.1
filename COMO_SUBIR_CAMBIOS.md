# Cómo subir cambios al repositorio

Repositorio remoto: `https://github.com/Sansalvasur/visorurbano_v1.1`
Rama principal: `main`

## Flujo normal (día a día)

Desde la carpeta del proyecto (`VISOR DE SAN SALVADOR SUR`), abre una terminal y ejecuta:

```bash
git status
```

Esto te muestra qué archivos cambiaron. Luego:

```bash
git add .
git commit -m "Descripción breve de lo que cambiaste"
git push
```

- `git add .` prepara todos los archivos modificados (respeta `.gitignore`, así que `node_modules`, `dist`, `.env` y `supabase/.temp/` nunca se suben).
- `git commit -m "..."` guarda esos cambios localmente con un mensaje explicando qué hiciste.
- `git push` sube el commit a GitHub.

## Ver el historial

```bash
git log --oneline
```

## Si `git push` pide iniciar sesión

Se abrirá una ventana de Git Credential Manager (o el navegador). Inicia sesión con la cuenta de GitHub que tenga acceso de escritura al repositorio (`cja2001`).

## Antes de subir algo, revisa que no incluya datos sensibles

Nunca subas:
- El archivo `.env` (contiene las claves de Supabase) — ya está en `.gitignore`.
- La carpeta `supabase/.temp/` (contiene el ID del proyecto y datos de conexión a la base de datos) — ya está en `.gitignore`.

Si agregas un archivo nuevo con contraseñas, tokens o claves, añádelo a `.gitignore` **antes** de hacer `git add`.

## Traer cambios que otra persona subió

Si alguien más subió cambios (por ejemplo desde otra computadora), antes de empezar a trabajar ejecuta:

```bash
git pull
```

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `git status` | Muestra archivos modificados/nuevos |
| `git diff` | Muestra los cambios línea por línea antes de hacer commit |
| `git add <archivo>` | Prepara solo ese archivo (en vez de todos con `.`) |
| `git log --oneline` | Historial resumido de commits |
| `git pull` | Descarga y aplica los cambios más recientes del remoto |
| `git push` | Sube tus commits al remoto |
