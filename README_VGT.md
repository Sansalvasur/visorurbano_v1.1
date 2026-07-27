# SIGT — Sistema Integral de Gestión Territorial
### San Salvador Sur

Implementación de las funciones del informe técnico SIGT sobre el visor
territorial existente (Leaflet + Supabase/PostgreSQL).

---

## 1. Arquitectura

Una sola aplicación (`index.html`) protegida por autenticación:

1. Al abrir el sistema aparece **únicamente la pantalla de acceso**. El mapa
   no se construye ni se descargan datos hasta que el login es correcto.
2. Tras autenticarse se muestra el visor territorial completo, con **todos
   los módulos dentro del mismo panel lateral**: Capas, Estadísticas,
   Leyenda, Registro y Administración.
3. Todo el trabajo (registrar necesidades, líderes y tracks) ocurre sobre el
   mismo mapa del visor.

> El mapa y los datos están detrás del login. Un visitante sin credenciales
> no ve nada: ni el mapa, ni las capas, ni los registros.

---

## 2. Puesta en marcha

1. Crear un proyecto en <https://supabase.com>.
2. `Project Settings > API`: copiar **Project URL** y la clave **anon public**
   y pegarlas en `config/supabase.js`.
   *Nunca* usar la clave `service_role`: esa ignora las políticas de seguridad.
3. `SQL Editor > New query`: pegar y ejecutar **todo** `supabase/schema.sql`.
   Esto crea tablas, catálogos, vistas, auditoría, políticas RLS y el bucket
   de fotografías.
4. `Authentication > Users > Add user`: crear **la primera cuenta**
   (la del administrador). No existe registro público. A partir de ahí, las
   demás cuentas se crean desde la propia aplicación (ver punto 6).
5. Asignar el primer administrador (con el UID del usuario recién creado):

   ```sql
   update public.usuarios
      set rol_id = 'admin', nombre_completo = 'Nombre Apellido'
    where id = '00000000-0000-0000-0000-000000000000';
   ```

6. **Publicar la función de administración de usuarios.** Es lo que permite
   crear cuentas desde la aplicación sin entrar a Supabase:

   ```bash
   npx supabase login
   npx supabase link --project-ref TU_PROYECTO
   npx supabase functions deploy admin-usuarios
   ```

   Sin este paso todo lo demás funciona igual, pero el formulario «Crear
   usuario» avisará de que la función no está publicada.

7. Publicar la carpeta en cualquier hosting estático (Vercel, Netlify,
   GitHub Pages o el servidor de la municipalidad). **Debe servirse por
   HTTPS**: los navegadores solo permiten geolocalización en sitios seguros.

---

## 3. Modelo de datos

Tablas implementadas según el informe:

- **Seguridad y organización**: `roles`, `usuarios`, `comunidades`
- **Catálogos**: `catalogo_necesidades`, `prioridades`, `estados`
- **Operación**: `necesidades`, `referentes`, `tracks`, `fotografias`, `seguimiento`
- **Cartografía y control**: `capas`, `auditoria`
- **Vistas de consulta**: `v_necesidades`, `v_referentes`

Las coordenadas se guardan en la base de datos: `lat`/`lng` para los puntos
(necesidades y referentes) y el recorrido completo en `coordinates` (JSONB,
formato `[[lng,lat], …]`) para los tracks, junto con su longitud calculada.

---

## 4. Roles y permisos

| Rol | Lectura | Crear / Editar | Eliminar | Usuarios y auditoría |
|---|---|---|---|---|
| *(sin sesión)* | ❌ no entra | ❌ | ❌ | ❌ |
| `consulta` | ✅ | ❌ | ❌ | ❌ |
| `editor` | ✅ | ✅ | ❌ | ❌ |
| `admin` | ✅ | ✅ | ✅ | ✅ |

Los permisos se aplican en **dos capas**: la interfaz oculta o deshabilita lo
que el rol no puede hacer, y las políticas **RLS de PostgreSQL** vuelven a
verificarlo en el servidor. La interfaz es una comodidad; la base de datos es
la que manda.

---

## 5. Controles de seguridad implementados

