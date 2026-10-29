# Glosario — el vocabulario de pi-session-scrub

Para el owner y para cualquiera que lea el código o `behavior.md`. Existe porque estas
palabras se usan como si fueran obvias y no lo son: "machine keep", "weak guess", "fila
compacta", "settled", "población". Cada decisión tomada sin vocabulario compartido cuesta
una explicación.

**Regla de este documento:** un término por línea, y cada uno dice **dónde vive en el código**
(`archivo:línea`). Si un término no tiene un lugar en el código, no entra: así no puede
mentir sin que se note. Cuando el código se mueva, la línea queda vieja y se ve — y
`doccheck.test.ts` verifica que la línea citada exista **y contenga el símbolo** que el
término nombra.

---

## 1. Estado ≠ veredicto (el error que este documento existe para evitar)

Son **dos vocabularios distintos** que se parecen, y confundirlos es el error más caro del
proyecto.

| | Qué es | Valores | Dónde |
| --- | --- | --- | --- |
| **veredicto** | Lo que la extensión **escribe** como entry en el archivo de sesión. Decide si la sesión se protege, se ofrece o se tira. | `keep`, `paused`, `finished`, `ephemeral`, `trash` | `classify.ts:32` |
| **estado** | El **prefijo del nombre** de la sesión, en la convención de `scrub_close`. Es lo que el humano lee en `/resume`. | `pausa`, `abierto`, `espera`, `traspaso`, `hecho` | `name.ts:31` |

**Falsos amigos, en criollo:**

- `paused` (veredicto, inglés) **no es** `pausa` (estado, español). Una sesión puede tener
  veredicto `paused` y nombre sin prefijo, o nombre `pausa: …` y ningún veredicto.
- `finished` (veredicto) **no es** `hecho` (estado). Misma trampa, otro par.
- `/scrub:adopt` escribe **estados** (`id:pausa`), nunca veredictos. `/scrub:apply` y
  `/scrub:triage` escriben **veredictos** (`id:keep`), nunca estados.

---

## 2. Clasificación del audit

Cada sesión cae en **un** `kind` (`classify.ts:71`), y el audit lo imprime con un token fijo
(`formatAuditLine`, `index.ts:168`).

| `kind` | Token en el audit | Qué significa | Dónde |
| --- | --- | --- | --- |
| `live` | `live` | La sesión que corre el comando. Nunca se toca. | `classify.ts:72` |
| `named-protected` | `kept … named "…"` | Tiene nombre y ningún veredicto de **retención** (`trash`, `ephemeral`): el nombre la protege. | `namedProtected`, `classify.ts:73` |
| `auto-deletable` | `auto … empty` | Sin mensajes: no hay nada que perder. | `autoDeletable`, `classify.ts:74` |
| `candidate` | `trash-candidate … reason=` | Tiene **señal** para tirarla (ver §3). | `candidate`, `classify.ts:75` |
| `old-needs-confirm` | `review …` | ≥ 7 días, sin veredicto, por debajo del piso de turnos. | `oldNeedsConfirm`, `classify.ts:76` |
| `kept` | `kept … <motivo>` | Protegida por contenido, por el piso de turnos o por ser joven. | `kept`, `classify.ts:77` |

Ojo con el token vs el `kind`: el `kind` `candidate` se imprime como **`trash-candidate`**, y
`old-needs-confirm` se imprime como **`review`**. Los nombres no coinciden.

**`named` no es un `kind`.** Es un calificador que aparece detrás del token cuando la sesión
tiene nombre (`kept 01a14ce0-37 named "hecho: …"`). Y **un veredicto de retención le gana al
nombre**: `trash` y `ephemeral` son la otra escala, y el nombre no puede expresar ninguno de los
dos, así que la retención se resuelve **antes** de mirar el nombre. Por eso P8 se clasifica
`candidate` aunque tenga nombre (`isRetentionVerdict`, `classify.ts:62`; `candidate`, `classify.ts:207`).

---

## 3. Los cuatro `reason` de una candidata

