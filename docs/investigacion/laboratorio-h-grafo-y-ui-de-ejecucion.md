# Laboratorio H — motor de grafo y UI de ejecución

Investigación interna sobre un sistema comparable a lo que estamos construyendo: una "software
factory" con interfaz visual propia — más completa que el visualizador de solo lectura del
Laboratorio A. Vale la pena leerlo en contraste directo con nuestras propias decisiones de Capa 0–2,
no solo por lo que aporta, sino por lo que decidimos distinto y por qué.

## Qué es

Un flujo de trabajo se define como un **grafo** (formato DOT de Graphviz: nodos = etapas, aristas =
transiciones), con soporte para ramificación, loops, paralelismo y compuertas humanas, versionado
junto al código. El motor ejecuta sesiones de agente multi-turno con acceso a herramientas; las
compuertas humanas pausan la ejecución para una decisión de aprobación. Es, en esencia, la misma idea
de "fase" que tenemos en Capa 1, pero expresada como grafo explícito en vez de secuencia de llamadas
en código.

## Decisiones de arquitectura, comparadas con las nuestras

### Lenguaje de implementación: binario único, cero dependencias

Construido en un lenguaje de sistemas, compilado a un binario único sin runtime — sin necesitar
Python, Node ni Docker instalados para *correr el motor en sí*. Es una propuesta de distribución más
fuerte que la nuestra: nuestra Capa 1 asume Node 22+ instalado.

**Por qué no cambiamos de decisión:** nuestra razón para TypeScript/Node (documentada en
`orbit-core/DESIGN.md`) es que el sustrato principal que vamos a orquestar — tu asistente de IA de
hoy — ya es un CLI de Node, y los hooks/configuración que necesitaremos cablear en Capa 0 son
JSON/JS-nativos. Un binario sin dependencias es una ventaja real de distribución, pero resuelve un
problema (instalar un runtime) que en nuestro caso específico ya está resuelto porque el runtime ya
tiene que estar ahí para el propio sustrato. Vale la pena re-evaluar esto solo si algún día
distribuimos orbit-core para gente que NO usa ya un sustrato basado en Node — no es el caso hoy.

### Enrutamiento de modelo declarativo, con fallback automático

Mecanismo concreto: una hoja de estilos (literalmente con sintaxis parecida a CSS) que enruta cada
nodo del grafo al modelo/proveedor correcto, con cadenas de fallback automático si el primero falla
o se agota la cuota.

**Por qué importa de verdad:** esto es la respuesta mecánica y limpia al problema que el Laboratorio
F documentó de forma dolorosa y manual (traspasar la factory completa a otro proveedor a mano cuando
se agota la cuota, con los primeros intentos caóticos). En vez de un protocolo de traspaso ad hoc
post-hoc, la idea es enrutar y hacer fallback *por diseño*, declarativamente, antes de que el
problema ocurra. Esto se incorpora como requisito de diseño concreto para la Capa 0 que construimos
a continuación: el `Substrate` no debería ser uno solo fijo por `Run`, sino un enrutador con reglas
declarativas de "qué modelo para qué tipo de fase" + cadena de respaldo.

### Sandboxes en VMs de nube, no solo aislamiento de archivos

Cada ejecución corre en una VM de nube aislada (arranque desde snapshot, controles de red,
limpieza automática) — una capa de aislamiento más fuerte que worktree + git: aísla también la red,
no solo el sistema de archivos.

**Por qué lo anotamos sin construirlo ya:** nuestra Capa 2 planeada (aislamiento por worktree, del
Laboratorio C) cubre el caso común sin depender de infraestructura de nube de terceros. Un sandbox
de VM es una opción más fuerte y más cara — vale la pena dejarlo como adaptador opcional de Capa 2
para cuando el riesgo lo justifique (p. ej. un agente con acceso de red amplio), no como requisito
desde el día uno.

### Tablero de estado visual + streaming de eventos en vivo

Interfaz web con un tablero tipo kanban (columnas de estado del flujo de trabajo) alimentado por una
API con streaming de eventos en tiempo real sobre HTTP, no solo polling.

**Por qué importa:** confirma, desde un ángulo distinto, el mismo hallazgo del Laboratorio F — un
layer visual de estado deja de ser opcional a cierta escala de uso. Nuestro `Trace` ya expone una
consulta por cursor (`since(runId, cursor)`) que es exactamente el tipo de primitivo sobre el que se
construye un stream de eventos en vivo — no haría falta rediseñar el trazado para soportar esto
eventualmente, solo añadir un transporte encima.

## Qué rescatar para orbit-core

1. **El `Substrate` de Capa 0 debería nacer como un enrutador con reglas declarativas y fallback**,
   no como un adaptador único fijo — esto cambia el alcance de lo que construimos a continuación, de
   forma bien justificada por el problema real documentado en el Laboratorio F.
2. **Sandbox de VM como adaptador opcional de aislamiento en Capa 2**, no como reemplazo del
   aislamiento por worktree — anotado para más adelante, no se construye ahora.
3. **El diseño de `Trace.since()` ya es compatible con un futuro transporte de streaming** — no
   requiere cambios, es una validación de que el cursor por rowid fue la elección correcta.
4. **No cambiar la decisión de TypeScript/Node** — el argumento de "binario sin dependencias" es
   real pero resuelve un problema que nuestro contexto específico (sustrato ya basado en Node) no
   tiene.
