#!/usr/bin/python3

import argparse
import asyncio
import gzip
import logging
import logging.handlers
import os
import sys

import lib.config
from lib.ibbq import IBBQ
from lib.webserver import WebServer

LOG_FILE_MAX_BYTES = 1024 * 1024 * 2 # 2MB
LOG_FILE_BACKUP_COUNT = 5

log = logging.getLogger('ibbqweb')

def init_logging(level, log_file=None):
    log.setLevel(level)
    log_fmt = "%(asctime)s [%(levelname)8s] %(message)s"
    if log_file is not None:
        handler = logging.handlers.RotatingFileHandler(log_file, maxBytes=LOG_FILE_MAX_BYTES,
                                                       backupCount=LOG_FILE_BACKUP_COUNT)

        handler.rotation_filename = lambda x: "%s.gz" % x

        def gzip_log_rotator(source, dest):
            with open(source, 'rb') as f_in:
                with gzip.open(dest, 'wb') as gz_out:
                    gz_out.writelines(f_in)
            os.remove(source)
        handler.rotator = gzip_log_rotator
    else:
        handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(log_fmt))
    log.addHandler(handler)

async def device_manager(ibbq):
    log.info("Connecting to iBBQ...")
    while True:
        try:
            await ibbq.connect(ibbq.address)
            log.info("iBBQ Connected")

            await ibbq.subscribe()

            while True:
                if not ibbq.connected:
                    raise ConnectionError("Disconnected from iBBQ %s" %
                                          ibbq.address)

                reading = ibbq.probe_reading
                if reading is not None:
                    log.info("Battery: %s%%", str(ibbq.battery_level))
                    temp_strs = [
                        "%s%s" % (temp, "" if temp is None else "C")
                        for temp in reading["probes"]
                    ]
                    log.info("Probe temps: " + ', '.join(["%s" for _ in range(len(temp_strs))]),
                              *temp_strs)

                await asyncio.sleep(5)
        except asyncio.CancelledError:
            return
        except (ConnectionError, asyncio.TimeoutError):
            log.warning("Reconnecting...")
            await asyncio.sleep(1)

async def main():
    desc = 'iBBQ bluetooth thermometer web interface'
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument('-c', '--config', metavar='FILE',
                        help="Use an alternate config file. Default: %s" %
                             lib.config.DEFAULT_FILE,
                        default=lib.config.DEFAULT_FILE)
    parser.add_argument('-l', '--log-file', metavar="FILE", default=None,
                        help="Log to a file. Default: <stdout>")
    parser.add_argument('-v', '--verbose', action="count", default=0,
                        help="Enable verbose logging (can be passed multiple "
                             "times for even more verbose output)")
    args = parser.parse_args()

    log_level = logging.WARNING
    if args.verbose >= 2:
        log_level = logging.DEBUG
    elif args.verbose == 1:
        log_level = logging.INFO
    init_logging(log_level, args.log_file)

    cfg = lib.config.IbbqWebConfig(args.config)
    cfg.load()

    async with IBBQ() as ibbq:
        if cfg.unit == 'C':
            await ibbq.set_unit_celcius()
        else:
            await ibbq.set_unit_farenheit()

        async with WebServer(cfg, ibbq) as webserver:
            await asyncio.gather(
                device_manager(ibbq),
                webserver.start(),
            )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
