# MyPhoneLibrary 1.7.1

Both backup Browse buttons now open the modern Windows Explorer folder picker, matching the folder-selection style used by MyMediaLibrary: address bar, search, navigation shortcuts, folder list and Select Folder button. The existing location is selected initially. Cancel leaves the configured path unchanged.

Uses IFileOpenDialog in folder mode instead of the legacy SHBrowseForFolder tree. Windows controls the dialog's theme. Retains the independent picker process and the one-click Windows updater from 1.7.0.

Validation: Windows test checks the actual dialog contains modern Explorer controls and closes cleanly on Cancel; regression and installer/update smoke tests also run.
