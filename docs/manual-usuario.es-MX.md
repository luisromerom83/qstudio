# Manual de usuario – Inspire Flex Studio

Inspire Flex Studio crea y administra ambientes de demostración de Quadient Inspire Flex en Docker, con casos de uso listos para presentar, desde una sola consola web en http://localhost:8090.

[TOC]

## 1. Instalación

El Studio es un solo contenedor (`inspire-studio-manager`) que crea los demás contenedores de cada ambiente; solo necesitas Docker y acceso a Internet.

**Requisitos**

- Docker Engine con Docker Compose v2 (Linux), o Docker Desktop con motor WSL 2 y contenedores Linux (Windows / macOS).
- Credenciales de Azure Container Registry de Quadient (usuario y token) y la dirección del servidor de licencias de Inspire.
- Memoria suficiente para un ambiente completo; al activar una demo, el Studio detiene las demás para liberar memoria.

**Iniciar en Linux**

1. En la carpeta del proyecto ejecuta `./run-studio.sh` (o `docker compose up -d`).
2. Abre http://localhost:8090.

**Iniciar en Docker Desktop (Windows / macOS)**

1. Copia el archivo `dockercomposestudio.yml` a una carpeta.
2. En esa carpeta ejecuta `docker compose -f dockercomposestudio.yml pull` y luego `docker compose -f dockercomposestudio.yml up -d`.
3. Abre http://localhost:8090.

El archivo monta el socket de Docker y tres volúmenes: `studio_data` (ajustes), `studio_environments` (ambientes) y `studio_docker_config` (sesión de Azure). La variable `STUDIO_LANG` fija el idioma inicial: `es-MX`, `en-US` o `pt-BR`.

**Primer ingreso**

La pantalla *Bienvenido a Demo & PoC Studio* pide el usuario ACR, el password o token ACR y el servidor de licencia de Inspire. Pulsa **Probar conexión** y después **Guardar y entrar**.

**Mantenimiento**

| Tarea | Comando |
| --- | --- |
| Ver logs del Studio | `docker compose logs -f` |
| Detener el Studio | `docker compose down` |
| Actualizar a la última versión | `docker compose pull && docker compose up -d` |

Detener o actualizar el Studio no borra los ambientes ni sus datos.

## 2. Recorrido rápido

El menú superior tiene las secciones del Studio, el botón **Nueva demo** y el selector de idioma (ES · MX, EN · US, PT · BR).

| Sección | Para qué sirve |
| --- | --- |
| Catálogo | Ver todas las demos por vertical, activarlas, detenerlas y abrir sus notas. |
| Servicios y logs | Ver la topología del ambiente, los accesos a cada servicio, sus logs y el diseño de arquitectura. |
| Versiones | Explorar las versiones de Inspire publicadas en Azure Container Registry. |
| Almacenamiento | Ver y eliminar los volúmenes de datos de cada ambiente y su ubicación en el equipo. |
| Ajustes | Credenciales, versión de Inspire, dirección del host, Quadient Cloud, Firebase y respaldo de ajustes. |
| Ayuda | Este manual, dentro del Studio (ícono de libro). |

## 3. Crear y administrar ambientes

Cada ambiente es una demo aislada con su propia versión de Inspire, sus servicios y sus datos; solo uno corre a la vez.

**Crear un ambiente**

1. Pulsa **Nueva demo** (o *Crear primer ambiente* si el catálogo está vacío).
2. Llena las pestañas del formulario:
    - **General**: nombre, vertical de industria, descripción o notas de la presentación, versión de Inspire, puerto de Interactive (vacío = automático) y carpeta del host para los volúmenes (opcional; vacío = volumen estándar de Docker).
    - **Inspire**: ICM y Postgres (obligatorios), Interactive (puertos 30701 / 30354) con *Demo Mode* opcional, y Scaler (puertos 30600 / 30354) con sus carpetas `sharedfolder` y *Jobs Directory*.
    - **Integraciones**: servicios opcionales Apache Kafka (broker en el puerto 9092) y servidor FTP (puerto 21, usuario `system` / `Password12345*`).
    - **Casos de uso**: marca las apps demo que tendrá el ambiente (ver la sección 6).
    - **Look & feel**: logo del cliente (PNG, JPG, SVG o WebP) y colores primario, secundario y terciario para los casos de uso.
3. Pulsa **Crear ambiente**.

**Activar y detener**

- En el **Catálogo**, cada tarjeta tiene **Activar** o **Detener**. Al activar una demo se detienen las demás. La primera activación tarda varios minutos porque descarga las imágenes.
- El estado se muestra como *Activa*, *Detenida*, *Activando* o *Parcial* (algún servicio no está en ejecución).
- En **Servicios y logs** están también **Iniciar todo** y **Detener todo**.

