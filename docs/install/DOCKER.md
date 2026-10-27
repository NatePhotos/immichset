# Installing Docker

Docker is the program that runs Immich and immichset on your computer. You install it once. Pick your computer below.
Each section links the official instructions, which are kept up to date by the people who make the software; the notes
here say what to choose and what to check.

After any of these, this should print a version number (open a terminal and type it):

```
docker compose version
```

You need **Compose version 2** (`v2.x`). If you see "docker-compose: command not found" or version 1, update Docker.

## Mac

1. Install **Docker Desktop**: [docs.docker.com/desktop/setup/install/mac-install](https://docs.docker.com/desktop/setup/install/mac-install/).
   Choose the version for your chip (Apple silicon or Intel).
2. Open Docker Desktop once and let it finish starting (the whale icon stops animating).
3. In Docker Desktop, open **Settings › Resources** and give it at least 4 GB of memory (8 GB if you want machine learning).

A Mac is fine for trying things out. For clients it needs to stay awake and on, so most people use a small always-on
computer later.

## Windows

Immich discourages Windows, and its database can't live on a normal Windows drive. If you must: install **Docker Desktop with
WSL2** ([docs.docker.com/desktop/setup/install/windows-install](https://docs.docker.com/desktop/setup/install/windows-install/),
and [the WSL notes](https://docs.docker.com/desktop/features/wsl/)), then install **Ubuntu** from the Microsoft Store, open
it, and run the installer **inside Ubuntu**, keeping the install folder in Ubuntu's home folder (not under `/mnt/c`).
A Mac, Linux machine or NAS is much easier.

## Linux and Raspberry Pi

Follow [docs.docker.com/engine/install](https://docs.docker.com/engine/install/) for your distribution (Ubuntu, Debian,
Raspberry Pi OS 64-bit, and others are listed). Install **Docker Engine and the Compose plugin**. Then let your user run
Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
```

Log out and back in. On a Raspberry Pi use the **64-bit** operating system, and a Pi 5 with 8 GB for Immich.

## Synology

1. Open **Package Center**, search for **Container Manager**, and install it. It needs DSM 7.2 or newer, and not every
   Synology model supports it; check your model on Synology's site.
2. Immich has a guide for Synology: [docs.immich.app/install/synology](https://docs.immich.app/install/synology).
   Read it if you want to install Immich by hand through Container Manager's **Project** screen.
3. To use the one-command installer instead, you need SSH (below).

## Ugreen, QNAP and Unraid

- **Ugreen (UGOS):** open the app store, install **Docker**. Menu names change with software updates; look for Docker
  and for an SSH or terminal setting.
- **QNAP:** install **Container Station** from the App Center.
- **Unraid:** Docker is built in. Immich has a guide: [docs.immich.app/install/unraid](https://docs.immich.app/install/unraid).

## Opening a terminal on a NAS

The installer is a command you type. A NAS has no terminal on its screen, so you turn on **SSH** (a way to connect a
terminal from your own computer):

1. In the NAS settings, find **SSH** and switch it on:
   - **Synology:** Control Panel › Terminal & SNMP › Enable SSH service.
   - **Ugreen (UGOS):** Control Panel › Terminal (or SSH), then turn SSH on. Note the port, normally 22.
   - **QNAP:** Control Panel › Network & File Services › Telnet / SSH, then Allow SSH connection.
   - **Unraid:** Settings › Management Access › Use SSH.
   - Menu names change between software versions. If you can't find it, search the NAS settings for "SSH".
2. On your own computer, open a terminal and connect, using your NAS login and its address:

```bash
ssh yourname@192.168.1.20
```

   Not sure of the NAS's name or address? From your own computer, any of these will tell you:

```bash
arp -a
```

   lists every device on your network with its name and address (a device with no name shows as `?`).

```bash
dns-sd -B _smb._tcp local.
```

   (Mac) lists devices that share files, which includes most NASes, by name. Press Ctrl+C to stop it.

```bash
nslookup 192.168.1.20
```

   gives the name for an address you already know. Use the address from the list, or the name with `.local` after it
   (`ssh yourname@mynas.local`). The NAS must be switched on and on the same network as your computer. Your router's list of
   connected devices and the NAS's own settings show the name too.

3. You should now see a prompt on the NAS. Run the installer there. When you're done, you can switch SSH off again.

On a NAS, run the installer with `sudo` if it says it can't create folders, and choose folders on your data volume (it
suggests sensible ones). If your NAS has no SSH, or you'd rather not use it, install Immich with its own guide and then add
immichset from a **Project**, as in [Add immichset to your Immich](HAVE-IMMICH.md).

> NAS makers rename menus between versions. If a name doesn't match, search the NAS's help for "Docker" or "SSH".
