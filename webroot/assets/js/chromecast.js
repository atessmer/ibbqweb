/*
 * Uses https://github.com/demille/url-cast-receiver cast application
 */
import * as Utils from './utils.js';

const APP_ID = '5CB45E5A';
const NAMESPACE = 'urn:x-cast:com.url.cast';

const initCastApi = () => {
   if (Utils.isCastReceiver()) {
      initCastReceiver();
   } else {
      initCastSender();
   }
};

const initCastSender = () => {
   cast.framework.CastContext.getInstance().setOptions({
      receiverApplicationId: APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
   });

   let context = cast.framework.CastContext.getInstance();
   context.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      (event) => {
         switch (event.sessionState) {
            case cast.framework.SessionState.SESSION_STARTED:
            case cast.framework.SessionState.SESSION_RESUMED:
               event.session.addMessageListener(NAMESPACE, (namespace, msg) => {
                  console.log(`${new Date().toISOString()} :: Received msg: `, msg);
               });

               castCurrentTab();
               break;
            case cast.framework.SessionState.SESSION_ENDED:
               // Anything to do here?
               break;
         }
      }
   );

   document.addEventListener('shown.bs.tab', (event) => {
      castCurrentTab();
   });
};

const castCurrentTab = () => {
   let session = cast.framework.CastContext.getInstance().getCurrentSession();
   if (session == null) {
      return;
   }

   /*
    * Use type='loc' so we become the parent page on the chromecast receiver.
    * This allows us to use the full receiver framework to set options as needed
    * and implement our own sender/receiver messaging.
    */
   session.sendMessage(NAMESPACE, {
      type: 'loc', // iframe | loc
      url: window.location.origin + document.querySelector('#pageTab .active').dataset['bsTarget'],
   });
};

const initCastReceiver = () => {
   document.body.classList.add('cast-receiver');

   const options = new cast.framework.CastReceiverOptions();
   options.customNamespaces = {
      [NAMESPACE]: cast.framework.system.MessageType.JSON,
   };
   options.disableIdleTimeout = true;

   const context = cast.framework.CastReceiverContext.getInstance();
   context.start(options);

   context.addCustomMessageListener(NAMESPACE, (event) => {
      context.sendCustomMessage(NAMESPACE, undefined, {
         type: 'Location',
         sender: event.senderId,
         url: event.data.url,
         all_senders: context.getSenders().map(s => s.id),
      });
      window.location.href = event.data.url;
   });

   for (type in [cast.framework.system.EventType.SENDER_CONNECTED,
                 cast.framework.system.EventType.SENDER_DISCONNECTED]) {
      context.addEventListener(type, (event) => {
         const senders = context.getSenders();
         context.sendCustomMessage(NAMESPACE, undefined, {
            type: event.type,
            sender: event.senderId,
            reason: event.reason,
            all_senders: context.getSenders().map(s => s.id),
         });
      });
   }

   setReceiverStatus();
   document.addEventListener('shown.bs.tab', (event) => {
      setReceiverStatus();
   });
};

const setReceiverStatus = () => {
   const context = cast.framework.CastReceiverContext.getInstance();

   context.setApplicationState(
      'iBBQ Web: ' + document.querySelector('#pageTab .active').textContent
   );
};

export {
   initCastApi,
};
