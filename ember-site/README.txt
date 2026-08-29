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

1. IMAGE RESOLUTION. The product plates are 1260–1848px sources. Act V, the
   flavour cards and the small breakpoints are all served at true 2x for
   retina. The one plate that is not is Act III's full-bleed first look:
   at a 1512px viewport it fills the width from a 1544px source, so it is
   roughly 1x on a retina display and will read soft there.
   4K upscales of all four plates were generated and are waiting in the
   Higgsfield account — they could not be downloaded into the build
   environment. Fetch them, crop to the same framing as the file they
   replace, check the edges for baked-in layout text, export WebP q92, and
   drop them in under the same filenames. Then regenerate the responsive
   variants and widen .a5-stage past its current 924px cap.

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
