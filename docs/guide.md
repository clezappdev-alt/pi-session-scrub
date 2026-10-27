# pi-session-scrub — guía de uso

Qué es este plugin, qué comandos tiene, qué tools expone, cómo se trabaja con él en una
sesión de proyecto y —en detalle— qué hace `/scrub:handoff` y por qué conviene usarlo.

> Esta guía describe el código en **HEAD**: lo que hay en `master`, que puede ir un paso
> adelante del último tag. La especificación as-built está en [`behavior.md`](behavior.md),
> anclada al último release y verificada contra `git describe` — el número de versión vive
> ahí y sólo ahí.
> El vocabulario compartido (estado, veredicto, machine keep, fila compacta) está en
> [`glossary.md`](glossary.md).

---

## 1. Objetivo

Tu lista de `/resume` se pudre: sesiones sin nombre apiladas, trabajo terminado
indistinguible de trabajo abierto, y cada semana encontrar algo cuesta más. El plugin
ataca eso con tres reglas que no se rompen:

| Regla | Qué significa en la práctica |
| --- | --- |
| **Cero tokens por defecto** | No inyecta nada en el contexto del modelo al abrir ni al cerrar. Nunca. |
| **Opt-in** | Sólo actúa cuando vos escribís un comando (o cuando el agente usa una tool a pedido tuyo). |
| **Explícito y reversible** | Nada se infiere como basura; lo que se mueve, vuelve con un comando o con un `mv`. |

No es un gestor de sesiones: no archiva, no resume, no borra. Es la capa que hace que
`/resume` **diga la verdad** sobre dónde vive el trabajo que sigue.

---

## 2. Tres canales, un solo criterio

El plugin escribe en tres lugares distintos y conviene no confundirlos.

### 2.1 El nombre de la sesión (lo que leés en `/resume`)

El nombre es el único canal que llega al selector de `/resume`, así que ahí se codifica
todo lo que necesitás saber de un vistazo. Un solo prefijo, cinco estados, una pregunta
que los separa: **¿dónde vive lo que sigue?**

| Estado | Significado | Quién lo escribe |
| --- | --- | --- |
| `pausa:` | Sigue acá, y sabés cuál es el próximo paso. | `scrub_close` o `/name` |
| `abierto:` | Sigue acá, pero no sabés bien por dónde retomar. | ídem |
| `espera:` | Está bloqueado en algo que no controlás (una persona, otro equipo). | ídem |
| `traspaso:` | Sigue en **otra** sesión. | `/scrub:handoff`, y solo cuando la continuación ya existe (vos podés anunciarlo antes con `/name`: es una intención) |
| `hecho:` | Terminado. No sigue en ningún lado. | `scrub_close` o `/name` |
| *(sin prefijo)* | Nadie declaró nada: sucio. | — |

Detalles que importan:

- Sólo cuenta un prefijo **al principio** y seguido de dos puntos. `reabierto:` no es
  `abierto:`, y un prefijo desconocido queda como texto libre.
- El texto después del prefijo es tuyo: el plugin no lo reescribe.
- Los estados son **mutuamente excluyentes**. Si el texto contradice al estado (`pausa:`
  con un texto que dice que el trabajo se va a otro lado), elegí el estado que
  corresponde: el estado es la promesa, el texto es el detalle.

### 2.2 Los veredictos (lo que decide el dispose)

Se registran con la tool `scrub_mark` y quedan como una entrada custom **dentro** del
archivo de sesión: no ensucian el contexto del modelo, pero son durables.

| Veredicto | Qué declara |
| --- | --- |
| `keep` | Vale la pena conservarla; nunca candidata. |
| `paused` | Se pausó, pero va a continuar. |
| `finished` | El trabajo terminó → candidata a basura. |
| `ephemeral` | Corrió un flujo efímero declarado por el proyecto → candidata. |
| `trash` | Condenada explícitamente → candidata aunque tenga nombre. |

Dos cosas no obvias:

- **No son idempotentes**: cada llamada agrega una entrada y al leer gana la última.
- **El nombre le gana al veredicto**. Si el nombre ya declara un estado, `scrub_mark`
  **se niega a escribir** y te manda a `scrub_close`: dos registros que se contradicen
  serían peores que ninguno.

