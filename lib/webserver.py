import asyncio
import datetime
import json
import logging
import os.path
import ssl

import aiohttp.web

log = logging.getLogger('ibbqweb')


WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "../webroot")

class WebServer:
    def __init__(self, cfg, ibbq):
        self._cfg = cfg
        self._ibbq = ibbq

        self._webapp = aiohttp.web.Application(middlewares=[
            WebServer.index_middleware,
            WebServer.cache_control_middleware,
        ])

        self._webapp['ssl_ctx'] = None
        if self._cfg.tls_cert and self._cfg.tls_key:
            self._webapp['tls_cert'] = self._cfg.tls_cert
            self._webapp['tls_key'] = self._cfg.tls_key
            self._webapp['ssl_ctx'] = ssl.SSLContext(protocol=ssl.PROTOCOL_TLS_SERVER)
            self._webapp['ssl_ctx'].load_cert_chain(self._cfg.tls_cert, self._cfg.tls_key)
            self._webapp.cleanup_ctx.append(WebServer._background_tasks)
        elif self._cfg.tls_cert or self._cfg.tls_key:
            raise ValueError("Must specify both or neither TLS 'cert' and 'key'")

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

    @staticmethod
    @aiohttp.web.middleware
    async def cache_control_middleware(request, handler):
        response = await handler(request)
        if isinstance(getattr(handler, '__self__', None),  aiohttp.web.StaticResource):
            response.headers.setdefault("Cache-Control", "max-age=0")
        return response

    @staticmethod
    async def _reload_certs(app):
        try:
            while True:
                await asyncio.sleep(60 * 5)
                app['ssl_ctx'].load_cert_chain(app['tls_cert'], app['tls_key'])
        except asyncio.CancelledError:
            pass

    @staticmethod
    async def _background_tasks(app):
        app['reload_certs'] = asyncio.create_task(WebServer._reload_certs(app))
        yield
        app['reload_certs'].cancel()
        await app['reload_certs']

    def start(self):
        tcpsite = aiohttp.web.TCPSite(self._webapp_runner,
                                      port=self._cfg.http_port,
                                      ssl_context=self._webapp['ssl_ctx'])
        return tcpsite.start()

    async def _ws_handle_cmd(self, data):
        try:
            if data["cmd"] == "set_unit":
                self._cfg.unit = data["unit"]
                if data["unit"] == 'C':
                    await self._ibbq.set_unit_celcius()
                else:
                    await self._ibbq.set_unit_farenheit()
            elif data["cmd"] == "set_probe_target_temp":
                await self._ibbq.set_probe_target_temp(data["probe"],
                                                       data["preset"],
                                                       data["min_temp"],
                                                       data["max_temp"])
            elif data["cmd"] == "silence_alarm":
                await self._ibbq.silence_alarm()

            elif data["cmd"] == "clear_history":
                self._ibbq.clear_history()
        except ConnectionError:
            # Send an error back to the client?
            pass

    def _ws_handler_factory(self):
        async def ws_handler(request):
            log.info("Websocket connected from %s:%d",
                     *request.transport.get_extra_info('peername'))
            wsock = aiohttp.web.WebSocketResponse()
            await wsock.prepare(request)

            client_unit = self._ibbq.unit
            payload = {
                "cmd": "unit_update",
                "unit": client_unit,
            }
            await wsock.send_json(payload)

            readings_since = self._ibbq.probe_readings_since
            full_history = True
            while True:
                if self._ibbq.probe_readings_since > readings_since:
                    readings_since = self._ibbq.probe_readings_since
                    full_history = True

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
                    "target_temps": {
                        probe: {
                            "preset": tt["preset"],
                            "min_temp": tt["min_temp_c"],
                            "max_temp": tt["max_temp_c"],
                        }
                        for (probe, tt) in self._ibbq.target_temps.items()
                    },
                    "target_temp_alert": self._ibbq.target_temp_alert,
                }

                if reading is None:
                    payload.update({
                        "probe_readings": [{
                            "ts": int(datetime.datetime.now().timestamp() * 1000),
                            "probes": [],
                        }],
                    })
                    await wsock.send_json(payload)
                else:
                    payload.update({
                        "probe_readings": [
                            {
                                "ts": int(e["timestamp"].timestamp() * 1000),
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
