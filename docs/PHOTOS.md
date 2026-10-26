# Photos, albums and your first gallery

## The two ideas

- An **album** is a named collection of photos **in Immich**. (Like a folder, but a photo can be in several albums.)
- A **gallery** is what your client opens. Each gallery shows one album (or a few, as "parts" like Ceremony and Party).

So the order is: photos go into Immich, you put them in an album, and you make a gallery from the album.

## Getting photos into Immich

Any one of these works. Use whichever you like; they can be mixed.

1. **From the immichset admin** (easiest). If you chose to let the admin add photos during setup: **New gallery › Start a new
   album and upload**. It makes the album and uploads the pictures in one go.
2. **Immich in your browser.** Open Immich (for example `http://192.168.1.20:2283`), drag photos in, select them, and choose
   **Add to album** (make a new one with a name you'll recognise).
3. **The Immich phone app.** Install it, sign in with your Immich address, and turn on backup. Good for photos you take on the phone.
4. **A folder that already exists** (hundreds of photos on a disk). Immich can read it in place without copying: **Administration ›
   External Libraries › Create library**, enter the folder path, and **Scan**. If you gave the installer a folder when it asked, this is done.

Immich takes a little while after an upload to make the small preview pictures. If a thumbnail is blank at first, wait a
minute and it fills in.

## Make your first gallery

In the admin, press **New gallery**.

![Creating a gallery from an Immich album](images/admin-04-new-gallery.jpg)

1. **Photos:** pick the album. (No albums listed? Your Immich has none yet. Go back to the list above.)
2. **Title** and **Date:** what clients see on the cover. The web address fills itself in from the title.
3. **Ask visitors for their email:** turn this on if you want to know who opened it (and collect addresses for later).
4. **Allow downloads:** lets clients save full-size photos.
5. **Password:** optional. Email and password are independent: use either, both, or neither.
6. **Publish now:** leave on. A draft returns "not found" to anyone with the link.

Press **Create gallery**. You land on the gallery's photos:

![The gallery's photos](images/admin-05-gallery.jpg)

**Preview** shows what a client sees. **Copy link** copies the web address. **Copy message** copies a ready-to-send note with
the link, a reminder that there is a password if you set one, and the date it ends.

## Sharing it

Send the link by message or email. Clients open it, optionally leave an email or enter the password, and can browse, mark
favourites, run a slideshow and download. You see who registered and what they downloaded under the gallery's **Activity** tab.

![What a client sees](images/client-01-cover.jpg)

Until you've [put it online](ONLINE.md), the link only works on your home Wi-Fi.

## A good habit

Open your own link on your phone **on mobile data** (Wi-Fi off) before you send it to a client. If it loads, so will theirs.
