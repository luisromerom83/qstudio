import io
import json
import os
import unittest
from unittest.mock import patch, MagicMock

from app import app


class TestKafkaDataWebApp(unittest.TestCase):

    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_health_endpoint(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("status"), "healthy")

    def test_index_page(self):
        with patch.dict(os.environ, {"KAFKA_HOST": "192.168.1.55", "KAFKA_TOPIC": "sensor-stream"}):
            res = self.client.get("/")
            self.assertEqual(res.status_code, 200)
            html = res.get_data(as_text=True)
            self.assertIn("Kafka Data Producer Studio", html)
            self.assertIn("192.168.1.55", html)
            self.assertIn("sensor-stream", html)

    def test_preview_csv_with_ignore_header_true(self):
        csv_text = "id,temp,humidity\n1,22.4,45\n2,23.1,48\n"
        res = self.client.post("/api/preview", data={
            "data_type": "csv",
            "content": csv_text,
            "delimiter": ",",
            "ignore_header": "true",
            "type_field": "tipo",
            "content_field": "datos"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("headers"), ["id", "temp", "humidity"])
        self.assertEqual(len(data.get("preview_rows")), 2)
        self.assertEqual(data.get("total_rows"), 2)
        self.assertEqual(data.get("sample_envelope")["tipo"], "CSV")
        self.assertIn("datos", data.get("sample_envelope"))

    def test_preview_csv_with_ignore_header_false(self):
        csv_text = "valA,valB\nvalC,valD\n"
        res = self.client.post("/api/preview", data={
            "data_type": "csv",
            "content": csv_text,
            "delimiter": ",",
            "ignore_header": "false"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("headers"), ["Col 1", "Col 2"])
        self.assertEqual(len(data.get("preview_rows")), 2)
        self.assertEqual(data.get("total_rows"), 2)
        self.assertEqual(data.get("sample_envelope")["type"], "CSV")

    def test_preview_json_valid(self):
        json_text = '{"name": "test", "active": true, "items": [1, 2, 3]}'
        res = self.client.post("/api/preview", data={
            "data_type": "json",
            "content": json_text
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("data_type"), "json")
        self.assertIn('"name": "test"', data.get("preview_json"))
        self.assertEqual(data.get("element_count"), 3)
        self.assertEqual(data.get("sample_envelope")["type"], "JSON")
        self.assertEqual(data.get("sample_envelope")["content"]["name"], "test")

    def test_preview_json_invalid(self):
        invalid_json = '{name: broken}'
        res = self.client.post("/api/preview", data={
            "data_type": "json",
            "content": invalid_json
        })
        self.assertEqual(res.status_code, 400)
        data = res.get_json()
        self.assertIn("error", data)

    @patch("app.send_data_to_kafka")
    def test_send_csv_endpoint(self, mock_send):
        mock_send.return_value = {
            "total_sent": 2,
            "total_errors": 0,
            "elapsed_time": 0.05
        }

        form_data = {
            "host": "192.168.1.100",
            "port": "9092",
            "topic": "test-topic",
            "data_type": "csv",
            "delimiter": ",",
            "send_mode": "lines",
            "ignore_header": "true",
            "type_field": "tipo",
            "content_field": "datos",
            "content": "id,val\n1,10\n2,20"
        }

        res = self.client.post("/api/send", data=form_data)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("stats")["total_sent"], 2)
        mock_send.assert_called_once()
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs.get("type_field"), "tipo")
        self.assertEqual(kwargs.get("content_field"), "datos")

    @patch("app.send_data_to_kafka")
    def test_send_json_endpoint(self, mock_send):
        mock_send.return_value = {
            "total_sent": 1,
            "total_errors": 0,
            "elapsed_time": 0.02
        }

        form_data = {
            "host": "192.168.1.100",
            "port": "9092",
            "topic": "test-json-topic",
            "data_type": "json",
            "type_field": "format_type",
            "content_field": "payload",
            "content": '{"event": "alert"}'
        }

        res = self.client.post("/api/send", data=form_data)
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("stats")["total_sent"], 1)
        mock_send.assert_called_once()
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs.get("type_field"), "format_type")
        self.assertEqual(kwargs.get("content_field"), "payload")

    def test_preview_with_integration_options(self):
        # Probar opción 1: Push with 3rd party Integration
        res1 = self.client.post("/api/preview", data={
            "data_type": "json",
            "content": '{"test": 123}',
            "integration": "Push with 3rd party Integration"
        })
        self.assertEqual(res1.status_code, 200)
        env1 = res1.get_json().get("sample_envelope")
        self.assertEqual(env1.get("integration"), "Push with 3rd party Integration")

        # Probar opción 2: Quadient Inspire DAS
        res2 = self.client.post("/api/preview", data={
            "data_type": "csv",
            "content": "a,b\n1,2",
            "integration": "Quadient Inspire DAS"
        })
        self.assertEqual(res2.status_code, 200)
        env2 = res2.get_json().get("sample_envelope")
        self.assertEqual(env2.get("integration"), "Quadient Inspire DAS")

    @patch("app.send_data_to_kafka")
    def test_send_with_integration(self, mock_send):
        mock_send.return_value = {
            "total_sent": 1,
            "total_errors": 0,
            "elapsed_time": 0.01
        }
        res = self.client.post("/api/send", data={
            "topic": "das-topic",
            "data_type": "csv",
            "content": "col1\nval1",
            "integration": "Quadient Inspire DAS"
        })
        self.assertEqual(res.status_code, 200)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs.get("integration"), "Quadient Inspire DAS")

    def test_preview_with_push_fields_and_autodetection(self):
        # CSV con auto-detección y campos de push
        res = self.client.post("/api/preview", data={
            "content": "id,sensor\n1,temp",
            "user_id": "USR-999",
            "push_title": "Alerta de Temperatura",
            "push_content": "Sensor 1 ha superado el umbral",
            "integration": "Push with 3rd party Integration"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("data_type"), "csv")
        env = data.get("sample_envelope")
        self.assertEqual(env.get("type"), "CSV")
        self.assertEqual(env.get("user_id"), "USR-999")
        self.assertEqual(env.get("push_title"), "Alerta de Temperatura")
        self.assertEqual(env.get("push_content"), "Sensor 1 ha superado el umbral")
        self.assertEqual(env.get("integration"), "Push with 3rd party Integration")

        # JSON con auto-detección y campos de push
        res_json = self.client.post("/api/preview", data={
            "content": '{"device": "d-10", "battery": 95}',
            "user_id": "USR-888",
            "push_title": "Batería OK",
            "push_content": "Dispositivo con carga completa"
        })
        self.assertEqual(res_json.status_code, 200)
        data_json = res_json.get_json()
        self.assertTrue(data_json.get("success"))
        self.assertEqual(data_json.get("data_type"), "json")
        env_json = data_json.get("sample_envelope")
        self.assertEqual(env_json.get("type"), "JSON")
        self.assertEqual(env_json.get("user_id"), "USR-888")
        self.assertEqual(env_json.get("push_title"), "Batería OK")
        self.assertEqual(env_json.get("push_content"), "Dispositivo con carga completa")
        self.assertEqual(env_json.get("content"), {"device": "d-10", "battery": 95})

    @patch("app.send_data_to_kafka")
    def test_send_with_push_fields_and_single_request(self, mock_send):
        mock_send.return_value = {
            "total_sent": 1,
            "total_errors": 0,
            "elapsed_time": 0.015
        }
        res = self.client.post("/api/send", data={
            "topic": "push-notifications",
            "content": "usuario,saldo\njuan,500.0",
            "user_id": "USR-101",
            "push_title": "Saldo Disponible",
            "push_content": "Tu nuevo saldo está listo",
            "integration": "Push with 3rd party Integration"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("stats")["total_sent"], 1)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs.get("user_id"), "USR-101")
        self.assertEqual(kwargs.get("push_title"), "Saldo Disponible")
        self.assertEqual(kwargs.get("push_content"), "Tu nuevo saldo está listo")
        self.assertEqual(kwargs.get("send_mode"), "whole")

    @patch("app.send_data_to_kafka")
    def test_send_usecase_3rd_party_auto_user_id(self, mock_send):
        mock_send.return_value = {"total_sent": 1, "total_errors": 0, "elapsed_time": 0.01}
        res = self.client.post("/api/send", data={
            "topic": "facturas-topic",
            "content": json.dumps({"BILLING_PERIOD": "Septiembre 2026", "TOTAL_AMOUNT": "$1,450.00"}),
            "integration": "3rd Party",
            "push_title": "Factura Lista",
            "push_content": "Tu factura está lista para descarga",
            "use_case": "Factura / Recibo Digital"
        })
        self.assertEqual(res.status_code, 200)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs.get("user_id"), "quadientlatam@gmail.com")
        self.assertEqual(kwargs.get("integration"), "3rd Party")
        self.assertEqual(kwargs.get("use_case"), "Factura / Recibo Digital")

    @patch("app.send_data_to_kafka")
    def test_send_usecase_das_auto_user_id(self, mock_send):
        mock_send.return_value = {"total_sent": 1, "total_errors": 0, "elapsed_time": 0.01}
        res = self.client.post("/api/send", data={
            "topic": "leads-topic",
            "content": json.dumps({"CUSTOMER_NAME": "Carlos Morales", "SERVICE_TYPE": "5G"}),
            "integration": "Quadient Inspire DAS",
            "push_title": "Contacto Registrado",
            "push_content": "Solicitud recibida",
            "use_case": "Solicitud de Contacto Telefonía"
        })
        self.assertEqual(res.status_code, 200)
        kwargs = mock_send.call_args[1]
        self.assertEqual(kwargs.get("user_id"), "xbaGznvBRTbXKT0YOVEH30959486")
        self.assertEqual(kwargs.get("integration"), "Quadient Inspire DAS")
        self.assertEqual(kwargs.get("use_case"), "Solicitud de Contacto Telefonía")


if __name__ == "__main__":
    unittest.main()
