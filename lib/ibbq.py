import asyncio
import collections
import datetime
import enum
import struct
from uuid import UUID

import bleak


ALARM_SILENCE_TIMEOUT = (5 * 60) # seconds. device uses 5 min so we will too

class Characteristics(enum.IntEnum):
    SETTINGS_NOTIFY         = 0xfff1    # Subscribe
    PAIR                    = 0xfff2    # Write
    HISTORY                 = 0xfff3    # Read (?)
    REALTIME_TEMP_NOTIFY    = 0xfff4    # Subscribe
    SETTINGS_UPDATE         = 0xfff5    # Write

class SettingsData(enum.Enum):
    ENABLE_REALTIME_DATA  = b"\x0B\x01\x00\x00\x00\x00"
    ENABLE_BATTERY_DATA   = b"\x08\x24\x00\x00\x00\x00"
    SET_TARGET_TEMP       = b"\x01{probe}{min}{max}" # probe = uint8,
                                                     # min/max = int16 in 10^-1 Celcius
    SET_UNIT_CELCIUS      = b"\x02\x00\x00\x00\x00\x00"
    SET_UNIT_FARENHEIT    = b"\x02\x01\x00\x00\x00\x00"

    GET_VERSION          = b"\x08\x23\x00\x00\x00\x00"
    SILENCE_ALARM        = b"\x04{probe}\x00\x00\x00\x00" # probe = uint8; 0xff for all
    DEVICE_ALARM_ON       = b"\xfd\x01\x01\x01\x00\x00" # Only for "grilleye" device?
    DEVICE_ALARM_OFF      = b"\xfd\x01\x00\x01\x00\x00" # Only for "grilleye" device?
    UNKNOWN1            = b"\x12\x03\x00\x00\x00\x00" # App sends this during init
                                                      # Return: b"\xff\x12\x00\x00\x00\x00"
    UNKNOWN2            = b"\xff\x01\x00\x00\x00\x00" # Unused in app


PAIR_KEY = b"\x21\x07\x06\x05\x04\x03\x02\x01\xb8\x22\x00\x00\x00\x00\x00"