**Cambiar un ambiente**

En **Servicios y logs**, elige el ambiente y pulsa **Configurar servicios**. Tiene las mismas pestañas que la creación; al pulsar **Guardar cambios** el Studio actualiza los contenedores.

**Eliminar un ambiente**

Pulsa **Eliminar ambiente** y elige:

- **Eliminar y conservar datos**: borra los contenedores y guarda bases de datos, paquetes ICM y archivos para recrearlo después.
- **Eliminar todo**: borra también los datos; pide escribir el nombre del ambiente para confirmar.

## 4. Servicios y logs

Esta vista muestra la topología del ambiente seleccionado: cada servicio es una tarjeta con su estado, puerto, contenedor, accesos y logs.

- **Ambiente seleccionado**: el selector de arriba cambia de ambiente.
- **Grupos de la topología**: Front-end (Interactive), Back-end (Scaler · hub de comunicaciones, ICM y Postgres), Sistemas del cliente e integraciones (Kafka, FTP, Digital Services) y Casos de uso.
- **Enlaces ABRIR**: abren Interactive, Scaler, el portal de casos de uso o Digital Services en una pestaña nueva.
- **Conectar desde tu equipo**: en ICM y FTP aparece la IP del host y el puerto publicado, con botón para copiar. Es la dirección para conectar el Designer o un cliente FTP desde este u otro equipo de la red.
- **¿Qué es…?** (ícono de información): explica cada componente de Inspire para usarlo en la presentación.
- **Iniciar, detener y reiniciar** cada servicio por separado.
- **Logs**: despliega los últimos registros del contenedor; el botón de refrescar los actualiza.

Dentro de la red de Docker los servicios se encuentran por su nombre, por ejemplo `scaler:30600` o `<ambiente>-kafka:9092`, sin importar el nombre del ambiente. Desde fuera se usa la IP del host.

Si aparece *Inicializando esquemas de base de datos (Prepare)*, los contenedores one-shot están preparando las bases de datos; espera a que terminen. Si fallan, revisa sus logs.

## 5. Diseñar arquitectura

El lienzo de Servicios y logs se puede acomodar libremente para contar la arquitectura del cliente; el diseño se guarda por ambiente y solo cambia cuando tú lo editas. Está disponible en pantallas de escritorio.

**Entrar y salir del modo edición**

1. En Servicios y logs pulsa **Diseñar arquitectura** (o **Editar diseño** si ya hay uno guardado).
2. Haz los cambios.
3. Pulsa **Bloquear diseño** para guardarlo, o **Cancelar** para descartarlos.

**Restablecer** regresa el ambiente al diseño automático y borra el guardado.

**Lo que puedes hacer en modo edición**

| Acción | Cómo |
| --- | --- |
| Mover un elemento | Arrástralo. Se alinea a la cuadrícula. |
| Cambiar el tamaño | Arrastra la esquina inferior derecha. |
| Seleccionar varios | Clic en uno; Shift o Ctrl + clic agrega o quita otros. Arrastrar uno mueve toda la selección. Esc limpia la selección. |
| Agrupar | Selecciona dos o más elementos y pulsa **Agrupar (n)**. Se crea una caja alrededor y se pide su nombre. |
| Mover un grupo | Arrástralo por su título; los elementos que están dentro se mueven con él. |
| Renombrar un grupo | Botón de lápiz en la esquina del grupo. |
| Desagrupar | Botón de desagrupar en la esquina del grupo (o **Desagrupar** en su lápiz). La caja desaparece y los elementos se quedan donde están. Los grupos automáticos solo se ocultan; Restablecer los regresa. |
| Agregar un elemento | **Agregar elemento**: elige una plantilla (AWS Cloud Services, Microsoft Azure, Google Cloud, SAP, CRM, Base de datos, Correo / SMS, Sistema del cliente u Otro), nombre, descripción, enlaces y color. |
| Editar o eliminar un elemento propio | Botón de lápiz en su encabezado. |
| Crear una flecha | Arrastra el punto azul de un elemento hasta otro. |
| Editar una flecha | Clic en la flecha: etiqueta (por ejemplo el protocolo), un sentido o doble sentido, o **Quitar flecha**. |
| Reordenar casos de uso | Arrastra las tarjetas dentro del grupo Casos de uso; cada tarjeta puede tener su propia flecha. |

**Enlaces de un elemento**

En el diálogo del elemento, **Agregar enlace** añade una fila con nombre y URL (hasta 6). Solo se aceptan direcciones que empiezan con `http://` o `https://`; si dejas el nombre vacío se muestra el dominio. En la tarjeta, cada enlace aparece con el botón **ABRIR**, igual que los accesos de Scaler o Interactive.

