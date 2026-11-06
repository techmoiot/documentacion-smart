# Sistema de documentación visual de infraestructura de red – Smart Connection

## 1. Descripción general

Desarrollar una plataforma web centralizada para documentar, administrar y visualizar gráficamente toda la infraestructura de red de Smart Connection, incluyendo redes de fibra óptica (FTTH), nodos de distribución, radioenlaces, torres, antenas, racks, switches, routers, OLT, ODF, UPS y demás equipos de telecomunicaciones.

El sistema debe permitir representar visualmente la infraestructura física y lógica de la red, mostrando cómo están interconectados los dispositivos, sus puertos, interfaces, conexiones y enlaces.

El objetivo es disponer de un mapa técnico e interactivo que permita conocer la topología completa de la red, facilitar el mantenimiento, solucionar fallas y llevar un control preciso de los equipos instalados.

## 2. Módulo de nodos y sitios de infraestructura

Cada nodo debe contar con una ficha individual donde se pueda documentar:

- Nombre del nodo.
- Código de identificación.
- Ubicación geográfica.
- Coordenadas GPS.
- Dirección o referencia.
- Fotografías del sitio.
- Tipo de nodo.
- Descripción técnica.
- Equipos instalados.
- Estado operativo.
- Fecha de instalación.
- Responsable técnico.

Cada nodo tendrá una representación gráfica de su infraestructura interna.

### Visualización de racks

Uno de los componentes principales será un editor gráfico de racks.

Debe permitir visualizar un rack de telecomunicaciones de forma frontal, representando los equipos instalados en sus respectivas unidades (U).

Ejemplo de equipos:

- Router MikroTik.
- Switches de distribución.
- OLT ZTE.
- ODF de fibra óptica.
- Patch panels.
- Organizadores de cableado.
- UPS.
- Servidores.
- Equipos de radio.
- Otros dispositivos.

Cada equipo debe ocupar visualmente el espacio correspondiente a sus dimensiones físicas.

**Interacción con el rack:**

- Visualizar el rack completo.
- Identificar la posición de cada equipo.
- Hacer clic sobre un equipo para abrir su información técnica.
- Hacer zoom para observar los puertos y conexiones.
- Visualizar los puertos frontales de switches, routers, ODF y patch panels.
- Seleccionar un puerto para identificar a qué equipo o dispositivo está conectado.
- Resaltar gráficamente las conexiones entre equipos.
- Mostrar el recorrido de un cable desde su origen hasta su destino.
- Permitir agregar, editar, mover y retirar equipos del rack.

Por ejemplo, al seleccionar el puerto SFP+3 de un MikroTik, el sistema debe resaltar la conexión física y mostrar hacia dónde se dirige, identificando el equipo y puerto de destino.

## 3. Módulo de fibra óptica (FTTH)

Este módulo permitirá documentar toda la infraestructura de fibra óptica.

Debe incluir:

- OLT.
- Tarjetas de servicio.
- Puertos PON.
- ODF.
- Cajas NAP.
- Cajas de distribución.
- Splitters.
- Cables troncales.
- Cables de distribución.
- Clientes y puntos de terminación.

### Representación gráfica

Crear un diagrama interactivo donde se pueda visualizar el recorrido de la fibra desde la OLT hasta los puntos de distribución y clientes.

Ejemplo:

OLT → Puerto PON → ODF → Cable troncal → Splitter principal → NAP → Cliente.

Cada elemento debe ser seleccionable y mostrar sus características técnicas.

También debe permitir documentar:

- Número de fibras.
- Tipo de cable.
- Capacidad del cable.
- Fibras utilizadas y disponibles.
- Hilos asignados.
- Atenuación registrada.
- Distancias.
- Relaciones entre cajas y equipos.

Debe ser posible identificar qué clientes o sectores dependen de un determinado puerto PON, splitter o tramo de fibra.

## 4. Módulo de radioenlaces inalámbricos

Este módulo debe permitir documentar gráficamente los enlaces inalámbricos entre diferentes nodos.

La visualización debe representar las antenas y sus conexiones mediante líneas direccionales.

Ejemplo:

Antena A (Nodo Principal) → Antena B (Nodo Secundario).

La conexión debe representarse con una línea punteada que indique visualmente la dirección del enlace.

### Visualización gráfica de radioenlaces

Cada antena debe mostrarse como un elemento gráfico seleccionable.

Al seleccionar una antena, debe mostrar:

