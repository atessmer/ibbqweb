import asyncio
import datetime
import json
import os.path

import aiohttp.web

WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "../webroot")
TS_FMT = "%m-%d-%y %H:%M:%S.%f"

class WebServer:
    def __init__(self, cfg, ibbq):
        self._cfg = cfg
        self._ibbq = ibbq

        self._webapp = aiohttp.web.Application(middlewares=[
            WebServer.index_middleware,
        ])
        self._webapp.add_routes([
            aiohttp.web.get('/ws', self._ws_handler_factory()),
            aiohttp.web.static('/', WEBROOT)
        ])

        self._webapp_runner = aiohttp.web.AppRunner(self._webapp)

    async def __aenter__(self):
        await self._webapp_runner.setup()
        return self

    async def __aexit__(self, *excinfo):
        await self._webapp_runner.cleanup()

    @staticmethod
    @aiohttp.web.middleware
    async def index_middleware(request, handler):
        if request.path == "/":
            return aiohttp.web.FileResponse(os.path.join(WEBROOT, "index.html"))
        return await handler(request)

    def start(self):
        tcpsite = aiohttp.web.TCPSite(self._webapp_runner,
                                      port=self._cfg.http_port)
        return tcpsite.start()

    async def _ws_handle_cmd(self, data):
        if data["cmd"] == "set_unit":
            self._cfg.unit = data["unit"]
            if data["unit"] == 'C':
                await self._ibbq.set_unit_celcius()
            else:
                await self._ibbq.set_unit_farenheit()
        elif data["cmd"] == "set_probe_target_temp":
            await self._ibbq.set_probe_target_temp(data["probe"],
                                                   data["min_temp"],
                                                   data["max_temp"])
        elif data["cmd"] == "silance_alarm":
            await self._ibbq.silanceAllAlarms()

    def _ws_handler_factory(self):
        async def ws_handler(request):
            wsock = aiohttp.web.WebSocketResponse()
            await wsock.prepare(request)

            client_unit = self._ibbq.unit
            payload = {
                "cmd": "unit_update",
                "unit": client_unit,
            }
            await wsock.send_json(payload)

            full_history = True
            while True:
                if self._ibbq.unit != client_unit:
                    client_unit = self._ibbq.unit
                    payload = {
                        "cmd": "unit_update",
                        "unit": client_unit,
                    }
                    await wsock.send_json(payload)

                reading = self._ibbq.probe_reading
                payload = {
                    "cmd": "state_update",
                    "connected": self._ibbq.connected,
                    "battery_level": self._ibbq.battery_level,
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
                    payload.update({
                        "probe_readings": [
                            {
                                "ts": e["timestamp"].strftime(TS_FMT)[:-5],
                                "probes": e["probes"],
                            } for e in (
                                self._ibbq.probe_readings_all if full_history
                                                              else [reading]
                            )
                        ],
                    })
                    full_history = False
                    await wsock.send_json(payload)

                recv_task = asyncio.create_task(wsock.receive())
                update_task = asyncio.create_task(self._ibbq.await_change())

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
                        await self._ws_handle_cmd(json.loads(msg.data))
                    else:
                        await task

                for task in pending:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
        return ws_handler
