# When something doesn't work

Find your symptom. Terminal commands are run in the install folder.

## Basics

First, see what's running:

```bash
sh install.sh status
```

(or `docker compose ps`). Look at recent messages from a service:

```bash
docker compose logs --tail 50 immichset
```

## The setup page won't open

- Use the address the installer printed, which is different on every computer (for example `http://192.168.1.20:3000/setup`), from a device on the same Wi-Fi.
- `localhost` only works on the same computer that runs it.
- The **setup code** is in the log (`docker compose logs immichset`).
- Behind a tunnel? Setup refuses the internet by design. Finish it from home.

## "Immich is starting" never finishes

The first start downloads and prepares a lot. Give it 5–10 minutes. Then check `docker compose logs immich-server`. Low memory is the
usual cause: Immich wants 6 GB (8 GB recommended).

## "Couldn't connect to Immich"

- Check the address has no typo and includes `http://` and the port (`:2283`).
- If you use Docker on the same computer, `localhost` points at the container itself. Use the computer's address or `http://immich-server:2283` if they share a network.

## Photos are blank or slow

Immich is still making previews after an upload. Wait; busy times are slower. Machine learning (smart search) is heavy and
off by default on small machines.

## Clients can't open the link

- Is it online ([Reaching your galleries from anywhere](ONLINE.md))? Test on your phone with Wi-Fi off.
- Does the **Public address** in Connections match the one you're sharing?
- Is the gallery published?

## No email arrives

See [Email](EMAIL.md#if-the-test-email-doesnt-arrive).

## I can't sign in to the admin

Sign-in uses an emailed code, so check the address you gave during setup (and spam). If email is broken, set your own sign-in
details again by recreating setup: stop immichset, move `/data/immichset.json` aside (don't delete it), start it, and run
the setup page again with the new code from the log.

## Still stuck

Open an issue at github.com/NatePhotos/immichset/issues. Include what you did, what you expected, and the last 30 lines of the log.
Remove passwords and tokens first.
