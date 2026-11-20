import asyncio
import datetime
import struct
import unittest
from typing import NamedTuple
from unittest.mock import AsyncMock, patch

try:
    import bleak  # noqa: F401
except ImportError:
    import sys
    import types

    bleak_stub = types.ModuleType("bleak")
    bleak_stub.exc = types.SimpleNamespace(
        BleakError=type("BleakError", (Exception,), {}),
        BleakDBusError=type("BleakDBusError", (Exception,), {}),
    )
    bleak_stub.BleakScanner = type("BleakScanner", (), {})
    bleak_stub.BleakClient = type("BleakClient", (), {})
    sys.modules["bleak"] = bleak_stub

from lib.ibbq import Characteristics, IBBQ, SettingsNotification, DISCONNECTED_PROBE_TEMPERATURE
import lib.ibbq as ibbq_module


class GattWrite(NamedTuple):
    characteristic: object
    data: bytes
    response: bool


class FakeClient:
    is_connected = True

    def __init__(self):
        self.writes = []

    async def write_gatt_char(self, characteristic, data, response=False):
        self.writes.append(GattWrite(characteristic, data, response))

    async def connect(self):
        self.is_connected = True

    async def disconnect(self):
        self.is_connected = False


class FakeBleakClient(FakeClient):
    def __init__(self, device, disconnected_callback):
        super().__init__()
        self.device = device
        self.disconnected_callback = disconnected_callback
        self.is_connected = False
        self.services = type("Services", (), {
            "characteristics": {
                f"char-{value}": type("Characteristic", (), {
                    "uuid": f"0000{value:04x}-0000-1000-8000-00805f9b34fb"
                })()
                for value in (0xfff1, 0xfff2, 0xfff4, 0xfff5)
            }
        })()


