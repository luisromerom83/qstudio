#!/usr/bin/env python3
"""
Kafka CSV Producer
------------------
Cliente productor de Kafka configurable para enviar datos CSV
(desde archivo local, contenido en texto o entrada estándar).
"""

import argparse
import csv
import io
import json
import logging
import os
import sys
import time
from typing import Generator, Optional, Tuple, Dict, Any

try:
    from kafka import KafkaProducer
    from kafka.errors import KafkaError
except ImportError:
    KafkaProducer = None
    KafkaError = Exception


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("kafka-csv-producer")


def resolve_bootstrap_servers(
    cli_servers: Optional[str] = None,
    cli_host: Optional[str] = None,
    cli_port: Optional[int] = None
) -> str:
    """
    Resuelve la dirección del broker Kafka priorizando:
    1. --host / KAFKA_HOST y --port / KAFKA_PORT si se definen explícitamente.
    2. --bootstrap-servers / KAFKA_BOOTSTRAP_SERVERS.
    3. Valor por defecto: localhost:9092.
    """
    host = cli_host or os.getenv("KAFKA_HOST")
    port = cli_port or os.getenv("KAFKA_PORT")
    servers = cli_servers or os.getenv("KAFKA_BOOTSTRAP_SERVERS")

    if host:
        port_num = port or "9092"
        return f"{host.strip()}:{port_num}"

    if servers:
        return servers.strip()

    return "localhost:9092"


def get_csv_reader_source(
    file_path: Optional[str] = None,
    content: Optional[str] = None,
    read_stdin: bool = False
) -> Tuple[io.TextIOBase, bool]:
    """
    Obtiene el flujo de texto para leer el CSV y si requiere cerrarse.
    """
    # 1. Desde contenido directo por variable o argumento
    csv_content = content or os.getenv("CSV_CONTENT")
    if csv_content:
        logger.info("Leyendo CSV desde contenido proporcionado directamente.")
        return io.StringIO(csv_content), False

    # 2. Desde stdin
    if read_stdin or not sys.stdin.isatty() and not file_path and not os.getenv("CSV_FILE"):
        logger.info("Leyendo CSV desde la entrada estándar (stdin).")
        return sys.stdin, False

    # 3. Desde archivo
    target_file = file_path or os.getenv("CSV_FILE")
    if target_file:
        if not os.path.exists(target_file):
            raise FileNotFoundError(f"El archivo CSV no existe en la ruta: '{target_file}'")
        logger.info(f"Leyendo CSV desde el archivo: '{target_file}'")
        return open(target_file, mode="r", encoding="utf-8-sig"), True

    raise ValueError(
        "No se especificó ninguna fuente CSV. "
        "Usa --file, --content, --stdin o las variables CSV_FILE / CSV_CONTENT."
    )


