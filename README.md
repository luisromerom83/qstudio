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
