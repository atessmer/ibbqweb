import json

DEFAULT_FILE = "/etc/ibbqweb/ibbqweb.json"

class IbbqWebConfig:
   def __init__(self, cfg_file=DEFAULT_FILE):
      self._cfg_file = cfg_file
      self._http_port = 8080
      self._unit = 'F'
      self._probe_count = 0
      self._loaded = False


   def load(self):
      with open(self._cfg_file, 'r') as f:
         cfg = json.load(f)

      self.http_port = cfg.get('http_port', self._http_port)
      self.unit = cfg.get('unit', self._unit)
      self.probe_count = cfg.get('probe_count', self._probe_count)

      self._loaded = True
      self.write()


   def write(self):
      if not self._loaded:
          return

      with open(self._cfg_file, 'w') as f:
         json.dump({
            'http_port': self.http_port,
            'unit': self.unit,
            'probe_count': self.probe_count,
         }, f, sort_keys=True, indent=4)


   @property
   def http_port(self):
      return self._http_port


   @http_port.setter
   def http_port(self, http_port):
      if not isinstance(http_port, int):
         raise TypeError("http_port must be of type <int>")

      if http_port != self._http_port:
         self._http_port = http_port
         self.write()


   @property
   def unit(self):
      return self._unit


   @unit.setter
   def unit(self, unit):
      if unit not in ['C', 'F']:
         raise ValueError("unit must be 'C' or 'F'")

      if unit != self._unit:
         self._unit = unit
         self.write()


   @property
   def probe_count(self):
      return self._probe_count


   @probe_count.setter
   def probe_count(self, probe_count):
      if not isinstance(probe_count, int):
         raise TypeError("probe_count must be of type <int>")

      if probe_count != self._probe_count:
         self._probe_count = probe_count
         self.write()
