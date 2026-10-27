# Dropbox downloads for videos

Videos play from your NAS, but a client's **download** button can send them to Dropbox's fast network instead of your home connection. Nothing is shared publicly. Each download asks Dropbox for a link that stops working after four hours, and the Dropbox copy is deleted some days after the gallery expires. The original always stays on your NAS.

## Set up once

1. Go to <https://www.dropbox.com/developers/apps> and choose **Create app**. Pick **Scoped access**, then **App folder**, and give it any name. The app can only see its own folder, never the rest of your Dropbox.
2. On the app's **Permissions** tab turn on `files.content.write` and `files.content.read`, then press **Submit**.
3. On the **Settings** tab, copy the **App key** and **App secret**.
4. On a computer with Node installed, run the helper and follow the two steps it prints. Give the full path to the file, or run the command from the project folder:

   ```bash
   node /full/path/to/immichset/dropbox/token.mjs YOUR_APP_KEY YOUR_APP_SECRET
   ```

5. In the admin panel open **Connections → Dropbox**, paste the key, secret and the refresh token it printed, press **Save**, then **Test Dropbox**.

## How it behaves

- Every ten minutes the server looks for new videos in published galleries and uploads each one to Dropbox, one at a time, in the background. Until a video's copy is ready its download comes from your NAS as before.
- A video taken out of a gallery loses its Dropbox copy. So does a gallery you delete.
- **Delete the Dropbox copy this many days after the gallery expires** (default 14) is set in the same place. A gallery with no expiry date keeps its copies until the gallery or video is removed. Set 0 to delete the day it expires.
- Photos are not affected, and **Download All** still builds its zip from your NAS.
