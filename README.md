# Kafka CSV Producer Studio 🚀

Cliente productor de Apache Kafka con **interfaz web interactiva** y API REST, empaquetado en un contenedor Docker optimizado y listo para ser publicado en Docker Hub.

Permite cargar cualquier archivo CSV o pegar texto directamente desde un navegador web, previsualizar los datos y enviarlos a un servidor Kafka en tu red en cualquier momento.

---

## ✨ Características Principales

- 🌐 **Interfaz Web Interactiva**: Abre tu navegador y envía archivos CSV cuando quieras sin necesidad de reiniciar el contenedor.
- 📁 **Subida Drag & Drop**: Arrastra y suelta archivos `.csv` con detección automática de columnas.
- 📝 **Editor Directo**: Pega texto plano CSV con delimitadores personalizados (`,`, `;`, `\t`, `|`).
- 👁️ **Previsualización en Tabla**: Inspecciona las primeras filas antes de enviarlas.
- ⚡ **Configuración de Red Kafka Flexible**:
  - `KAFKA_HOST`: IP o Hostname del servidor Kafka en tu red local (ej. `192.168.1.100`).
  - `KAFKA_PORT`: Puerto del broker Kafka (ej. `9092`).
  - `KAFKA_TOPIC`: Topic destino en Kafka.
  - O `KAFKA_BOOTSTRAP_SERVERS`: Dirección completa.
- 🔑 **Clave Dinámica (Key Column)**: Asigna una columna del CSV como clave de particionado en Kafka.
- 📦 **Formatos de Envío**:
  - `json`: Un objeto JSON por cada fila (por defecto).
  - `raw`: Una línea de texto por cada fila.
  - `whole`: Todo el CSV en un único mensaje Kafka.
- 📊 **Métricas en Tiempo Real**: Conteo de registros enviados, tiempo total, tasa de transferencia y registro de actividad en vivo.

---

## 🐳 Ejecución Rápida con Docker

### Paso 1: Iniciar el Contenedor
Ejecuta el contenedor mapeando el puerto `8080` y pasando la IP/puerto de tu broker Kafka por variables de entorno:

```bash
docker run -d \
  --name kafka-csv-studio \
  -p 8080:8080 \
  -e KAFKA_HOST="192.168.1.100" \
  -e KAFKA_PORT="9092" \
  -e KAFKA_TOPIC="sensores-iot" \
  tu_usuario/kafka-csv-producer:latest
```

### Paso 2: Abrir en el Navegador
Abre en tu navegador:
👉 **`http://localhost:8080`** (o `http://<IP_DE_TU_SERVIDOR>:8080`)

¡Listo! Verás el formulario con la IP, puerto y topic ya pre-llenados. Solo arrastra tu archivo CSV y presiona **🚀 Enviar a Kafka**.

---

## 📦 Cómo Construir y Subir a Docker Hub

### 1. Iniciar sesión en Docker Hub
```bash
docker login
```

### 2. Construir la Imagen
*(Reemplaza `tu_usuario` por tu nombre de usuario en Docker Hub)*:
```bash
docker build -t tu_usuario/kafka-csv-producer:latest .
```

> **Soporte Multi-Arquitectura (Opcional)**: Si deseas compatibilidad tanto para x86_64 como para ARM64 (Apple Silicon / Raspberry Pi):
> ```bash
> docker buildx build --platform linux/amd64,linux/arm64 -t tu_usuario/kafka-csv-producer:latest --push .
> ```

### 3. Subir a Docker Hub
```bash
docker push tu_usuario/kafka-csv-producer:latest
```

---

## 🔌 Uso como API REST

Además de la interfaz web, el contenedor expone endpoints HTTP que puedes consumir vía `curl` o desde tus scripts:

