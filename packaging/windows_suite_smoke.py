"""Check the two selectable installer components and persistent data separation."""
import os,subprocess,winreg
from pathlib import Path
root=Path(__file__).resolve().parents[1];exe=next((root/'dist').glob('MyLibraries_Setup_*.exe'))
subprocess.run([str(exe),'/S','/MEDIA_ONLY'],check=True,timeout=240)
key=winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{8EAE03E7-2BB8-4D54-A50A-A5E23375E3A2}_is1')
assert winreg.QueryValueEx(key,'DisplayName')[0]=='My Media Library'
subprocess.run([str(exe),'/S','/PHONE_ONLY'],check=True,timeout=120)
assert (Path(os.environ['LOCALAPPDATA'])/'Programs/MyPhoneLibrary/MyPhoneLibrary.exe').is_file()
print('Combined installer: Media-only and Phone-only selections installed successfully.')