Si la caja de un grupo queda justo a la medida de su elemento, el título del grupo se tapa; agranda la caja para que se vean sus botones.

## 6. Casos de uso incluidos

Los casos de uso son apps que simulan los sistemas del cliente; todos corren en un solo contenedor y puerto, cada uno en su ruta, y el portal de casos de uso los lista. Se activan por ambiente en la pestaña **Casos de uso** al crear o configurar el ambiente.

| Caso de uso | Ruta | Qué demuestra | Requiere |
| --- | --- | --- | --- |
| Entrega de Factura Digital con push notifications | `/kafka-csv/` | Publica una factura como mensaje JSON en un tópico de Kafka; Scaler la consume y la entrega en Quadient Inspire DAS. Solo se define el ID del usuario destinatario; el host y puerto de Kafka ya vienen llenos. | Apache Kafka activo en el ambiente |
| Digital Advantage Inbox | `/das-inbox/` | Login con cuenta de Quadient Cloud y bandeja con los documentos del usuario y los públicos. Incluye **Crear cuenta** para que el usuario se registre. | Quadient Cloud en Ajustes |
| Banca en línea | `/das-banking/` | Portal de banca con datos de ejemplo; sus estados de cuenta mensuales son los documentos de Digital Services filtrados por un metadato (por defecto `DocType` = `accstt`). Mismo login que Digital Advantage Inbox. | Quadient Cloud y Banca en línea en Ajustes |
| Push Notifications Inbox | `/push-inbox/` | Bandeja de mensajes HTML con notificaciones push. Scaler envía los documentos a `POST /push-inbox/api/inbox/send`. | Proyecto de Firebase en Ajustes |
| Demos personalizadas | una ruta por demo | Abre un documento de una aplicación de Quadient Cloud con acceso anónimo, sin login (por ejemplo, Solicitud de Tarjeta de Crédito). | Demo definida en Ajustes › Quadient Cloud |

**Usuarios de Digital Advantage Inbox y Banca en línea**

Los usuarios son cuentas de Quadient Cloud. Un cliente puede registrarse con **Crear cuenta** en la pantalla de login; Quadient Cloud le asigna un ID de usuario. Ese ID es el *sujeto* de los documentos: para que un estado de cuenta llegue a su bandeja, el ID se pone en los datos de entrada (por ejemplo, en el CSV) antes de generar los documentos.

El logo y los colores definidos en **Look & feel** del ambiente se aplican a estos casos de uso.

## 7. Respaldo de configuración de Scaler e ICM

En **Configurar servicios › Integraciones** hay un apartado *Respaldo de configuración* para llevar la configuración de Scaler y las variables de ICM de un ambiente a otro. El ambiente debe estar activo.

**Configuración de Scaler**

- **Exportar** descarga un JSON con la configuración de administración de Scaler (integraciones, conexiones, ajustes).
- **Importar** carga un archivo exportado de este u otro ambiente y deja elegir qué módulos importar (*Todos* o *Solo con contenido*).
- Cada módulo marcado reemplaza por completo al que tiene Scaler: si el archivo trae 1 servidor FTP y Scaler tiene 3, queda solo 1. Los módulos sin marcar no se tocan.
- Scaler solo acepta la importación con todos los workflows sin desplegar: haz *Undeploy* antes.

**Variables de entorno de ICM**

**Exportar** descarga el archivo `ICMEnvVars.json`; **Importar** lo carga con uno de estos modos:

| Modo | Resultado |
| --- | --- |
| Agregar sin sobrescribir | Agrega las variables nuevas; las existentes conservan su valor. |
| Agregar y sobrescribir | Agrega las nuevas y actualiza las existentes; las demás no se tocan. |
| Reemplazar todas | Deja exactamente las variables del archivo; las que no estén en él se eliminan. |

## 8. Ajustes

Ajustes está organizado en cuatro pestañas; el Studio recuerda la última que abriste.

