# Quadient Inspire Flex Stack (Docker Deployment)

Paquete de despliegue reproducible para **Quadient Inspire Flex 17.5** en Docker / Docker Compose.

---

## Servicios incluidos

| Servicio | Contenedor | Puerto(s) | Descripción |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | `quadient-postgres` | `5432` | Bases de datos independientes `scaler_db`, `icm_db` e `interactive_db` |
| **Inspire Content Manager (ICM)** | `inspire-icm` | `30353` | Gestor de contenidos y repositorio central |
| **Inspire Scaler** | `inspire-scaler` | `30600`, `30354` | Motor de orquestación y GUI web |
| **Inspire Production Server (IPS)** | `inspire-ips` | `30354` *(Modo Pod Scaler)* | Motor de composición de Scaler |
| **Inspire Interactive** | `inspire-interactive` | `30701` | Portal web interactivo de documentos |
| **Inspire Production Server (IPS)** | `inspire-interactive-ips` | *(Modo Pod Interactive)* | Motor de composición local de Interactive |

> [!NOTE]
> **Modo Pod / Red compartida:** Scaler e Interactive tienen cada uno su propio motor IPS local compartiendo `localhost` (`network_mode: "service:scaler"` y `network_mode: "service:interactive"`), replicando la arquitectura de Pods de Kubernetes. Todos los componentes se conectan a ICM en el puerto `30353` y a PostgreSQL en el `5432`.

---

## Archivos en este directorio

* `docker-compose.yml`: Definición de todos los servicios.
* `.quadient_credentials.env`: Credenciales de Azure Container Registry y servidor de licencias.
* `.quadient_credentials.env.example`: Plantilla de credenciales.
* `init-databases.sql`: Script ejecutado por PostgreSQL para crear `icm_db` y `scaler_db`.
* `grant_impersonation.java`: Script Java automatizado que otorga el derecho `User impersonation` al usuario `system` en ICM.
* `deploy.sh`: Script de despliegue automatizado de principio a fin.

---

## Despliegue en un nuevo equipo

### 1. Copiar la carpeta
Copia el directorio completo `Inspire/` al nuevo equipo.

### 2. Configurar credenciales
Si no existe `.quadient_credentials.env`, cópialo desde la plantilla:
```bash
cp .quadient_credentials.env.example .quadient_credentials.env
```
Edita `.quadient_credentials.env` con tu usuario y token de Azure Container Registry.

### 3. Ejecutar el despliegue automático
```bash
./deploy.sh
```

El script se encargará de:
1. Autenticar en Azure Container Registry (`quadientdistribution.azurecr.io`).
2. Descargar las imágenes oficiales (`icm`, `scaler`, `ips`, `postgres`).
3. Inicializar las bases de datos en PostgreSQL.
4. Crear el usuario `system` en ICM.
5. Iniciar el servicio ICM.
6. Otorgar los permisos de `User impersonation` a `system`.
7. Preparar las tablas de Scaler con `scaler-prepare`.
8. Levantar `scaler` e `ips` en red compartida.

---

## Acceso y credenciales

* **Scaler Web GUI:** `http://localhost:30600/` (o `http://localhost:30600/scaler`)
* **Interactive Web:** `http://localhost:30701/interactive`
* **Usuario:** `system`
* **Contraseña:** `Password12345*`
* **ICM Port:** `30353`
* **IPS Scaler Port:** `30354`
* **IPS Interactive Port:** Local (`30354` interno en red Interactive)