`CANDIDATE_REASON`, `classify.ts:80`. Es el **porqué** de que una sesión esté en la lista de tirables.

| `reason` | Por qué | Dónde |
| --- | --- | --- |
| `explicit-trash` | Alguien escribió el veredicto `trash`. | `explicitTrash`, `classify.ts:81`; `trash`, `classify.ts:68` |
| `finished` | El veredicto `finished` la marcó como terminada. | `classify.ts:218` |
| `ephemeral` | Invocó un flujo declarado en `ephemeral-flows` (política del proyecto). | `classify.ts:227`, `index.ts:132` |
| `empty` | No tiene mensajes. | `classify.ts:240` |

**`ephemeral-flows`** es la única clave que la extensión lee de la política: un bloque en
`AGENTS.md` del proyecto, entre los marcadores `<!-- pi-session-scrub:start -->` y
`end -->`. Todo lo demás del bloque es guía para el agente, no configuración
(`parsePolicyBlock`, `policy.ts:97`; `readPolicyConfig`, `index.ts:258`).

---

## 4. Grados de triage: hecho vs adivinanza

`TRIAGE_GRADE` (`index.ts:945`). Esto es lo que decide **si la extensión sabe o supone**.

| Grado | Qué es | Dónde |
| --- | --- | --- |
| **`machine`** (machine keep) | Sesión **nombrada** sin veredicto. El nombre ya declara el estado, así que la extensión **no opina**: propone `keep` como **hecho**, con la rationale `named session — presumed active`. | `index.ts:945`, `index.ts:1568` |
| **`weak`** | Sesión **sin nombre**. La extensión no puede saber: mira edad y mensajes y **adivina**. | `index.ts:945`, `index.ts:1132` |
| **`judged`** | Ya lo decidió el humano. | `index.ts:945` |

**weak guess** = la adivinanza de una fila `weak`: `finished` si la edad ≥ `MAX_AGE_MS`,
si no `paused` (`suggestTriageWeak`, `index.ts:1132`). Siempre viaja etiquetada
`(WEAK — judge from head/tail, never auto-confirm)`: es una sugerencia para leer las
palabras, **nunca** una decisión.

**machine keep** = la fila `machine`. Cuando se confirman en bloque, el veredicto escrito es
`keep` con la rationale `machine keep, bulk-confirmed <fecha ISO>`
(`bulkKeepRationale`, `index.ts:1467`).

**La fila compacta de una machine row no lleva guess.** La fila compacta sólo renderiza
filas `machine`, y su propuesta es el hecho `keep`; por eso el campo de guess se quitó del
esquema (`formatCompactRow`, `render.ts:255`; `spec.md` UX-02). El guess vive donde
corresponde: en el pack de una fila `weak` (`weak-guess:`, `formatDigestPack`,
`index.ts:1424`).

**Queda una excepción, y es deliberada — no la leas como si el problema estuviera resuelto en
todos lados.** Bajo `--verbose`, una machine row recibe *además* su pack completo, y ese pack
todavía renderiza la weak guess junto al hecho `NAMED → keep (machine)`
(`formatDigestPack(pack, machineFactOf(pack), guessOf(c))`, `index.ts:1594`). Es la misma
tensión que la fila compacta ya resolvió, sin resolver en el pack verboso: el hecho y la
adivinanza aparecen juntos en el mismo bloque. No se cambió porque esa decisión no estaba
tomada; es deuda registrada, no comportamiento deseado.

---

## 5. Formatos de salida

| Término | Qué es | Dónde |
| --- | --- | --- |
| **pack** (digest pack) | Bloque completo de una sesión: `head` (primeros 300c), `tail` (últimos 300c cronológicos), msgs, edad, created/modified ISO, rationale. | `formatDigestPack`, `index.ts:1424` |
| **head** / **tail** | Las dos ventanas de texto del pack, 300 caracteres cada una. | `HEAD_DIGEST_CHARS`, `index.ts:952`; `TAIL_DIGEST_CHARS`, `index.ts:953` |
| **fila compacta** | Una línea, formato por defecto para filas `machine`: `<id> · <n>msgs · <d>d · named "<nombre>"\|unnamed · <head≤121>`. El `named "…"` es entrecomillado por el renderer; el `<head>` no lleva comillas propias (sólo se escapan las que traiga adentro). **Sin campo de guess.** | `render.ts:255` |
| **pack cap** | Máximo 20 packs por corrida; el resto se lista como `deferred`. | `index.ts:954` |
| **deferred** | Sesiones que no entraron en el cap: sólo ids, sin packs ni guesses. | `deferred`, `index.ts:1540`; `index.ts:1598` |

