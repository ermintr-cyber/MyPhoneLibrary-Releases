# My Phone Library

Private phone collection software for Windows, with browser access on the host, LAN or Tailscale.

Download the Windows **EXE installer** from [Releases](https://github.com/ermintr-cyber/MyPhoneLibrary-Releases/releases/latest).

- One model row with individual units, IMEIs, colors, editions and photos.
- Drag column headers to reorder. Switch between List and Cards.
- Separate battery, charger and other catalogs with editable properties.
- Local backups, two configurable destinations, full database/photo restore.
- Password-protected network access on port 8091.
- Background launch without a CMD window. Restart/Stop in Settings > Maintenance.
- GitHub update checking, SHA-256 verified downloads, backup and staged application update.

The installer configures a named Windows Firewall rule for its stable pythonw.exe path,
TCP 8091, limited to LocalSubnet and Tailscale IPv4 (100.64.0.0/10). This requires Windows
administrator approval the first time. Later installs reuse a matching rule. No firewall
notifications are disabled. A custom port requires a corresponding firewall rule.

Data is stored in `%LOCALAPPDATA%\MyPhoneLibrary`, separately from application files.
This repository contains only program source and build definitions, never collection data.

## Build
Python 3.11+ and NSIS 3.09+. The release workflow builds the pinned Windows Python runtime,
launchers, EXE installer and update ZIP, runs tests and publishes a versioned release.
Before committing a release, bump VERSION in server.py. Existing published assets are not overwritten.

Run `python -m unittest discover -s tests -v` locally.