def extract_records(
    stream: io.TextIOBase,
    delimiter: str = ",",
    output_format: Optional[str] = None,
    key_column: Optional[str] = None,
    data_type: str = "auto",
    send_mode: str = "whole",
    ignore_header: bool = False,
    type_field: str = "type",
    content_field: str = "content",
    integration: Optional[str] = None,
    integration_field: str = "integration",
    user_id: Optional[str] = None,
    push_title: Optional[str] = None,
    push_content: Optional[str] = None,
    use_case: Optional[str] = None
) -> Generator[Tuple[Optional[bytes], bytes], None, None]:
    """
    Genera pares (key, value) en bytes para publicar en Kafka.
    Cada mensaje enviado es siempre un objeto JSON que contiene:
    - Un campo (type_field, por defecto 'type') con el valor 'CSV' o 'JSON'.
    - Un campo opcional de integración (integration_field, por defecto 'integration') al mismo nivel.
    - Campos opcionales de push: user_id, push_title, push_content en la raíz del JSON.
    - Campo opcional use_case indicando el tipo de caso de uso.
    - Un campo (content_field, por defecto 'content') con el contenido real.
    Si el archivo/texto de entrada ya está envuelto en un objeto JSON con campos de tipo y contenido,
    se desanida automáticamente para evitar duplicaciones como {"type": "...", "content": {"type": ...}}.
    """
    normalized_type = (data_type or "auto").strip().upper()
    full_text = stream.read()
    if not full_text.strip():
        return

    # Helper para construir envoltorio JSON ordenado
    def build_envelope(t_val, c_val):
        has_extended = any(x is not None for x in (integration, user_id, push_title, push_content, use_case))
        if has_extended:
            env = {
                content_field: c_val,
                integration_field: str(integration or "").strip(),
                "push_content": str(push_content or "").strip(),
                "push_title": str(push_title or "").strip(),
                type_field: t_val,
                "user_id": str(user_id or "").strip()
            }
            if use_case is not None and str(use_case).strip() != "":
                env["use_case"] = str(use_case).strip()
            return env
        return {
            type_field: t_val,
            content_field: c_val
        }

    # Verificar si el contenido de entrada ya es un JSON con envoltorio previo o JSON válido
    already_enveloped = False
    parsed_input = None
    is_json = False
    try:
        loaded = json.loads(full_text)
        is_json = True
        if isinstance(loaded, dict) and any(k in loaded for k in (type_field, "type")) and any(k in loaded for k in (content_field, "content")):
            already_enveloped = True
            parsed_input = loaded
    except Exception:
        is_json = False

    # Determinar si tratamos como JSON o CSV
    if already_enveloped:
        inner_type = parsed_input.get(type_field, parsed_input.get("type"))
        if inner_type:
            detected_type = str(inner_type).upper()
        else:
            detected_type = "JSON"
    elif normalized_type == "AUTO":
        detected_type = "JSON" if is_json else "CSV"
    else:
        detected_type = normalized_type

    # 1. Caso JSON: Envío completo envuelto en JSON
    if detected_type == "JSON":
        if already_enveloped:
            inner_content = parsed_input.get(content_field, parsed_input.get("content"))
            effective_user_id = user_id if (user_id is not None and str(user_id).strip() != "") else parsed_input.get("user_id")
            effective_push_title = push_title if (push_title is not None and str(push_title).strip() != "") else parsed_input.get("push_title")
            effective_push_content = push_content if (push_content is not None and str(push_content).strip() != "") else parsed_input.get("push_content")
            effective_integration = integration or parsed_input.get(integration_field)
            effective_use_case = use_case if (use_case is not None and str(use_case).strip() != "") else parsed_input.get("use_case")
            has_ext = any(x is not None for x in (effective_integration, effective_user_id, effective_push_title, effective_push_content, effective_use_case))
            if has_ext:
                envelope = {
                    content_field: inner_content,
                    integration_field: str(effective_integration or "").strip(),
                    "push_content": str(effective_push_content or "").strip(),
                    "push_title": str(effective_push_title or "").strip(),
                    type_field: "JSON",
                    "user_id": str(effective_user_id or "").strip()
                }
                if effective_use_case is not None and str(effective_use_case).strip() != "":
                    envelope["use_case"] = str(effective_use_case).strip()
            else:
                envelope = {
                    type_field: "JSON",
                    content_field: inner_content
                }
        else:
            try:
                parsed_json = json.loads(full_text)
            except Exception as e:
                raise ValueError(f"El contenido proporcionado no es un JSON válido: {e}")
            envelope = build_envelope("JSON", parsed_json)
        yield (None, json.dumps(envelope, ensure_ascii=False).encode("utf-8"))
        return

    # 2. Modo compatibilidad con output_format anterior
    if output_format == "whole":
        send_mode = "whole"
    elif output_format == "raw":
        send_mode = "lines"
    elif output_format == "json":
        reader = csv.DictReader(io.StringIO(full_text), delimiter=delimiter)
        if not reader.fieldnames:
            logger.warning("El CSV parece estar vacío o no contiene encabezados.")
            return
        for row_idx, row in enumerate(reader, start=1):
            key_bytes = None
            if key_column and key_column in row and row[key_column] is not None:
                key_bytes = str(row[key_column]).encode("utf-8")
            envelope = build_envelope("CSV", row)
            yield (key_bytes, json.dumps(envelope, ensure_ascii=False).encode("utf-8"))
        return

    # 3. Caso CSV según nuevas especificaciones:
    csv_raw_text = full_text
    if already_enveloped:
        inner_content = parsed_input.get(content_field, parsed_input.get("content"))
        if isinstance(inner_content, str):
            csv_raw_text = inner_content
        elif isinstance(inner_content, (dict, list)):
            envelope = build_envelope("CSV", inner_content)
            yield (None, json.dumps(envelope, ensure_ascii=False).encode("utf-8"))
            return

    csv_lines = csv_raw_text.splitlines(keepends=True)
    if not csv_lines:
        return

    if send_mode == "whole":
        if ignore_header and len(csv_lines) > 1:
            lines_to_send = csv_lines[1:]
        else:
            lines_to_send = csv_lines
        content_to_send = "".join(lines_to_send)
        if content_to_send.strip():
            envelope = build_envelope("CSV", content_to_send)
            yield (None, json.dumps(envelope, ensure_ascii=False).encode("utf-8"))
        return

    # send_mode == "lines" (compatibilidad previa)
    for idx, line in enumerate(csv_lines):
        if idx == 0 and ignore_header:
            continue
        cleaned = line.strip("\r\n")
        if cleaned:
            envelope = build_envelope("CSV", cleaned)
            yield (None, json.dumps(envelope, ensure_ascii=False).encode("utf-8"))


