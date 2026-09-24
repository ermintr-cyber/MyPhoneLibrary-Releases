# MyPhoneLibrary 1.5.0

- Prefer port 9000. If occupied, use 8091; explicit custom ports remain supported. Existing launch arguments using 8091 migrate automatically. The old 8091 address redirects to 9000 when available, including compatibility with the 1.4.1 update restart check.
- Windows uses exclusive port binding, so another application is not displaced. Network access to a new port may require one Windows elevation; subsequent launches reuse the matching rule.
- Close Add phone by clicking outside its dialog; retain the same draft as Close.
- Move the expand arrow before the model image, at the start of the table. The image column stays first; remaining columns can be reordered.
- Delete catalog entries directly from each list row, with confirmation and the existing warning for linked records.
- Put update checking, download, status and restart directly in Settings / About.
- Replace the native backup folder chooser with an authenticated in-app host-folder browser for both backup locations. Settings inputs remain intact during folder selection.
- Normalize valid GSMArena HTTPS model links and handle known GSMArena redirects. Continue rejecting external redirects and private addresses. Upstream availability and blocking remain outside the app's control.
- Remove Type code from the individual unit form; retain it at model level. Remove Originality from the form. Existing stored values are retained.
- New ownership choices: In collection and Wanted. Wanted units appear in Wishlist and are excluded from owned counts and inventory checks. Previously stored legacy statuses are preserved rather than silently changed.
- Default new monetary entries to KM, with no other new currency choices. Existing nonzero amounts in another currency retain their original currency; no exchange-rate conversion is performed.

Validation: 42 Python tests; interface behavior tests; Windows installer and background runtime tests; real HTTP update/restart; Windows 9000 migration, occupied-port fallback and host-folder listing.