### 2.3 La basura (lo que se mueve, nunca se borra)

```
~/.pi/agent/sessions/--<proyecto>--/            ← las sesiones (Pi)
~/.pi/agent/session-scrub-trash/--<proyecto>--/ ← la basura del plugin
~/.pi/agent/session-scrub-backups/--<proyecto>--/ ← backups de escrituras sobre otras sesiones
```

"Basura" es una carpeta propia, no la papelera del sistema operativo: los archivos siguen
en disco y no hay purga automática. `/scrub:restore` los devuelve, y `mv` también.

### 2.4 Estado ≠ veredicto

Es el error más caro del proyecto. `paused` (veredicto, inglés) no es `pausa:` (estado,
prefijo del nombre), ni `finished` es `hecho:`. Una sesión puede tener nombre
`pausa: …` y ningún veredicto, o veredicto `finished` y nombre sin prefijo. Los comandos
de limpieza escriben **veredictos**; `/scrub:adopt` escribe **estados**.

---

## 3. Comandos

Todos son explícitos. Ninguno corre solo.

| Comando | Qué hace | Flags | Escribe |
| --- | --- | --- | --- |
| `/scrub:audit` | Lista y clasifica las sesiones del proyecto: `live`, `kept`, `trash-candidate`, `auto`, `review`. Sólo lectura. | — | nada |
| `/scrub:triage` | Fase 1: tabla compacta + packs citados (cabeza y cola de cada sesión) para que juzgues vos. | `--verbose` | nada |
| `/scrub:triage --apply …` | Fase 2: aplica tus juicios y renombres, con `confirm` por ítem. | ver §3.1 | veredictos, nombres |
| `/scrub:apply` | Mueve a la basura lo accionable. Dry-run primero, `confirm` por ítem. | `--dry-run` | basura |
| `/scrub:restore` | Lista lo que está en la basura y lo devuelve, con `confirm` por ítem. | **ninguno** (ver §3.3) | sesiones restauradas |
| `/scrub:init` | Escribe el bloque de política `session-scrub` en el `AGENTS.md` del proyecto, una sola vez. | — | `AGENTS.md` |
| `/scrub:adopt` | Aplica la convención de nombres a sesiones viejas, sin tocar el texto humano. | `--apply`, `id:estado` | nombres + backups |
| `/scrub:handoff` | Crea la continuación que esta sesión prometió. | — (un texto libre = pendiente) | una sesión nueva, ver §6 |

### 3.1 `/scrub:triage` en dos fases

La fase 1 no juzga: te da **datos citados** (nunca instrucciones) y una nota por sesión:

- `machine` — la sesión tiene nombre, así que el nombre ya declaró el estado. Propone
  `keep` como **hecho**, no como adivinanza.
- `WEAK` — la sesión no tiene nombre. Mira edad y cantidad de mensajes y **adivina**
  (`finished` si se creó hace 7 días o más, si no `paused`). Se juzga leyendo el texto,
  nunca confirmando a ciegas.

La fase 2 escribe lo que decidiste:

```
/scrub:triage --apply 01a1:keep:"lo sigo la semana que viene" 01a2:finished:"PR mergeado"
/scrub:triage --apply 01a1:name:"scrub-handoff-contexto"
```

Reglas rápidas: un `keep` de máquina acepta `id:keep` pelado; los demás veredictos piden
razón. Los prefijos desconocidos o ambiguos se rechazan en vez de adivinar. **`trash`
nunca se aplica desde triage**: ese veredicto se registra con `scrub_mark`, y el que mueve
a la basura es `/scrub:apply`.

### 3.2 La política del proyecto (`/scrub:init`)

Escribe un bloque delimitado en `<proyecto>/AGENTS.md` con instrucciones para el agente
(cuándo marcar) y los flujos efímeros del proyecto. Sólo una clave la lee el código:
`ephemeral-flows:`. El resto es guía para humanos y para el agente.

Se escribe **una vez**: si el marcador de inicio ya existe en cualquier parte del archivo,
el comando no actualiza ni fusiona y avisa que ya existe. Sin bloque, el plugin usa
defaults conservadores: no infiere flujos efímeros.

### 3.3 Dos trampas de ergonomía