def send_data_to_kafka(
    bootstrap_servers: str,
    topic: str,
    data_type: str = "auto",
    file_path: Optional[str] = None,
    content: Optional[str] = None,
    read_stdin: bool = False,
    delimiter: str = ",",
    send_mode: str = "whole",
    ignore_header: bool = False,
    output_format: Optional[str] = None,
    key_column: Optional[str] = None,
    type_field: str = "type",
    content_field: str = "content",
    integration: Optional[str] = None,
    integration_field: str = "integration",
    user_id: Optional[str] = None,
    push_title: Optional[str] = None,
    push_content: Optional[str] = None,
    use_case: Optional[str] = None,
    delay: float = 0.0,
    acks: Any = "all",
    producer_instance: Optional[Any] = None
) -> Dict[str, Any]:
    """
    Lee los registros CSV o JSON y los publica en el topic de Kafka especificado.
    """
    logger.info(f"Conectando a Kafka en: {bootstrap_servers}")
    logger.info(f"Topic destino: {topic} | Tipo de datos: {data_type} | Modo: {send_mode}")

    should_close_stream = False
    stream = None
    producer = producer_instance

    stats = {
        "total_sent": 0,
        "total_errors": 0,
        "start_time": time.time(),
        "elapsed_time": 0.0
    }

    try:
        stream, should_close_stream = get_csv_reader_source(file_path, content, read_stdin)

        if producer is None:
            if KafkaProducer is None:
                raise RuntimeError(
                    "kafka-python no está instalado. Instala las dependencias con: pip install -r requirements.txt"
                )
            producer = KafkaProducer(
                bootstrap_servers=bootstrap_servers.split(","),
                acks=acks,
                retries=3,
                max_block_ms=30000
            )

        def on_send_success(record_metadata):
            pass

        def on_send_error(excp):
            stats["total_errors"] += 1
            logger.error(f"Error al enviar mensaje a Kafka: {excp}")

        logger.info(f"Iniciando envío de registros ({data_type}, modo: {send_mode})...")

        for key_bytes, value_bytes in extract_records(
            stream,
            delimiter=delimiter,
            output_format=output_format,
            key_column=key_column,
            data_type=data_type,
            send_mode=send_mode,
            ignore_header=ignore_header,
            type_field=type_field,
            content_field=content_field,
            integration=integration,
            integration_field=integration_field,
            user_id=user_id,
            push_title=push_title,
            push_content=push_content,
            use_case=use_case
        ):
            try:
                future = producer.send(
                    topic=topic,
                    key=key_bytes,
                    value=value_bytes
                )
                future.add_callback(on_send_success)
                future.add_errback(on_send_error)
                stats["total_sent"] += 1

                if stats["total_sent"] % 100 == 0:
                    logger.info(f"Progreso: {stats['total_sent']} mensajes enviados...")

                if delay > 0:
                    time.sleep(delay)

            except Exception as e:
                stats["total_errors"] += 1
                logger.error(f"Excepción al enviar registro {stats['total_sent'] + 1}: {e}")

        # Vaciar el buffer del producer
        logger.info("Esperando a que todos los mensajes sean confirmados por el broker...")
        producer.flush()

    finally:
        if should_close_stream and stream:
            stream.close()
        if producer and producer_instance is None:
            producer.close()

    stats["elapsed_time"] = round(time.time() - stats["start_time"], 3)
    logger.info(
        f"Completado: {stats['total_sent']} registros enviados, "
        f"{stats['total_errors']} errores en {stats['elapsed_time']}s."
    )
    return stats


