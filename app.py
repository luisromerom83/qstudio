#!/usr/bin/env python3
"""
Kafka CSV Web Service
---------------------
Servidor Web Flask con interfaz gráfica interactiva y API REST
para cargar y enviar archivos o contenido CSV hacia Apache Kafka.
"""

import csv
import io
import json
import logging
import os
import sys
from typing import Dict, Any

from flask import Flask, render_template, request, jsonify

from producer import (
    resolve_bootstrap_servers,
    send_data_to_kafka,
    send_csv_to_kafka,
    extract_records
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("kafka-csv-web")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB max upload
app.config['TEMPLATES_AUTO_RELOAD'] = True


def get_default_config() -> Dict[str, Any]:
    return {
        "kafka_host": os.getenv("KAFKA_HOST", ""),
        "kafka_port": os.getenv("KAFKA_PORT", "9092"),
        "kafka_bootstrap_servers": os.getenv("KAFKA_BOOTSTRAP_SERVERS", ""),
        "kafka_topic": os.getenv("KAFKA_TOPIC", ""),
        "data_type": os.getenv("DATA_TYPE", "json"),
        "csv_delimiter": os.getenv("CSV_DELIMITER", ","),
        "send_mode": "whole",
        "ignore_header": False,
        "type_field": os.getenv("TYPE_FIELD", "type"),
        "content_field": os.getenv("CONTENT_FIELD", "content"),
        "integration": os.getenv("INTEGRATION", "3rd Party"),
        "integration_field": os.getenv("INTEGRATION_FIELD", "integration"),
        "user_id": os.getenv("USER_ID", "quadientlatam@gmail.com"),
        "push_title": os.getenv("PUSH_TITLE", ""),
        "push_content": os.getenv("PUSH_CONTENT", ""),
        "use_case": os.getenv("USE_CASE", "Fatura / Recibo Digital")
    }


@app.route("/")
def index():
    config = get_default_config()
    return render_template("index.html", config=config)


@app.route("/api/config", methods=["GET"])
def api_config():
    return jsonify(get_default_config())


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "service": "kafka-csv-producer-web"})


@app.route("/api/preview", methods=["POST"])
def api_preview():
    try:
        data_type = (request.form.get("data_type", "auto") or "auto").strip().lower()
        type_field = (request.form.get("type_field", "type") or "type").strip()
        content_field = (request.form.get("content_field", "content") or "content").strip()
        integration = (request.form.get("integration", "3rd Party") or "3rd Party").strip()
        integration_field = (request.form.get("integration_field", "integration") or "integration").strip()
        user_id = (request.form.get("user_id", "") or "").strip()
        push_title = (request.form.get("push_title", "") or "").strip()
        push_content = (request.form.get("push_content", "") or "").strip()
        use_case = (request.form.get("use_case", "") or "").strip()
        content = ""

        if "file" in request.files and request.files["file"].filename:
            file_obj = request.files["file"]
            content = file_obj.read().decode("utf-8-sig", errors="replace")
        elif "content" in request.form:
            content = request.form.get("content", "")

        if not content.strip():
            return jsonify({"error": "Nenhum arquivo ou texto foi informado."}), 400

        # Helper para construir envelope
        def build_sample_envelope(t_val, c_val):
            env = {
                content_field: c_val,
                integration_field: integration,
                "push_content": push_content,
                "push_title": push_title,
                type_field: t_val,
                "user_id": user_id
            }
            if use_case:
                env["use_case"] = use_case
            return env

        # Detectar si el contenido es un JSON válido o si ya viene envuelto
        already_enveloped = False
        parsed_input = None
        is_json = False
        parsed_json = None
        try:
            loaded = json.loads(content)
            is_json = True
            if isinstance(loaded, dict) and any(k in loaded for k in (type_field, "type")) and any(k in loaded for k in (content_field, "content")):
                already_enveloped = True
                parsed_input = loaded
                parsed_json = parsed_input.get(content_field, parsed_input.get("content"))
            else:
                parsed_json = loaded
        except Exception:
            is_json = False

        # Si se especificó explícitamente formato json pero no es json válido, error 400
        if data_type == "json" and not is_json:
            try:
                json.loads(content)
            except Exception as e:
                return jsonify({"error": f"Error de sintaxis JSON: {str(e)}"}), 400

        # Si el tipo es auto o viene pre-envuelto, decidir según sea JSON o CSV/texto
        if already_enveloped:
            inner_type = parsed_input.get(type_field, parsed_input.get("type"))
            treat_as_json = (str(inner_type).upper() == "JSON") if inner_type else True
        else:
            treat_as_json = (data_type == "json") or (data_type == "auto" and is_json)

        # Previsualización para JSON
        if treat_as_json:
            element_count = len(parsed_json) if isinstance(parsed_json, (list, dict)) else 1
            is_array = isinstance(parsed_json, list)
            formatted = json.dumps(parsed_json, indent=2, ensure_ascii=False)

            sample_envelope = build_sample_envelope("JSON", parsed_json)

            return jsonify({
                "success": True,
                "data_type": "json",
                "preview_json": formatted[:5000],
                "sample_envelope": sample_envelope,
                "is_truncated": len(formatted) > 5000,
                "is_array": is_array,
                "element_count": element_count,
                "total_bytes": len(content.encode("utf-8"))
            })

        # Previsualización para CSV
        delimiter = request.form.get("delimiter", ",") or ","
        ignore_header = request.form.get("ignore_header", "false").lower() in ("true", "1", "yes", "on")
        csv_text = content
        if already_enveloped and isinstance(parsed_json, str):
            csv_text = parsed_json

        stream = io.StringIO(csv_text)
        reader = csv.reader(stream, delimiter=delimiter)

        raw_rows = []
        for r in reader:
            if r:
                raw_rows.append(r)

        if not raw_rows:
            return jsonify({"error": "El contenido está vacío."}), 400

        if ignore_header:
            headers = raw_rows[0]
            data_rows = raw_rows[1:]
            total_rows = len(data_rows)
            rows = data_rows[:10]
        else:
            first_row = raw_rows[0]
            headers = [f"Col {i + 1}" for i in range(len(first_row))]
            data_rows = raw_rows
            total_rows = len(data_rows)
            rows = data_rows[:10]

        sample_content = csv_text.strip()
        if len(sample_content) > 300:
            sample_content = sample_content[:300] + "..."

        sample_envelope = build_sample_envelope("CSV", sample_content)

        return jsonify({
            "success": True,
            "data_type": "csv",
            "headers": headers,
            "preview_rows": rows,
            "total_rows": total_rows,
            "sample_envelope": sample_envelope
        })

    except Exception as e:
        logger.error(f"Error al generar previsualización: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/send", methods=["POST"])
