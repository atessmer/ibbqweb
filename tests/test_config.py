import json
import tempfile
import unittest
from pathlib import Path

from lib.config import IbbqWebConfig


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.cfg_dir = self.enterContext(tempfile.TemporaryDirectory())
        self.cfg_file = Path(self.cfg_dir) / "config.json"

    def load_config(self, contents):
        self.cfg_file.write_text(json.dumps(contents), encoding="utf-8")
        config = IbbqWebConfig(self.cfg_file)
        config.load()
        return config

    def test_defaults_and_poweroff_opt_in(self):
        config = self.load_config({})
        self.assertEqual(config.http_port, 8080)
        self.assertEqual(config.unit, "F")
        self.assertFalse(config.allow_poweroff)

    def test_rejects_partial_tls_configuration(self):
        with self.assertRaises(ValueError):
            self.load_config({"tls": {"cert": "/tmp/cert.pem"}})
        with self.assertRaises(ValueError):
            self.load_config({"tls": {"key": "/tmp/cert.key"}})

    def test_rejects_boolean_port(self):
        with self.assertRaises(TypeError):
            self.load_config({"http_port": True})

    def test_loads_and_persists_valid_settings(self):
        self.cfg_file.write_text(json.dumps({
            "http_port": 9090,
            "tls": {"cert": "/tmp/cert.pem", "key": "/tmp/key.pem"},
            "unit": "C",
            "allow_poweroff": True,
        }), encoding="utf-8")
        config = IbbqWebConfig(self.cfg_file)
        config.load()

        self.assertEqual(config.http_port, 9090)
        self.assertEqual(config.tls_cert, "/tmp/cert.pem")
        self.assertEqual(config.tls_key, "/tmp/key.pem")
        self.assertEqual(config.unit, "C")
        self.assertTrue(config.allow_poweroff)
        config.http_port = 9091
        self.assertEqual(json.loads(self.cfg_file.read_text(encoding="utf-8"))["http_port"], 9091)

    def test_rejects_invalid_config_values(self):
        for contents, error in (
            ([], ValueError),
            ({"http_port": 0}, ValueError),
            ({"tls": []}, TypeError),
            ({"tls": {"cert": 1, "key": "key"}}, TypeError),
            ({"unit": "K"}, ValueError),
            ({"allow_poweroff": 1}, TypeError),
        ):
            with self.subTest(contents=contents), self.assertRaises(error):
                self.load_config(contents)

    def test_does_not_write_before_load_and_validates_setters(self):
        config = IbbqWebConfig(self.cfg_file)
        config.http_port = 8080
        self.assertFalse(self.cfg_file.exists())
        self.cfg_file.write_text("{}", encoding="utf-8")
        config.load()
        with self.assertRaises(ValueError):
            config.http_port = 65536
        with self.assertRaises(ValueError):
            config.unit = "K"


if __name__ == "__main__":
    unittest.main()
