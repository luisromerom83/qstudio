import io
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from producer import (
    resolve_bootstrap_servers,
    get_csv_reader_source,
    extract_records,
    send_data_to_kafka,
    send_csv_to_kafka
)


class TestKafkaDataProducer(unittest.TestCase):

    def test_resolve_bootstrap_servers_with_host_and_port(self):
        res = resolve_bootstrap_servers(cli_host="192.168.1.150", cli_port=9094)
        self.assertEqual(res, "192.168.1.150:9094")

        with patch.dict(os.environ, {"KAFKA_HOST": "10.0.0.5", "KAFKA_PORT": "9093"}):
            res_env = resolve_bootstrap_servers()
            self.assertEqual(res_env, "10.0.0.5:9093")

    def test_resolve_bootstrap_servers_fallback(self):
        res = resolve_bootstrap_servers(cli_servers="broker1:9092,broker2:9092")
        self.assertEqual(res, "broker1:9092,broker2:9092")

        with patch.dict(os.environ, {}, clear=True):
            res_default = resolve_bootstrap_servers()
            self.assertEqual(res_default, "localhost:9092")

    def test_csv_whole_mode_enveloped_in_json(self):
        csv_data = "col1,col2\nval1,val2\nval3,val4\n"

        # Without ignore_header: sends whole CSV enveloped in JSON
        stream1 = io.StringIO(csv_data)
        records1 = list(extract_records(stream1, data_type="csv", send_mode="whole", ignore_header=False))
        self.assertEqual(len(records1), 1)
        payload1 = json.loads(records1[0][1].decode("utf-8"))
        self.assertEqual(payload1.get("type"), "CSV")
        self.assertEqual(payload1.get("content"), csv_data)

        # With ignore_header: strips header line, enveloped in JSON
        stream2 = io.StringIO(csv_data)
        records2 = list(extract_records(stream2, data_type="csv", send_mode="whole", ignore_header=True))
        self.assertEqual(len(records2), 1)
        payload2 = json.loads(records2[0][1].decode("utf-8"))
        self.assertEqual(payload2.get("type"), "CSV")
        self.assertEqual(payload2.get("content"), "val1,val2\nval3,val4\n")

    def test_csv_lines_mode_enveloped_in_json(self):
        csv_data = "id;name\n101;Alice\n102;Bob\n"

        # Without ignore_header: 3 lines, each enveloped in JSON
        stream1 = io.StringIO(csv_data)
        records1 = list(extract_records(stream1, data_type="csv", send_mode="lines", ignore_header=False))
        self.assertEqual(len(records1), 3)
        p0 = json.loads(records1[0][1].decode("utf-8"))
        p1 = json.loads(records1[1][1].decode("utf-8"))
        p2 = json.loads(records1[2][1].decode("utf-8"))
        self.assertEqual(p0, {"type": "CSV", "content": "id;name"})
        self.assertEqual(p1, {"type": "CSV", "content": "101;Alice"})
        self.assertEqual(p2, {"type": "CSV", "content": "102;Bob"})

        # With ignore_header: 2 lines, each enveloped in JSON
        stream2 = io.StringIO(csv_data)
        records2 = list(extract_records(stream2, data_type="csv", send_mode="lines", ignore_header=True))
        self.assertEqual(len(records2), 2)
        p_data1 = json.loads(records2[0][1].decode("utf-8"))
        p_data2 = json.loads(records2[1][1].decode("utf-8"))
        self.assertEqual(p_data1, {"type": "CSV", "content": "101;Alice"})
        self.assertEqual(p_data2, {"type": "CSV", "content": "102;Bob"})

    def test_json_whole_mode_enveloped(self):
        json_data = '{"sensor": "temp_01", "reading": 25.4, "status": "active"}'
        stream = io.StringIO(json_data)
        records = list(extract_records(stream, data_type="json"))
        self.assertEqual(len(records), 1)
        payload = json.loads(records[0][1].decode("utf-8"))
        self.assertEqual(payload.get("type"), "JSON")
        self.assertEqual(payload.get("content"), json.loads(json_data))

    def test_custom_type_and_content_fields(self):
        csv_data = "x,y\n1,2\n"
        stream = io.StringIO(csv_data)
        records = list(extract_records(
            stream,
            data_type="csv",
            send_mode="lines",
            ignore_header=True,
            type_field="formato",
            content_field="datos"
        ))
        self.assertEqual(len(records), 1)
        payload = json.loads(records[0][1].decode("utf-8"))
        self.assertEqual(payload.get("formato"), "CSV")
        self.assertEqual(payload.get("datos"), "1,2")

    def test_json_invalid_raises_error(self):
        invalid_json = '{"unclosed": "brace"'
        stream = io.StringIO(invalid_json)
        with self.assertRaises(ValueError):
            list(extract_records(stream, data_type="json"))

    def test_get_csv_reader_source_direct_content(self):
        stream, should_close = get_csv_reader_source(content="a,b\n1,2")
        self.assertFalse(should_close)
        self.assertEqual(stream.read(), "a,b\n1,2")

    def test_send_data_to_kafka_mocked_csv(self):
        mock_producer = MagicMock()
        mock_future = MagicMock()
        mock_producer.send.return_value = mock_future

        csv_content = "header1,header2\nv1,v2\nv3,v4\n"
        stats = send_data_to_kafka(
            bootstrap_servers="localhost:9092",
            topic="test-topic",
            data_type="csv",
            content=csv_content,
            send_mode="lines",
            ignore_header=True,
            producer_instance=mock_producer
        )

        self.assertEqual(stats["total_sent"], 2)
        self.assertEqual(stats["total_errors"], 0)
        self.assertEqual(mock_producer.send.call_count, 2)
        mock_producer.flush.assert_called_once()

    def test_send_data_to_kafka_mocked_json(self):
        mock_producer = MagicMock()
        mock_future = MagicMock()
        mock_producer.send.return_value = mock_future

        json_content = '{"event": "login", "user": "admin"}'
        stats = send_data_to_kafka(
            bootstrap_servers="localhost:9092",
            topic="json-topic",
            data_type="json",
            content=json_content,
            producer_instance=mock_producer
        )

        self.assertEqual(stats["total_sent"], 1)
        self.assertEqual(mock_producer.send.call_count, 1)

    def test_already_enveloped_csv_input_does_not_duplicate_type(self):
        input_data = '{\n    "type": "CSV",\n    "content": "1,DHT22,24.5"\n}'
        stream = io.StringIO(input_data)
        records = list(extract_records(stream, data_type="csv", send_mode="whole"))
        self.assertEqual(len(records), 1)
        payload = json.loads(records[0][1].decode("utf-8"))
        self.assertEqual(payload, {"type": "CSV", "content": "1,DHT22,24.5"})

    def test_already_enveloped_json_input_does_not_duplicate_type(self):
        input_data = '{\n    "type": "JSON",\n    "content": {"sensor_id": "SN-901", "valores": [23.4, 23.8]}\n}'
        stream = io.StringIO(input_data)
        records = list(extract_records(stream, data_type="json"))
        self.assertEqual(len(records), 1)
        payload = json.loads(records[0][1].decode("utf-8"))
        self.assertEqual(payload, {
            "type": "JSON",
            "content": {"sensor_id": "SN-901", "valores": [23.4, 23.8]}
        })
        self.assertNotIn("type", payload["content"])

    def test_extract_records_with_push_fields_and_autodetection(self):
        # CSV con autodetección
        csv_data = "temp,hum\n25.1,60\n"
        stream1 = io.StringIO(csv_data)
        records1 = list(extract_records(
            stream1,
            data_type="auto",
            user_id="USER-777",
            push_title="Alerta Clima",
            push_content="Humedad alta detectada"
        ))
        self.assertEqual(len(records1), 1)
        p1 = json.loads(records1[0][1].decode("utf-8"))
        self.assertEqual(p1.get("type"), "CSV")
        self.assertEqual(p1.get("user_id"), "USER-777")
        self.assertEqual(p1.get("push_title"), "Alerta Clima")
        self.assertEqual(p1.get("push_content"), "Humedad alta detectada")
        self.assertEqual(p1.get("content"), csv_data)

        # JSON con autodetección
        json_data = '{"sensor": "S1", "val": 100}'
        stream2 = io.StringIO(json_data)
        records2 = list(extract_records(
            stream2,
            data_type="auto",
            user_id="USER-888",
            push_title="Lectura Sensor",
            push_content="Nueva lectura recibida"
        ))
        self.assertEqual(len(records2), 1)
        p2 = json.loads(records2[0][1].decode("utf-8"))
        self.assertEqual(p2.get("type"), "JSON")
        self.assertEqual(p2.get("user_id"), "USER-888")
        self.assertEqual(p2.get("push_title"), "Lectura Sensor")
        self.assertEqual(p2.get("push_content"), "Nueva lectura recibida")
        self.assertEqual(p2.get("content"), {"sensor": "S1", "val": 100})

    def test_usecase_1_invoice_structured_envelope(self):
        invoice_content = {
            "BILLING_PERIOD": "Septiembre 2026",
            "COMPANY_NAME": "Empresa Servicios Digitales S.A.",
            "CURRENCY": "MXN",
            "FOLIO_FISCAL": "9A8B7C-6543",
            "ITEM_1_NAME": "Suscripción Plan Corporativo Cloud",
            "ITEM_1_PRICE": "$1,250.00",
            "ITEM_1_QTY": "1",
            "ITEM_2_NAME": "Servicio de Notificaciones Push Adicionales",
            "ITEM_2_PRICE": "$200.00",
            "ITEM_2_QTY": "1",
            "RFC": "ESD120304XYZ",
            "STATUS_BADGE": "PAGADA",
            "SUPPORT_EMAIL": "soporte@empresa.com",
            "TAX_DISCLAIMER": "IVA incluido",
            "TOTAL_AMOUNT": "$1,450.00"
        }
        stream = io.StringIO(json.dumps(invoice_content))
        records = list(extract_records(
            stream,
            data_type="json",
            integration="3rd Party",
            user_id="quadientlatam@gmail.com",
            push_title="Factura Septiembre Lista",
            push_content="Su factura por $1,450.00 MXN ha sido generada.",
            use_case="Factura / Recibo Digital"
        ))
        self.assertEqual(len(records), 1)
        payload = json.loads(records[0][1].decode("utf-8"))
        self.assertEqual(payload["type"], "JSON")
        self.assertEqual(payload["integration"], "3rd Party")
        self.assertEqual(payload["user_id"], "quadientlatam@gmail.com")
        self.assertEqual(payload["push_title"], "Factura Septiembre Lista")
        self.assertEqual(payload["push_content"], "Su factura por $1,450.00 MXN ha sido generada.")
        self.assertEqual(payload["use_case"], "Factura / Recibo Digital")
        self.assertEqual(payload["content"], invoice_content)
        self.assertIsInstance(payload["content"], dict)

    def test_usecase_2_telephony_structured_envelope(self):
        telephony_content = {
            "CUSTOMER_NAME": "Carlos Morales",
            "CUSTOMER_PHONE": "+52 55 4920 1823",
            "CUSTOMER_EMAIL": "carlos.morales@empresa.com",
            "SERVICE_TYPE": "Plan Móvil Empresarial 5G",
            "REQUEST_TYPE": "Portabilidad",
            "PREFERRED_CONTACT_TIME": "Tarde",
            "LOCATION_CITY": "CDMX",
            "NOTES": "Cotización 15 líneas"
        }
        stream = io.StringIO(json.dumps(telephony_content))
        records = list(extract_records(
            stream,
            data_type="json",
            integration="Quadient Inspire DAS",
            user_id="xbaGznvBRTbXKT0YOVEH30959486",
            push_title="Solicitud Comercial Registrada",
            push_content="Un asesor te contactará en breve.",
            use_case="Solicitud de Contacto Telefonía"
        ))
        self.assertEqual(len(records), 1)
        payload = json.loads(records[0][1].decode("utf-8"))
        self.assertEqual(payload["type"], "JSON")
        self.assertEqual(payload["integration"], "Quadient Inspire DAS")
        self.assertEqual(payload["user_id"], "xbaGznvBRTbXKT0YOVEH30959486")
        self.assertEqual(payload["push_title"], "Solicitud Comercial Registrada")
        self.assertEqual(payload["push_content"], "Un asesor te contactará en breve.")
        self.assertEqual(payload["use_case"], "Solicitud de Contacto Telefonía")
        self.assertEqual(payload["content"], telephony_content)
        self.assertIsInstance(payload["content"], dict)


if __name__ == "__main__":
    unittest.main()
