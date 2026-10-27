# Laboratorio E — revisores en paralelo y riesgo de despliegue

Investigación interna sobre una demostración pública de un pipeline de "AI Factory" en producción —
una fuente de campo, no un repo. Fecha: 23 oct 2026.

## Por qué importa esta investigación

No es un repo ni documentación — es una demostración hablada, por primera vez en público, del diseño
de un sistema de "AI Factory" ya en producción, con intención declarada de convertirlo en un proyecto
mayor (construido sobre la misma base que el Laboratorio D) todavía no publicado. Es, en efecto, una
hoja de ruta un paso por delante de lo que el Laboratorio D cubre hoy, desde la misma línea de
investigación.

## Definición central: ¿qué es una AI Factory?

Cita (traducida): *"Una factory, al final, es cualquier proceso que es repetible y auditable con
inteligencia artificial dentro."* Dos condiciones, explícitas y mínimas:

1. **Repetible** — la misma tarea sigue el mismo camino cada vez.
2. **Auditable** — cada paso deja rastro y se puede ver dónde falló para arreglarlo.

Analogía usada: una fábrica de coches — entra acero, sale un coche, y en medio hay máquinas que deciden y transforman, cada una auditable; un error en una máquina se propaga a las siguientes si no se detecta ahí mismo.

## Los tres tipos de paso (idéntico al "kind" de fase del Laboratorio A)

Esta fuente describe, desde su propia base, casi exactamente el mismo primitivo que el Laboratorio A llama `Phase(kind=...)`:

1. **Código** — determinista, siempre igual. "No hay nada más determinista que el código: o funciona o no funciona." Si es repetible, se hace con código, no con un agente.
2. **Agente** — para lo no determinista, donde la entrada decide qué tipo de razonamiento aplicar.
3. **Aprobación humana** — paso opcional, pero debe poder incluirse explícitamente en el proceso.

## "El cerebro" = memoria persistente, consultada ANTES de actuar

Se llama literalmente "el cerebro" y se conecta explícitamente con el concepto de memoria del Laboratorio D (equivalente a su carpeta de documentación del proyecto, ya investigada). El punto clave, no trivial: **el cerebro se consulta antes de que el agente escriba el spec o el código**, no solo se actualiza después. Ejemplo que da: si decidiste hace 3 meses que la base de datos es Postgres y el agente no tiene memoria continua, una tarea de "mejorar el rendimiento de la base de datos" puede terminar asumiendo MySQL porque lo inventó.

## Pipeline concreto demostrado

```
Input (error de producción / issue / tarea por voz)
   │
   ▼
Spec writer (modelo grande) ── consulta el cerebro antes de escribir ──► spec
   │
   ▼
Builder (modelo grande, TDD: escribe el test primero, falla, luego código) ── consulta el cerebro (arquitectura)
   │
   ▼
4 revisores en paralelo, cada uno con un MODELO DISTINTO a propósito:
   ├─ Seguridad   → otra familia de modelo — evita que el builder se autoevalúe
   ├─ UX          → otra familia de modelo, distinta al builder
   ├─ UI          → un modelo entrenado con RL específicamente para computer use
   └─ Código      → un modelo "menor" a propósito, porque es la tarea que menos preocupa
   │
   ▼
Approver (modelo grande) ── agrega el feedback de los 4; si hay negativo, vuelve al builder; itera hasta que los 4 aprueban
   │
   ▼
Clasificador de riesgo (otro agente, modelo grande obligatorio — nunca menor)
   ├─ Riesgo bajo (ej. "cambia el color del botón") → merge directo a main, sin humano
   └─ Riesgo alto (backend, core, base de datos) → PR + notificación, requiere aprobación humana
       "Para esto un agente de IA solo no basta. Hay que incluir hooks o código que bloqueen a la gente de hacer este tipo de cosas."
   │
   ▼
Todo el pipeline corre en paralelo: cada tarea tiene su propio ID, no espera a que termine la anterior.
```

