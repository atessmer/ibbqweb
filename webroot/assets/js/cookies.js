/*
 * Cookie handlers.
 * source: https://www.quirksmode.org/js/cookies.html
 */
const create = (name, value, days=null) => {
   let expires = "";
   if (days !== null) {
      const date = new Date();
      date.setTime(date.getTime()+(days*24*60*60*1000));
      expires = "; expires="+date.toUTCString();
   }
   document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}${expires}; path=/`;
}

const decode = (value) => {
   try {
      return decodeURIComponent(value);
   } catch {
      // Return malformed cookie data as-is instead of failing the whole read.
      return value;
   }
}

const read = (name) => {
   const cookies = document.cookie.split(";");
   for (const cookie of cookies) {
      const separator = cookie.indexOf("=");
      if (separator < 0) continue;
      const cookie_name = decode(cookie.slice(0, separator).trim());
      const cookie_value = cookie.slice(separator + 1);
      if (cookie_name == name) {
         return decode(cookie_value);
      }
   }
   return null;
}

const erase = (name) => {
   create(name, "", -1);
}

export {
   create,
   read,
   erase,
};
