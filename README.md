# DVRKO Ballistic Solver (web app)

A basic long-range ballistic calculator that runs entirely in your phone or computer's browser. It includes live reticle
imaging with hold points, DOPE tables, and an optional live link to a WMLRF rangefinder over Bluetooth. Nothing is sent
anywhere: your rifles, settings and readings are stored only in your own browser.

**Open it:** https://libertyorlofi.github.io/DVRKO-BALLISTIC-SOLVER-/

This is a prototype for a scope-mounted DIY device. Always confirm its numbers against real-world shooting before relying
on it.

## Which browser to use

| Device | Browser | Rangefinder link |
| --- | --- | --- |
| iPhone / iPad | **Bluefy** (free in the App Store) | Yes |
| iPhone / iPad | Safari | No (Safari has no Web Bluetooth). Type the range by hand |
| Android | Chrome | Yes |
| Windows / Mac / Linux | Chrome or Edge | Yes |

## iPhone: put it on the home screen (with Bluetooth)

Safari's "Add to Home Screen" works, but that version cannot use Bluetooth. To get an icon that opens in Bluefy:

1. Install **Bluefy** from the App Store and open the app link above in it once, while you have signal.
2. Open the **Shortcuts** app and tap **+** to make a new shortcut.
3. Add the action **Open URLs** and paste this link exactly (plain, not encoded):

   ```
   bluefy://open?url=https://libertyorlofi.github.io/DVRKO-BALLISTIC-SOLVER-/
   ```
4. Tap the play button to test. Bluefy should open the solver.
5. Rename the shortcut (for example "Ballistic"), tap the share icon, then **Add to Home Screen**.

## Android and computers

- **Android (Chrome):** open the link, tap the three dots, then **Add to Home screen** or **Install app**.
- **Windows / Mac (Chrome or Edge):** open the link and click the install icon in the address bar, or the three dots,
  then **Install** / **Save and share > Install page as app**. It then runs in its own window and works offline.

## Connecting the rangefinder

1. Turn the rangefinder on and make sure no other phone or app is connected to it.
2. In the app, open **Conditions** and tap **Connect rangefinder**.
3. Pick the device (it shows as `EE090103`) and take a reading. The range box turns green and the solution updates.
4. The rangefinder's angle is off by default because its units are not confirmed yet. Tick **Use rangefinder angle** to
   try it.
5. **Download readings** saves every reading (range, angle, raw packet) as a CSV, which helps with testing.

If you leave the app, iOS may pause it. Check that the status says **Connected** before the next shot, and tap Connect
again if it does not.

## Your rifles

The app starts with one generic starter rifle. Add your own on the **Rifles** tab, or import rifle `.json` files from the
desktop Ballistic Solver's `rifles` folder (Rifles tab, **Import files**). **Export** saves a backup. Each load has a
**Zero offset**: how many inches that load lands above (+) or below (−) your point of aim at your zero distance. Every dial
value and reticle hold shifts to match.

Rifle data stays on the device. Clearing a site's data in the browser deletes it, so export a backup first.

## Offline use

After one visit with signal, the app keeps working without internet. Android and desktop browsers install a full offline
copy. In Bluefy, the page reloaded offline in testing and the Bluetooth link works without internet, but keep the app open
in the foreground while shooting. The **Conditions** panel shows which version you have and whether offline mode is
available.

## Updates

New versions download automatically when you open the app with signal. After an update, close and reopen the app twice
to switch to the new version. The version number is shown in **Conditions**.

## Other features

- **Stage tab:** keep a list of targets (range, angle, wind, clock) and see every solution at once, as cards you swipe or as
  a list. The same list is used for every rifle.
- **Import ChairGun:** on the Rifles tab, import a ChairGun Elite export (the emailed `.eml`, or its text saved as `.txt`).
- **BC by speed:** loads can use Sierra-style stepped BCs, entered as `fps:BC` pairs such as `2850:0.595, 2400:0.58, 0:0.55`.
- **Reticle range labels:** the red range numbers sit on whole-MIL lines (or every 4th MOA) so they stay readable.

## Reticles included

MIL Tree (custom), Red dot circle + BDC dots, MOA Ladder + BDC (generic), Vortex EBR-7C MRAD, and ACSS Aurora MIL. The
EBR-7C and Aurora were measured from the makers' published diagrams, with a few small details estimated. They are not
official products of Vortex or Primary Arms.
