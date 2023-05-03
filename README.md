## iBBQ Web

An alternat client for Inkbird iBBQ bluetooth grill thermometers, providing a terminal display as well as a web front-end for monitoring and adjusting the thermomitor over the network.

## Requirements

### Python Dependencies

Install the following python dependencies:
```
sudo pip install aiohttp
sudo pip install bleak
```

### System User/Group

Create an 'ibbqweb' user/group and configure user/group permissions to ensure ibbqweb has the needed access to system resources without needing to run as root:
```
sudo useradd --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin ibbqweb
sudo usermod -a -G bluetooth ibbqweb
sudo vim /etc/dbus-1/system.d/bluetooth.conf
```

After creating the user, add permissions listed here for <policy group="bluetooth">: https://unix.stackexchange.com/questions/348441/how-to-allow-non-root-systemd-service-to-use-dbus-for-ble-operation

### iptables

Add iptables rules to NAT from port 80 to 8080, so ibbqweb can run on non-privileged port:
```
sudo iptables -t nat -I OUTPUT -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports 8080
sudo iptables -t nat -I PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080
sudo apt install iptables-persistent
sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
```

### Run as 'ibbqweb' user

Start the ibbq client as the ibbqweb user:
```
sudo -u ibbqweb ./ibbqweb.py
```

## Recommended

### git-hooks
```
git config --local core.hooksPath .githooks/
```

### TLS via Let's Encrypt:

The following steps can be used to generate and use a free TLS certificate for the web front-end from Let's Encrypt.

#### Install certbot
```
sudo apt install certbot
```

#### DNS Challenge (internal domains)

For internal domain, where certbot cannot verify your ownership of the domain by adding a file to the webroot directory, configure certbot for DNS challenge:

See https://www.digitalocean.com/community/tutorials/how-to-acquire-a-let-s-encrypt-certificate-using-dns-validation-with-acme-dns-certbot-on-ubuntu-18-04

#### System Group

Create an 'ssl-certs' group, make it the owner of the certs, and add the ibbqweb
```
sudo groupadd ssl-certs
sudo usermod -a -G ssl-certs ibbqweb
sudo chgrp -R ssl-certs /etc/letsencrypt
sudo chmod -R g=rX /etc/letsencrypt
````

#### iBBQ Web Config

Update `http_port`, `tls.cert`, and `tls.key` in /etc/ibbqweb/ibbqweb.json. Ex:
```
{
   "http_port": 4433,
   "tls": {
      "cert": "/etc/letsencrypt/live/example.com/fullchain.pem",
      "key": "/etc/letsencrypt/live/example.com/privkey.pem"
   }
}
```

#### iptables

Replace the above iptables rules for port 80 with the same rules for port 443
```
sudo iptables -t nat -D OUTPUT -p tcp -d 127.0.0.1 --dport 80 -j REDIRECT --to-ports 8080
sudo iptables -t nat -D PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080
sudo iptables -t nat -I OUTPUT -p tcp -d 127.0.0.1 --dport 443 -j REDIRECT --to-ports 4433
sudo iptables -t nat -I PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 4433
sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
```