def api_send():
    try:
        # Extraer parámetros de conexión Kafka
        host = request.form.get("host", "").strip() or None
        port = request.form.get("port", "").strip() or None
        servers = request.form.get("bootstrap_servers", "").strip() or None
        topic = request.form.get("topic", "").strip() or os.getenv("KAFKA_TOPIC", "")

        if not topic:
            return jsonify({"error": "O nome do Tópico do Kafka é obrigatório."}), 400

        bootstrap_servers = resolve_bootstrap_servers(
            cli_servers=servers,
            cli_host=host,
            cli_port=int(port) if port else None
        )

        data_type = (request.form.get("data_type", "json") or "json").strip().lower()
        delimiter = request.form.get("delimiter", ",") or ","
        # Envío siempre de 1 request completo
        send_mode = (request.form.get("send_mode", "whole") or "whole").strip().lower()
        ignore_header = request.form.get("ignore_header", "false").lower() in ("true", "1", "yes", "on")
        type_field = (request.form.get("type_field", "type") or "type").strip()
        content_field = (request.form.get("content_field", "content") or "content").strip()
        integration = (request.form.get("integration", "3rd Party") or "3rd Party").strip()
        integration_field = (request.form.get("integration_field", "integration") or "integration").strip()
        user_id = (request.form.get("user_id", "") or "").strip()
        if not user_id:
            user_id = "quadientlatam@gmail.com" if "3rd" in integration else "xbaGznvBRTbXKT0YOVEH30959486"
        push_title = (request.form.get("push_title", "") or "").strip() or None
        push_content = (request.form.get("push_content", "") or "").strip() or None
        use_case = (request.form.get("use_case", "") or "").strip() or None

        # Compatibilidad con formato legado si se proporciona
        output_format = request.form.get("format", None)

        # Obtener contenido
        content = None
        if "file" in request.files and request.files["file"].filename:
            file_obj = request.files["file"]
            content = file_obj.read().decode("utf-8-sig", errors="replace")
        elif "content" in request.form and request.form.get("content", "").strip():
            content = request.form.get("content", "")

        if not content:
            msg = "É necessário anexar um arquivo ou inserir o conteúdo dos dados."
            return jsonify({"error": msg}), 400

        logger.info(
            f"Petición Web recibida para topic '{topic}' en '{bootstrap_servers}' "
            f"(tipo: {data_type}, user_id: {user_id}, push_title: {push_title}, "
            f"use_case: {use_case}, type_field: {type_field}, content_field: {content_field}, "
            f"integration: {integration})"
        )

        stats = send_data_to_kafka(
            bootstrap_servers=bootstrap_servers,
            topic=topic,
            data_type=data_type,
            content=content,
            delimiter=delimiter,
            send_mode=send_mode,
            ignore_header=ignore_header,
            type_field=type_field,
            content_field=content_field,
            integration=integration,
            integration_field=integration_field,
            user_id=user_id,
            push_title=push_title,
            push_content=push_content,
            use_case=use_case,
            output_format=output_format
        )

        msg = f"Mensagem enviada com sucesso em 1 requisição ao Kafka no tópico '{topic}' ({stats['total_sent']} mensagem)."

        return jsonify({
            "success": True,
            "message": msg,
            "stats": stats,
            "bootstrap_servers": bootstrap_servers,
            "topic": topic
        })

    except Exception as e:
        logger.error(f"Error procesando envío a Kafka: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    host = os.getenv("HOST", "0.0.0.0")
    logger.info(f"Iniciando servidor web en http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
