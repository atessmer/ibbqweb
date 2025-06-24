/*
 * Cookie handlers.
 * source: https://www.quirksmode.org/js/cookies.html
 */
const create = (name, value, days=null) => {
   let expires = "";
   if (days !== null) {
      const date = new Date();
      date.setTime(date.getTime()+(days*24*60*60*1000));
      expires = "; expires="+date.toGMTString();
   }
   document.cookie = `${name}=${value}${expires}; path=/`;
}

const read = (name) => {
   const cookies = document.cookie.split(";");
   for (const cookie of cookies) {
      const [cookie_name, cookie_value] = cookie.trim().split("=");
      if (cookie_name == name) {
         return cookie_value;
      }
   }
   return null;
}

const erase = (name) => {
   createCookie(name, "", -1);
}

export {
   create,
   read,
   erase,
};