- Nombre de la antena.
- Nodo al que pertenece.
- Marca y modelo.
- Dirección IP.
- Coordenadas GPS.
- Altura de instalación.
- Frecuencia de operación.
- Ancho de canal.
- Potencia de transmisión.
- Ganancia de antena.
- Polarización.
- Capacidad del enlace.
- Estado operativo.

Al seleccionar la línea que conecta dos antenas, debe abrirse una ventana con información del radioenlace:

- Antena de origen.
- Antena de destino.
- Distancia entre antenas.
- Frecuencia.
- Nivel de señal (RSSI).
- Capacidad del enlace.
- Disponibilidad.
- Fecha de instalación.
- Fotografías.
- Observaciones técnicas.

También debe permitir representar enlaces punto a punto (PTP) y punto multipunto (PTMP).

Los enlaces deben diferenciarse visualmente según su estado: operativo, degradado, fuera de servicio o pendiente de instalación.

## 5. Mapa geográfico de infraestructura

Implementar un mapa interactivo donde se visualicen todos los nodos, torres, sitios y puntos de distribución.

Funciones:

- Ubicar nodos mediante coordenadas GPS.
- Mostrar conexiones entre nodos.
- Representar radioenlaces mediante líneas entre antenas.
- Mostrar recorridos de fibra óptica.
- Filtrar por tipo de infraestructura.
- Seleccionar un nodo para consultar sus equipos.
- Acercar y alejar el mapa.
- Consultar distancias entre ubicaciones.

El mapa debe funcionar como una vista general de toda la infraestructura de Smart Connection.

## 6. Inventario de equipos

Crear un inventario centralizado de todos los dispositivos.

Cada equipo debe tener:

- Nombre.
- Marca.
- Modelo.
- Número de serie.
- Dirección IP.
- Dirección MAC.
- Versión de firmware o sistema operativo.
- Ubicación.
- Nodo asociado.
- Rack y posición U, cuando corresponda.
- Fecha de instalación.
- Estado.
- Fotografías.
- Documentación y archivos adjuntos.

Debe permitir buscar equipos por nombre, IP, modelo, número de serie o nodo.

## 7. Conexiones físicas y lógicas

El sistema debe contar con un motor de conexiones que permita relacionar dispositivos y sus interfaces.

Cada conexión debe registrar:

- Equipo de origen.
- Puerto de origen.
- Equipo de destino.
- Puerto de destino.
- Tipo de conexión.
- Medio físico.
- Identificador del cable.
- Velocidad o capacidad.
- Estado.
- Observaciones.

Es importante diferenciar las conexiones físicas de las relaciones lógicas, como VLAN, interfaces virtuales, enlaces troncales y redes IP.

Al seleccionar cualquier conexión, el sistema debe resaltarla gráficamente y mostrar ambos extremos.

## 8. Experiencia de usuario e interfaz

La plataforma debe contar con una interfaz moderna, profesional y enfocada en operaciones de telecomunicaciones.

Debe priorizar la visualización gráfica sobre las tablas tradicionales.

Funciones principales:

- Navegación por nodos.
- Vista general de infraestructura.
- Visualización de racks.
- Diagramas interactivos de conexiones.
- Zoom y desplazamiento.
- Paneles de información contextual.
- Búsqueda global.
- Filtros.
- Edición visual de infraestructura.
- Historial de modificaciones.

La interfaz debe permitir pasar de una vista general de la red a una vista detallada de un puerto o conexión sin perder la ubicación dentro de la infraestructura.

## 9. Usuarios y permisos

Implementar autenticación y diferentes niveles de acceso:

- Administrador: control total del sistema.
- Ingeniero de red: administración de nodos, equipos y conexiones.
- Técnico: consulta y actualización de información autorizada.
- Solo lectura: visualización de la infraestructura.

Registrar un historial de cambios para conocer quién modificó cada elemento y cuándo.

## 10. Objetivo final

Construir un sistema que funcione como el mapa técnico central de Smart Connection.

La plataforma debe permitir conocer en cualquier momento:

- Qué equipos existen.
- Dónde están instalados.
- Cómo están conectados.
- Qué puertos utilizan.
- Qué enlaces dependen de cada nodo.
- Qué infraestructura de fibra existe.
- Qué radioenlaces conectan los diferentes sitios.
- Qué equipos o conexiones podrían verse afectados ante una falla.

El resultado debe ser una plataforma escalable, visual, interactiva y preparada para crecer junto con la infraestructura de la empresa.