- `/scrub:restore` **no acepta `--dry-run`**: en TUI restaura de verdad, con confirmación
  por ítem. Fuera de una TUI interactiva, en cambio, todo se detiene en dry-run.
- En cualquier modo no interactivo (`--mode rpc`, `--mode print`, `--mode json`),
  `/scrub:apply` y `/scrub:triage --apply` **nunca escriben**: se quedan en dry-run.
  No hay forma de saltear la confirmación humana.

### 3.4 `/scrub:adopt`

Trae a la convención las sesiones que la precedieron.

```
/scrub:adopt                                  # dry-run, no escribe nada
/scrub:adopt --apply                          # sólo lo que la máquina ya afirmó
/scrub:adopt --apply 01a1:pausa 01a2:espera   # más lo que decidas vos
```

- **Nunca reescribe el texto humano**: agrega el prefijo y conserva lo que escribiste.
- El estado se completa sin preguntar sólo cuando una máquina ya lo había afirmado
  (`paused` → `pausa:`, `finished` → `hecho:`). `keep`, `ephemeral` y `trash` no derivan
  estado, y una sesión vieja **no** es `pausa:` por ser vieja.
- Cada escritura se respalda en `session-scrub-backups/` y se verifica después: el archivo
  debe seguir parseando, haber ganado exactamente una entrada y esa entrada debe llevar el
  nombre pedido.
- Una sesión escrita en los últimos 2 minutos se confirma individualmente, avisando el
  riesgo de pisar el flush de Pi. No hay flag para saltearlo; esperar es el único bypass.
- Tu sesión viva nunca es destino: para nombrarla se usa `scrub_close`.

---

## 4. Tools

El agente tiene dos tools y las dos escriben sobre la sesión **actual**, nunca sobre otra.

### `scrub_mark`

`verdict` (uno de `keep`, `paused`, `finished`, `ephemeral`, `trash`) y `reason` opcional.
Agrega una entrada custom al archivo de la sesión viva. Se niega si el nombre ya declara
estado (§2.2). Es la tool que hace que la limpieza sea posible sin abrir nada a mano.

### `scrub_close`

`state` (`pausa`, `abierto`, `espera`, `hecho`) y `text`. Nombra la sesión con
el mismo `setSessionName` que `/name`, así que memoria y disco quedan sincronizados y un
flush de Pi no puede borrar el nombre. Es la tool que el agente usa al cerrar un bloque.

El quinto estado, `traspaso:`, **no está en esa lista**: afirma que la continuación existe
en otra sesión, y el único que puede saberlo es `/scrub:handoff`, porque es el único que
la crea (§6). Mientras el handoff está pendiente, el estado honesto es `pausa:`: el
trabajo sigue acá y el próximo paso se sabe. Vos sí podés escribir `traspaso:` con
`/name`; es una intención tuya, no un informe del agente.

`text` lo lee un humano escaneando `/resume`, así que va **el próximo paso en palabras
llanas**: no lo que implementaste, no nombres de símbolos, no una llamada de API. Una
línea mirable. Y si el estado contradice al texto, gana el estado que escribas.

---

## 5. Flujo de trabajo en una sesión de proyecto

Un ciclo, de apertura a cierre, sin ceremonia:

1. **Apertura.** El plugin no inyecta nada. Si la sesión no tiene nombre, una vez aparece
   en la barra de estado una sugerencia determinística derivada de tu primer mensaje
   (`suggested: /name <slug>`). Vos decidís si la usás: el plugin nunca renombra solo.
2. **Trabajo.** Nada corre por defecto. Si el agente necesita declarar algo (pausa,
   bloqueo, fin de bloque), usa `scrub_close`; vos podés hacer lo mismo con `/name`
   usando los mismos prefijos.
3. **Cierre de bloque.**
   - Sigue acá y sabés cómo retomar → `pausa:`
   - Sigue acá pero estás perdido → `abierto:`
   - Bloqueado afuera → `espera:`
   - Terminado → `hecho:`
   - **Sigue en otra sesión: `pausa:` ahora y `/scrub:handoff`** (§6). El comando la
     renombra a `traspaso:` recién cuando la sesión nueva ya existe.
4. **Mantenimiento periódico (cada tanto, no cada día).**
   ```
   /scrub:audit        # ¿qué hay?
   /scrub:triage       # leer y juzgar lo que no tiene veredicto
   /scrub:triage --apply …   # escribir tus juicios
   /scrub:apply        # mover lo accionable, con confirmación
   /scrub:restore      # arrepentirse
   ```
