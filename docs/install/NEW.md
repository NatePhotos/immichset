# Install everything (you don't have Immich yet)

This installs Immich and immichset together, in one folder, with one command. About 30 minutes, most of it waiting for
downloads. Read each step through before you do it.

> **On a NAS with only its Docker app and no terminal?** Use [Install everything from your NAS's Docker app](NO-TERMINAL.md) instead.

## 1. Pick the computer

Anything that stays on and meets the sizes in [Start here](../START-HERE.md#what-your-computer-needs): a small NAS
(Synology, Ugreen, QNAP, Unraid), a mini PC, an old laptop, or a Raspberry Pi 5 (8 GB). A Mac works for trying it out.

Before you go on, decide **where your photos will live**. Pick the biggest disk you have and plan to back it up. This
matters more than anything else in this guide: your photos live in a normal folder on that disk, and the installer will
ask you for it.

## 2. Install Docker

Docker runs everything. Follow the guide for your computer: [Docker](DOCKER.md). When you are done, this should print a
version number in a terminal:

```
docker compose version
```

> **You should now see** something like `Docker Compose version v2.x`. If it says "command not found", Docker isn't
> installed yet.

## 3. Open a terminal on that computer

A **terminal** is a window where you type commands. On a Mac or Linux laptop, open the Terminal app. On a NAS you
usually switch on **SSH** and connect from your own computer; [Docker](DOCKER.md#opening-a-terminal-on-a-nas) shows how.

## 4. Download and run the installer

Copy these two lines into the terminal, one at a time, pressing Enter after each:

```bash
curl -fsSLO https://raw.githubusercontent.com/NatePhotos/immichset/main/install/install.sh
```

```bash
sh install.sh
```

The first line downloads a small script (you can open `install.sh` in a text editor and read it first; it is short and
never deletes anything). The second runs it.

**To see what it would do without changing anything, run it with `--dry-run` first:**

```bash
sh install.sh --dry-run
```

It asks a few questions. Press **Enter** to accept the suggestion in brackets:

| It asks | What to answer |
|---|---|
| Install Immich too? | **y** |
| Install folder | Enter (it suggests a sensible place for your kind of computer) |
| Folder for your photos | **Your big disk.** Type the full path, such as `/volume1/photos/immich` |
| Folder for Immich's database | Enter, but it must be a disk **inside** the computer, never a network share (it refuses those) |
| Turn machine learning on? | Follow the recommendation. It turns it off for small computers. |
| A folder of photos that already exists | Optional. If you already have photos in a folder, give its path and Immich will show them without copying. |

Then it downloads Immich and immichset. The first time this takes a while. When it finishes it prints **two lines like these**:

```
Open this in your web browser:  http://192.168.1.20:3000/setup
Setup code:  K7Q2-M9XD-4RTB
```

> **These two lines are an example.** Your address and code will be different; they are made for your computer. **Use the
> ones on your own screen, not the ones above.** The address starts with your computer's number on your home network
> (often `192.168...` or `10...`). If it doesn't open, and you're on the same computer that's running it, try
> `http://localhost:3000/setup`.

> **If it stops with "Cannot continue"**, read the sentence after it. It tells you exactly what to fix (Docker missing,
> not enough memory, database on a network share), and nothing was changed. Fix it and run the same command again.
> Running it again is always safe.

## 5. Finish in your browser

Open that address in a web browser **on a computer on the same Wi-Fi**. Enter the setup code.

![The setup page asks for the code from the installer](../images/setup-01-code.jpg)

The page then asks who you are, and **creates your Immich account for you**, using the same email and password, so there
is only one to remember. You never copy an API key.

![The Immich step: it makes your account and keys, and says how to add photos](../images/setup-14-immich-ready.jpg)

If Immich is still starting (the first start takes a few minutes), the page says so and carries on by itself:

![Immich is starting for the first time](../images/setup-13-immich-starting.jpg)

The remaining steps (email, public address, extras) are explained in [the setup guide](../SETUP.md). You can skip email
and the public address for now and add them later.

> **You should now see** "You're all set". Press **Open the admin** and sign in.

## 6. What next

1. [Add photos and make your first gallery](../PHOTOS.md). This is the part that feels like it worked.
2. [Put it online](../ONLINE.md) so clients can open it from anywhere. Until then it works only on your Wi-Fi.
3. [Back it up](../BACKUPS.md).

## If you want to stop, start or remove it

Run these from the install folder. **None of them delete your photos.**

```bash
sh install.sh stop        # stop everything
sh install.sh start       # start it again
sh install.sh update      # get newer versions
sh install.sh uninstall   # stop and remove the containers; your folders stay
```
