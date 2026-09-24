# Independent Android and Windows updates

The old Android client loaded the Windows server's HTML, JavaScript and CSS.
Updating Windows therefore also changed Android's interface without installing an APK.

Android now bundles `web/` in its own APK. Only the listed packaged files are intercepted
under the configured LAN/Tailscale origin; API requests, photographs and downloads still
use the Windows server. Cookies and collection storage remain on their existing origins.
Changing Windows does not replace the packaged interface or force Android into a reload loop.

## Versions and release channels

| Target | Version source | Release channel |
| --- | --- | --- |
| Windows server and browser UI | `server.py`, `web/app.js` | Existing `vX.Y.Z` releases in MyPhoneLibrary-Releases |
| Android app and packaged UI | `android/VERSION`, increasing `android/VERSION_CODE` | `phone-android-vX.Y.Z` releases in MyMediaLibrary-Releases |

The Android signing secrets stay in the private MyMediaLibrary repository. Its
**MyPhoneLibrary Android release** workflow accepts a Phone commit/branch and a separate
publish flag. It builds only the Phone APK; it does not install or release Windows or Media.
The initial migration requires Windows 1.16.0 and the separately installed Android 1.16.0 APK.
Old 1.15.0 APKs cannot gain packaged assets through a Windows update.

Android About shows the installed APK, bundled interface and Windows server versions
separately. Its update button reads `update-phone-android.json`; Windows installers and
manual Windows ZIP controls are absent from this screen. Older servers show an explicit
server-upgrade message instead of reporting a Windows result as an Android update.

## Android behavior

- Keep the native wrapper free of SwipeRefreshLayout, so dragging a nested Settings panel
  toward its top does not refresh the page.
- Consume native system-bar, cutout and keyboard insets before laying out the WebView.
- Match Media's current compact Settings: wrapping category buttons, two theme columns,
  44 px controls, flat content area and reachable Save above the five-button navigation.
- Keep all existing phone-specific fields and collection workflows.

## Validation

Run Python unittest discovery, `node tests/ui.test.cjs`, `node tests/ui-workflows.test.cjs`,
`node tests/ui-android.test.cjs`, and `node tests/ui-form.test.cjs` with Edge or
`MPL_TEST_BROWSER` pointing to Chromium. The Android CI builds the real APK and uses an
emulator plus disposable server data to check scrolling, Save visibility, independent
versions, reload after a Windows change, and remembered login after a process restart.

Future backend releases must preserve APIs used by installed Android versions. No user
database, photographs, sessions or signing keys belong in a source commit.
