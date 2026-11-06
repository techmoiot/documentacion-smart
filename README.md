# Topos · Documentación visual de infraestructura de red (Smart Connection)

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

## Planta externa FTTH (postes y cables, estilo OZmap)

Menú **Planta externa** (`#/planta`):

- **Postes**: herramienta *Poste* → clic en el mapa. Código automático (`P-0001`), material, altura, propietario, fotos e historial. Al arrastrar un poste, los cables que pasan por él lo siguen.
- **Cables**: herramienta *Cable de fibra* → clic sobre postes (se ajustan solos) o puntos libres; doble clic para terminar. Guarda trazado, longitud, número de hilos y el elemento del que nace (OLT, splitter, caja, otro cable). Se puede **editar el trazado** (arrastrar vértices, clic en la línea para añadir, doble clic para quitar).
- **Cajas y clientes**: NAP, cajas de empalme/distribución, splitters y clientes se colocan en el mapa; si caen sobre un poste quedan vinculados a él. Todo se puede arrastrar para reubicar.
- **Hilos**: cada cable muestra sus hilos con el código de colores TIA-598 (tubo y color); marque cada hilo como libre/usado/reservado/dañado y a qué PON, splitter o cliente está asignado.
- Selector de **mapa base** (arriba a la derecha): Calles, Satélite, Híbrido, Relieve, Topográfico y Oscuro; recuerda su elección y aplica también al Mapa general. Satélite configurable con `SAT_TILE_URL`. Los cables y postes aparecen también en el **Mapa** general.
- Los elementos siguen formando el árbol FTTH: *Ver en árbol* e *Impacto* funcionan igual.

## Importar desde OZmap (KMZ / KML)

En **Planta externa → Importar KMZ / KML** suba el archivo exportado de OZmap (también sirve Google Earth o QGIS). El asistente lista cada carpeta/capa con su geometría y propone qué es (poste, cable, NAP/CTO, caja de empalme, splitter, cliente); usted puede corregirlo antes de importar.

- Los postes a menos de 1 m de uno existente se reutilizan; los vértices de cable a menos de 3 m de un poste se anclan a él.
- El número de hilos se toma del nombre si aparece (p. ej. «Troncal 24F»).
- Reimportar el mismo archivo no duplica (mismo nombre y posición).
- Se importa sin jerarquía: después indique de qué elemento nace cada cable (Editar datos).
- Los polígonos (zonas) se ignoran. Requiere rol de escritura. Sin dependencias extra: el KMZ se lee con `zlib`.

## Versión

`document version` y el pie del menú muestran `versión+build.commit` (p. ej. `1.2.0+6.ab12cd3`): el número base está en `package.json` y el build es el número de commits, así que cambia con cada actualización.

## Torres y antenas

En **Radioenlaces**: *Nueva torre* (nombre, código, estructura, altura, GPS, responsable) y, en la ficha de cada torre (clic en su cabecera del diagrama), *Agregar antena* con el nodo ya seleccionado. Una torre sin antenas aparece igualmente en el diagrama con «+ Agregar antenas». Cada antena guarda altura, azimut, frecuencia, etc., y se enlaza con otras en *Nuevo radioenlace*.

## Equipos personalizados y racks por ambos lados

- **Plantillas**: al crear un equipo elija una plantilla (incluye `MikroTik CCR1036-12G-2S`: 12 × ether Gigabit, 2 × SFP, consola) o parta en blanco y defina tipo, marca, modelo, altura en U y grupos de puertos a su medida. Marque *Guardar como plantilla reutilizable* y aparecerá con ★ en la lista; se administran en **Inventario → Plantillas**.
- **Frente / Atrás**: cada equipo se monta en el *frente*, la parte *posterior* o *ambos lados* (profundidad completa). En la vista del rack, el selector **Frente | Atrás** alterna la cara; las U de cada lado son independientes (puede haber un equipo al frente y otro atrás en la misma U) salvo los de ambos lados, que ocupan las dos.