| Requisito del informe | Cómo se cumple |
|---|---|
| Autenticación / JWT | Supabase Auth. Las contraseñas nunca pasan por código propio; el SDK gestiona el JWT y su renovación. |
| Hash de contraseñas | Gestionado por Supabase Auth (bcrypt). |
| Row Level Security | Activado en todas las tablas, con políticas por rol (`supabase/schema.sql`). |
| Protección SQL Injection | Todas las consultas van por el SDK (PostgREST), que envía los valores como parámetros. No se concatena SQL en el cliente. |
| Protección XSS | `escapeHtml()` en `assets/js/utils/security.js`: **todo** dato proveniente de la base se escapa antes de insertarse en el DOM. Las URLs se validan con `safeUrl()` (solo `http(s)`/`blob`). |
| Validación de entradas | Longitudes máximas, catálogos cerrados (`isAllowed`), coordenadas (`isValidLatLng`), correo (`isValidEmail`) y archivos (`validateImageFile`: tipo MIME real + tamaño). |
| Control de sesiones | `SessionGuard` cierra la sesión tras 30 min de inactividad (configurable en `config/supabase.js`). |
| Auditoría | Triggers en PostgreSQL registran INSERT/UPDATE/DELETE con usuario, fecha y datos antes/después. Solo el admin puede consultarla. |
| Alta de usuarios | Se hace en una Edge Function (`admin-usuarios`), no en el navegador. La clave `service_role` vive solo en el servidor de Supabase; la función valida el JWT de quien llama y exige rol `admin` activo antes de crear, modificar o borrar cuentas. |
| Mensajes de error | El login responde igual ante usuario inexistente o contraseña incorrecta, para no revelar qué correos existen. |
| HTTPS | Depende del hosting; Vercel/Netlify lo aplican por defecto. |

---

## 6. Registro en campo

- **Autogeolocalización al abrir el formulario**: el formulario aparece de
  inmediato (no espera al GPS) y se localiza solo, ya abierto, mostrando el
  progreso: «Obteniendo su ubicación GPS...» -> «Ubicación GPS obtenida
  (+/-N m)». Si el GPS falla o se deniega el permiso, avisa y deja ubicar el
  punto tocando el mapa; el formulario nunca se queda bloqueado.
- **Formulario flotante con mapa propio**: cada formulario incluye un mapa
  donde se ve el punto exacto, con marcador arrastrable, un circulo que
  representa la precision del GPS, coordenadas X/Y visibles y un boton para
  volver a ubicarse. Si se ajusta el punto a mano, el estado pasa a
  «Punto ajustado manualmente».
- **Al editar** un registro existente **no** se reubica: se respeta la
  ubicacion ya guardada.
- **Fotografias ampliables**: al tocar cualquier foto (en los popups del mapa
  o en las miniaturas del formulario) se abre a pantalla completa, con paso
  de una a otra mediante flechas, teclado o deslizando el dedo, contador
  «2 / 4» y cierre con la X, Escape o tocando el fondo.
- **Tracks de calles**, en dos modos:
  - *Grabar con GPS*: sigue la posición mientras se recorre la calle y va
    dibujando el trazo en vivo.
  - *Trazar sobre el mapa*: dibujo manual punto por punto.
  En ambos casos se calcula la longitud del recorrido automáticamente.

---

## 7. Organización de la interfaz

### 7.1 Panel lateral

- **Capas** — capas GeoJSON del municipio **y** el bloque *Registro
  territorial*, donde se encienden y apagan del mapa las **necesidades**, los
  **líderes comunitarios** y los **tracks de calles**, cada uno con su
  contador de elementos. Al apagar una capa desaparece del mapa y también de
  la leyenda.
- **Estadísticas** — resumen de las capas cartográficas.
- **Leyenda** — además de las capas GeoJSON, muestra los datos registrados:
  calles agrupadas por tipo de superficie, necesidades por tipo y líderes
  comunitarios, con el mismo formato de acordeón y contadores.
- **Registro** — botones de alta rápida (necesidad, líder, track), el estado
  de conexión y los dos accesos a las ventanas de trabajo: **Gestión de
  registros** y **Dashboard**.
- **Administración** — usuarios y auditoría *(solo admin)*.

### 7.2 Ventana de gestión de registros

El botón **«Gestionar registros»** abre un panel que **ocupa por completo el
área del mapa**: mientras se trabaja en él el mapa no se ve, para poder
revisar listados largos sin distracciones. Se cierra con la X y el mapa
vuelve tal como estaba. Contiene cinco pestañas:

| Pestaña | Contenido |
|---|---|
| **Filtros** | tipo, prioridad, estado, comunidad y texto libre; se aplican a la vez al mapa y a los listados |
| **Necesidades** | listado completo con editar, seguimiento, ver en el mapa y eliminar |
| **Líderes comunitarios** | listado de referentes con sus datos de contacto |
| **Tracks de calles** | recorridos con tipo de superficie y longitud |
| **Exportar** | descarga en GeoJSON, KML y CSV de lo que dejan ver los filtros |

### 7.3 Ventana de dashboard

El botón **«Dashboard»** abre una ventana flotante sobre el visor con:

- tarjetas de métricas (total de necesidades, resueltas, pendientes, líderes,
  tracks y kilómetros registrados);
- un gráfico (Chart.js) agrupable por **estado, prioridad, tipo o comunidad**
  y conmutable entre **barras, pastel o rosco**;
- una tabla de detalle con el reparto y su porcentaje;
- descarga del reporte en CSV.

### 7.4 Administrador de usuarios *(solo admin)*

En la pestaña **Administración** se crean cuentas sin entrar a Supabase:
nombre, correo, contraseña y rol. Desde el mismo listado se puede cambiar el
rol, restablecer la contraseña, activar/desactivar y eliminar cuentas. Las
acciones sobre la propia cuenta aparecen deshabilitadas, para que un
administrador no pueda dejarse fuera del sistema.

