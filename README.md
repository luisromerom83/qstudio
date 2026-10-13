# Quadient Inspire Flex - Demo & PoC Studio 🚀

Orquestador web para gestionar, desplegar y operar entornos aislados de demostración y pruebas de concepto (PoC) de **Quadient Inspire Flex** en contenedores Docker.

---

## 📋 Requisitos Previos

* **Docker Engine** y **Docker Compose v2** (o **Docker Desktop** en Windows / macOS).
* Conectividad a Internet (para descargar la imagen del Studio desde Docker Hub).

---

## ⚡ Inicio Rápido

### En Linux / macOS
```bash
./run-studio.sh
```
*(o directamente: `docker compose up -d`)*

### En Windows
* Haz doble clic en **`run-studio.bat`**
* O ejecuta en PowerShell:
  ```powershell
  .\run-studio.ps1
  ```
*(o directamente: `docker compose up -d`)*

---

## 🌐 Acceso a la Interfaz Web

Una vez levantado el contenedor, abre tu navegador en:

👉 **[http://localhost:8090](http://localhost:8090)**

Desde el panel de control podrás:
- Crear y gestionar sandboxes/entornos por industrias (Banca, Seguros, Telco, Retail, etc.).
- Conectar con el registro privado de Quadient (Azure Container Registry).
- Desplegar, iniciar, pausar y destruir contenedores de Inspire Flex.
- Gestionar snapshots y respaldos de estado.

---

## 🧩 Casos de Uso

Las apps demo que simulan los sistemas del cliente (formularios, inbox de notificaciones, etc.) viven en un solo contenedor, `use-cases`, con un solo puerto. Al crear o editar un ambiente se marca cada caso de uso por separado; el portal en `http://localhost:<puerto>/` lista los habilitados y cada uno responde en su propia ruta:

| Caso | Ruta | Requiere |
|------|------|----------|
| Formularios a Kafka | `/kafka-csv/` | Apache Kafka (servicio opcional del ambiente) |
| Push Notifications Inbox | `/push-inbox/` | Proyecto de Firebase (Configuración) |

Para agregar un caso nuevo, crea `use-cases/cases/<id>/` con:
- `case.json`: `name`, `description`, `icon`, `requires` (`kafka`, `firebase`) y `order`.
- `router.js`: exporta `{ router }` (un `express.Router` con sus APIs y `express.static` de su carpeta `public/`) y, opcionalmente, `status()` para indicar en el portal si le falta configuración.
- `public/`: el frontend, con rutas relativas (`api/...`, `app.js`) porque se sirve bajo `/<id>/`.

El manager lo detecta solo y lo muestra como checkbox.

---

## 🛠️ Comandos de Mantenimiento

* **Ver estado y logs:**
  ```bash
  docker compose logs -f
  ```
* **Detener el Studio:**
  ```bash
  docker compose down
  ```
* **Actualizar a la última versión:**
  ```bash
  docker compose pull && docker compose up -d
  ```
