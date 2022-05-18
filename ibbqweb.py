#!/usr/bin/python3

import argparse
import asyncio
import datetime
import json
import os.path

import aiohttp.web

import lib.config
from lib.ibbq import IBBQ


WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "webroot")
TS_FMT = "%m-%d-%y %H:%M:%S.%f"

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

async def ws_handle_cmd(ibbq, cfg, data):
    if data["cmd"] == "set_unit":
        cfg.unit = data["unit"]
        if data["unit"] == 'C':
            await ibbq.set_unit_celcius()
        else:
            await ibbq.set_unit_farenheit()
    elif data["cmd"] == "set_probe_target_temp":
        await ibbq.set_probe_target_temp(data["probe"],
                                         data["min_temp"],
                                         data["max_temp"])
    elif data["cmd"] == "silance_alarm":
        await ibbq.silanceAllAlarms()

def ws_handler_factory(ibbq, cfg):
    async def ws_handler(request):
        wsock = aiohttp.web.WebSocketResponse()
        await wsock.prepare(request)

        client_unit = ibbq.unit
        payload = {
            "cmd": "unit_update",
            "unit": client_unit,
        }
        await wsock.send_json(payload)

        full_history = True
        while True:
            if ibbq.unit != client_unit:
                client_unit = ibbq.unit
                payload = {
                    "cmd": "unit_update",
                    "unit": client_unit,
                }
                await wsock.send_json(payload)

            reading = ibbq.probe_reading
            payload = {
                "cmd": "state_update",
                "connected": ibbq.connected,
                "battery_level": ibbq.battery_level,
                "full_history": full_history,
            }

            if reading is None:
                payload.update({
                    "probe_readings": [{
                        "ts": datetime.datetime.now().strftime(TS_FMT)[:-5],
                        "probes": [],
                    }],
                })
                await wsock.send_json(payload)
            else:
                full_history = False
                payload.update({
                    "probe_readings": [
                        {
                            "ts": e["timestamp"].strftime(TS_FMT)[:-5],
                            "probes": e["probes"],
                        } for e in (
                            ibbq.probe_readings_all if full_history else [reading]
                        )
                    ],
                })
                await wsock.send_json(payload)

            recv_task = asyncio.create_task(wsock.receive())
            update_task = asyncio.create_task(ibbq.await_change())

            done, pending = await asyncio.wait(
                [recv_task, update_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            for task in done:
                if task == recv_task:
                    msg = await task
                    if msg.type == aiohttp.WSMsgType.CLOSE:
                        return wsock

                    if msg.type != aiohttp.WSMsgType.TEXT:
                        raise TypeError(
                            "Received message %d:%s is not WSMsgType.TEXT" %
                            (msg.type, msg.data)
                        )
                    await ws_handle_cmd(ibbq, cfg, json.loads(msg.data))
                else:
                    await task

            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
    return ws_handler

@aiohttp.web.middleware
async def index_middleware(request, handler):
    if request.path == "/":
        return aiohttp.web.FileResponse(os.path.join(WEBROOT, "index.html"))
    return await handler(request)

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

        webapp = aiohttp.web.Application(middlewares=[index_middleware])
        webapp.add_routes([
            aiohttp.web.get('/ws', ws_handler_factory(ibbq, cfg)),
            aiohttp.web.static('/', WEBROOT)
        ])
        webapp_runner = aiohttp.web.AppRunner(webapp)
        await webapp_runner.setup()

        await asyncio.gather(
            device_manager(ibbq),
            aiohttp.web.TCPSite(webapp_runner, port=cfg.http_port).start()
        )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
