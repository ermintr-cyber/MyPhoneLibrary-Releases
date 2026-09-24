# MyPhoneLibrary 1.6.0

- Backup Browse opens the native Windows folder selector directly on the host computer. No intermediate web folder dialog. Cancel preserves the current path.
- Escape follows Close behavior for phone editors, settings and catalogs, retaining new-phone drafts and guarding unsaved edits.
- Catalogs shortcut above Inventory check in the sidebar.
- Phone and part prices are labelled KM without a separate currency field. Previously entered foreign-currency amounts retain their original label and value.
- Restart keeps a visible reconnecting screen, confirms the target version, and displays an initial loading screen after reload. Timeout remains visible with retry and close actions.
- GSMArena parsing supports nested markup, spaced attributes and alternate model headings. Challenge pages return a specific error; live import still requires confirmation on the user's host.

Validation: Python regression suite, Node interface behavior checks and Windows release workflow. Native folder dialog appearance requires an interactive Windows check.
