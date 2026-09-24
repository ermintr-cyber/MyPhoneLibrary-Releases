"""Fetch the pinned, published Media installer; never package unchecked downloads."""
import hashlib,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1];folder=root/'bundle';folder.mkdir(exist_ok=True)
url='https://github.com/ermintr-cyber/MyMediaLibrary-Releases/releases/download/v3.23.2/MyMediaLibrary_Setup_3.23.2.exe'
target=folder/'media.exe'
with urllib.request.urlopen(url,timeout=120) as source,target.open('wb') as out:
 while block:=source.read(1024*1024):out.write(block)
assert hashlib.sha256(target.read_bytes()).hexdigest()=='3f97b2db7ab1ad839fe663713c3432c7710c4e9dce349aa63928fbbffcf89e5b','Media installer checksum mismatch'
print('Verified MyMediaLibrary 3.23.2 installer for the combined package.')
