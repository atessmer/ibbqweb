#!/usr/bin/python3

import aiohttp.web
import argparse
import asyncio
import datetime
import os.path

from lib.ibbq import iBBQ


HTTP_PORT = 8080
WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "webroot")

async def deviceManager(ibbq, address):
   print("Connecting to %s..." % address)
   while True:
      try:
         try:
            await ibbq.connect(address)
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

async def websocketHandleCmd(ibbq, data):
   if data["cmd"] == "set_unit":
      if data["celcius"]:
          await ibbq.setUnitCelcius()
      else:
          await ibbq.setUnitFarenheit()

def websocketHandlerFactory(ibbq):
   async def websocketHandler(request):
      try:
          print("Websocket: request=%s" % str(request))
          ws = aiohttp.web.WebSocketResponse()
          await ws.prepare(request)

          clientUnit = ibbq.unit
          payload = {
             "cmd": "unit_update",
             "celcius": clientUnit == "C",
          }
          await ws.send_json(payload)

          while True:
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
                   "celcius": clientUnit == "C",
                }
                await ws.send_json(payload)

             try:
                data = await ws.receive_json(timeout=1)
                await websocketHandleCmd(ibbq, data)
             except (asyncio.TimeoutError, TypeError):
                pass
             except Exception as e:
                print("Websocket: exception on receive (%s): %s" %
                      (type(e), str(e)))
      except ConnectionResetError:
         # Connection closed by peer
         return
   return websocketHandler

@aiohttp.web.middleware
async def indexMiddleware(request, handler):
   if request.path == "/":
      return aiohttp.web.FileResponse(os.path.join(WEBROOT, "index.html"))
   return await handler(request)

async def main():
   parser = argparse.ArgumentParser(description='iBBQ bluetooth monitor')
   parser.add_argument('--unit', choices=["C", "F"])
   parser.add_argument('--mac')
   args = parser.parse_args()

   ibbq = iBBQ()

   if args.unit == "C":
      await ibbq.setUnitCelcius()
   else:
      await ibbq.setUnitFarenheit()

   webapp = aiohttp.web.Application(middlewares=[indexMiddleware])
   webapp.add_routes([
      aiohttp.web.get('/ws', websocketHandlerFactory(ibbq)),
      aiohttp.web.static('/', WEBROOT)
   ])
   webappRunner = aiohttp.web.AppRunner(webapp)
   await webappRunner.setup()

   await asyncio.gather(
      deviceManager(ibbq, args.mac),
      aiohttp.web.TCPSite(webappRunner, port=HTTP_PORT).start()
   )

   webappSite.cleanup()

if __name__ == "__main__":
   asyncio.run(main())