# Alias para retrocompatibilidad
send_csv_to_kafka = send_data_to_kafka


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cliente Kafka Productor para Archivos o Contenido CSV",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    # Opciones de conexión Kafka
    kafka_group = parser.add_argument_group("Opciones de Servidor Kafka")
    kafka_group.add_argument(
        "--bootstrap-servers", "-b",
        default=os.getenv("KAFKA_BOOTSTRAP_SERVERS"),
        help="Dirección completa del broker Kafka (ej: localhost:9092, 192.168.1.50:9092). Variable: KAFKA_BOOTSTRAP_SERVERS"
    )
    kafka_group.add_argument(
        "--host", "-H",
        default=os.getenv("KAFKA_HOST"),
        help="IP o Hostname del servidor Kafka en la red (ej: 192.168.1.100, kafka-broker). Variable: KAFKA_HOST"
    )
    kafka_group.add_argument(
        "--port", "-P",
        type=int,
        default=int(os.getenv("KAFKA_PORT", "9092")),
        help="Puerto del servidor Kafka (ej: 9092). Variable: KAFKA_PORT"
    )
    kafka_group.add_argument(
        "--topic", "-t",
        default=os.getenv("KAFKA_TOPIC"),
        required=not bool(os.getenv("KAFKA_TOPIC")),
        help="Nombre del topic de Kafka de destino. Variable: KAFKA_TOPIC"
    )

    # Opciones de origen de datos CSV
    csv_group = parser.add_argument_group("Opciones de Origen de Datos CSV")
    csv_group.add_argument(
        "--file", "-f",
        default=os.getenv("CSV_FILE"),
        help="Ruta al archivo CSV a procesar. Variable: CSV_FILE"
    )
    csv_group.add_argument(
        "--content", "-c",
        default=os.getenv("CSV_CONTENT"),
        help="Contenido en texto plano del CSV directamente. Variable: CSV_CONTENT"
    )
    csv_group.add_argument(
        "--stdin",
        action="store_true",
        help="Leer el CSV desde la entrada estándar (stdin)"
    )
    csv_group.add_argument(
        "--delimiter", "-d",
        default=os.getenv("CSV_DELIMITER", ","),
        help="Delimitador del archivo CSV (ej: ',', ';', '\t', '|'). Variable: CSV_DELIMITER"
    )

    # Opciones de tipo de datos y modo de envío
    data_group = parser.add_argument_group("Opciones de Origen de Datos y Modo")
    data_group.add_argument(
        "--data-type",
        choices=["csv", "json"],
        default=os.getenv("DATA_TYPE", "csv"),
        help="Tipo de origen de datos: 'csv' o 'json'. Variable: DATA_TYPE"
    )
    data_group.add_argument(
        "--send-mode",
        choices=["whole", "lines"],
        default=os.getenv("SEND_MODE", "lines"),
        help="Modo de envío para CSV: 'whole' (todo el contenido en 1 request) o 'lines' (1 request por cada línea). Variable: SEND_MODE"
    )
    data_group.add_argument(
        "--ignore-header",
        action="store_true",
        default=os.getenv("IGNORE_HEADER", "false").lower() in ("true", "1", "yes"),
        help="Ignorar la primera fila del CSV si corresponde a la cabecera. Variable: IGNORE_HEADER"
    )
    data_group.add_argument(
        "--type-field",
        default=os.getenv("TYPE_FIELD", "type"),
        help="Nombre del campo JSON para indicar el tipo ('CSV' o 'JSON'). Variable: TYPE_FIELD"
    )
    data_group.add_argument(
        "--content-field",
        default=os.getenv("CONTENT_FIELD", "content"),
        help="Nombre del campo JSON que contiene el contenido real del archivo. Variable: CONTENT_FIELD"
    )

    # Opciones de Push Notification
    push_group = parser.add_argument_group("Opciones de Notificación Push")
    push_group.add_argument(
        "--user-id",
        default=os.getenv("USER_ID"),
        help="Identificador de usuario para la notificación push. Variable: USER_ID"
    )
    push_group.add_argument(
        "--push-title",
        default=os.getenv("PUSH_TITLE"),
        help="Título de la notificación push. Variable: PUSH_TITLE"
    )
    push_group.add_argument(
        "--push-content",
        default=os.getenv("PUSH_CONTENT"),
        help="Cuerpo/mensaje de la notificación push. Variable: PUSH_CONTENT"
    )

    send_group = parser.add_argument_group("Opciones de Envío")
    send_group.add_argument(
        "--format",
        choices=["json", "raw", "whole"],
        default=os.getenv("OUTPUT_FORMAT", None),
        help="[Legado] Formato de los mensajes: 'json', 'raw', 'whole'. Variable: OUTPUT_FORMAT"
    )
    send_group.add_argument(
        "--key-column", "-k",
        default=os.getenv("KEY_COLUMN"),
        help="Nombre de la columna del CSV cuyo valor se usará como Key del mensaje Kafka. Variable: KEY_COLUMN"
    )
    send_group.add_argument(
        "--delay",
        type=float,
        default=float(os.getenv("DELAY_SECONDS", "0")),
        help="Retardo en segundos entre mensajes para controlar la tasa de envío. Variable: DELAY_SECONDS"
    )
    send_group.add_argument(
        "--acks",
        default=os.getenv("KAFKA_ACKS", "all"),
        help="Nivel de confirmación de Kafka ('all', '1', '0'). Variable: KAFKA_ACKS"
    )

    return parser.parse_args()


def main():
    args = parse_arguments()

    bootstrap_servers = resolve_bootstrap_servers(
        cli_servers=args.bootstrap_servers,
        cli_host=args.host,
        cli_port=args.port
    )

    if not args.topic:
        logger.error("Debe especificarse un topic con --topic o la variable KAFKA_TOPIC.")
        sys.exit(1)

    try:
        stats = send_data_to_kafka(
            bootstrap_servers=bootstrap_servers,
            topic=args.topic,
            data_type=args.data_type,
            file_path=args.file,
            content=args.content,
            read_stdin=args.stdin,
            delimiter=args.delimiter,
            send_mode=args.send_mode,
            ignore_header=args.ignore_header,
            type_field=args.type_field,
            content_field=args.content_field,
            output_format=args.format,
            key_column=args.key_column,
            user_id=args.user_id,
            push_title=args.push_title,
            push_content=args.push_content,
            delay=args.delay,
            acks=args.acks
        )

        if stats["total_errors"] > 0:
            sys.exit(2)
    except Exception as e:
        logger.error(f"Error fatal durante la ejecución: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
