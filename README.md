# Smart Connection · Documentación visual de infraestructura de red

Plataforma web para documentar, visualizar y administrar toda la infraestructura de red de Smart Connection:
nodos y torres, **racks con equipos por U y puertos**, **fibra óptica FTTH** (OLT → PON → ODF → cable → splitter → NAP → cliente),
**radioenlaces** (PTP/PTMP), conexiones físicas y lógicas, mapa geográfico, inventario, usuarios con permisos e historial de cambios.

Los requisitos originales están en [`docs/requisitos.md`](docs/requisitos.md).

## Instalación en un contenedor LXC (Debian 12/13 o Ubuntu 22.04/24.04)

Dentro del contenedor, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/techmoiot/documentacion-smart/main/install.sh | bash
```

El instalador: instala Node.js 22, crea el usuario `smartdoc`, clona el repositorio en `/opt/documentacion-smart`,
instala dependencias, crea el servicio systemd `documentacion-smart`, el comando `document`, y al final
**muestra el usuario `admin` y su contraseña generada** (anótela: no se vuelve a mostrar).
La aplicación queda en `http://IP-DEL-CONTENEDOR:3000`.

> **Repositorio privado:** el `curl` anterior no funciona sin autenticación. Use una *deploy key* de solo lectura:
> configure la clave SSH en el contenedor y ejecute `REPO_URL=git@github.com:techmoiot/documentacion-smart.git bash install.sh`
> (clonando antes el repositorio o copiando `install.sh`). Así `document update` también funciona sin pedir credenciales.
> Evite poner tokens en la URL: quedarían guardados en `.git/config`.

Requisitos del LXC: ~512 MB de RAM y 1 GB de disco para empezar (las fotografías ocupan lo que usted suba). No requiere *nesting* ni privilegios especiales.

## Actualizar: `document update`

```bash
document update
```

1. Consulta GitHub y muestra los cambios que se aplicarán.
2. **Respalda** la base de datos y los archivos subidos en `/var/backups/documentacion-smart/` (conserva los últimos 10).
3. Descarga la nueva versión (`git merge --ff-only`), instala dependencias solo si cambiaron y reinicia el servicio.
4. Si el servicio no responde tras reiniciar, **revierte automáticamente** a la versión anterior.

Los datos (`/var/lib/documentacion-smart`) nunca se tocan salvo por migraciones de esquema controladas.
Si hay cambios locales en el código, avisa y se detiene; `document update --force` los descarta.

## Comando `document`

| Comando | Qué hace |
|---|---|
| `document update [--force]` | Actualiza desde GitHub (respaldo + reinicio + reversión automática) |
| `document status` | Versión, estado del servicio y URL de acceso |
| `document start \| stop \| restart` | Controla el servicio |
| `document logs [-f]` | Registros del servicio |
| `document backup [archivo]` | Respalda base de datos y archivos (`.tar.gz`) |
| `document restore <archivo>` | Restaura un respaldo |
| `document create-admin [usuario] [clave]` | Crea un administrador o restablece su clave (si omite la clave, genera una) |
| `document passwd <usuario> [clave]` | Restablece la contraseña de un usuario |
| `document list-users` | Lista usuarios |
| `document seed-demo` | Carga datos de ejemplo (solo con la base vacía; códigos `DEMO-*`) |

## Configuración

Archivo `/etc/documentacion-smart.env` (después de editarlo: `document restart`):

| Variable | Descripción | Por defecto |
|---|---|---|
| `PORT` / `HOST` | Puerto y dirección de escucha | `3000` / `0.0.0.0` |
| `DATA_DIR` | Base de datos SQLite y archivos subidos | `/var/lib/documentacion-smart` |
| `BRANCH` | Rama que sigue `document update` | `main` |
| `TRUST_PROXY=1`, `COOKIE_SECURE=1` | Úselas detrás de un proxy inverso con HTTPS | — |
| `SESSION_TTL_HOURS` | Duración de la sesión | `12` |
| `MAX_UPLOAD_MB` | Tamaño máximo por archivo | `20` |
| `TILE_URL` | Servidor de teselas del mapa (para operar sin Internet) | OpenStreetMap |

**HTTPS:** el servicio habla HTTP. Para exponerlo fuera de la red de gestión, póngalo detrás de un proxy inverso con TLS
(nginx, Caddy, Nginx Proxy Manager…) y active `TRUST_PROXY=1` y `COOKIE_SECURE=1`.

## Uso rápido

- **Mapa**: nodos por GPS, radioenlaces con flecha de dirección y color por estado, recorridos de fibra, filtros, medición de distancias.
- **Nodos y racks**: ficha del nodo → pestaña *Racks*. Clic en un equipo para ver su ficha; **clic en un puerto** (p. ej. `SFP+3` del MikroTik)
  resalta el cable y muestra equipo y puerto de destino con botón *Ir al destino*. Arrastre un equipo para moverlo de U; clic en una U vacía para agregar.
  Use la rueda para acercar y arrastre el fondo para desplazarse.
- **Topología**: diagrama de conexiones del nodo (físicas sólidas, lógicas punteadas); clic en una línea para ver ambos extremos.
- **Fibra FTTH**: árbol interactivo; al seleccionar un elemento se resalta la ruta hacia la OLT y todo lo que depende de él (clientes, NAP).
- **Radioenlaces**: antenas agrupadas por sitio, enlaces punteados animados en sentido origen → destino (PTP/PTMP); clic en la línea para la ficha del enlace.
- **Impacto de falla**: botón en nodos, equipos, fibra y radioenlaces: lista dependencias directas, clientes y nodos afectados.
- **Búsqueda global** (tecla `/`): equipos por nombre, IP, MAC, serie, modelo, nodo; clientes, antenas, enlaces.

### Roles

| Rol | Permisos |
|---|---|
| Administrador | Todo, incluida la gestión de usuarios |
| Ingeniero de red | Crear, editar, mover y eliminar nodos, racks, equipos, conexiones, fibra y radioenlaces |
| Técnico | Consultar y **actualizar datos** de elementos existentes y subir fotografías (no crea/elimina ni cambia la estructura) |
| Solo lectura | Visualización |

Cada cambio queda en el **historial** (quién, cuándo, qué campo cambió).

## Arquitectura

- **Backend**: Node.js 22 + Express, SQLite nativo (`node:sqlite`, sin compilar módulos), sesiones con cookie `HttpOnly`, contraseñas `scrypt`.
- **Frontend**: aplicación de una página sin paso de compilación (ES modules, SVG y Leaflet incluido en `public/vendor`).
- **Datos**: `DATA_DIR/smartdoc.db` y `DATA_DIR/uploads/`. Esquema con migraciones incrementales (`server/db.js`).
- Plantillas de equipo (MikroTik, ZTE, ODF, patch panel, UPS…) en `public/js/catalog.js`; los puertos son siempre editables.

### Desarrollo local

```bash
npm install
node server/cli.js create-admin admin 'UnaClaveLarga123'
npm run seed-demo      # opcional
npm start              # http://localhost:3000   (datos en ./data)
npm test
```

### Notas

- Las plantillas de equipo son orientativas (número de puertos y U): ajústelas al equipo real al crearlo.
- El mapa base usa OpenStreetMap; sin Internet, configure `TILE_URL` con un servidor de teselas local.
- Haga respaldos periódicos (`document backup`) y cópielos fuera del contenedor (snapshot del LXC o `rsync`).
