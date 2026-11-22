import { pathToFileURL } from 'node:url';

const fakeUtils = pathToFileURL(new URL('./fake-utils.mjs', import.meta.url).pathname).href;
const bootstrapStub = pathToFileURL(new URL('./bootstrap-stub.mjs', import.meta.url).pathname).href;
const appStub = pathToFileURL(new URL('./app-deps.mjs', import.meta.url).pathname).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'canvasjs') return { url: appStub, shortCircuit: true };
  if (context.parentURL?.endsWith('/app.js') &&
      ['./alert.js', './chromecast.js', './pwa.js', './utils.js', './websocket.js'].includes(specifier)) {
    return { url: appStub, shortCircuit: true };
  }
  if (specifier === 'bootstrap') return { url: bootstrapStub, shortCircuit: true };
  if (specifier === './utils.js' &&
      (context.parentURL?.endsWith('/websocket.js') || context.parentURL?.endsWith('/chromecast.js') ||
       context.parentURL?.endsWith('/pwa.js') || context.parentURL?.endsWith('/alert.js'))) {
    return { url: fakeUtils, shortCircuit: true };
  }
  if (specifier === './websocket.js' && context.parentURL?.endsWith('/alert.js')) {
    return { url: pathToFileURL(new URL('./fake-websocket.mjs', import.meta.url).pathname).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
