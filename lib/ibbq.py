import asyncio
import binascii
import datetime
import enum
import struct


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


PairKey = b"\x21\x07\x06\x05\x04\x03\x02\x01\xb8\x22\x00\x00\x00\x00\x00"


def CtoF(temp):
   return (temp * 9 / 5) + 32

def FtoC(temp):
   return (temp - 32) * 5 / 9


class iBBQ:
   def __init__(self, adapter, address=None):
      self._adapter = adapter
      self._address = address
      self._celcius = False
      self._connected = False
      self._device = None
      self._characteristics = None
      self._currentTemps = []
      self._currentBatteryLevel = None

   @property
   def address(self):
      return self._address

   @property
   def unit(self):
      return "C" if self._celcius else "F"

   @property
   def connected(self):
      return self._connected

   @property
   def probeTemperatures(self):
      return self._currentTemps

   @property
   def batteryLevel(self):
      return self._currentBatteryLevel

   async def find(self):
      print("Scanning for iBBQ")
      while True:
         devs = self._adapter.scan()
         for dev in devs:
            if dev["name"] == "iBBQ":
               #print("Found iBBQ: %s" % dev["address"])
               self._address = dev["address"]
               return
         await asyncio.sleep(1)

   def _cbDisconnect(self, *args, **kwargs):
      #print("Disconnect callback received")
      self._connected = False

   def connect(self):
      if self._address is None:
         raise RuntimeError("Device address not set")

      self._device = self._adapter.connect(self._address)

      # Time portion of UUID is characteristic key
      self._characteristics = {
         k.time: v
      for k, v in self._device.discover_characteristics().items() }

      self._device.char_write(
         self._characteristics[Characteristics.Pair.value].uuid,
         PairKey
      )
      self._connected = True

      self._device.register_disconnect_callback(self._cbDisconnect)

      # Sync settings to device
      if self._celcius:
         self._setUnit(SettingsData.SetUnitCelcius.value)
      else:
         self._setUnit(SettingsData.SetUnitFarenheit.value)

      #print("Paired")

   def subscribe(self):
      if not self.connected:
         raise RuntimeError("Device not connected")

      self._device.subscribe(
         self._characteristics[Characteristics.RealtimeTempNotify.value].uuid,
         callback=self._cbRealtimeTempNotify
      )
      self._device.char_write(
         self._characteristics[Characteristics.SettingsUpdate.value].uuid,
         SettingsData.EnableRealtimeData.value,
         wait_for_response=False
      )

      self._device.subscribe(
         self._characteristics[Characteristics.SettingsNotify.value].uuid,
         callback=self._cbSettingsNotify
      )
      self._device.char_write(
         self._characteristics[Characteristics.SettingsUpdate.value].uuid,
         SettingsData.EnableBatteryData.value,
         wait_for_response=False
      )


   def _setUnit(self, data):
      if not self.connected:
         raise RuntimeError("Device not connected")

      self._device.char_write(
         self._characteristics[Characteristics.SettingsUpdate.value].uuid,
         data
      )

   def setUnitCelcius(self):
      self._celcius = True
      try:
         self._setUnit(SettingsData.SetUnitCelcius.value)
      except RuntimeError:
         pass

   def setUnitFarenheit(self):
      self._celcius = False
      try:
         self._setUnit(SettingsData.SetUnitFarenheit.value)
      except RuntimeError:
         pass

   def setProbeTargetTemp(self, probe, min, max):
      if not self.connected:
         raise RuntimeError("Device not connected")

      if not self._celcius:
         min = FtoC(min)
         max = FtoC(max)
      # See SettingsData.SetTargetTemp
      data = b"\x01" + struct.pack("<Bhh", probe, int(min * 10), int(max * 10))

      self._device.char_write(
         self._characteristics[Characteristics.SettingsUpdate.value].uuid,
         data
      )

   def _calcTemp(self, probeData):
      rawTemp = struct.unpack('<H', probeData)[0]
      if rawTemp == 0xfff6:
         return None
      temp = rawTemp / 10
      if self._celcius:
         return temp
      return CtoF(temp)

   def _cbRealtimeTempNotify(self, handle, data):
      # int16 temperature per probe, always celcius
      #print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
      self._currentTemps = [self._calcTemp(probeData)
                            for probeData in [data[i:i+2] for i in range(0, len(data), 2)]]
      #for temp in self._currentTemps:
      #   if temp is None:
      #      print("Probe disconnected")
      #   else:
      #      print(u"Probe temp: %.1f\N{DEGREE SIGN}%s" %
      #            (temp, "C" if self._celcius else "F"))

   def _cbSettingsNotify(self, handle, data):
      #print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
      if data[0] == 0x24:
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
         if curVoltage > VOLTAGES[-1] * factor:
            self._currentBatteryLevel = 100
         else:
            for i, percentVoltage in enumerate(VOLTAGES):
               if curVoltage < percentVoltage * factor:
                  self._currentBatteryLevel = i-1
                  break
         #print("Battery %d%%: Cur=%dnV, Max=%dmV, Factor=%f" %
         #      (self._batteryLevel, curVoltage, maxVoltage, factor))
      elif data[0] == 0xff:
         # Setting successful
         print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
         if data[1] == 0x01:
            # Probe Target Temp
            print("Probe target temp set")
         elif data[1] == 0x02:
            # Unit
            print("Temperature unit set")
         elif data[1] == 0x04:
            # Button pressed to silence alarm
            print("Alarm silenced")
         else:
            print("Unhandled settings successful callback: %s" % data)
      else:
         print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
         print("Unhandled settings callback: %s" % data)
         pass
