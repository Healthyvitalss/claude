EMBER — Coming Soon / Early Access landing page
Healthy Vitalss

HOW TO USE
1. Upload this whole folder (index.html + the assets folder) to your host.
   Keep index.html and assets/ together — the paths are relative.
2. Open index.html. That's the page.

WHY THE VIDEO SOMETIMES NEEDS A CLICK
Browsers block autoplay unless a video is muted, and some block it entirely
until you interact with the page. This video is muted and set to loop, and the
page retries play on load, on canplay, and on the first click, tap, key press
or scroll. Opening the file straight from your Downloads folder (a file:// URL)
is the strictest case — served from a real domain it autoplays.
There is a mute button in the header if you want sound.

Through the first viewport the video's playhead is tied to scroll position, so
the opening moves under the reader's own hand. Past that first screen it
returns to a free-running loop. Under prefers-reduced-motion it holds the
poster frame and never plays.


HOOKING UP THE FORM  (this is the one thing you must do before launch)
The Reserve form posts JSON to a single endpoint. Set it before the script
runs — anywhere above the closing </body>, or from your tag manager:

    <script>window.RESERVE_ENDPOINT = 'https://your-endpoint.example/subscribe';</script>

Point it at Klaviyo, Mailchimp, ConvertKit, Shopify, or your own proxy.
(Prefer a small server-side proxy: it keeps the provider's API key off the
page, where anyone can read it.)

It receives:

    { "kind": "email", "email": "...",              "source": "reserve" }
    { "kind": "sms",   "phone": "...", "email":"...","source": "reserve" }

Any non-2xx response, or no response at all, is treated as a failure — the
record goes into localStorage under "ember.reserve.queue" and is retried on
the next page load and whenever the browser comes back online. An address is
never lost to a flaky connection, and the reader is told their place is saved
rather than being shown a dead end.

While RESERVE_ENDPOINT is unset the page runs in demo mode: it still
validates, still advances, and still queues locally, so a preview never
silently drops an address.

Error states are real messages now, not just the shake — empty field,
malformed address, and too-short number each say what is wrong.


ANALYTICS
Events are pushed to window.dataLayer and to gtag() when either is present,
and kept in window.EMBER_EVENTS for debugging. Nothing is sent anywhere on
its own — wire your own tag manager.

  act_view            once per act (act1…act7) — scroll depth per act
  reserve_cta         a CTA was clicked; {from: "bar" | "nav" | "act1"}
                      — this is how you separate persistent-bar clicks from
                        the in-page Act VII conversions
  reserve_step        the form advanced; {step: 1|2|3}
  reserve_sent        a record reached the endpoint
  reserve_queued      a record was queued after a network failure
  reserve_sms_skipped the SMS step was skipped

Drop-off between email and SMS is reserve_step{2} vs reserve_step{3} plus
reserve_sms_skipped.


EDITING
- Colours: the :root block at the top of the <style> tag.
- Copy: search for the text you want to change, it's all plain HTML.
- Images: drop replacements into assets/ using the same filenames.
  Each product plate also has -480/-768/-1080 variants wired into srcset;
  regenerate those too, or the small screens will keep serving the old crop.


KNOWN GAPS — what still needs doing before this is finished

1. IMAGE RESOLUTION — one command fixes this.

       cd ember-site
       bash install-upscales.sh

   The three full-bleed plates (Act V's colonnade pool, Act III's first look,
   and the city-scale break) ship from 1536px sources but fill a 1452–1512px
   box, so a retina screen asks for roughly twice the pixels they have. They
   look correct on an ordinary 1080p monitor and soft on a MacBook.

   They have been re-rendered at 4096px and are sitting on Higgsfield's CDN.
   This build environment's egress proxy cannot reach that host, so the files
   could not be pulled in here — your machine can. The script downloads all
   three, crops each to the aspect the page already lays out, encodes WebP,
   regenerates the 480/768/1080 variants, and rewrites the srcset width
   descriptors to match. Needs curl and Pillow (pip install pillow).

   Measured against a plain Lanczos enlargement of the same source:

       ember-hero    4096x2560    3.11x detail    clipping +0.17%
       dual-sunset   4096x2737    2.06x detail    clipping -0.13%
       city-scale    4096x2304    5.10x detail    clipping -0.47%

   Two of the three clip LESS than a plain resize. That is the difference
   between reconstructing detail and simply sharpening — a sharpened image
   spikes its clipped-pixel count, and these do not.

   The flavour cards were deliberately NOT upscaled: they display at 478px
   from 819px sources, so a 2x screen needs only 1.17x more. Not worth the
   credits or the extra page weight.

   Credits spent: 6 of a 25 cap (3 upscales at 2 each).

2. VIDEO. Still H.264 MP4. Converting to AV1/WebM with an H.264 fallback is
   the biggest remaining weight saving. The scroll-scrub also only lands on
   the nearest keyframe in this encode — a keyframe-dense (frame-seekable)
   re-encode is what makes the scrub exact rather than approximate.

3. SOUND. The mute control still only mutes. The low room tone that rises
   through Act II and resolves at the Act V reveal is not built.

4. FONTS. Bebas Neue and DM Sans load from Google Fonts. If that request
   fails the page falls back to Impact/system sans and the typography
   changes character completely. Self-hosting both faces would remove that
   dependency.

5. INGREDIENT FIGURES. 6G citrulline · 3.2G beta-alanine · 200MG caffeine ·
   30 servings are read off the supplied packaging artwork. Confirm them
   against the real formula before launch. If any figure is not final,
   remove it rather than guess — the page's whole argument is that every
   dose is disclosed and accurate.

NOT YET AVAILABLE FOR SALE.
