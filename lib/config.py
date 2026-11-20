import json

DEFAULT_FILE = "/etc/ibbqweb/ibbqweb.json"

class IbbqWebConfig: # pylint: disable=too-many-instance-attributes
    def __init__(self, cfg_file=DEFAULT_FILE):
        self._cfg_file = cfg_file
        self._http_port = 8080
        self._tls_cert = None
        self._tls_key = None
        self._unit = 'F'
        self._allow_poweroff = False
        self._loaded = False


    def load(self):
        with open(self._cfg_file, 'r', encoding='utf-8') as f_obj:
            cfg = json.load(f_obj)

        if not isinstance(cfg, dict):
            raise ValueError("configuration must be a JSON object")

        http_port = cfg.get('http_port', self._http_port)
        if isinstance(http_port, bool) or not isinstance(http_port, int):
            raise TypeError("http_port must be of type <int>")
        if not 1 <= http_port <= 65535:
            raise ValueError("http_port must be between 1 and 65535")
        self._http_port = http_port
        tls = cfg.get('tls', {})
        if not isinstance(tls, dict):
            raise TypeError("tls must be an object")
        self._tls_cert = tls.get('cert', self._tls_cert)
        self._tls_key = tls.get('key', self._tls_key)
        if self._tls_cert is not None and not isinstance(self._tls_cert, str):
            raise TypeError("tls.cert must be a string or null")
        if self._tls_key is not None and not isinstance(self._tls_key, str):
            raise TypeError("tls.key must be a string or null")
        if (self._tls_cert is None) != (self._tls_key is None):
            raise ValueError("Must specify both or neither TLS 'cert' and 'key'")
        unit = cfg.get('unit', self._unit)
        if not isinstance(unit, str) or unit not in ('C', 'F'):
            raise ValueError("unit must be 'C' or 'F'")
        self._unit = unit
        allow_poweroff = cfg.get('allow_poweroff', self._allow_poweroff)
        if not isinstance(allow_poweroff, bool):
            raise TypeError("allow_poweroff must be a boolean")
        self._allow_poweroff = allow_poweroff

        self._loaded = True


    def write(self):
        if not self._loaded:
            return

        with open(self._cfg_file, 'w', encoding='utf-8') as f_obj:
            json.dump({
                'http_port': self.http_port,
                'tls': {
                    'cert': self.tls_cert,
                    'key': self.tls_key,
                },
                'unit': self.unit,
                'allow_poweroff': self.allow_poweroff,
            }, f_obj, sort_keys=True, indent=4)


    @property
    def http_port(self):
        return self._http_port


    @http_port.setter
    def http_port(self, http_port):
        if isinstance(http_port, bool) or not isinstance(http_port, int):
            raise TypeError("http_port must be of type <int>")
        if not 1 <= http_port <= 65535:
            raise ValueError("http_port must be between 1 and 65535")

        if http_port != self._http_port:
            self._http_port = http_port
            self.write()


    @property
    def tls_cert(self):
        return self._tls_cert


    @property
    def tls_key(self):
        return self._tls_key


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
    def allow_poweroff(self):
        return self._allow_poweroff
