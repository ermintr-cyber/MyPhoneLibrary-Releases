# MyPhoneLibrary 1.4.1 — update and restart fix

- Restart applies the verified pending package to the running program using its actual data folder, then launches that server directly with the same port and host.
- Launcher and CMD fallback forward custom data-folder arguments to the updater.
- Installing a newer EXE cannot be undone by an older staged update on the next launch.
- Download status and completion remain visible. Restart waits for the target version before reporting success; a timeout is shown instead of silently refreshing to the old version.
- Pending updates and update errors are visible when reopening Application updates.
- Tested HTTP staging and real process restart with preserved collection data, including the installed Windows pythonw runtime.

For installations still on 1.3.0 with the broken restart path: stop the server and install the 1.4.1 EXE once. Collection data remains in the existing data folder.
