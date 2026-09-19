# Test protocol

The question: can a phone replace the POS terminal on a keke, and is a tap fast enough for a queue?
Run these on at least one mid-range Android phone and one iPhone, and ideally a low-end Android
like the ones drivers actually carry.

## What the app measures by itself

| Figure | Meaning |
|---|---|
| **Card read to result** (Android) | From the moment Chrome reports the card to the moment the result screen is painted. Covers the signature check, the balance update and drawing the screen. |
| **Link opened to result** (iPhone) | From the moment Safari starts opening the tapped link to the result being painted. Covers page start-up, the check and drawing. |
| **Between taps** | Time from one logged tap to the next: your throughput. Gaps over a minute are ignored. |
| **Rapid tap test** (Android) | 20 seconds of tapping one card on and off. Shows the fastest back-to-back reading the phone can do. |

No web page can see the moment the card first touches the phone, or (on iPhone) how long the
passenger takes to tap the notification. Film those.

## Slow-motion video (touch to result)

1. Use a **second phone** to film. On iPhone, background NFC reading stops while the camera is
   open, so the terminal phone can't film itself.
2. Set the second phone to slow motion, 240 fps if possible (one frame ≈ 4.2 ms; at 120 fps ≈ 8.3 ms).
3. Frame the terminal screen and the card together, with good light.
4. For each tap, step through the video frame by frame and note:
   - **A**, the first frame the card touches the phone;
   - **B**, the first frame the result colour (green / red / amber) appears;
   - on iPhone also **N**, the frame the notification appears, and **T**, the frame it is tapped.
5. Touch to result = (B − A) ÷ fps. On iPhone, split it into touch to notification (N − A),
   the passenger's reaction (T − N), and notification to result (B − T).

## Runs

Do each run with a **Quick token** card and a **Secure link** card. Clear the log before each run
(**Results → Clear log**) and export the CSV after it. Set a clear **terminal name** in Settings.

1. **Single taps, 20 per card type.** Tap, wait for the result, press Done, repeat. Normal grip.
2. **Queue.** Five to ten people walk up and tap one after another, like boarding a keke.
   Set **Return to Tap Card after** to 2 seconds so nobody has to press Done. Note how many tries
   the first tap took per person.
3. **Rapid tap test** (Android): three runs of 20 seconds.
4. **Awkward conditions:** phone in its usual case; card inside a wallet or sleeve; bright sun;
   battery saver on; mobile data and Wi-Fi off (the app still works, because everything is on the
   phone).
5. **Security checks:** replay an old secure link (open an old tab, or use the simulator's replay),
   copy a quick-token link onto a second card, try an unregistered card. All three must be refused.

## What to write down

For every run: phone model, Android or iOS version, browser, card type, case on or off, place,
number of taps, first-tap success count, and the app's median and 90% figures. Attach the CSV and
the video notes.

## Reading the results

Useful questions for the go / no-go decision:

- **Speed:** is the median touch-to-result on Android comfortably under a second? Where does the
  time go: reading the card, or drawing the screen?
- **Reliability:** what share of passengers succeed on the first tap?
- **Throughput:** passengers a minute in the queue run, compared with cash and the POS terminal.
- **iPhone:** is two touches and a new tab acceptable for a conductor, or should iPhone drivers
  use a small native app instead? (A native app can read cards in one touch.)
- **Cost:** a phone the driver already owns against ₦189,000 per terminal.
