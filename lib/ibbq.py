import asyncio
import bleak
import binascii
import datetime
import enum
import struct
from uuid import UUID


class Characteristics(enum.IntEnum):
   SettingsNotify       = 0xfff1    # Subscribe
   Pair                 = 0xfff2    # Write
   History              = 0xfff3    # Read (?)
   RealtimeTempNotify   = 0xfff4    # Subscribe
   SettingsUpdate       = 0xfff5    # Write

class SettingsData(enum.Enum):
   EnableRealtimeData   = b"\x0B\x01\x00\x00\x00\x00"
   EnableBatteryData    = b"\x08\x24\x00\x00\x00\x00"
   SetTargetTemp        = b"\x01{probe}{min}{max}"    # probe = uint8, min/max = int16 in 10^-1 Celcius
   SetUnitCelcius       = b"\x02\x00\x00\x00\x00\x00"
   SetUnitFarenheit     = b"\x02\x01\x00\x00\x00\x00"

   GetVersion           = b"\x08\x23\x00\x00\x00\x00"
   SilanceAlarm         = b"\x04\{probe}\x00\x00\x00\x00" # probe = uint8; 0xff for all
   DeviceAlarmOn        = b"\xfd\x01\x01\x01\x00\x00" # Only for "grilleye" device?
   DeviceAlarmOff       = b"\xfd\x01\x00\x01\x00\x00" # Only for "grilleye" device?
   Unknown1             = b"\x12\x03\x00\x00\x00\x00" # App sends this during init
                                                      # Return: b"\xff\x12\x00\x00\x00\x00"
   Unknown2             = b"\xff\x01\x00\x00\x00\x00" # Unused in app


PairKey = b"\x21\x07\x06\x05\x04\x03\x02\x01\xb8\x22\x00\x00\x00\x00\x00"


class iBBQ:
   def __init__(self, probe_count=0):
      self._celcius = False
      self._device = None
      self._characteristics = {}
      self._currentTempsC = [None] * probe_count
      self._currentBatteryLevel = None
      self._client = None

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
   def probeTemperaturesC(self):
      return self._currentTempsC

   @property
   def batteryLevel(self):
      return self._currentBatteryLevel

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

      self._client = bleak.BleakClient(self._device)
      await self._client.connect()

      services = await self._client.get_services()
      for characteristic in services.characteristics.values():
        # Time portion of UUID is characteristic key
        char_uuid = UUID(characteristic.uuid)
        self._characteristics[char_uuid.time] = characteristic

      await self._client.write_gatt_char(
         self._characteristics[Characteristics.Pair.value],
         PairKey,
         response=True
      )

      # Sync settings to device
      if self._celcius:
         await self._setUnit(SettingsData.SetUnitCelcius.value)
      else:
         await self._setUnit(SettingsData.SetUnitFarenheit.value)

      #print("Paired")

   async def subscribe(self):
      if not self.connected:
         raise RuntimeError("Device not connected")

      await self._client.start_notify(
         self._characteristics[Characteristics.RealtimeTempNotify.value],
         self._cbRealtimeTempNotify
      )
      await self._client.write_gatt_char(
         self._characteristics[Characteristics.SettingsUpdate.value],
         SettingsData.EnableRealtimeData.value,
         response=False
      )

      await self._client.start_notify(
         self._characteristics[Characteristics.SettingsNotify.value],
         self._cbSettingsNotify
      )
      await self._client.write_gatt_char(
         self._characteristics[Characteristics.SettingsUpdate.value],
         SettingsData.EnableBatteryData.value,
         response=False
      )

      await self._client.write_gatt_char(
         self._characteristics[Characteristics.SettingsUpdate.value],
         SettingsData.Unknown1.value,
         response=False
      )


   async def _setUnit(self, data):
      if not self.connected:
         raise RuntimeError("Device not connected")

      await self._client.write_gatt_char(
         self._characteristics[Characteristics.SettingsUpdate.value],
         data,
         response=False
      )

   async def setUnitCelcius(self):
      self._celcius = True
      try:
         await self._setUnit(SettingsData.SetUnitCelcius.value)
      except RuntimeError:
         pass

   async def setUnitFarenheit(self):
      self._celcius = False
      try:
         await self._setUnit(SettingsData.SetUnitFarenheit.value)
      except RuntimeError:
         pass

   async def setProbeTargetTemp(self, probe, minTempC, maxTempC):
      if not self.connected:
         raise RuntimeError("Device not connected")

      # See SettingsData.SetTargetTemp
      data = b"\x01" + struct.pack("<Bhh", probe, int(minTempC * 10),
                                   int(maxTempC * 10))

      await self._client.write_gatt_char(
         self._characteristics[Characteristics.SettingsUpdate.value],
         data,
         response=False
      )

   async def silanceAlarm(self, probe=0xff):
      if not self.connected:
         raise RuntimeError("Device not connected")

      print("Silencing alarm: probe = %s" % "all" if probe == 0xff else str(probe))

      # See SettingsData.SilanceAlarm
      await self._client.write_gatt_char(
         self._characteristics[Characteristics.SettingsUpdate.value],
         struct.pack("6b", 0x04, probe, 0x00, 0x00, 0x00, 0x00),
         response=False
     )

   @staticmethod
   def _tempCbtof(probeData):
      rawTemp = struct.unpack('<H', probeData)[0]
      if rawTemp == 0xfff6:
         return None
      tempC = float(rawTemp) / 10
      return tempC

   @staticmethod
   def _tempCftob(tempC):
      if tempC == None:
         rawTemp = 0xfff6
      else:
         rawTemp = int(tempC * 10)
      return struct.pack('<H', rawTemp)

   def _cbRealtimeTempNotify(self, handle, data):
      # int16 temperature per probe, always celcius
      #print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
      self._currentTempsC = [self._tempCbtof(probeData)
                            for probeData in [data[i:i+2] for i in range(0, len(data), 2)]]
      #for temp in self._currentTempsC:
      #   if temp is None:
      #      print("Probe disconnected")
      #   else:
      #      print(u"Probe temp: %.1f\N{DEGREE SIGN}C" % temp)

   def _cbSettingsNotify(self, handle, data):
      #print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
      if data[0] == 0x04:
         if data[1] == 0xff:
            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            print("Alarm silenced")
         else:
            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            print("Unhandled settings callback: %s" % data)
      elif data[0] == 0x20:
         # paring key???
         pass
      elif data[0] == 0x21:
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
      elif data[0] == 0x23:
         majorVersion = data[1]
         minorVersion = data[2]
         patchVersion = data[3]
      elif data[0] == 0x24:
         curVoltage = int.from_bytes(data[1:3], "little")
         maxVoltage = int.from_bytes(data[3:5], "little")
         if maxVoltage == 0:
            maxVoltage = 6550
         factor = maxVoltage / 6550.0

         #
         # https://github.com/sworisbreathing/go-ibbq/issues/2#issuecomment-650725433
         #
         VOLTAGES = [
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
         if curVoltage == 0:
            # Charging
            self._currentBatteryLevel = 0xffff
         elif curVoltage > VOLTAGES[-1] * factor:
            self._currentBatteryLevel = 100
         else:
            for i, percentVoltage in enumerate(VOLTAGES[1:]):
               if curVoltage < percentVoltage * factor:
                  self._currentBatteryLevel = i-1
                  break
         #print("Battery %d%%: Cur=%dnV, Max=%dmV, Factor=%f" %
         #      (self._currentBatteryLevel, curVoltage, maxVoltage, factor))
         # Setting successful
      elif data[0] == 0xff:
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
      else:
         print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
         print("Unhandled settings callback: %s" % data)
         pass