| Pestaña | Apartado | Qué configura |
| --- | --- | --- |
| Inspire | Credenciales de Azure Container Registry & Licencia | Registro, usuario y token de Azure, y el servidor de licencias (`CX_LIC_SERVER`). **Probar conexión ACR** valida las credenciales. Deja el token en blanco para conservar el actual. |
| Inspire | Versión de Inspire | Actualizar un ambiente a otra versión (ver sección 9). |
| Inspire | Dirección del host | IP o nombre con que otros equipos llegan a este (ICM, FTP). Se detecta sola en Linux; en Docker Desktop hay que escribirla. |
| Quadient Cloud | Quadient Cloud para Digital Advantage Inbox | URL de Quadient Cloud, Application ID y Authentication Client ID de la aplicación de Digital Services. La aplicación necesita un almacén de usuarios con Inspire Authentication y autorregistro. |
| Quadient Cloud | Banca en línea | Metadato y valor que identifican los estados de cuenta (por defecto `DocType` = `accstt`; distingue mayúsculas). Vacío muestra todos los documentos. Depende del apartado anterior. |
| Quadient Cloud | Demos personalizadas | Nombre, descripción, Application ID, Client ID y Document ID de cada demo con acceso anónimo. La aplicación debe tener el proveedor *Anonymous Access*. |
| Firebase | Firebase para Push Notifications Inbox | Configuración web (`firebaseConfig`), VAPID key y cuenta de servicio (`serviceAccountKey.json`). El proyecto necesita Authentication (Email/Password), Firestore y Cloud Messaging. |
| Respaldo | Respaldo de ajustes | Exportar e importar todos los ajustes (ver sección 9). |

Al guardar Quadient Cloud, Banca en línea, una demo o Firebase, los ambientes en ejecución reinician el caso de uso afectado con la nueva configuración (tarda unos segundos).

## 9. Respaldos, cambio de equipo y actualización de versión

El Studio respalda sus ajustes; el contenido de Inspire se respalda exportando desde ICM.

**Respaldo de ajustes (Ajustes › Respaldo)**

- **Exportar ajustes** descarga un archivo con las credenciales de Azure y el servidor de licencias, Firebase, Quadient Cloud, Banca en línea y las demos personalizadas.
- El archivo incluye contraseñas y llaves: guárdalo en un lugar seguro.
- **Importar ajustes** muestra qué contiene el archivo y reemplaza esos apartados. Las demos con el mismo identificador se actualizan y las demás se conservan.
- No incluye los ambientes ni sus datos de Flex.

**Pasar a un equipo nuevo**

1. En el equipo actual: exporta los ajustes, el contenido de cada ambiente desde ICM y, si aplica, la configuración de Scaler y las variables de ICM (sección 7).
2. En el equipo nuevo: instala el Studio (sección 1) e importa los ajustes.
3. Crea los ambientes con los mismos casos de uso y actívalos.
4. Importa el contenido en ICM y, después, la configuración de Scaler y las variables de ICM.

**Actualizar la versión de Inspire (Ajustes › Inspire › Versión de Inspire)**

1. Respalda el contenido exportándolo desde ICM.
2. Pulsa **Consultar versiones**; se listan las versiones completas disponibles en Azure.
3. En el ambiente, elige la **Nueva versión** y pulsa **Actualizar**; confirma.
4. El Studio descarga las imágenes (varios GB). Si el ambiente está en ejecución, lo reinicia con la nueva versión; si está detenido, la usará la próxima vez que lo actives.

Al arrancar, Inspire migra sus bases de datos: no se puede regresar a la versión anterior con los mismos datos.

La sección **Versiones** del menú sirve para explorar las versiones principales y los hotfixes publicados en Azure Container Registry y asignar una al ambiente activo.

## 10. Solución de problemas

| Síntoma | Qué hacer |
| --- | --- |
| El Studio no inicia en Docker Desktop | Verifica que use el motor WSL 2 y contenedores Linux, y que el socket `/var/run/docker.sock` esté montado como en `dockercomposestudio.yml`. Revisa con `docker compose -f dockercomposestudio.yml logs`. |
| No conecta con Azure Container Registry | En Ajustes › Inspire revisa usuario y token y pulsa **Probar conexión ACR**. |
| El ambiente queda en *Parcial* | En Servicios y logs abre los logs del servicio detenido y reinícialo. |
| Falla *Preparación de base de datos (Prepare)* | Revisa los logs de los contenedores one-shot; corrige y vuelve a activar el ambiente. |
| La tarjeta de ICM o FTP no muestra la IP del host | En Docker Desktop no se detecta: escríbela en Ajustes › Inspire › Dirección del host. |
| Digital Advantage Inbox o Banca en línea no inician sesión | Revisa Ajustes › Quadient Cloud: URL, Application ID y Client ID, y que la aplicación tenga almacén de usuarios de Quadient Cloud. |
| Banca en línea no muestra estados de cuenta | El metadato distingue mayúsculas: confirma que los documentos tengan `DocType` = `accstt` (o el valor configurado) y que el ID del usuario sea el sujeto del documento. |
| La importación de Scaler responde con error | Haz *Undeploy* de todos los workflows y vuelve a importar. |
| Push Notifications Inbox no envía notificaciones | Completa Firebase en Ajustes y abre la app con `localhost` o HTTPS. |
| Un caso de uso no aparece en el portal | Actívalo en Configurar servicios › Casos de uso; si publica en Kafka, activa también Apache Kafka. |