5. **Sesiones históricas.** Una vez, después de instalar la convención:
   `/scrub:adopt`.

Dos invariantes del flujo: **tu sesión viva nunca es tocada** por la limpieza, y **una
sesión con nombre está protegida**: sólo un veredicto `trash` explícito (posible cuando el
nombre no declara estado) la vuelve candidata.

### Lo que no va a pasar

Nombrar protege, y eso incluye `hecho:` y `traspaso:`. Una sesión con prefijo de estado
**no** aparece como candidata en `/scrub:audit`, y `scrub_mark` se niega a escribir
veredictos sobre ella (§2.2): el nombre es la promesa y el plugin no la deshace por su
cuenta. Consecuencia práctica: la limpieza alcanza a sesiones sin nombre (o con nombre
sin prefijo); una sesión nombrada que quieras sacar de la lista se archiva a mano con
`mv`, no con `/scrub:apply`.

---

## 6. `/scrub:handoff` — continuidad entre sesiones

El nombre `traspaso:` **anuncia** que el trabajo sigue en otro lado, y un anuncio sin
continuación es peor que no tener nombre, porque se confía en él: `/resume` te promete una
sesión que nunca existió. Por eso el anuncio no lo escribe nadie de antemano:
`/scrub:handoff` crea la sesión real y **después** escribe el `traspaso:`. (El comando se
escribe con dos puntos, `/scrub:handoff`; `scrub:handoff` es el espacio de nombres que
registra el plugin.)

### 6.1 Qué hace, paso a paso

1. **Resuelve el pendiente.** Toma el texto que le pasaste como argumento; si no hay,
   toma el texto del nombre actual (sin el prefijo). Si no queda nada, avisa y **no crea
   nada**: un traspaso sin nada que entregar no es un traspaso.
2. **Busca la última memoria escrita** en las entradas persistidas de esta sesión (no en
   una variable en proceso): sólo cuentan las escrituras (`mem_save`, `mem_session_summary`);
   las lecturas no. De ahí saca el `topic_key` y el título.
3. **Crea la sesión nueva** con `parentSession` apuntando a esta, le inyecta un mensaje
   inicial invisible (`display: false`) con origen + pendiente + memoria, y la nombra
   `pausa: desde <abbr> · <pendiente>`.
4. **Recién entonces renombra la vieja** a `traspaso: <abbr> · <pendiente>`, sea cual fuere
   su nombre anterior; si la vieja ya venía de otro handoff, el nombre re-emite el linaje
   (`traspaso: desde <parent> · <abbr> · <pendiente>`) en vez de perderlo. `<abbr>` es la
   abreviatura única mínima del proyecto, no un slice fijo de ocho: el ancho lo decide el
   conjunto de sesiones que se está mostrando (glossary §8). La escribe **por archivo**, con
   el mismo stack que usa el triage: copia de respaldo, append y verificación. Si esa
   escritura falla, te avisa y la vieja queda como estaba: una promesa que no se escribió es
   mejor que una promesa falsa.
5. **Te avisa** con el nombre nuevo y la clave de memoria usada.

Después del comando, **estás en la sesión nueva**. La vieja queda en `/resume` como el otro
extremo del par.

### 6.2 Cómo se ve en `/resume`

```
pausa: desde 01a10e25 · implementar el traspaso        ← la nueva, donde seguís
traspaso: 01a10e25 · implementar el traspaso           ← la que entregó el trabajo
```

Los dos nombres llevan la misma abreviatura para que puedas reconocer el par sin abrir
nada. Si encadenás otro handoff el linaje se re-emite, no se apila: una cadena de tres se
lee `desde <a> · <b> · <pendiente>`, nunca `desde a · desde b · …`.

### 6.3 El mensaje con el que arranca la sesión nueva

Es una entrada custom invisible en el transcript: no la vas a ver en pantalla, pero el
agente la recibe en su primer token y la conserva. Es corta a propósito, y lleva
**punteros, no contenido**:

```
Continuación de la sesión 01a10e25. Quedó como: "traspaso: 01a10e25 · implementar el
traspaso". Pendiente: implementar el traspaso. Contexto en memoria:
session-scrub:continuity-traspaso. Último registrado: Continuidad: slice A y B listos.
```

