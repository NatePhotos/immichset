# Add immichset to an Immich you already run

You already have Immich with photos in it. immichset only needs to be able to **read** albums from it.

## Option A: the installer (recommended)

If Immich runs in Docker on the same computer, the installer finds it and connects to it. In a terminal on that computer:

```bash
curl -fsSLO https://raw.githubusercontent.com/NatePhotos/immichset/main/install/install.sh
```

```bash
sh install.sh
```

It says "I found Immich already running here", installs **only immichset**, and joins it to Immich's network so the setup
page can find it. Your Immich is not touched. If Immich is on another computer, run `sh install.sh --no-immich` and enter
its address in the setup page.

## Option B: a compose file (Synology, Ugreen and other NAS apps with a "Project" screen)

If you would rather paste a file into your NAS's Docker app, use
[`docker-compose.quickstart.yml`](../../docker-compose.quickstart.yml). Save it as `docker-compose.yml`, set your time
zone, create the project, and then follow [Docker](DOCKER.md) to find the setup code in the container log.

## Then, the setup page

Open `http://<your computer>:3000/setup` and enter the code. On the Immich step choose what fits:

![Do you already have Immich?](../images/setup-15-have-immich.jpg)

- **Yes: sign me in.** Enter your Immich address, your Immich email and password, and it makes the two keys the app needs.
  Your password is used once and never saved.
- **Yes: I'll paste an API key.** If you prefer to make the key yourself in Immich (Account Settings › API Keys).

![Sign in to your Immich](../images/setup-16-signin-immich.jpg)

**The Immich address.** Use the address *this server* can reach, like `http://192.168.1.20:2283`. Inside a container,
`localhost` means the container itself, so it won't work. If the installer connected the networks, the address
is filled in for you.

Everything after that is the same as in [the setup guide](../SETUP.md).
