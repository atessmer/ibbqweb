#!/usr/bin/python3

import aiohttp.web
import argparse
import asyncio
import datetime
import os.path

import lib.config
from lib.ibbq import iBBQ


WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "webroot")

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
         print("Connected")

         await ibbq.subscribe()

         while True:
            if not ibbq.connected:
               raise ConnectionError("Disconnected from %s" % ibbq.address)

            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            print("Battery: %s%%" % str(ibbq.batteryLevel))
            for idx, temp in enumerate(ibbq.probeTemperaturesC):
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
      print("Websocket: request=%s" % str(request))
      ws = aiohttp.web.WebSocketResponse()
      await ws.prepare(request)

      try:
          clientUnit = ibbq.unit
          payload = {
             "cmd": "unit_update",
             "unit": clientUnit,
          }
          await ws.send_json(payload)

          while True:
             cfg.probe_count = len(ibbq.probeTemperaturesC)
             payload = {
                "cmd": "state_update",
                "connected": ibbq.connected,
                "batteryLevel": ibbq.batteryLevel,
                "probeTemperaturesC": ibbq.probeTemperaturesC,
             }
             await ws.send_json(payload)

             if ibbq.unit != clientUnit:
                clientUnit = ibbq.unit
                payload = {
                   "cmd": "unit_update",
                   "unit": clientUnit,
                }
                await ws.send_json(payload)

             try:
                data = await ws.receive_json(timeout=1)
                await websocketHandleCmd(ibbq, cfg, data)
             except (asyncio.TimeoutError, TypeError):
                pass
      except (ConnectionResetError, asyncio.CancelledError):
         # Connection closed by peer, or daemon is exiting
         return ws
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

   ibbq = iBBQ(
      probe_count=cfg.probe_count,
   )

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

   webappSite.cleanup()

if __name__ == "__main__":
   try:
      asyncio.run(main())
   except KeyboardInterrupt:
      pass
