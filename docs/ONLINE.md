# Reaching your galleries from anywhere

Right now your galleries open only on your home Wi-Fi. To share them with clients you need an address that works over the
internet, and it should be **https** (the padlock) so browsers trust it. There are four ways. Most people want the first.

## Which should I choose?

| I want... | Choose | Cost | Effort |
|---|---|---|---|
| Clients to open galleries, with no router fiddling | **Cloudflare Tunnel** | A domain (~$10–15/yr); the rest free | Medium. Step-by-step below. |
| To try it with one friend this afternoon | **Try-online** (temporary address) | Free | 2 minutes |
| To reach my **own** admin and Immich from my phone while away | **Tailscale** | Free (up to 6 people) | 10 minutes |
| To do it all myself with my router, and I know how | **Port forward** | A domain | Hard; read the warnings |

Most people: a Cloudflare Tunnel for clients, plus Tailscale for themselves.

**Never open Immich's own port (2283) on your router.** Immich's makers say so too. Clients only ever need immichset.

---

## A. Cloudflare Tunnel (recommended for clients)

A tunnel is a private pipe from your computer to Cloudflare, which then serves your address over https. You don't open
anything on your router, and it works even if your internet provider hides your address.

**You need:** a domain name on Cloudflare. (A domain is a name like `yourstudio.com` that you rent for about $10–15 a year.)

1. **Make a Cloudflare account** at cloudflare.com (free).
2. **Get a domain on Cloudflare.** Either buy one there (**Domain Registration › Register**, sold at cost), or add one you already
   own (**Add a domain**, then change its nameservers at the company you bought it from, as Cloudflare shows you).
3. **Create the tunnel.** In the Cloudflare dashboard open **Networking › Tunnels › Create a tunnel**, choose **Cloudflared**,
   and name it `immichset`. If Cloudflare asks you to start "Zero Trust", it will ask for payment details even on the free plan; you
   are **not** charged for what this guide uses.
4. **Choose Docker** as the connector and **copy the long text after `--token`**. That is your tunnel token. Treat it like a password.
5. **On your computer**, in the install folder, run:

```bash
sh install.sh tunnel
```

   and paste the token when asked (it isn't shown). You should now see the tunnel turn **Healthy** in the Cloudflare dashboard.
6. **Add the address.** In the tunnel, **Routes › Add route › Published application**: Subdomain `galleries`, Domain
   `yourstudio.com`, Service URL **`http://immichset:3000`**. Save.
7. **Tell immichset.** In the setup page's **Address** step (or later under **Connections**), enter
   `https://galleries.yourstudio.com` and press **Test address**. You should see "Arrives through Cloudflare".

Open the address on your phone **on mobile data**. If the gallery loads, clients can open it too.

**Good to know**
- Cloudflare limits upload sizes to 100 MB per request on the free plan. That doesn't affect clients viewing or downloading, but it
  would break big video uploads from the Immich phone app. That's why you reach **Immich** with Tailscale, not through this tunnel.
- The installer sets `CLIENT_IP_HEADER=cf-connecting-ip` for you so the sign-in limits see real visitor addresses.
- If you didn't use the installer (you used the compose file), see the commented tunnel block in `docker-compose.quickstart.yml`.

## B. Try-online (a temporary address, no domain)

```bash
sh install.sh try-online
```

It prints an address ending in `.trycloudflare.com`. Use it as the **Public address** while you test. It **changes every time
it restarts**, so links you already sent stop working; it has no uptime promise. It's for trying it out, never for clients.
Stop it with `sh install.sh try-online stop`.

## C. Tailscale (private access just for you)

Tailscale makes a private network between your own devices, so your phone can reach your home computer as if it were on your
Wi-Fi. It is not for clients (each would need Tailscale).

1. Install Tailscale on the home computer (the Synology and QNAP app stores have it; or [tailscale.com/download](https://tailscale.com/download)) and
   on your phone and laptop, signed in with the same account. The free plan is enough.
2. Your admin is then at `http://<computer-name>:3000/admin` from anywhere, and in the **Immich phone app** you set the server
   to `http://<computer-name>:2283` to back up photos while you travel.

## D. Port forwarding with your own router (advanced)

Only if you know your router and want no third party.

1. **Check you can.** Some internet providers put many customers behind one address ("CGNAT"). If your router's internet address
   differs from what a "what is my IP" website shows, or starts with `100.64`–`100.127`, port forwarding **won't work**; use the tunnel.
2. Forward **only ports 80 and 443**, to a **reverse proxy** (Caddy, or your NAS's built-in one) that gets a free certificate from
   Let's Encrypt and passes traffic to port 3000. **Never forward 3000 or 2283.**
3. If your home address changes, immichset can keep a DNS record up to date (see **Connections › Dynamic DNS**).
4. Set `CLIENT_IP_HEADER` to a header your proxy writes (for example `x-real-ip`).
5. Keep your computer updated, use a strong admin password, and keep the emailed sign-in code on.

---

## What to enter in immichset

**Connections › Public address** (or the setup page's **Address** step): your full https address. Links in emails are built from
it. You can change it any time. If you're not ready yet, choose **Set up later (home only)** in the setup page.

**What depends on you:** your internet provider (CGNAT), your router, and whether your NAS supports Tailscale. When in doubt, the
Cloudflare Tunnel works almost everywhere.