Si la sesión no escribió ninguna memoria, el mensaje simplemente omite esas dos últimas
cláusulas y el aviso dice `no prior memory in this session`. El handoff funciona igual:
sólo viaja el pendiente.

### 6.4 Cómo se usa

Tres caminos, el mismo resultado. El primero es el que más rinde, y conviene tenerlo en
los dedos:

**1. Pedile al agente que lo prepare.** El handoff son dos actores por diseño: el agente
cierra el bloque y deja lo que va a viajar; vos creás la sesión.

```
vos     "prepará el handoff: terminar la migración y correr la suite"
agente  escribe la memoria del bloque        (protocolo de cierre de Engram)
        nombra esta sesión                   scrub_close, estado pausa + el pendiente
        te avisa que corras /scrub:handoff
vos     /scrub:handoff
```

Lo que el agente **no** puede hacer es crear la sesión: `newSession` vive en el contexto
de comando y una tool no lo tiene. Por eso el último paso es tuyo — y es un solo comando,
sin argumento, porque el nombre ya lleva el pendiente. Esa división no es una limitación
que haya que rodear: es la forma del host, y es lo que deja el bloque cerrado y listo
antes de que la sesión vieja se convierta en `traspaso:`.

| Paso | Quién | Qué queda |
| --- | --- | --- |
| Cerrar el bloque | el agente, con `scrub_close` | `pausa: <pendiente>`, con el linaje intacto |
| Memoria del bloque | el agente, protocolo de cierre | lo único que el handoff lleva como contexto de fondo; su **título** es la línea que se lee |
| Crear la continuación | **vos**, `/scrub:handoff` | la sesión nueva nombrada y sembrada; esta queda `traspaso:` |

Un detalle que evita una ida y vuelta: no le pidas un veredicto después de que nombró.
`scrub_mark` se niega cuando el nombre ya declara estado —el nombre es el registro— y te
manda a `scrub_close`. El orden es nombrar y entregar, no nombrar y marcar.

**2. Nombrás vos y el handoff hace el resto.**

```
/name pausa: implementar el traspaso con newSession
/scrub:handoff
```

**3. Un solo paso:** el argumento es el pendiente.

```
/scrub:handoff implementar el traspaso con newSession
```

`/name` es tuyo; `scrub_close` es la tool con la que el agente escribe el mismo nombre
(estado + texto). Lo que importa es que el nombre declare el pendiente: da igual si es
`pausa:` o el que ya tenías, porque el handoff reescribe el estado a `traspaso:` cuando la
sesión nueva existe.

En los caminos 2 y 3 la memoria del bloque la escribís vos (o se la pedís al agente con el
protocolo de cierre de Engram) **antes** de disparar el comando: es lo único que el handoff
puede llevar como contexto de fondo, y su **título** es la única descripción de una línea
que viaja.

### 6.5 Cuándo usarlo (y cuándo no)

| Situación | Acción |
| --- | --- |
| El bloque termina acá y continúa en otra sesión (otro modelo, otro contexto, otra rama de trabajo) | `pausa:` mientras esperás, y `/scrub:handoff` (él escribe el `traspaso:`) |
| La sesión se está quedando sin contexto y querés seguir limpio | ídem: es el caso que lo justifica |
| El trabajo sigue acá y sabés cómo retomar | `pausa:` a secas, **sin** handoff |
| El trabajo terminó | `hecho:`, **sin** handoff |
| Estás bloqueado esperando a alguien | `espera:`, **sin** handoff |
| Querés limpiar la lista | `/scrub:audit` → `/scrub:triage` → `/scrub:apply` |

Regla mental: el handoff **crea trabajo futuro**, no cierra trabajo pasado. Si no hay una
próxima sesión concreta, no lo corras.

### 6.6 Ventajas en un flujo entre sesiones

- **Continuidad sin reexplorar.** La sesión nueva sabe de dónde viene y qué sigue en su
  primer token. No gasta tres comandos de git ni una búsqueda para reconstruir el estado.
- **Contexto barato.** El detalle queda en Engram; el mensaje inicial lleva el
  `topic_key` y el título. Un mensaje corto, una sola vez, en lugar del volcado de la
  conversación anterior.
