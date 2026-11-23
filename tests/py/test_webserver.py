import asyncio
import datetime
import unittest
from unittest.mock import AsyncMock, MagicMock, mock_open, patch
from types import SimpleNamespace

try:
    from lib.webserver import WebServer
    from aiohttp import WSMsgType
except ImportError:
    WebServer = None


@unittest.skipIf(WebServer is None, "aiohttp and cryptography are required")
class WebSocketCommandTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.server = WebServer.__new__(WebServer)
        self.server._cfg = SimpleNamespace(unit="F", allow_poweroff=False)
        self.server._ibbq = SimpleNamespace()

    async def test_rejects_unknown_command(self):
        with self.assertRaisesRegex(ValueError, "unknown command"):
            await self.server._ws_handle_cmd({"cmd": "unknown"})

    async def test_rejects_extra_command_fields(self):
        with self.assertRaisesRegex(ValueError, "invalid fields"):
            await self.server._ws_handle_cmd({"cmd": "clear_history", "extra": True})

    async def test_rejects_invalid_temperature_range(self):
        with self.assertRaisesRegex(ValueError, "must not exceed"):
            await self.server._ws_handle_cmd({
                "cmd": "set_probe_target_temp",
                "probe": 0,
                "preset": "custom.range",
                "min_temp": 10,
                "max_temp": 5,
            })

    async def test_passes_integer_temperatures_to_ibbq(self):
        self.server._ibbq.set_probe_target_temp = AsyncMock()

        await self.server._ws_handle_cmd({
            "cmd": "set_probe_target_temp",
            "probe": 0,
            "preset": "custom.range",
            "min_temp": 10.9,
            "max_temp": 25,
        })

        self.server._ibbq.set_probe_target_temp.assert_awaited_once_with(
            0, "custom.range", 10, 25)

    async def test_poweroff_command_is_accepted_when_disabled(self):
        await self.server._ws_handle_cmd({"cmd": "poweroff"})

    async def test_validates_command_shape_probe_preset_and_temperature(self):
        for data in (
            None,
            {"cmd": 1},
            {"cmd": "set_unit", "unit": "K"},
            {"cmd": "set_probe_target_temp", "probe": True, "preset": "fish",
             "min_temp": None, "max_temp": 50},
            {"cmd": "set_probe_target_temp", "probe": 0, "preset": "unknown",
             "min_temp": None, "max_temp": 50},
            {"cmd": "set_probe_target_temp", "probe": 0, "preset": "fish",
             "min_temp": None, "max_temp": float("nan")},
            {"cmd": "set_probe_target_temp", "probe": 0, "preset": "fish",
             "min_temp": None, "max_temp": None},
            {"cmd": "set_probe_target_temp", "probe": 0, "preset": "custom.range",
             "min_temp": None, "max_temp": 50},
            {"cmd": "set_probe_target_temp", "probe": 0, "preset": None,
             "min_temp": 1, "max_temp": None},
        ):
            with self.subTest(data=data), self.assertRaises(ValueError):
                await self.server._ws_handle_cmd(data)

    async def test_set_unit_and_silence_alarm_dispatch(self):
        self.server._ibbq.set_unit_celcius = AsyncMock()
        self.server._ibbq.set_unit_farenheit = AsyncMock()
        self.server._ibbq.silence_alarm = AsyncMock()

        await self.server._ws_handle_cmd({"cmd": "set_unit", "unit": "C"})
        await self.server._ws_handle_cmd({"cmd": "set_unit", "unit": "F"})
        await self.server._ws_handle_cmd({"cmd": "silence_alarm"})

        self.assertEqual(self.server._cfg.unit, "F")
        self.server._ibbq.set_unit_celcius.assert_awaited_once()
        self.server._ibbq.set_unit_farenheit.assert_awaited_once()
        self.server._ibbq.silence_alarm.assert_awaited_once()

    async def test_index_middleware_serves_root_and_delegates_other_paths(self):
        handler = AsyncMock(return_value="delegated")
        root = SimpleNamespace(path="/")
        response = await WebServer.index_middleware(root, handler)
        self.assertEqual(response.status, 200)
        handler.assert_not_awaited()

        other = SimpleNamespace(path="/health")
        self.assertEqual(await WebServer.index_middleware(other, handler), "delegated")
        handler.assert_awaited_once_with(other)

    async def test_cache_middleware_preserves_handler_response(self):
        handler = AsyncMock(return_value=SimpleNamespace(headers={}))
        request = SimpleNamespace()
        response = await WebServer.cache_control_middleware(request, handler)
        self.assertEqual(response.headers, {})
        handler.assert_awaited_once_with(request)

    async def test_stream_sends_full_history_after_history_reset_and_unit_change(self):
        timestamp = datetime.datetime(2025, 1, 1, tzinfo=datetime.timezone.utc)
        state = SimpleNamespace(
            unit="F", history_generation=0, change_generation=0,
            connected=True, battery_level=82,
            target_temps={2: {"preset": "fish", "min_temp_c": None,
                              "max_temp_c": 60}},
            target_temp_alert=False,
            probe_reading={"timestamp": timestamp, "probes": [25.0]},
            probe_readings_all=[{"timestamp": timestamp, "probes": [24.0]},
                                {"timestamp": timestamp, "probes": [25.0]}],
        )

        async def wait_for_change(_generation):
            await asyncio.Event().wait()

        state.await_change = wait_for_change
        self.server._ibbq = state

        class Socket:
            def __init__(self):
                self.sent = []
                self.messages = 0

            async def prepare(self, _request):
                return self

            async def send_json(self, payload):
                self.sent.append(payload)

            async def receive(self):
                self.messages += 1
                if self.messages == 1:
                    state.unit = "C"
                    state.history_generation += 1
                    state.change_generation += 1
                    return SimpleNamespace(type=WSMsgType.TEXT, data="not-json")
                return SimpleNamespace(type=WSMsgType.CLOSE)

        socket = Socket()
        request = SimpleNamespace(transport=None)
        with patch("lib.webserver.aiohttp.web.WebSocketResponse", return_value=socket):
            result = await self.server._ws_handler_factory()(request)

        self.assertIs(result, socket)
        self.assertEqual(socket.sent[0], {"cmd": "unit_update", "unit": "F"})
        self.assertEqual(socket.sent[1]["cmd"], "state_update")
        self.assertTrue(socket.sent[1]["full_history"])
        self.assertEqual(socket.sent[1]["probe_readings"], [
            {"ts": int(timestamp.timestamp() * 1000), "probes": [24.0]},
            {"ts": int(timestamp.timestamp() * 1000), "probes": [25.0]},
        ])
        self.assertEqual(socket.sent[1]["target_temps"], {
            2: {"preset": "fish", "min_temp": None, "max_temp": 60}
        })
        self.assertEqual(socket.sent[2], {"cmd": "unit_update", "unit": "C"})
        self.assertEqual(socket.sent[3]["cmd"], "state_update")
        self.assertTrue(socket.sent[3]["full_history"])
        self.assertEqual(socket.sent[3]["probe_readings"][-1]["probes"], [25.0])

    async def test_stream_handles_empty_history_and_non_text_frames(self):
        state = SimpleNamespace(
            unit="F", history_generation=0, change_generation=0,
            connected=False, battery_level=None, target_temps={},
            target_temp_alert=False, probe_reading=None, probe_readings_all=[],
        )

        async def wait_for_change(_generation):
            await asyncio.Event().wait()

        state.await_change = wait_for_change

        class Socket:
            def __init__(self):
                self.sent = []
                self.messages = 0

            async def prepare(self, _request):
                return self

            async def send_json(self, payload):
                self.sent.append(payload)

            async def receive(self):
                self.messages += 1
                frame_type = WSMsgType.BINARY if self.messages == 1 else WSMsgType.CLOSED
                return SimpleNamespace(type=frame_type, data=b"ignored")

        self.server._ibbq = state
        socket = Socket()
        with patch("lib.webserver.aiohttp.web.WebSocketResponse", return_value=socket):
            await self.server._ws_handler_factory()(SimpleNamespace(transport=None))

        states = [payload for payload in socket.sent if payload["cmd"] == "state_update"]
        self.assertEqual(len(states), 2)
        self.assertTrue(states[0]["full_history"])
        self.assertFalse(states[1]["full_history"])
        self.assertEqual(states[0]["probe_readings"][0]["probes"], [])
        self.assertIsNone(states[0]["battery_level"])

    async def test_stream_sends_latest_reading_after_device_change(self):
        timestamp = datetime.datetime(2025, 1, 1, tzinfo=datetime.timezone.utc)
        old_reading = {"timestamp": timestamp, "probes": [20.0]}
        new_reading = {"timestamp": timestamp, "probes": [21.0]}
        state = SimpleNamespace(
            unit="F", history_generation=0, change_generation=0,
            connected=True, battery_level=90, target_temps={},
            target_temp_alert=False, probe_reading=old_reading,
            probe_readings_all=[old_reading],
        )

        async def wait_for_change(generation):
            state.probe_reading = new_reading
            state.probe_readings_all.append(new_reading)
            state.change_generation = generation + 1
            return state.change_generation

        state.await_change = wait_for_change

        class Socket:
            def __init__(self):
                self.sent = []
                self.messages = 0

            async def prepare(self, _request):
                return self

            async def send_json(self, payload):
                self.sent.append(payload)

            async def receive(self):
                self.messages += 1
                if self.messages == 1:
                    await asyncio.Event().wait()
                return SimpleNamespace(type=WSMsgType.CLOSE)

        self.server._ibbq = state
        socket = Socket()
        with patch("lib.webserver.aiohttp.web.WebSocketResponse", return_value=socket):
            await self.server._ws_handler_factory()(SimpleNamespace(transport=None))

        states = [payload for payload in socket.sent if payload["cmd"] == "state_update"]
        self.assertEqual(len(states), 2)
        self.assertTrue(states[0]["full_history"])
        self.assertEqual(states[0]["probe_readings"][-1]["probes"], [20.0])
        self.assertFalse(states[1]["full_history"])
        self.assertEqual(states[1]["probe_readings"], [
            {"ts": int(timestamp.timestamp() * 1000), "probes": [21.0]}
        ])


