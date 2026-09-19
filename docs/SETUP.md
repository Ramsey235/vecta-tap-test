# Setup guide

## 1. Put the app online (HTTPS)

Phones only allow NFC on secure `https://` pages, so the app must be hosted. Any static host works
(GitHub Pages, Netlify, Cloudflare Pages, Vercel). The app works from a sub-folder too.

**GitHub Pages, from VS Code on Windows**

1. Create a new repository on github.com, for example `vecta-tap-test` (public, or private on a paid plan).
2. In VS Code, open the `vecta-tap-test` folder, open the Source Control panel, choose
   **Publish to GitHub**, and pick the repository.
3. On github.com open the repository → **Settings → Pages**. Under *Build and deployment* choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`, and **Save**.
4. After a minute the address appears at the top of that page, like
   `https://your-name.github.io/vecta-tap-test/`. That is the terminal address.

**Updating later:** change `VERSION` in `sw.js` (for example to `vecta-tap-v1.0.1`) every time you
upload changed files, otherwise phones keep the old copy. Then close and reopen the app.

> Why not Live Server? It serves `http://` over your Wi-Fi, which phones don't count as secure,
> so NFC stays off. Use it only for layout work, with the tap simulator turned on.

## 2. Android terminal

1. Turn on NFC: **Settings → Connected devices → Connection preferences → NFC** (the path differs a
   little between brands).
2. Open the address in **Chrome**. Tap **Open terminal**. The first time, Chrome asks to allow NFC:
   allow it.
3. Optional: Chrome menu → **Add to Home screen** or **Install app**.
4. Find the phone's NFC spot: usually the middle or top of the back. Move a card slowly over the
   back until the terminal reacts, and use that spot for every test.

If you once blocked NFC: tap the icon left of the address → **Permissions → NFC → Allow**.

## 3. iPhone terminal

1. iPhone XS or newer. Background tag reading needs the screen on and unlocked, and it pauses
   while the **camera** is open, in **airplane mode**, or while **Apple Pay Wallet** is open.
2. Open the address in a **Safari tab** and keep the terminal there. Don't use a home-screen copy
   for the terminal: card taps always open in Safari, which keeps separate data.
3. Tap **Open terminal**. Hold the card at the top edge of the phone (near the camera), then tap
   the notification. Each tap opens a new tab showing the result.
4. Close old tabs now and then (Safari tab switcher → long-press **Done** → **Close all tabs**).
5. Taps keep charging for 30 minutes after the terminal was last used. With the terminal closed,
   a tap only shows a **Card check** page and charges nothing.

## 4. Prepare test cards

### A. Quick token (easiest)

- **On Android:** Admin → **Add test card** → name and balance → **Quick token** → **Continue** →
  hold the card on the phone until **Card ready**. The app reads and writes the card in one touch.
- **On iPhone:** the same steps give you a link (for example `https://…/?t=K7M2Q9XW4B8C`). Write it
  onto the card as a **URL / Link** record with NXP TagWriter or any NFC writer app. Don't add a
  title: a titled link is a smart poster, which iPhone ignores.

### B. Secure link, SUN (what production would use)

The NTAG 424 DNA can change part of its link on every tap: it encrypts its chip ID and tap
counter, and signs the link with AES-CMAC. The app checks that signature and refuses old counters.

1. In the app open **Admin → Settings → Secure cards (SUN)**. Copy the **Link to put on the
   cards**. It looks like
   `https://your-name.github.io/vecta-tap-test/?picc_data=000…000&cmac=0000000000000000`.
   The zeros mark where the card writes its data.
2. Install **NXP TagWriter** (Android or iPhone). Create a new **Link / URL** dataset with that link.
3. Turn on the SUN / Secure Dynamic Messaging option for NTAG 424 DNA and choose:
   - **encrypted PICC data** (chip ID and counter), placed at the first run of zeros (32 characters);
   - **SUN MAC / CMAC**, placed at the second run of zeros (16 characters);
   - keys left at the factory default for the first test.
   Menu names differ between TagWriter versions. If a tool asks for byte offsets instead, Settings
   lists them for your exact address (**PICC data offset**, **SDM MAC offset**, **SDM MAC input offset**).
4. Write the card. In the app, **Admin → Inspect a card** (Android) and tap it: you should see
   **Secure link: Verified**, the chip ID and a counter that rises with every tap.
5. Register it: **Add test card → Secure link (SUN) → Continue** and tap the card.
   On iPhone, the card is added in the Safari tab that opens.

If Inspect says **Not verified**: check the parameter names in Settings match the link on the card
(`picc_data` and `cmac` by default), and that the keys match. The app also accepts a card set to
mirror the chip ID and counter in plain text with a signature, and several MAC input layouts; it
remembers which one your cards use.

### C. Changing keys (before any pilot)

With all-zero keys anyone can create a valid tap. Before real passengers use the cards, set new
**SDM meta read** and **SDM file read** keys on each card with TagWriter or NXP's tools, record them
safely, and enter the same values in **Settings**.

## 5. Try it without cards

**Admin → Settings → Show tap simulator** adds a panel to the terminal that fakes taps from your
test cards, an unregistered card, an unreadable tap, a forged secure tap and a replayed one.
Simulated taps are kept out of the results unless you include them.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Needs an https:// address" | Open the hosted address, not a file or `http://` link. |
| Android: nothing happens on tap | NFC on? Terminal open? Try the other parts of the back of the phone. Thick or metal cases block NFC. |
| "Chrome is blocking NFC" | Icon left of the address → Permissions → NFC → Allow. |
| "The card moved before writing finished" | Hold still for a full second; write again. |
| "The card refused the write" | The card is locked or already set up for SUN. Use a fresh card or register it as Secure link. |
| iPhone: no notification | Screen on and unlocked, camera closed, not in airplane mode. Card at the top edge. The link must be the first record. |
| iPhone: "Card not registered" but it is | The card was added in another browser or in the home-screen app. Use the same Safari. |
| "This tap was already used" | A secure link was opened twice (for example an old tab). Tap the card again. |
| Old version still showing | Change `VERSION` in `sw.js`, upload, close and reopen the app. |