class IBBQ: # pylint: disable=too-many-instance-attributes
    def __init__(self, maxhistory=(60*60*8)):
        self._celcius = False
        self._device = None
        self._characteristics = {}
        self._readings = collections.deque(maxlen=maxhistory) # temps stored in celcius
        self._target_temps = {}
        self._silence_temp_alert_until = datetime.datetime.now()
        self._cur_battery_level = None
        self._client = None
        self._change_event = asyncio.Event()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *excinfo):
        if self.connected:
            await self._client.disconnect()

    @property
    def address(self):
        return self._device.address if self._device else None

    @property
    def unit(self):
        return "C" if self._celcius else "F"

    @property
    def connected(self):
        return self._client is not None and bool(self._client.is_connected)

    @property
    def probe_reading(self):
        if len(self._readings):
            return self._readings[-1]
        return None

    @property
    def probe_readings_all(self):
        return list(self._readings)

    @property
    def probe_readings_since(self):
        if len(self._readings):
            return self._readings[0]['timestamp'].timestamp()
        return 0.0

    @property
    def target_temps(self):
        return self._target_temps

    @property
    def target_temp_alert(self):
        if (
            datetime.datetime.now() < self._silence_temp_alert_until or
            self.probe_reading is None
        ):
            return False

        probe_readings = list(self.probe_reading['probes'])
        for (probe, target_temp) in self._target_temps.items():
            if probe_readings[probe] is None:
                # Probe disconnected
                continue

            if probe_readings[probe] >= target_temp['max_temp_c']:
                return True

            if (
                target_temp['min_temp_c'] is not None and
                probe_readings[probe] <= target_temp['min_temp_c']
            ):
                return True

        return False

    @property
    def battery_level(self):
        return self._cur_battery_level

    @property
    def rssi(self):
        """The initial RSSI from scan/discover, this value is not updated
           when connected."""
        if self._device is None:
            return None
        return self._device.rssi

    def _notify_change(self):
        self._change_event.set()
        self._change_event.clear()

    async def await_change(self):
        await self._change_event.wait()

    def _cb_disconnect(self, client):
        self._notify_change()

    async def connect(self, address=None):
        if self._device is None:
            if address is None:
                while self._device is None:
                    devs = await bleak.BleakScanner.discover()
                    for dev in devs:
                        if dev.name == "iBBQ":
                            #print("Found iBBQ: %s" % dev.address)
                            self._device = dev
                            break
                    await asyncio.sleep(1)
            else:
                self._device = await bleak.BleakScanner.find_device_by_address(address)
                if self._device is None:
                    raise ValueError("Device with address %s not found" % address)
        elif address is not None and self._device.address != address:
            raise NotImplementedError("Changing BLE address not supported")

        self._client = bleak.BleakClient(self._device, disconnected_callback=self._cb_disconnect)
        try:
            await self._client.connect()
        except (bleak.exc.BleakError, bleak.exc.BleakDBusError) as ex:
            print("Failure to connect to device: [%s] %s" % (type(ex).__name__, ex))
            raise ConnectionError("Failure to connect to device") from ex

        await self._init_client()

    async def _init_client(self):
        services = await self._client.get_services()
        for characteristic in services.characteristics.values():
            # Time portion of UUID is characteristic key
            print(characteristic)
            char_uuid = UUID(characteristic.uuid)
            self._characteristics[char_uuid.time] = characteristic

        await self._client.write_gatt_char(
            self._characteristics[Characteristics.PAIR.value],
            PAIR_KEY,
            response=True
        )

        # Sync settings to device
        if self._celcius:
            await self._set_unit(SettingsData.SET_UNIT_CELCIUS.value)
        else:
            await self._set_unit(SettingsData.SET_UNIT_FARENHEIT.value)

        for (probe, target_temp) in self._target_temps.items():
            await self.set_probe_target_temp(probe,
                                             target_temp['preset'],
                                             target_temp['min_temp_c'],
                                             target_temp['max_temp_c'])

        self._notify_change()

    async def subscribe(self):
        if not self.connected:
            raise ConnectionError("Device not connected")

        await self._client.start_notify(
            self._characteristics[Characteristics.REALTIME_TEMP_NOTIFY.value],
            self._cb_realtime_temp_notify
        )
        await self._client.write_gatt_char(
            self._characteristics[Characteristics.SETTINGS_UPDATE.value],
            SettingsData.ENABLE_REALTIME_DATA.value,
            response=False
        )

        await self._client.start_notify(
            self._characteristics[Characteristics.SETTINGS_NOTIFY.value],
            self._cb_settings_notify
        )
        await self._client.write_gatt_char(
            self._characteristics[Characteristics.SETTINGS_UPDATE.value],
            SettingsData.ENABLE_BATTERY_DATA.value,
            response=False
        )

        await self._client.write_gatt_char(
            self._characteristics[Characteristics.SETTINGS_UPDATE.value],
            SettingsData.UNKNOWN1.value,
            response=False
        )


    async def _set_unit(self, data):
        if not self.connected:
            raise ConnectionError("Device not connected")

        await self._client.write_gatt_char(
            self._characteristics[Characteristics.SETTINGS_UPDATE.value],
            data,
            response=False
        )
        self._notify_change()

    async def set_unit_celcius(self):
        self._celcius = True
        try:
            await self._set_unit(SettingsData.SET_UNIT_CELCIUS.value)
        except ConnectionError:
            pass

    async def set_unit_farenheit(self):
        self._celcius = False
        try:
            await self._set_unit(SettingsData.SET_UNIT_FARENHEIT.value)
        except ConnectionError:
            pass

    async def set_probe_target_temp(self, probe, preset, min_temp_c, max_temp_c):
        if not self.connected:
            raise ConnectionError("Device not connected")

        # device uses temp * 10, with extreems if not set
        dev_min_temp_c = int(min_temp_c * 10) if min_temp_c else  -3000
        dev_max_temp_c = int(max_temp_c * 10) if max_temp_c else 3020

        # See SettingsData.SET_TARGET_TEMP
        data = b"\x01" + struct.pack("<Bhh", probe, dev_min_temp_c,
                                     dev_max_temp_c)

        await self._client.write_gatt_char(
            self._characteristics[Characteristics.SETTINGS_UPDATE.value],
            data,
            response=False
        )

        if preset is None and min_temp_c is None and max_temp_c is None:
            try:
                del self._target_temps[probe]
            except KeyError:
                pass
        else:
            self._target_temps[probe] = {
                "preset": preset,
                "min_temp_c": min_temp_c,
                "max_temp_c": max_temp_c,
            }
        self._silence_temp_alert_until = datetime.datetime.now()

        self._notify_change()

    def _silence_client_alarm(self):
        self._silence_temp_alert_until = datetime.datetime.now() + \
                                         datetime.timedelta(seconds=ALARM_SILENCE_TIMEOUT)
        self._notify_change()

    async def silence_alarm(self, probe=0xff):
        self._silence_client_alarm()

        if not self.connected:
            raise ConnectionError("Device not connected")

        print("Silencing alarm: probe = %s" % "all" if probe == 0xff else str(probe))

        # See SettingsData.SILENCE_ALARM
        await self._client.write_gatt_char(
            self._characteristics[Characteristics.SETTINGS_UPDATE.value],
            struct.pack("6B", 0x04, probe, 0x00, 0x00, 0x00, 0x00),
            response=False
        )

    def clear_history(self):
        self._readings.clear()

    @staticmethod
    def _tempc_bin_to_float(probe_data):
        """Temperature (Celcius) binary to float"""
        raw_temp = struct.unpack('<H', probe_data)[0]
        if raw_temp == 0xfff6:
            return None
        return float(raw_temp) / 10

    @staticmethod
    def _tempc_float_to_bin(temp):
        """Temperature (Celcius) float to binary"""
        if temp is None:
            raw_temp = 0xfff6
        else:
            raw_temp = int(temp * 10)
        return struct.pack('<H', raw_temp)

    def _cb_realtime_temp_notify(self, handle, data):
        # int16 temperature per probe, always celcius
        reading = {
            'timestamp': datetime.datetime.now(),
            'probes': [
                self._tempc_bin_to_float(probe_data)
                for probe_data in [data[i:i+2] for i in range(0, len(data), 2)]
            ],
        }

        # When the temps all remain the same, we just need the first/last
        # timestamp of those values to draw a straight line
        last_readings = self.probe_readings_all[-2:]
        if len(last_readings) == 2 and \
           reading['probes'] == last_readings[1]['probes'] and \
           reading['probes'] == last_readings[0]['probes']:
            last_readings[1]['timestamp'] = reading['timestamp']
        else:
            self._readings.append(reading)
        self._notify_change()

    def _cb_settings_notify(self, handle, data):
        def notify_alarm(data):
            if data[1] == 0xff:
                print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
                print("Alarm silenced")
                self._silence_client_alarm()
            else:
                print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
                print("Unhandled settings callback: %s" % data)

        def notify_pairing_key(_data):
            # Not sure what this is...
            pass

        def notify_connect(data):
            if data[1] == 0:
                # Service pair "miyao" ???
                # Connect successful
                pass
            elif data[1] == 1:
                # Connect failed
                pass
            else:
                # "What's this?"
                pass

        def notify_version(data):
            major = data[1]
            minor = data[2]
            patch = data[3]
            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            print("Version: %d.%d.%d" % (major, minor, patch))

        def notify_voltage(data):
            cur_voltage = int.from_bytes(data[1:3], "little")
            max_voltage = int.from_bytes(data[3:5], "little")
            if max_voltage == 0:
                max_voltage = 6550
            factor = max_voltage / 6550.0

            #
            # https://github.com/sworisbreathing/go-ibbq/issues/2#issuecomment-650725433
            #
            voltages = [
                5580, 5595, 5609, 5624, 5639, 5644, 5649, 5654, 5661, 5668,    # 0-10%
                5676, 5683, 5698, 5712, 5727, 5733, 5739, 5744, 5750, 5756,    # 10-20%
                5759, 5762, 5765, 5768, 5771, 5774, 5777, 5780, 5783, 5786,    # 20-30%
                5789, 5792, 5795, 5798, 5801, 5807, 5813, 5818, 5824, 5830,    # 30-40%
                5830, 5830, 5835, 5840, 5845, 5851, 5857, 5864, 5870, 5876,    # 40-50%
                5882, 5888, 5894, 5900, 5906, 5915, 5924, 5934, 5943, 5952,    # 50-60%
                5961, 5970, 5980, 5989, 5998, 6007, 6016, 6026, 6035, 6044,    # 60-70%
                6052, 6062, 6072, 6081, 6090, 6103, 6115, 6128, 6140, 6153,    # 70-80%
                6172, 6191, 6211, 6230, 6249, 6265, 6280, 6285, 6290, 6295,    # 80-90%
                6300, 6305, 6310, 6315, 6320, 6325, 6330, 6335, 6340, 6344     # 90-100%
            ]
            if cur_voltage == 0:
                # Charging
                self._cur_battery_level = 0xffff
            elif cur_voltage > voltages[-1] * factor:
                self._cur_battery_level = 100
            else:
                for i, percent_voltage in enumerate(voltages[1:]):
                    if cur_voltage < percent_voltage * factor:
                        self._cur_battery_level = i
                        break
            #print("Battery %d%%: Cur=%dnV, Max=%dmV, Factor=%f" %
            #      (self._cur_battery_level, curVoltage, maxVoltage, factor))
            # Setting successful

        def notify_unhandled(data):
            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            print("Unhandled settings callback: %s" % data)

        def notify_success(data):
            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            if data[1] == 0x01:
                # Probe Target Temp
                print("Success: Probe target temp set")
            elif data[1] == 0x02:
                # Unit
                print("Success: Temperature unit set")
            elif data[1] == 0x04:
                # response for writing SettingsData.SilenceAlarm, though
                # device alarm continues beeping
                print("Success: Alarm silenced")
            else:
                print("Unhandled settings successful callback: %s" % data)

        handlers = {
            0x04: notify_alarm,
            0x20: notify_pairing_key,
            0x21: notify_connect,
            0x23: notify_version,
            0x24: notify_voltage,
            0xff: notify_success,
        }
        data_handler = handlers.get(data[0], notify_unhandled)
        data_handler(data)
