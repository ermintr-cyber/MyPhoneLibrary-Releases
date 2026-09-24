# MyPhoneLibrary 1.4.0

- Compact expanded unit rows, smaller photo thumbnails and less vertical spacing.
- Delete collection entries permanently from Trash. Historical audit records and existing backups remain available.
- Trash releases inventory numbers, including numbers retained by earlier versions. Restore reuses an available previous number or assigns a new unique number.
- Accurate English labels: Brand, Model name, Model number / Variant, Type code and per-unit Product code. Leading zeroes are preserved.
- Delete items from every catalog. Linked records keep their text; deleted catalog links and specifications are removed after confirmation. Deleted items are not recreated automatically.
- Close a catalog item to return to its catalog; close the catalog to return to Settings / Catalogs.
- Green successful network checks and red unsuccessful checks.
- Navigate from Settings and catalogs through the collection sidebar, with a warning for unsaved edits.
- Add phone drafts retain fields and uploaded photo references while visiting catalogs. Reopening Add phone resumes the draft and refreshes catalog choices. Clear data discards it after confirmation. Drafts last for the current browser page session; closing or reloading warns about unsaved work.

Validation: 33 Python tests and Node interface behavior checks. The Windows release workflow also verifies the installed background server, two installer runs preserving collection data and a single firewall rule.
