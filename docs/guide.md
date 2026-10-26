# pi-session-scrub — guía de uso

Qué es este plugin, qué comandos tiene, qué tools expone, cómo se trabaja con él en una
sesión de proyecto y —en detalle— qué hace `/scrub:handoff` y por qué conviene usarlo.

> Esta guía describe el código en **HEAD**. La especificación as-built está en
> [`behavior.md`](behavior.md), anclada a la última release (`v0.4.2`), que es la que ya
> incluye la convención de nombres, `/scrub:handoff` y `/scrub:adopt`.
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
| `traspaso:` | Sigue en **otra** sesión. | `scrub_close`, y `/scrub:handoff` lo escribe solo |
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

`state` (`pausa`, `abierto`, `espera`, `traspaso`, `hecho`) y `text`. Nombra la sesión con
el mismo `setSessionName` que `/name`, así que memoria y disco quedan sincronizados y un
flush de Pi no puede borrar el nombre. Es la tool que el agente usa al cerrar un bloque.

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
   - **Sigue en otra sesión: `traspaso:` + `/scrub:handoff`** (§6)
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

El nombre `traspaso:` **anuncia** que el trabajo sigue en otro lado. Pero un anuncio sin
continuación es peor que no tener nombre, porque se confía en él: `/resume` te promete una
sesión que nunca existió. `/scrub:handoff` convierte el anuncio en la sesión real. (El
comando se escribe con dos puntos, `/scrub:handoff`; `scrub:handoff` es el espacio de
nombres que registra el plugin.)

### 6.1 Qué hace, paso a paso

1. **Resuelve el pendiente.** Toma el texto que le pasaste como argumento; si no hay,
   toma el texto del nombre actual (sin el prefijo). Si no queda nada, avisa y **no crea
   nada**: un traspaso sin nada que entregar no es un traspaso.
2. **Renombra la sesión actual** a `traspaso: <id8> · <pendiente>`, sea cual fuere su
   nombre anterior (`<id8>` son los primeros 8 caracteres del id de la sesión). Lo hace
   mientras sigue siendo la sesión actual, así que el selector de `/resume` —el *picker*—
   muestra el par, no dos filas idénticas.
3. **Busca la última memoria escrita** en las entradas persistidas de esta sesión (no en
   una variable en proceso): sólo cuentan las escrituras (`mem_save`, `mem_session_summary`);
   las lecturas no. De ahí saca el `topic_key` y el título.
4. **Crea la sesión nueva** con `parentSession` apuntando a esta, le inyecta un mensaje
   inicial invisible (`display: false`) con origen + pendiente + memoria, y la nombra
   `pausa: desde <id8> · <pendiente>`.
5. **Te avisa** con el nombre nuevo y la clave de memoria usada.

Después del comando, **estás en la sesión nueva**. La vieja queda intacta, en `/resume`,
como el otro extremo del par.

### 6.2 Cómo se ve en `/resume`

```
pausa: desde 01a10e25 · implementar el traspaso        ← la nueva, donde seguís
traspaso: 01a10e25 · implementar el traspaso           ← la que entregó el trabajo
```

Los dos nombres llevan ese `<id8>` para que puedas reconocer el par sin abrir nada. Si
encadenás otro handoff, el marcador viejo se quita antes de escribir el nuevo, así el
texto no crece como `desde a · desde b · desde c`.

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

```
# Camino normal: primero el cierre, después el handoff
/name traspaso: implementar el traspaso con newSession
/scrub:handoff

# El mismo efecto en un solo paso: el argumento es el pendiente
/scrub:handoff implementar el traspaso con newSession
```

`/name` es tuyo; `scrub_close` es la tool con la que el agente escribe el mismo nombre
(estado + texto). El resultado es indistinguible: lo que importa es que el nombre
traspaso:` declare el pendiente antes de correr el handoff.

Antes de dispararlo, escribí la memoria del bloque (o pedile al agente que la escriba con
el protocolo de cierre de Engram). Es lo único que el handoff puede llevar como contexto
de fondo, y su **título** es la única descripción de una línea que viaja.

### 6.5 Cuándo usarlo (y cuándo no)

| Situación | Acción |
| --- | --- |
| El bloque termina acá y continúa en otra sesión (otro modelo, otro contexto, otra rama de trabajo) | `traspaso:` + `/scrub:handoff` |
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
  `topic_key` y el título. Unas pocas decenas de tokens, una vez, en lugar del volcado de
  la conversación anterior.
- **Señal en el selector, no en tu memoria.** El par `traspaso:` / `pausa: desde …` se lee
  en `/resume` antes de abrir nada: sabés qué sesión entregó y cuál recibió.
- **Trazabilidad real.** `parentSession` vincula las dos sesiones en Pi, y el id corto en
  ambos nombres hace visible el vínculo en el selector.
- **Determinista y sin modelo.** No hay scoring, ranking ni llamada al modelo: "la última
  memoria **escrita** antes del traspaso es el traspaso". Misma entrada, mismo mensaje.
- **Sobrevive a `/reload`.** El handoff lee las entradas persistidas de la sesión, no una
  variable en proceso. Un reload no le borra el contexto al destino.
- **Cadena sin acumulación.** Cada handoff reemplaza el marcador de linaje anterior: una
  cadena larga sigue siendo una línea legible.
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
- **Cancelar no deshace el renombre.** El origen ya se renombró antes de crear la sesión
  nueva, así que si cancelás quedan un `traspaso:` sin continuación y ningún mensaje. Si
  pasa, volvé a correr el comando: es idempotente en la práctica.
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
| [`../README.md`](../README.md) | Instalación, flags y comportamiento público del paquete. |
| [`behavior.md`](behavior.md) | Especificación as-built en tres capas, anclada a la última release, citada por símbolo. |
| [`glossary.md`](glossary.md) | Vocabulario compartido, un término por línea, con su lugar en el código. |
| [`../PRD.md`](../PRD.md) | El problema que el plugin existe para resolver. |
| [`../openspec/changes/session-scrub-naming/`](../openspec/changes/session-scrub-naming/) | El change que introdujo la convención, `scrub_close` y `/scrub:handoff`. |