@unittest.skipIf(WebServer is None, "aiohttp and cryptography are required")
class CertificateRotationTests(unittest.TestCase):
    def setUp(self):
        self.ssl_ctx = MagicMock()
        self.app = {
            "ssl_ctx": self.ssl_ctx,
            "tls": {
                "cert": "/etc/ibbq/cert.pem",
                "key": "/etc/ibbq/key.pem",
                "loaded_at": 100,
                "not_valid_after": 500,
            },
        }

    @patch("lib.webserver.os.lstat")
    def test_does_not_reload_unchanged_certificate(self, lstat):
        lstat.return_value.st_mtime = 100

        WebServer._reload_certs(self.app)

        self.ssl_ctx.load_cert_chain.assert_not_called()
        self.assertEqual(self.app["tls"]["loaded_at"], 100)
        self.assertEqual(self.app["tls"]["not_valid_after"], 500)

    @patch("lib.webserver.now_utc", return_value=250)
    @patch("lib.webserver.cryptography.x509.load_pem_x509_certificate")
    @patch("builtins.open", new_callable=mock_open, read_data=b"rotated cert")
    @patch("lib.webserver.os.lstat")
    def test_reloads_rotated_certificate_and_refreshes_expiry(
            self, lstat, _open, load_certificate, _now):
        lstat.return_value.st_mtime = 200
        expiry = datetime.datetime(2030, 1, 1, tzinfo=datetime.timezone.utc)
        load_certificate.return_value.not_valid_after_utc = expiry

        WebServer._reload_certs(self.app)

        self.ssl_ctx.load_cert_chain.assert_called_once_with(
            "/etc/ibbq/cert.pem", "/etc/ibbq/key.pem")
        self.assertEqual(self.app["tls"]["loaded_at"], 250)
        self.assertEqual(self.app["tls"]["not_valid_after"], expiry.timestamp())


if __name__ == "__main__":
    unittest.main()