class IbbqTests(unittest.IsolatedAsyncioTestCase):
    _device_mac = "00:1A:2B:3C:4D:5E"

    def setUp(self):
        self._device = type("Device", (), {
            "address": self._device_mac,
        })()

    async def test_connect_discovers_device_and_initializes_gatt(self):
        client = FakeBleakClient(self._device, None)
        with patch.object(ibbq_module.bleak.BleakScanner,
                          "find_device_by_address",
                          new=AsyncMock(return_value=self._device),
                          create=True), \
             patch.object(ibbq_module.bleak, "BleakClient", return_value=client):
            ibbq = IBBQ()
            await ibbq.connect(self._device_mac)

        self.assertTrue(ibbq.connected)
        self.assertEqual(ibbq.address, self._device_mac)
        self.assertEqual(client.writes[0].data, ibbq_module.PAIR_KEY)
        self.assertTrue(client.writes[0].response)
        self.assertGreater(ibbq.change_generation, 0)

    async def test_connect_missing_device_and_address_change_are_rejected(self):
        with patch.object(ibbq_module.bleak.BleakScanner,
                          "find_device_by_address",
                          new=AsyncMock(return_value=None),
                          create=True):
            with self.assertRaisesRegex(ValueError, "not found"):
                await IBBQ().connect("missing")

        ibbq = IBBQ()
        ibbq._device = self._device
        with self.assertRaises(NotImplementedError):
            await ibbq.connect("00:11:22:33:44:55:66")

    async def test_bleak_connect_failure_cleans_up_and_raises_connection_error(self):
        client = FakeBleakClient(self._device, None)
        bleak_error = ibbq_module.bleak.exc.BleakError("radio unavailable")

        async def fail_connect():
            raise bleak_error

        client.connect = fail_connect
        with patch.object(ibbq_module.bleak.BleakScanner,
                          "find_device_by_address",
                          new=AsyncMock(return_value=self._device),
                          create=True), \
             patch.object(ibbq_module.bleak, "BleakClient", return_value=client):
            ibbq = IBBQ()
            with self.assertRaisesRegex(ConnectionError, "Failure to connect") as raised:
                await ibbq.connect(self._device_mac)

        self.assertIs(raised.exception.__cause__, bleak_error)
        self.assertIsNone(ibbq._client)
        self.assertEqual(ibbq._characteristics, {})

    async def test_non_bleak_initialization_failure_also_cleans_up(self):
        client = FakeBleakClient(self._device, None)

        async def fail_write(*args, **kwargs):
            raise RuntimeError("unexpected initialization error")

        client.write_gatt_char = fail_write
        with patch.object(ibbq_module.bleak.BleakScanner,
                          "find_device_by_address",
                          new=AsyncMock(return_value=self._device),
                          create=True), \
             patch.object(ibbq_module.bleak, "BleakClient", return_value=client):
            ibbq = IBBQ()
            with self.assertRaisesRegex(RuntimeError, "initialization error"):
                await ibbq.connect(self._device_mac)

        self.assertIsNone(ibbq._client)
        self.assertEqual(ibbq._characteristics, {})

    async def test_context_exit_disconnects_and_clears_device(self):
        ibbq = IBBQ()
        client = FakeClient()
        ibbq._client = client
        ibbq._device = self._device
        ibbq._characteristics[Characteristics.SETTINGS_UPDATE.value] = "settings"

        async with ibbq:
            self.assertTrue(ibbq.connected)

        self.assertFalse(client.is_connected)
        self.assertIsNone(ibbq._client)
        self.assertIsNone(ibbq._device)
        self.assertEqual(ibbq._characteristics, {})

    async def test_disconnect_callback_notifies_waiters(self):
        ibbq = IBBQ()
        generation = ibbq.change_generation

        ibbq._cb_disconnect(None)

        self.assertEqual(await ibbq.await_change(generation), generation + 1)

    async def test_target_encoding_preserves_zero_and_fractional_values(self):
        ibbq = IBBQ()
        client = FakeClient()
        ibbq._client = client
        ibbq._characteristics[Characteristics.SETTINGS_UPDATE.value] = "settings"

        min_temp_c = 0
        max_temp_c = 12.3
        await ibbq.set_probe_target_temp(1, "custom.range", min_temp_c, max_temp_c)

        set_target_temperature_command = 0x01
        probe_index = 1
        min_temp_tenths_c = int(min_temp_c * 10)
        max_temp_tenths_c = int(max_temp_c * 10)
        self.assertEqual(
            client.writes[0].data,
            struct.pack(
                "<BBhh", set_target_temperature_command, probe_index,
                min_temp_tenths_c, max_temp_tenths_c
            ),
        )
        self.assertEqual(ibbq.target_temps[1]["min_temp_c"], 0)

    async def test_waiter_observes_change_that_precedes_wait_registration(self):
        ibbq = IBBQ()
        old_generation = ibbq.change_generation
        ibbq._notify_change()

        observed = await asyncio.wait_for(ibbq.await_change(old_generation), timeout=0.1)

        self.assertGreater(observed, old_generation)

    async def test_clear_history_notifies_and_empties_readings(self):
        ibbq = IBBQ()
        ibbq._readings.append({"timestamp": None, "probes": [10.0]})
        old_generation = ibbq.change_generation

        ibbq.clear_history()

        self.assertEqual(ibbq.probe_readings_all, [])
        self.assertGreater(ibbq.change_generation, old_generation)

    async def test_malformed_temperature_notification_is_ignored(self):
        ibbq = IBBQ()
        # Each probe temperature is a 16-bit value, so this payload is truncated.
        ibbq._cb_realtime_temp_notify(None, struct.pack("<B", 1))
        self.assertIsNone(ibbq.probe_reading)

    async def test_temperature_decode_and_flat_reading_compression(self):
        ibbq = IBBQ()
        temperature_c = 215.0
        temperature_tenths_c = int(temperature_c * 10)
        temperature_data = struct.pack("<H", temperature_tenths_c)
        ibbq._cb_realtime_temp_notify(None, temperature_data)
        ibbq._cb_realtime_temp_notify(None, temperature_data)
        ibbq._cb_realtime_temp_notify(None, temperature_data)
        ibbq._cb_realtime_temp_notify(None, temperature_data)

        self.assertEqual(len(ibbq.probe_readings_all), 2)
        self.assertEqual(ibbq.probe_reading["probes"], [temperature_c])

    async def test_disconnected_operations_and_invalid_probe_are_rejected(self):
        ibbq = IBBQ()
        with self.assertRaises(ConnectionError):
            await ibbq.set_probe_target_temp(0, "beef.rare", None, 55)
        ibbq._client = FakeClient()
        ibbq._characteristics[Characteristics.SETTINGS_UPDATE.value] = "settings"
        for probe in (True, -1, 256, 1.5):
            with self.subTest(probe=probe), self.assertRaises(ValueError):
                await ibbq.set_probe_target_temp(probe, "custom.temp", None, 55)

    async def test_target_alert_limits_and_alarm_silence(self):
        ibbq = IBBQ()
        max_temp_c = 50
        temperature_tenths_c = max_temp_c * 10
        ibbq._cb_realtime_temp_notify(None, struct.pack("<H", temperature_tenths_c))
        ibbq._target_temps[0] = {"min_temp_c": None, "max_temp_c": max_temp_c}
        ibbq._silence_temp_alert_until = datetime.datetime.now(datetime.timezone.utc)
        self.assertTrue(ibbq.target_temp_alert)
        ibbq._silence_client_alarm()
        self.assertFalse(ibbq.target_temp_alert)

    async def test_settings_notifications_update_battery_and_ignore_bad_data(self):
        ibbq = IBBQ()
        ibbq._cb_settings_notify(None, b"")
        # Incomplete voltage notification: type byte plus one payload byte.
        partial_voltage_payload = 1
        ibbq._cb_settings_notify(
            None, struct.pack(
                "<BB", SettingsNotification.VOLTAGE, partial_voltage_payload
            )
        )
        self.assertIsNone(ibbq.battery_level)
        current_voltage_mv = 0
        max_voltage_mv = 0
        ibbq._cb_settings_notify(
            None, struct.pack(
                "<BHH", SettingsNotification.VOLTAGE,
                current_voltage_mv, max_voltage_mv
            )
        )
        self.assertEqual(ibbq.battery_level, 0xffff)
        current_voltage_mv = 0xffff
        max_voltage_mv = 0x1986
        ibbq._cb_settings_notify(
            None, struct.pack(
                "<BHH", SettingsNotification.VOLTAGE,
                current_voltage_mv, max_voltage_mv
            )
        )
        self.assertEqual(ibbq.battery_level, 100)

    async def test_target_removal_and_clear_history_generation(self):
        ibbq = IBBQ()
        ibbq._client = FakeClient()
        ibbq._characteristics[Characteristics.SETTINGS_UPDATE.value] = "settings"
        ibbq._target_temps[0] = {"preset": "fish", "min_temp_c": None, "max_temp_c": 60}
        await ibbq.set_probe_target_temp(0, None, None, None)
        self.assertNotIn(0, ibbq.target_temps)
        old_history_generation = ibbq.history_generation
        ibbq.clear_history()
        self.assertEqual(ibbq.history_generation, old_history_generation + 1)

    async def test_temperature_conversion_handles_disconnected_probe(self):
        self.assertIsNone(
            IBBQ._tempc_bin_to_float(
                struct.pack("<H", DISCONNECTED_PROBE_TEMPERATURE)
            )
        )
        self.assertEqual(IBBQ._tempc_bin_to_float(IBBQ._tempc_float_to_bin(21.5)), 21.5)

    async def test_unit_changes_when_disconnected_are_remembered(self):
        ibbq = IBBQ()
        await ibbq.set_unit_celcius()
        self.assertEqual(ibbq.unit, "C")
        await ibbq.set_unit_farenheit()
        self.assertEqual(ibbq.unit, "F")

    async def test_target_alert_checks_low_threshold_and_disconnected_probe(self):
        ibbq = IBBQ()
        connected_probe_temperature_tenths_c = 1000
        ibbq._cb_realtime_temp_notify(
            None, struct.pack(
                "<HH", connected_probe_temperature_tenths_c,
                DISCONNECTED_PROBE_TEMPERATURE
            )
        )
        ibbq._target_temps[0] = {"min_temp_c": 110, "max_temp_c": 200}
        ibbq._target_temps[1] = {"min_temp_c": 0, "max_temp_c": 1}
        ibbq._silence_temp_alert_until = datetime.datetime.now(datetime.timezone.utc)
        self.assertTrue(ibbq.target_temp_alert)
        ibbq._target_temps[0] = {"min_temp_c": None, "max_temp_c": 200}
        self.assertFalse(ibbq.target_temp_alert)


if __name__ == "__main__":
    unittest.main()