### Enviar un archivo CSV por API (completo o línea por línea):
```bash
# Envío CSV completo en 1 solo request omitiendo cabecera:
curl -X POST http://localhost:8080/api/send \
  -F "file=@/ruta/datos.csv" \
  -F "data_type=csv" \
  -F "delimiter=," \
  -F "send_mode=whole" \
  -F "ignore_header=true" \
  -F "host=192.168.1.100" \
  -F "port=9092" \
  -F "topic=sensores-iot"

# Envío CSV línea por línea:
curl -X POST http://localhost:8080/api/send \
  -F "file=@/ruta/datos.csv" \
  -F "data_type=csv" \
  -F "delimiter=," \
  -F "send_mode=lines" \
  -F "ignore_header=true" \
  -F "topic=sensores-iot"
```

### Enviar JSON completo por API:
```bash
curl -X POST http://localhost:8080/api/send \
  -F "file=@/ruta/payload.json" \
  -F "data_type=json" \
  -F "topic=eventos-json" \
  -F "host=192.168.1.100"
```

---

## ⚙️ Variables de Entorno Disponibles

| Variable | Valor por Defecto | Descripción |
| :--- | :--- | :--- |
| `KAFKA_HOST` | `""` | IP o Hostname del broker Kafka en la red. |
| `KAFKA_PORT` | `9092` | Puerto del broker Kafka. |
| `KAFKA_BOOTSTRAP_SERVERS` | `""` | Dirección completa alternativa (ej: `192.168.1.100:9092`). |
| `KAFKA_TOPIC` | `""` | Nombre del topic Kafka predeterminado. |
| `DATA_TYPE` | `csv` | Origen de datos predeterminado (`csv` o `json`). |
| `CSV_DELIMITER` | `,` | Delimitador CSV por defecto (`,`, `;`, `\t`, `\|`). |
| `SEND_MODE` | `whole` | Modo de envío para CSV (`whole` = 1 mensaje, `lines` = 1 mensaje por línea). |
| `IGNORE_HEADER` | `false` | Ignorar la primera fila del CSV como cabecera (`true` o `false`). |
| `PORT` | `8080` | Puerto HTTP donde escucha el servidor web. |

---

## 🧪 Pruebas Locales y Desarrollo

### Ejecutar Servidor Web Localmente (Python)
```bash
pip install -r requirements.txt
python app.py
```

### Ejecutar Pruebas Unitarias
```bash
python -m unittest discover -s tests
```

### Probar con Kafka Local (Docker Compose)
```bash
docker compose up --build
```
Abre `http://localhost:8080` en tu navegador.

---

## 🎛️ Quadient Inspire Flex - Demo & PoC Studio

El proyecto incluye un panel web visual para administrar demostraciones y pruebas de concepto por verticales (Seguros, Banca/Finanzas, Telecom, Salud, PoCs de cliente) optimizado para preventa:

### Iniciar el Studio:
```bash
./run_manager.sh start
```
Abre en tu navegador:
👉 **`http://localhost:8090`**

### Comandos disponibles:
* `./run_manager.sh start` - Inicia el servidor en segundo plano.
* `./run_manager.sh stop` - Detiene el servidor.
* `./run_manager.sh restart` - Reinicia el servidor.
* `./run_manager.sh status` - Muestra si el servidor está activo.
* `./run_manager.sh logs` - Muestra los logs en vivo.

### Características del Studio:
1. **Onboarding & Ajustes de Azure**: Asistente inicial para configurar credenciales de Azure Container Registry (`quadientdistribution.azurecr.io`) y servidor de licencias con prueba de conectividad en vivo.
2. **Catálogo de Demos por Vertical**: Tarjetas organizadas por industria con links directos a Inspire Interactive y Scaler.
3. **Modo Ahorro de RAM (On-Demand)**: Con 1 clic activa la demo a presentar hoy y suspende las demás para liberar memoria y CPU de tu equipo.
4. **Servicios & Logs en Vivo**: Control granular de cada contenedor (`postgres`, `icm`, `scaler`, `ips`, `interactive`) y visor de logs en tiempo real.
5. **Explorador de Versiones en Azure (ACR)**: Consulta las versiones disponibles en el registro de Azure antes de actualizar.
6. **Snapshots & Respaldos**: Crea respaldos point-in-time de bases de datos y configuraciones para exportar o restaurar demostraciones.

