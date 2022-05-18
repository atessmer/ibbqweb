#!/usr/bin/python3

import aiohttp.web
import argparse
import asyncio
import datetime
import json
import os.path

import lib.config
from lib.ibbq import iBBQ


WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "webroot")
TS_FMT = "%m-%d-%y %H:%M:%S.%f"

async def deviceManager(ibbq):
    print("Connecting...")
    while True:
        try:
            try:
                await ibbq.connect(ibbq.address)
            except asyncio.CancelledError:
                return
            except Exception as e:
                await asyncio.sleep(1)
                continue
            print("Connected, RSSI: %ddBm" % ibbq.rssi)

            await ibbq.subscribe()

            while True:
                if not ibbq.connected:
                    raise ConnectionError("Disconnected from %s" % ibbq.address)

                reading = ibbq.probeReading
                if reading is not None:
                    print("-"*20 + reading['timestamp'].isoformat() + "-"*20)
                    print("Battery: %s%%" % str(ibbq.batteryLevel))
                    for idx, temp in enumerate(reading["probes"]):
                        print("Probe %d: %s%s" % (idx, str(temp), "C" if temp else ""))

                await asyncio.sleep(5)
        except ConnectionError:
            print("Reconnecting...")
            await asyncio.sleep(1)

async def websocketHandleCmd(ibbq, cfg, data):
    if data["cmd"] == "set_unit":
        cfg.unit = data["unit"]
        if data["unit"] == 'C':
            await ibbq.setUnitCelcius()
        else:
            await ibbq.setUnitFarenheit()
    elif data["cmd"] == "set_probe_target_temp":
        await ibbq.setProbeTargetTemp(data["probe"],
                                      data["min_temp"],
                                      data["max_temp"])
    elif data["cmd"] == "silance_alarm":
        await ibbq.silanceAllAlarms()

def websocketHandlerFactory(ibbq, cfg):
    async def websocketHandler(request):
        ws = aiohttp.web.WebSocketResponse()
        await ws.prepare(request)

        clientUnit = ibbq.unit
        payload = {
            "cmd": "unit_update",
            "unit": clientUnit,
        }
        await ws.send_json(payload)

        fullHistory = True
        while True:
            if ibbq.unit != clientUnit:
                clientUnit = ibbq.unit
                payload = {
                    "cmd": "unit_update",
                    "unit": clientUnit,
                }
                await ws.send_json(payload)

            reading = ibbq.probeReading
            payload = {
                "cmd": "state_update",
                "connected": ibbq.connected,
                "batteryLevel": ibbq.batteryLevel,
                "fullHistory": fullHistory,
            }

            if reading is None:
                payload.update({
                    "probeReadings": [{
                        "ts": datetime.datetime.now().strftime(TS_FMT)[:-5],
                        "probes": [],
                    }],
                })
                await ws.send_json(payload)
            else:
                cfg.probe_count = len(reading["probes"])
                if fullHistory:
                    fullHistory = False
                    payload.update({
                        "probeReadings": [
                            {
                                "ts": e["timestamp"].strftime(TS_FMT)[:-5],
                                "probes": e["probes"],
                            } for e in ibbq.probeReadingsAll
                        ],
                    })
                else:
                    payload.update({
                        "probeReadings": [
                            {
                                "ts": reading["timestamp"].strftime(TS_FMT)[:-5],
                                "probes": reading["probes"],
                            }
                        ],
                    })

                await ws.send_json(payload)

            recv_task = asyncio.create_task(ws.receive())
            update_task = asyncio.create_task(ibbq.waitForChange())

            done, pending = await asyncio.wait(
                [recv_task, update_task],
                return_when=asyncio.FIRST_COMPLETED
            )

            for task in done:
                if task == recv_task:
                    msg = await task
                    if msg.type == aiohttp.WSMsgType.CLOSE:
                        return ws

                    if msg.type != aiohttp.WSMsgType.TEXT:
                        raise TypeError(
                            "Received message %d:%s is not WSMsgType.TEXT" %
                            (msg.type, msg.data)
                        )
                    await websocketHandleCmd(ibbq, cfg, json.loads(msg.data))
                else:
                    await task

            for task in pending:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
    return websocketHandler

@aiohttp.web.middleware
async def indexMiddleware(request, handler):
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

    async with iBBQ(probe_count=cfg.probe_count) as ibbq:
        if cfg.unit == 'C':
            await ibbq.setUnitCelcius()
        else:
            await ibbq.setUnitFarenheit()

        webapp = aiohttp.web.Application(middlewares=[indexMiddleware])
        webapp.add_routes([
            aiohttp.web.get('/ws', websocketHandlerFactory(ibbq, cfg)),
            aiohttp.web.static('/', WEBROOT)
        ])
        webappRunner = aiohttp.web.AppRunner(webapp)
        await webappRunner.setup()

        await asyncio.gather(
            deviceManager(ibbq),
            aiohttp.web.TCPSite(webappRunner, port=cfg.http_port).start()
        )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
