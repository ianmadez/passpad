# PassPad setup: for the person with the PS5

About 10 minutes, once. After that it's one double-click.

## What you need

- Your PS5, switched on, connected to your home network. A network cable to the router is best.
- A Windows 10 or 11 laptop on the same home network. It doesn't need to be a gaming laptop.
- Firefox is recommended, and any browser works.

## 1. Get PassPad

1. Download **passpad-windows.zip** from the Releases page your friend sends you.
2. Right-click it, choose **Extract All…**, then **Extract**.
3. Open the new folder and double-click **START-PassPad.cmd**.
   - If Windows says _"Windows protected your PC"_, click **More info**, then **Run anyway**. This
     appears because the file isn't from a big company. The setup checks every download against its
     published fingerprint before using it.

## 2. Answer the setup questions

The black window walks you through these steps:

1. **Tailscale** installs by itself. Click **Yes** if Windows asks for permission, then sign in
   with the invite your friend sent you.
2. **Your friends' addresses.** Each friend opens the Tailscale app and reads you their address
   (it starts with `100.`). Type one, press Enter, and press Enter on an empty line when you're
   done.
3. **The PS5** is found automatically. If it isn't, the window tells you where to find its
   address on the PS5.
4. **Firewall.** Windows asks for permission once. Click **Yes**.
5. **Pair the PS5.** A chiaki-ng window opens:
   - On the PS5: **Settings → System → Remote Play → Enable Remote Play**, then **Link Device**.
     The PS5 shows an 8-digit code.
   - In chiaki-ng: click your PS5, sign in to PSN when it asks, then type the code.
   - Close chiaki-ng when it says it's registered.
   - Tip: pair a **free second PSN account** so friends play on their own profile and saves.
6. Say **Y** to the desktop shortcut.

## 3. Play

1. Double-click **PassPad** on your desktop. Your browser opens the PassPad page.
2. Click **Connect PS5**. The picture appears within about 20 seconds.
3. When a friend wants to play, they press **Ask for the pad**. You hear a chime, then click
   **Pass to (name)**. A clock counts down their turn.
4. **Take the pad back** (or press `Esc` on the page) returns control instantly. Your own PS5
   controller works the whole time.
5. To stop, close the black window.

If something's off, run `START-PassPad.cmd doctor`. It checks everything and tells you what to fix
in plain words.

## Is it safe?

Friends get a live picture and a controller that only works while you allow it. Nothing is opened
to the internet, and nobody but the Tailscale addresses you typed in can connect. Your PSN password
never leaves your laptop. Close the black window and everything stops.
