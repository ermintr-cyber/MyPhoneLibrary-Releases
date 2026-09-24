# MyPhoneLibrary 1.6.1

- Catalog field headings open their category directly; Return to phone retains form values and photos.
- Model/list image upload is separate from physical-unit photos. Unit photos no longer silently substitute for the model image in list/cards.
- Native Windows shell folder picker replaces the hidden PowerShell dialog. A new Browse request replaces an old pending picker; stop/restart cancels it.
- HTTP connections close after responses so idle browser connections do not delay server restart. Restart verification checks the server instance as well as the installed version.
- Every 10 seconds and when the tab regains focus, check server availability and active version. Reload stale interfaces automatically only when there is no unsaved work. Otherwise show a persistent reload notice. Offline means disconnected, not offline editing support.

Validation: Python and Node regression suites, actual Windows shell dialog open/cancel test, Windows installer and update/restart smoke checks. Live GSMArena import remains awaiting user confirmation.
