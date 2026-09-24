# MyPhoneLibrary 1.7.0

GitHub updates now use the MyMediaLibrary lifecycle: one Update action starts an independent worker outside the installation directory, downloads the official EXE, verifies its published SHA-256 and size, creates a collection backup, stops the server, runs the silent Windows installer, starts the new server and verifies its version and process identity. No separate stage/restart step is needed for subsequent GitHub updates.

The worker uses its own copied Python runtime so the installer can replace application files without locking its runtime. Job status survives server restarts. The browser shows download percentage and installation/reconnection phases, then reloads automatically only after verified completion. Failure messages remain visible. Manual ZIP update remains available separately.

Ordinary page refresh no longer uses the full-screen update loader. This release introduces the new updater; the transition from 1.6.x still uses the previously installed updater (or this EXE). Future updates run through the new workflow.

Validation includes actual Windows independent-process -> silent EXE installer -> new server tests, data/photo preservation, backup verification, corrupted downloads, failed installation, busy-server refusal, and browser polling across server outages. Live GSMArena import remains unconfirmed.