---

## 6. Escritura: `fresh` vs `settled`

| Término | Qué es | Dónde |
| --- | --- | --- |
| **ventana de frescura** | 2 minutos (`120_000` ms). Es la ventana en la que un archivo cuenta como recién escrito. | `FRESH_MTIME_MS`, `adopt.ts:24` |
| **`fresh`** | Archivo dentro de la ventana. Pide **un prompt por sesión**, con `freshnessWarning`. | `isFresh`, `adopt.ts:106`; `freshnessWarning`, `index.ts:1999` |
| **`settled`** | Archivo fuera de la ventana. Se pliega en **un solo prompt de resumen**. | `planAdoption`, `adopt.ts:159` |
| **`freshnessWarning`** | El texto que sólo ve una escritura `fresh`: edad en segundos, ruta del backup, y "no hay flag para saltearlo; esperar es el único bypass". | `adopt.ts:277` |
| **backup** | Copia de los bytes **previos** a la escritura, en `<runtime>/session-scrub-backups/<proyecto>/`. | `getBackupDir`, `sessionfs.ts:42`; `backupPathFor`, `sessionfs.ts:50` |
| **basurero** (trash) | Donde va una sesión tirada: `<runtime>/session-scrub-trash/<proyecto>/`. Es un `rename`, no un borrado. | `getTrashDir`, `sessionfs.ts:29` |

**La frescura se congela al arrancar el comando.** `planAdoption(…, Date.now())` corre una
sola vez, antes de cualquier confirmación: podés tardar diez minutos en responder y el
reparto `fresh`/`settled` ya está decidido. No es una carrera contra el reloj.

---

## 7. Las tres marcas de tiempo (y qué lee cada compuerta)

Este es el error que costó una corrida entera de medición. Hay **tres** "modified", no una.

| Marca | Dónde vive | Quién la lee |
| --- | --- | --- |
| **`mtime`** | Filesystem, el `stat` del archivo | La **ventana de 2 minutos** de la escritura (`sessionfs.ts:133`, `adopt.ts:106`). Se toca con `touch`. |
| **`created`** | ISO `timestamp` del header **y** el nombre del archivo | La **compuerta de 7 días** → `to review` (`MAX_AGE_MS`, `classify.ts:19`). `touch` **no** la cambia. |
| **`modified`** | Numérico `message.timestamp` (epoch ms) dentro de cada mensaje | Sólo **display**, en audit y triage. No decide nada. |

**Piso de turnos:** `MIN_CONVERSATION_TURNS = 5` (`classify.ts:30`), contando entries
`type === "message"` con rol `user` o `assistant`. Una sesión joven sin veredicto y por
debajo del piso es `kept`, no candidata.

---

## 8. Abreviaturas

**Abreviatura única** = el prefijo más corto que identifica una sesión **dentro del conjunto
que se está mostrando** (`uniqueAbbreviations`, `ids.ts:28`). El ancho **se deriva del
conjunto**, no es fijo: en un proyecto con nueve sesiones que comparten prefijo salen 10
caracteres; en un proyecto con una sola, alcanzan 8. Si ves un id más corto que en otra
pantalla, no es un bug: es otro conjunto.

---

**`Remaining` no es el total del audit.** El audit cuenta la sesión viva aunque no tenga
archivo; `Remaining` cuenta lo que devuelve `SessionManager.list` después del movimiento,
que no la incluye. Son dos preguntas distintas, las dos bien contestadas
(`formatTrashResult`, `render.ts:348`).
