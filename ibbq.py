#!/usr/bin/python3

import aiohttp.web
import argparse
import asyncio
import datetime
import http.server
import logging
import os.path
import pygatt
import socketserver
import sys
import time

from lib.ibbq import iBBQ


#logging.basicConfig()
#logging.getLogger('pygatt').setLevel(logging.DEBUG)


HTTP_PORT = 8080
WEBROOT = os.path.join(os.path.dirname(os.path.realpath(__file__)), "webroot")

async def deviceManager(ibbq):
   if ibbq.address is None:
      await ibbq.find()

   print("Connecting to %s..." % ibbq.address)
   while True:
      try:
         try:
            ibbq.connect()
         except pygatt.exceptions.NotConnectedError:
            await asyncio.sleep(1)
            continue
         print("Connected")

         ibbq.subscribe()

         while True:
            if not ibbq.connected:
               raise ConnectionError("Disconnected from %s" % ibbq.address)

            print("-"*20 + datetime.datetime.now().isoformat() + "-"*20)
            print("Battery: %s%%" % str(ibbq.batteryLevel))
            for idx, temp in enumerate(ibbq.probeTemperatures):
               print("Probe %d: %s" % (idx, str(temp)))

            await asyncio.sleep(5)
      except ConnectionError:
         print("Reconnecting...")
         await asyncio.sleep(1)

def websocketHandlerFactory(ibbq):
   async def websocketHandler(request):
      print("Websocket: request=%s" % str(request))
      ws = aiohttp.web.WebSocketResponse()
      await ws.prepare(request)

      while True:
         payload = {
            "connected": ibbq.connected,
            "batteryLevel": ibbq.batteryLevel,
            "unit": ibbq.unit,
            "probeTemperatures": ibbq.probeTemperatures,
         }
         await ws.send_json(payload)
         await asyncio.sleep(1)
   return websocketHandler

async def main():
   parser = argparse.ArgumentParser(description='iBBQ bluetooth monitor')
   parser.add_argument('--unit', choices=["C", "F"])
   parser.add_argument('--mac')
   args = parser.parse_args()

   adapter = pygatt.GATTToolBackend()
   adapter.start()

   ibbq = iBBQ(adapter, args.mac)

   if args.unit == "C":
      ibbq.setUnitCelcius()
   else:
      ibbq.setUnitFarenheit()

   webapp = aiohttp.web.Application()
   webapp.add_routes([
      aiohttp.web.get('/ws', websocketHandlerFactory(ibbq)),
      aiohttp.web.static('/', WEBROOT)
   ])
   webappRunner = aiohttp.web.AppRunner(webapp)
   await webappRunner.setup()

   await asyncio.gather(
      deviceManager(ibbq),
      aiohttp.web.TCPSite(webappRunner, port=8080).start()
   )

   webappSite.cleanup()

if __name__ == "__main__":
   asyncio.run(main())
