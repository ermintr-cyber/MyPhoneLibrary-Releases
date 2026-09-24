"""Build reproducible manifest and Windows ZIP; optionally acquire pinned runtime."""
import argparse,hashlib,json,os,re,urllib.request,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--runtime',action='store_true');parser.add_argument('--repo',default='');args=parser.parse_args()
version=re.search(r"VERSION = '([^']+)'",(root/'server.py').read_text(encoding='utf-8')).group(1)
if args.runtime and not (root/'runtime/python.exe').exists():
    payload=urllib.request.urlopen('https://www.python.org/ftp/python/3.13.15/python-3.13.15-embed-amd64.zip',timeout=90).read()
    if hashlib.sha256(payload).hexdigest()!='d1f04d990aee1253d8569e8e5104e30fa9f5fa830899f14843448872d936a2cf':raise ValueError('Runtime checksum mismatch')
    import io
    with zipfile.ZipFile(io.BytesIO(payload)) as z:z.extractall(root/'runtime')
if args.repo:
    import sys
    sys.path.insert(0,str(root));from updater import repository
    repo=repository(args.repo)
    p=root/'server.py';s=p.read_text(encoding='utf-8');s=re.sub(r"'update_repo':'[^']*'", "'update_repo':"+repr(repo),s);p.write_text(s,encoding='utf-8')
files=['battery_catalog.py','data/nokia-batteries.json','server.py','updater.py','Pokreni-MyPhoneLibrary.cmd','PROCITAJ-ME.md']
files += [p.relative_to(root).as_posix() for p in sorted((root/'web').iterdir()) if p.is_file()]
manifest={'product':'MyPhoneLibrary','version':version,'schema':1,'files':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in files}}
(root/'app-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
dist=root/'dist';dist.mkdir(exist_ok=True);target=dist/f'MyPhoneLibrary-{version}-Windows-x64.zip';tmp=target.with_suffix('.tmp')
with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob('*')):
        rel=p.relative_to(root)
        if p.is_file() and not any(x in ('__pycache__','dist','.git') for x in rel.parts) and p.suffix not in ('.pyc','.sqlite3'):
            z.write(p,'MyPhoneLibrary-'+version+'/'+rel.as_posix())
with zipfile.ZipFile(tmp) as z:
    if z.testzip():raise ValueError('ZIP verification failed')
with tmp.open('r+b') as f:os.fsync(f.fileno())
os.replace(tmp,target)
print(target)
