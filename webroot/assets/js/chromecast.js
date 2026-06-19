/*
 * Uses https://github.com/demille/url-cast-receiver cast application
 */

const applicationID = '5CB45E5A';
const namespace = 'urn:x-cast:com.url.cast';

const initCastApi = () => {
   cast.framework.CastContext.getInstance().setOptions({
      receiverApplicationId: applicationID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
   });

   let context = cast.framework.CastContext.getInstance();
   context.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (event) => {
         switch (event.sessionState) {
            case cast.framework.SessionState.SESSION_STARTED:
            case cast.framework.SessionState.SESSION_RESUMED:
               event.session.addMessageListener(namespace, receiveMessage);
               startCasting();
               break;
            case cast.framework.SessionState.SESSION_ENDED:
               // Anything to do here?
               break;
         }
      }
   );

   document.addEventListener('shown.bs.tab', (event) => {
      startCasting();
   });
};

const receiveMessage = (namespace, msg) => {
   // namespace = 'urn:x-cast:com.url.cast'
   // it only ever says 'ok' - just confirming when a url has been received
}

const startCasting = () => {
   let session = cast.framework.CastContext.getInstance().getCurrentSession();
   if (session == null) {
      return;
   }

   session.sendMessage(namespace, {
      type: 'iframe', // iframe | location
      url: window.location.origin + '?cast=true' +
           document.querySelector('#pageTab .active').dataset['bsTarget'],
   });
};

export {
   initCastApi,
};
