# Apache Kafka Standalone para Inspire Scaler

Paquete de despliegue de **Apache Kafka (KRaft mode)** diseñado para ser consumido por una instancia de **Inspire Scaler** alojada en un servidor o máquina virtual externa.

---

## 📌 Punto clave de arquitectura: `KAFKA_ADVERTISED_HOST`

Cuando Kafka acepta una conexión de un cliente (como Inspire Scaler desde otra VM), el broker le responde al cliente con la dirección anunciada (`advertised.listeners`).

* Si se anunciara `localhost`, la VM de Scaler intentaría conectarse a `localhost:9092` dentro de su propia máquina y la conexión fallaría.
* Por ello, este paquete configura `KAFKA_ADVERTISED_HOST` con la **IP o hostname del servidor Kafka** alcanzable a través de la red local o VPN.

---

## 📁 Archivos en este directorio

| Archivo | Descripción |
| :--- | :--- |
| `docker-compose.yml` | Despliegue de Kafka (KRaft) y contenedor automático de creación del topic. |
| `.env` | Variables de configuración (IP anunciada, puerto, topic). |
| `.env.example` | Plantilla de variables de entorno. |
| `deploy-kafka.sh` | Script de despliegue e inicialización automatizado. |

---

## 🚀 Despliegue rápido

### 1. Configurar la IP del servidor Kafka
Edita el archivo `.env` para asegurarte de que `KAFKA_ADVERTISED_HOST` tenga la IP accesible desde la VM de Scaler:

```env
KAFKA_ADVERTISED_HOST=192.168.68.60
KAFKA_EXTERNAL_PORT=9092
KAFKA_TOPIC=sensor-data
```

### 2. Ejecutar el despliegue
```bash
./deploy-kafka.sh
```

El script:
1. Descarga la imagen oficial de `apache/kafka:latest`.
2. Levanta el contenedor `kafka-standalone` en el puerto `9092`.
3. Crea automáticamente el topic `sensor-data` (o el indicado en `.env`).
4. Muestra en pantalla los valores exactos a colocar en la interfaz web de Inspire Scaler.

---

## 🖥️ Configuración en la interfaz de Inspire Scaler

### Paso 1: Configurar la conexión (Administration $\rightarrow$ Kafka Connections $\rightarrow$ Add)
* **Alias:** `LocalKafka`
* **Brokers:**
  * **Host:** `<IP_DEL_SERVIDOR_KAFKA>` (ej. `192.168.68.60`)
  * **Port:** `9092`
* **Authentication method:** `None` *(o `Anonymous` / `PLAINTEXT`)*
* **Enable secure connection via TLS:** $\square$ *(Desmarcado)*

> Haz clic en **TEST CONNECTION** para verificar la comunicación.

### Paso 2: Configurar el nodo de entrada en el flujo (Kafka Input)
* **Alias:** `LocalKafka`
* **Topics:** `sensor-data` *(Clic en el icono **`+`**)*
* **Consumer group ID:** `scaler-consumer-group`
* **Message type:** `Text`
* **Error topic (optional):** *(Dejar en blanco)*

---

## 🛠️ Comandos útiles

### Probar conectividad desde la VM externa de Scaler:
```bash
nc -zv <IP_KAFKA> 9092
# o bien:
curl -v telnet://<IP_KAFKA>:9092
```

### Enviar un mensaje de prueba al topic:
```bash
sudo docker exec -i kafka-standalone \
  /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic sensor-data
```
*(Escribe cualquier texto o JSON y presiona Enter)*.

### Ver logs del broker:
```bash
sudo docker logs -f kafka-standalone
```