> **Por qué hace falta una función en el servidor.** Crear cuentas exige la
> clave `service_role`, que ignora **todas** las políticas de seguridad (RLS).
> Si esa clave viajara al navegador, cualquiera que abriera el código fuente
> tendría control total de la base de datos. Por eso el navegador solo envía
> la petición —con el JWT del administrador— a la Edge Function
> `supabase/functions/admin-usuarios`, que vuelve a comprobar en el servidor
> que quien pide es un administrador activo antes de tocar nada.

---

## 8. Uso en campo: móviles, tablets y sin conexión

### Compatibilidad con móviles y tablets
- **Móvil**: el mapa ocupa la pantalla y los paneles se abren como cajones
  deslizantes. La barra de pestañas queda **fija en la parte inferior**, al
  alcance del pulgar y siempre accesible. Tocar la pestaña activa cierra el
  panel para despejar el mapa.
- **Tablet**: panel lateral más estrecho y el panel de gráficos se abre solo
  cuando se pide.
- **Táctil**: todos los controles miden al menos 44 px; los campos usan 16 px
  de fuente para que iOS no haga zoom al enfocarlos.
- **Instalable**: incluye `manifest.webmanifest`, así que se puede "Añadir a
  la pantalla de inicio" y abrirse como una aplicación.

### Trabajo sin conexión y sincronización automática
1. **La aplicación abre sin señal.** Un *service worker* (`sw.js`) guarda el
   código, los estilos y las capas GeoJSON. Los mosaicos del mapa ya visitados
   también quedan guardados, así que las zonas recorridas se siguen viendo.
2. **Los datos se leen de una caché local.** La última copia descargada de
   necesidades, líderes, tracks y catálogos se guarda en IndexedDB.
3. **Los registros nuevos se guardan en el dispositivo.** Si no hay señal —o
   si la petición falla por red— el registro y sus fotografías van a una cola
   local en lugar de perderse. Aparecen en el mapa y en las listas marcados
   como *«Por subir»*, con borde punteado.
4. **Se suben solos al volver la señal.** En cuanto hay conexión, la cola se
   envía en el mismo orden en que se creó, y la insignia de pendientes
   desaparece. También se reintenta cada minuto por si el navegador dice estar
   conectado pero la red no responde de verdad.

El indicador de estado en la pestaña **Registro** muestra en todo momento si
hay conexión y cuántos registros faltan por subir.

> Requiere **HTTPS** (o `localhost`): sin él, el navegador no permite ni el
> GPS ni el service worker.

---

## 9. Integración GIS

El visor exporta lo que está en pantalla (respetando los filtros activos):

- **GeoJSON** — importable directamente en QGIS.
- **KML** — abre en Google Earth y también se importa en QGIS.

La base es PostgreSQL, por lo que QGIS puede conectarse directamente a ella.
Si se habilita la extensión **PostGIS** (una línea comentada al inicio de
`schema.sql`), se suman consultas espaciales y capas vivas vía conexión directa.

---

## 10. Estructura de archivos

```
├── index.html                 Aplicación completa (login + visor)
├── sw.js                      Service worker (funcionamiento sin conexión)
├── manifest.webmanifest       Permite instalarla como aplicación
├── config/
│   ├── layers.json            Configuración de capas del mapa
│   └── supabase.js            ← credenciales (completar)
├── supabase/
│   ├── schema.sql             ← ejecutar en el SQL Editor
│   └── functions/
│       └── admin-usuarios/    ← Edge Function: alta y gestión de cuentas
│           └── index.ts
├── assets/
│   ├── css/                   estilos (incl. registry.css y admin.css)
│   ├── js/
│   │   ├── app.js             arranque del visor
│   │   ├── core/
│   │   │   ├── auth.js        puerta de acceso (login / roles / sesión)
│   │   │   ├── registry.js    registro territorial (CRUD + GPS + formularios,
│   │   │   │                  ventana de gestión, dashboard y usuarios)
│   │   │   ├── sigt-client.js acceso a datos + caché + exportación GIS
│   │   │   ├── offline-store.js  cola local y caché (IndexedDB)
│   │   │   ├── sync.js        sincronización automática al recuperar señal
│   │   │   ├── lightbox.js    visor de fotografías a pantalla completa
│   │   │   └── …              mapa, capas, leyenda, estadísticas
│   │   └── utils/security.js  escapado, validación y control de sesión
│   └── images/
└── data/                      capas GeoJSON del municipio
```

---

## 11. Pendiente / siguientes pasos

- Habilitar **PostGIS** y migrar las geometrías a columnas `geometry` para
  consultas espaciales avanzadas (buffers, intersecciones, vecindad).
- Servicios **WMS/WFS** para publicar capas hacia otras instituciones.
- Notificaciones por correo al cambiar el estado de una necesidad.