Puntos de diseño explícitos y citables:

- **Diversidad de modelos como mecanismo anti-sesgo**: elegir deliberadamente un modelo distinto al que construyó el código para cada revisor, para que el revisor no se autoevalúe. Esto no apareció de forma tan explícita en los otros laboratorios — es un patrón nuevo.
- **El clasificador de riesgo decide el "fast path" vs. "slow path"**, análogo al sistema de *lanes* del Laboratorio D, pero aplicado específicamente a "¿esto necesita aprobación humana antes de producción?" en vez de "¿esto necesita más o menos proceso de desarrollo?". Y es explícito en que esto **no puede ser solo un agente decidiendo** — necesita hooks/código que lo hagan cumplir mecánicamente (eco directo de la distinción "guardas que fallan abierto vs. mecanismos duros" del Laboratorio D).
- **Todo corre en paralelo por diseño**, no secuencial — cada tarea con su propio identificador, ramas y tests se crean independientemente.

## Factory de contenido (segundo ejemplo, no-código)

Demuestra que el concepto no es exclusivo de SDLC: un pipeline de edición de video (el propio material se editó así) — corta silencios, pasa por un "diseñador", añade transiciones, une clips, genera miniaturas, sube a YouTube — con el mismo criterio: *"si es algo que haces más de una vez por semana, y es revisable y auditable, puedes convertirlo en una AI Factory."* Aun así, hay revisión manual antes de publicar — no es 100% autónomo ni siquiera en el caso de uso más maduro.

## Validación externa que cita

Menciona (sin verificar, de oídas) que ingenieros de una empresa grande de IA construyeron una solución de más de 1 millón de líneas sin escribir código a mano, y que otra empresa conocida completó más de 1000 PRs en una semana usando agentes — como evidencia de que el patrón de "factory" ya se usa a escala real, no es solo teoría de una demostración pública.

## Anuncio: un producto mayor, no publicado aún

Se anuncia textualmente que las dos pruebas de concepto (software factory + content factory) se están llevando a algo más grande, construido sobre la misma base del Laboratorio D, con intención de abrirlo como open source "pronto" — condicionado explícitamente a la respuesta/demanda de la demostración. **No hay nada público todavía** — es la pieza que vendría después del Laboratorio D en la misma línea de investigación, y confirma que esa misma línea está persiguiendo casi exactamente el mismo objetivo que sforge.

## Qué añade esto a la síntesis de sforge

1. **Confirma con un caso de uso real y en producción** (no solo teoría) la arquitectura de capas que ya propusimos: código determinista / agente acotado / aprobación humana opcional, con memoria persistente consultada *antes* de actuar — validación externa fuerte de la Capa 1 (motor de orquestación) que propusimos basada en el Laboratorio A.
2. **Aporta un patrón nuevo no cubierto por los demás laboratorios**: diversidad deliberada de modelos entre builder y revisores como mecanismo anti-sesgo (el modelo que escribió el código nunca se revisa a sí mismo). Vale la pena añadirlo como principio de diseño de la Capa 2 (pipeline de calidad).
3. **Aporta un segundo patrón nuevo**: un agente clasificador de riesgo que decide fast-path (auto-merge) vs. slow-path (aprobación humana obligatoria + hooks que lo fuerzan), separado del propio pipeline de construcción/revisión — una capa de "gate de despliegue" distinta del "gate de calidad" que el Laboratorio A ya cubre.
4. **Generaliza el concepto fuera de SDLC** con el ejemplo de content factory — refuerza que sforge como capa agnóstica de dominio es una dirección correcta, no una abstracción forzada.
5. **Es señal de mercado/timing**: la misma línea de investigación del Laboratorio D persigue este objetivo ahora mismo y aún no lo ha publicado — sforge no estaría inventando una categoría inexistente, sino construyendo en paralelo a donde ya se mueve la industria (cita también dos señales independientes de la industria).
