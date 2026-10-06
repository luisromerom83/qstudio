# Guía de Empaquetado y Despliegue Automatizado
## Quadient Inspire Flex Stack & Demo Studio Orchestrator

Esta guía describe cómo compartir e instalar el entorno completo de contenedores en cualquier servidor o equipo nuevo (especialmente en **Windows desde cero** para compartir con equipos de trabajo).

---

## ⚡ MÉTODO RECOMENDADO: Despliegue Rápido en Windows desde Docker Hub

Para compartir la solución con tu equipo de trabajo o instalar en Windows desde cero:

### 1. Requisitos Previos en Windows
1. Instalar y abrir **Docker Desktop** (asegúrate de que el ícono esté en verde en la barra de tareas).
2. Descargar únicamente los archivos ligeros:
   * [`docker-compose.studio.yml`](file:///home/lromero/.gemini/antigravity-ide/scratch/kafka-csv-producer/docker-compose.studio.yml)
   * [`run-studio.bat`](file:///home/lromero/.gemini/antigravity-ide/scratch/kafka-csv-producer/run-studio.bat) (o [`run-studio.ps1`](file:///home/lromero/.gemini/antigravity-ide/scratch/kafka-csv-producer/run-studio.ps1))

### 2. Iniciar el Orchestrator
* **Opción A (Doble clic)**: Haz doble clic en `run-studio.bat`.
* **Opción B (Línea de comandos)**:
  ```powershell
  docker compose -f docker-compose.studio.yml up -d
  ```

El script descargará automáticamente la imagen oficial desde Docker Hub:
**`luisromerom/inspire-flex-demo-studio:latest`**

### 3. Abrir la Consola Web
Abre en tu navegador:
👉 **`http://localhost:8090`**

### 4. Configuración Inicial (Onboarding)
1. En el asistente inicial o en la pestaña **Ajustes** (⚙️), ingresa tus credenciales de Azure (`quadientdistribution.azurecr.io`), usuario, contraseña y la URL del servidor de licencias.
2. Presiona **Guardar y Probar Conexión**.

### 5. Presentación de Demostraciones
* Haz clic en **▶ Activar Demo** en la tarjeta **Demo Base / General** o en cualquier vertical (Retail, Banca, Seguros, Salud).
* La primera activación inicializará automáticamente PostgreSQL, creará las bases de datos (`scaler_db`, `icm_db`, `interactive_db`), creará el usuario administrador `system`, asignará permisos de impersonación en ICM y preparará Scaler.
* Abre los accesos directos desde la tarjeta:
  - **Inspire Interactive**: `http://localhost:30701/interactive` (con Demo Mode y avatares precargados)
  - **Inspire Scaler**: `http://localhost:30600/scaler`

---

## 🛡️ Aislamiento de Puertos y Demo Mode (Sin Cruces)

El sistema implementa una arquitectura de prevención total de conflictos:

1. **Puertos No Cruzados (Garantía de Offset Limpio)**:
   - **Ambiente Base**: Interactive (`30701`), Scaler (`30600`), Scaler IPS (`30354`), ICM (`30353`), PostgreSQL (`5432`), CSV Studio (`8080`).
   - **Ambiente 1 (Offset +10)**: Interactive (`30711`), Scaler (`30610`), Scaler IPS (`30364`), ICM (`30363`), PostgreSQL (`5442`).
   - **Ambientes Siguientes**: Saltos limpios de +10 (`30721`, `30731`...) garantizando que ningún puerto colisione con Scaler IPS ni ICM.
   - El sistema analiza los puertos en uso en Docker y el sistema operativo antes de asignar puertos para evitar conflictos.

2. **Demo Mode Aislado por Ambiente**:
   - Cada sandbox cuenta con su propio volumen Docker independiente: `{project_name}_demomode_{env_id}`.
   - Los archivos de configuración (`users.json` y avatares) se sincronizan de forma aislada en `/opt/QuadientInteractive/config/demo-mode`, permitiendo personalizar usuarios y compañías por vertical sin alterar otros ambientes.

## 📋 Requisitos en el Equipo Destino

1. **Sistema Operativo**: Linux (Ubuntu, Debian, RHEL, Rocky, etc.), macOS o Windows con WSL2.
2. **Docker Engine**: Versión 24.0 o superior.
3. **Docker Compose**: Plugin v2 (`docker compose`).
4. **Conexión a Internet**: Acceso saliente para descargar imágenes desde:
   * Azure Container Registry (`quadientdistribution.azurecr.io`)
   * Docker Hub (`docker.io` para PostgreSQL y Apache Kafka)

---

## 📦 1. Archivos que Componen el Paquete

El paquete de despliegue contiene únicamente los archivos de configuración, scripts y código fuente ligero (ocupa menos de 1 MB):

| Archivo / Directorio | Descripción |
| :--- | :--- |
| `deploy.sh` | Asistente interactivo de instalación y actualización automática. |
| `docker-compose.yml` | Orquestación de servicios y perfiles (`Tipo 1` y `Tipo 2`). |
| `init-databases.sql` | Script SQL que crea las bases de datos `icm_db`, `scaler_db` e `interactive_db`. |
| `grant_impersonation.java` | Inicializador de permisos para el usuario administrador `system`. |
| `Dockerfile` | Definición para construir el contenedor de Kafka CSV Studio. |
| `app.py` / `producer.py` | Backend en Python/Flask del productor Kafka con API y Web GUI. |
| `requirements.txt` | Dependencias de Python para la GUI. |
| `static/` y `templates/` | Archivos frontend de la interfaz web. |

---

## 🚀 2. Cómo Empaquetar y Transferir

### En tu máquina actual:
Ejecuta el siguiente comando para generar el paquete comprimido:

```bash
tar -czvf quadient-deploy-bundle.tar.gz \
  docker-compose.yml \
  deploy.sh \
  deploy.ps1 \
  init-databases.sql \
  grant_impersonation.java \
  Dockerfile \
  app.py \
  producer.py \
  requirements.txt \
  static/ \
  templates/ \
  GUIA_DESPLIEGUE.md
```

Copia el archivo `quadient-deploy-bundle.tar.gz` al nuevo servidor mediante `scp`, pendrive o tu método preferido:
```bash
scp quadient-deploy-bundle.tar.gz usuario@servidor-destino:/home/usuario/
```

---

## ⚙️ 3. Instalación en el Nuevo Servidor

### Paso 1: Descomprimir el paquete

* **En Linux / WSL / macOS / PowerShell Windows:**
  ```bash
  tar -xzvf quadient-deploy-bundle.tar.gz
  cd quadient-deploy-bundle
  ```
  *(En Windows también puedes hacer clic derecho y extraer con 7-Zip o WinRAR).*

### Paso 2: Ejecutar el asistente

* **Opción A: En Linux / WSL / Git Bash:**
  ```bash
  chmod +x deploy.sh
  ./deploy.sh
  ```

* **Opción B: En Windows nativo (Docker Desktop con Doble Clic o PowerShell):**
  * **Método 1 (El más fácil)**: Haz doble clic en el archivo `deploy.bat`.
  * **Método 2 (Por consola)**: Abre PowerShell y ejecuta:
    ```powershell
    powershell -ExecutionPolicy Bypass -File .\deploy.ps1
    ```

---

## 🖥️ 4. Flujo del Asistente Interactivo (`deploy.sh`)

Durante la ejecución, el asistente te solicitará 4 datos:

### 1) Versión de Inspire
```text
Versión de Inspire (ej. 17.5, 17.6, 18.0) [default: 17.5]: 
```
* Puedes escribir `17.5`, `17.6` o `18.0`.
* El script automáticamente le añade `-latest` (ej. `17.5-latest`) para forzar la descarga de la última compilación/hotfix disponible en Azure.

### 2) Credenciales de Azure Registry y Servidor de Licencia
```text
Azure Container Registry [quadientdistribution.azurecr.io]: 
Usuario ACR: <Tu_Usuario_Azure>
Password/Token ACR: <Tu_Password_o_Token_Azure>
Servidor de Licencia Inspire (CX_LIC_SERVER): <Tu_Servidor_Licencia>
```
> **Nota de Seguridad**: Las credenciales se guardan localmente en `.quadient_credentials.env` y `.env` con permisos restringidos (`600`). Si vuelves a ejecutar `./deploy.sh` más adelante, recordará estos valores y bastará con pulsar **Enter**.

### 3) Selección del Tipo de Instalación
```text
1) Únicamente Quadient (IPS, ICM, Scaler, Interactive + Postgres)
2) Full Stack (Quadient + Servidores Kafka KRaft + GUI CSV Studio)
Seleccione opción [1 o 2]: 
```

* **Opción 1 (Tipo 1 - Inspire Core)**:
  * PostgreSQL (con las bases de datos preparadas)
  * Inspire Content Manager (ICM)
  * Inspire Scaler
  * Inspire Production Server (IPS)
  * Inspire Interactive Web

* **Opción 2 (Tipo 2 - Full Stack)**:
  * Todos los servicios del Tipo 1
  * Apache Kafka (Modo KRaft autónomo sin Zookeeper)
  * Kafka CSV Studio (GUI web interactiva para enviar archivos CSV/JSON)

---

## 🌐 5. Direcciones y Puertos de Acceso

Una vez concluido el despliegue, podrás acceder a los siguientes servicios:

| Servicio | URL / Puerto | Credenciales Predeterminadas |
| :--- | :--- | :--- |
| **Inspire Interactive** | `http://<IP_SERVIDOR>:30701/interactive` | `system` / `Password12345*` |
| **Inspire Scaler Web** | `http://<IP_SERVIDOR>:30600/scaler` | `system` / `Password12345*` |
| **Inspire ICM Engine** | Puerto `30353` | `system` / `Password12345*` |
| **Inspire IPS Engine** | Puerto `30354` | — |
| **PostgreSQL** | Puerto `5432` | `scaler` / `scalerpassword123` |
| **Kafka CSV Studio (GUI)** *(Tipo 2)* | `http://<IP_SERVIDOR>:8080` | Acceso directo web |
| **Apache Kafka Broker** *(Tipo 2)* | `<IP_SERVIDOR>:9092` | PLAINTEXT sin auth |

---

## 🛠️ 6. Comandos Útiles de Mantenimiento

### Ver el estado de los contenedores
```bash
docker compose ps
```

### Ver logs en tiempo real
```bash
# Todos los servicios
docker compose logs -f

# De un servicio específico (ej. interactive o scaler)
docker compose logs -f interactive
docker compose logs -f scaler
```

### Forzar actualización a las últimas imágenes publicadas
```bash
# Para Tipo 1:
docker compose --env-file .quadient_credentials.env pull
docker compose --env-file .quadient_credentials.env up -d

# Para Tipo 2:
docker compose --env-file .quadient_credentials.env --profile full pull
docker compose --env-file .quadient_credentials.env --profile full up -d
```

### Detener los servicios
```bash
# Detener sin borrar datos
docker compose stop

# Detener y remover contenedores (los volúmenes de datos se conservan)
docker compose down
```

### Reiniciar desde cero (Limpieza total)
> ⚠️ **Precaución**: Esto eliminará los datos de la base de datos y de ICM.
```bash
docker compose down -v
./deploy.sh
```
