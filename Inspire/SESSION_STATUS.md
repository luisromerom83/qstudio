# Resumen de Sesión - Quadient Inspire Flex Stack

**Fecha:** 3 de Septiembre, 2026  
**Estado:** Pausado a petición del usuario.

---

## 1. Componentes Instalados y Funcionando al 100%

* **PostgreSQL (`quadient-postgres` en puerto 5432):**
  * Bases de datos independientes inicializadas: `icm_db`, `scaler_db`, `interactive_db`.
* **Inspire Content Manager (`inspire-icm` en puerto 30353):**
  * Usuario administrador `system` configurado con contraseña `Password12345*`.
  * Permiso `User impersonation` asignado al usuario `system`.
* **Inspire Scaler (`inspire-scaler` en puerto 30600):**
  * Inicializado con `scaler-prepare`.
  * Panel Web activo en `http://localhost:30600/` con usuario `system`.
* **Inspire Production Server (`inspire-ips`):**
  * Corriendo en modo Pod con red compartida (`network_mode: "service:scaler"`).
  * Detectado localmente por Scaler en `localhost:30354`.
* **Apache Kafka (`Inspire/Kafka/`):**
  * Broker KRaft en puerto `9092` / `29092`.
  * Paquete de instalación independiente listo para VM remota.
  * Tópico `sensor-data` configurado y validado en Scaler Kafka Input.

---

## 2. Estado de Quadient Inspire Interactive (`inspire-interactive`)

* **Imagen oficial:** `quadientdistribution.azurecr.io/flex/interactive:17.5-latest`.
* **Esquema de Base de Datos:** `interactive_db` creada y preparada con 138 tablas relacionales.
* **Problemas diagnosticados y resueltos en configuración:**
  1. **Permisos de escritura (`/opt/QuadientInteractive/stores`):** Corregido configurando `user: "0:0"` (root) en el servicio Docker.
  2. **Conflicto de puerto 30701:** Liberado el contenedor de prueba previo.
  3. **Timeout de resolución de hostname en Java:** Se añadió `hostname: inspire-interactive` y `extra_hosts: ["inspire-interactive:127.0.0.1"]` para evitar demoras de 27 segundos en DNS.
  4. **Error `WRONG_ADDRESS` de la librería nativa VCS:** Se declararon las variables secundarias de ICM (`ICM_HOST_SECOND: icm`, `ICM_PORT_SECOND: 30353`, `ICM_HOST2: icm`, `ICM_PORT2: 30353`) para evitar que apunte a `localhost:0`.
* **IPS dedicado (`inspire-interactive-ips`):**
  * Configurado en red compartida `network_mode: "service:interactive"`.

---

## 3. Próximo paso al reanudar

Para arrancar el portal interactivo y su motor IPS local:

```bash
sudo docker compose up -d interactive interactive-ips
```

Y verificar los logs de Tomcat:

```bash
sudo docker logs -f inspire-interactive
```

Acceso al portal web:
* **URL:** `http://localhost:30701/interactive`
* **Usuario:** `system`
* **Contraseña:** `Password12345*`
