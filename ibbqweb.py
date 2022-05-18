#!/usr/bin/python3

import argparse
import asyncio

import lib.config
from lib.ibbq import IBBQ
from lib.webserver import WebServer


async def device_manager(ibbq):
    print("Connecting...")
    while True:
        try:
            try:
                await ibbq.connect(ibbq.address)
            except asyncio.CancelledError:
                return
            except asyncio.TimeoutError:
                await asyncio.sleep(1)
                continue
            print("Connected, RSSI: %ddBm" % ibbq.rssi)

            await ibbq.subscribe()

            while True:
                if not ibbq.connected:
                    raise ConnectionError("Disconnected from %s" %
                                          ibbq.address)

                reading = ibbq.probe_reading
                if reading is not None:
                    print("-"*20 + reading['timestamp'].isoformat() + "-"*20)
                    print("Battery: %s%%" % str(ibbq.battery_level))
                    for idx, temp in enumerate(reading["probes"]):
                        print("Probe %d: %s%s" %
                              (idx, str(temp), "C" if temp else ""))

                await asyncio.sleep(5)
        except ConnectionError:
            print("Reconnecting...")
            await asyncio.sleep(1)

async def main():
    desc = 'iBBQ bluetooth thermometer web interface'
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument('-c', '--config', metavar='FILE',
                        help="Use an alternate config file. Default: %s" %
                             lib.config.DEFAULT_FILE,
                        default=lib.config.DEFAULT_FILE)
    args = parser.parse_args()

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