- **Señal en el selector, no en tu memoria.** El par `traspaso:` / `pausa: desde …` se lee
  en `/resume` antes de abrir nada: sabés qué sesión entregó y cuál recibió.
- **Trazabilidad real.** `parentSession` vincula las dos sesiones en Pi, y la abreviatura
  en ambos nombres hace visible el vínculo en el selector.
- **Nada se borra.** El handoff no mueve a basura ni cierra la sesión de origen: queda en
  `/resume`, protegida por su nombre, como registro de lo entregado.

### 6.7 Límites y trampas

- **El pendiente es obligatorio.** Sin texto en el argumento ni en el nombre, el comando
  avisa y no crea nada.
- **El traspaso no inventa el próximo paso: lo lee.** Si el nombre miente, el handoff
  propaga la mentira. El estado que elijas y el texto que escribas son la única fuente.
- **La conversación no viaja.** Viajan el pendiente, el `topic_key` y el título. Si no
  escribiste memoria, el destino arranca sólo con el pendiente.
- **Sólo la última escritura cuenta.** Un `mem_update` no es una escritura nueva para el
  handoff, y dos escrituras seguidas dejan la segunda.
- **El id de la observación no está en el mensaje.** Los resultados de tools no se
  persisten en el archivo de sesión, así que el `id` no sobrevive a un reload; por eso el
  mensaje apunta al `topic_key`, que sí es durable, y `mem_search` lo resuelve.
- **El destino siempre nace `pausa:`.** Aunque el pendiente diga que el trabajo vuelve a
  moverse: si se mueve otra vez, se hace otro handoff.
- **Cancelar no escribe nada.** El orden es destino primero, promesa al final: si cancelás
  la sesión nueva, el origen queda exactamente como estaba, sin `traspaso:` colgado y sin
  mensaje. El riesgo real es el opuesto y es más raro: si la escritura del origen falla
  *después* de que la sesión nueva ya existe, queda un `pausa: desde …` sin su `traspaso:`;
  el comando te lo reporta como advertencia con el arreglo, no como éxito.
- **Un `traspaso:` sin handoff es una promesa falsa.** Si lo nombraste y no corriste el
  comando, `/resume` anuncia una continuación que nunca existió. Es el error que este
  comando existe para evitar; no lo dejes colgado.
- **El origen queda protegido, no limpio.** Una sesión con nombre no aparece como
  candidata: el par sobrevive a la limpieza mensual, y eso es deliberado (es el registro
  del traspaso).

---

## 7. Recetas

```
# "Paro acá, sigo mañana y sé por dónde"
/name pausa: cerrar el guard de adopt y correr los tests

# "No sé por dónde retomar"
/name abierto: revisar el spec de naming antes de seguir

# "Estoy esperando a alguien"
/name espera: esperando respuesta sobre el criterio de guard

# "Terminé"
/name hecho: naming convention cerrada y mergeada

# "Sigo en otra sesión"
/name traspaso: implementar la corrección de triage
/scrub:handoff

# "Sigo en otra sesión", en un paso
/scrub:handoff implementar la corrección de triage

# Limpieza mensual
/scrub:audit
/scrub:triage --verbose
/scrub:triage --apply 01a1:keep:"block abierto" 01a2:finished:"work merged"
/scrub:apply
/scrub:restore        # si algo se fue de más

# Migrar sesiones viejas a la convención
/scrub:adopt
/scrub:adopt --apply 01a1:pausa 01a2:hecho
```

---

## 8. Dónde leer más

| Documento | Qué es |
| --- | --- |
| [`../README.md`](../README.md) | Instalación, primer arranque y comandos por momento. |
| [`behavior.md`](behavior.md) | Especificación as-built en tres capas, anclada al último release, citada por símbolo. |
| [`glossary.md`](glossary.md) | Vocabulario compartido, un término por línea, con su lugar en el código. |
| [`../PRD.md`](../PRD.md) | El problema que el plugin existe para resolver. |
| [`../openspec/changes/archive/2026-10-26-session-scrub-naming/`](../openspec/changes/archive/2026-10-26-session-scrub-naming/) | El change, ya archivado, que introdujo la convención, `scrub_close` y `/scrub:handoff`. |
