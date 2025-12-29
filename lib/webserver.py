import asyncio
import datetime
import json
import logging
import os
import os.path
import ssl
import cryptography.x509

import aiohttp.web

log = logging.getLogger('ibbqweb')


WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "../webroot")


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).timestamp()


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
            self._webapp['tls'] = {
                'cert': self._cfg.tls_cert,
                'key': self._cfg.tls_key,
                'loaded_at': 0,
                'not_valid_after': 0,
            }
            self._webapp['ssl_ctx'] = ssl.SSLContext(protocol=ssl.PROTOCOL_TLS_SERVER)
            WebServer._reload_certs(self._webapp)
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
    def _reload_certs(app):
        if os.lstat(app['tls']['cert']).st_mtime > app['tls']['loaded_at']:
            app['ssl_ctx'].load_cert_chain(app['tls']['cert'], app['tls']['key'])

            with open(app['tls']['cert'], 'rb') as _f:
                cert_data = cryptography.x509.load_pem_x509_certificate(_f.read())
            app['tls']['not_valid_after'] = cert_data.not_valid_after_utc.timestamp()
            app['tls']['loaded_at'] = now_utc()

            log.info("Certificate chain (re)loaded, expires %s", cert_data.not_valid_after_utc)

    @staticmethod
    async def _reload_certs_poller(app):
        try:
            while True:
                expired = app['tls']['not_valid_after'] < now_utc()
                await asyncio.sleep(5 if expired else 5 * 60)
                WebServer._reload_certs(app)
        except asyncio.CancelledError:
            pass

    @staticmethod
    async def _background_tasks(app):
        app['reload_certs'] = asyncio.create_task(WebServer._reload_certs_poller(app))
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

            elif data["cmd"] == "poweroff":
                if self._cfg.allow_poweroff:
                    os.system('sudo poweroff')
                else:
                    log.warning('Attempted to power off the server when '
                                '"allow_poweroff" is disabled.')
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
                            "ts": int(now_utc() * 1000),
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
                                f"Received message {msg.type}:{msg.data} is not WSMsgType.TEXT"
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
