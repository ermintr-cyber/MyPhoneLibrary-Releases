"""Validate user-selected release ZIPs and apply staged updates on next launch."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import urllib.request
import urllib.error
import zipfile

def version(v):
    if not re.fullmatch(r'\d+\.\d+\.\d+',str(v)):raise ValueError('Invalid package version.')
    return tuple(map(int,v.split('.')))

def allowed(name):
    p=PurePosixPath(name)
    return not p.is_absolute() and '..' not in p.parts and '\\' not in name and ':' not in name and (name in ('server.py','updater.py','Pokreni-MyPhoneLibrary.cmd','PROCITAJ-ME.md','app-manifest.json') or (len(p.parts)==2 and p.parts[0]=='web' and p.suffix in ('.js','.css','.html','.svg','.webmanifest','.txt')))

def validate_archive(content,current):
    result={}
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        candidates=[n for n in z.namelist() if n.endswith('/app-manifest.json') or n=='app-manifest.json']
        if len(candidates)!=1:raise ValueError('Package must contain one manifest.')
        manifest_path=candidates[0];prefix=manifest_path[:-len('app-manifest.json')]
        manifest=json.loads(z.read(manifest_path))
        if manifest.get('product')!='MyPhoneLibrary':raise ValueError('This is not a MyPhoneLibrary package.')
        if version(manifest.get('version'))<=version(current):raise ValueError('Select a newer version than '+current+'.')
        files=manifest.get('files',{})
        if not isinstance(files,dict) or 'server.py' not in files or 'web/app.js' not in files:raise ValueError('Package is incomplete.')
        total=0
        for name,digest in files.items():
            if not allowed(name):raise ValueError('Unsupported file in package: '+name)
            info=z.getinfo(prefix+name);total+=info.file_size
            if total>30*1024*1024:raise ValueError('Program files are too large.')
            b=z.read(prefix+name)
            if hashlib.sha256(b).hexdigest()!=digest:raise ValueError('Corrupted package: '+name)
            result[name]=b
        result['app-manifest.json']=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
    return manifest,result

def stage(content,directory,current):
    manifest,files=validate_archive(content,current)
    directory=Path(directory);tmp=Path(tempfile.mkdtemp(prefix='update-',dir=directory))
    try:
        for name,b in files.items():
            p=tmp/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
        pending=directory/'pending-update'
        if pending.exists():shutil.rmtree(pending)
        tmp.replace(pending)
    finally:
        if tmp.exists():shutil.rmtree(tmp)
    return manifest['version']

def apply(root,directory):
    root=Path(root);directory=Path(directory);pending=directory/'pending-update'
    if not pending.exists():return False
    manifest=json.loads((pending/'app-manifest.json').read_text(encoding='utf-8'))
    files=manifest['files'];back=Path(tempfile.mkdtemp(prefix='program-before-update-',dir=directory));changed=[]
    try:
        for name,digest in files.items():
            if not allowed(name) or hashlib.sha256((pending/name).read_bytes()).hexdigest()!=digest:raise ValueError('Staged update verification failed.')
        for name in list(files)+['app-manifest.json']:
            source=pending/name;dest=root/name
            if not allowed(name):raise ValueError('Invalid path.')
            existed=dest.exists()
            if existed:
                saved=back/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(dest,saved)
            dest.parent.mkdir(parents=True,exist_ok=True)
            temp=dest.with_name(dest.name+'.mpl-new');shutil.copy2(source,temp)
            os.replace(temp,dest);changed.append((name,existed))
        shutil.rmtree(pending)
        print('MyPhoneLibrary updated to '+manifest['version']+'.')
        return True
    except Exception:
        for name,existed in reversed(changed):
            if existed:shutil.copy2(back/name,root/name)
            else:(root/name).unlink(missing_ok=True)
        raise

# Only public GitHub release assets are accepted. No arbitrary download hosts.
def repository(value):
    value=str(value or '').strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}',value):
        raise ValueError('Set a GitHub release repository in owner/name format first.')
    return value

class GitHubRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        check_download_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def check_download_url(value):
    from urllib.parse import urlsplit
    p=urlsplit(value)
    if p.scheme!='https' or p.hostname not in ('api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com') or p.username or p.password or p.port not in (None,443):
        raise ValueError('The release contains an unsupported download URL.')

def github_bytes(address,limit):
    check_download_url(address)
    req=urllib.request.Request(address,headers={'User-Agent':'MyPhoneLibrary-Updater','Accept':'application/vnd.github+json'})
    try:
        with urllib.request.build_opener(GitHubRedirect()).open(req,timeout=45) as response:
            content=response.read(limit+1)
            if len(content)>limit:raise ValueError('GitHub response exceeds the allowed size.')
            return content
    except urllib.error.HTTPError as e:
        raise ValueError('GitHub release unavailable (HTTP '+str(e.code)+'). Check the public repository and published release.') from e
    except OSError as e:
        raise ValueError('Unable to reach GitHub. Check your connection and try again.') from e

def latest_release(repo,current):
    repo=repository(repo)
    release=json.loads(github_bytes('https://api.github.com/repos/'+repo+'/releases/latest',2*1024*1024))
    if release.get('draft') or release.get('prerelease'):raise ValueError('A stable published release is required.')
    tag=release.get('tag_name','');new=tag.removeprefix('v');version(new)
    if version(new)<=version(current):return {'available':False,'version':new}
    filename='MyPhoneLibrary-'+new+'-Windows-x64.zip'
    assets=[a for a in release.get('assets',[]) if a.get('name')==filename and a.get('state')=='uploaded']
    if len(assets)!=1:raise ValueError('The release is missing its Windows update package.')
    asset=assets[0];size=asset.get('size',0);digest=asset.get('digest','')
    if not isinstance(size,int) or not 0<size<=100*1024*1024:raise ValueError('Invalid update size.')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',digest or ''):raise ValueError('This release has no verified SHA-256 digest.')
    from urllib.parse import quote
    expected='https://github.com/'+repo+'/releases/download/'+quote(tag,safe='')+'/'+filename
    if asset.get('browser_download_url')!=expected:raise ValueError('The release asset does not belong to this repository.')
    return {'available':True,'version':new,'size':size,'digest':digest[7:],'url':expected}

def download_release(repo,current):
    info=latest_release(repo,current)
    if not info['available']:raise ValueError('The latest version is already installed.')
    content=github_bytes(info['url'],info['size'])
    if len(content)!=info['size'] or hashlib.sha256(content).hexdigest()!=info['digest']:raise ValueError('Update checksum or size verification failed.')
    manifest,_=validate_archive(content,current)
    if manifest['version']!=info['version']:raise ValueError('Release and package versions do not match.')
    return content

if __name__=='__main__':
    root=Path(__file__).resolve().parent
    directory=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'.local/share')))/'MyPhoneLibrary'
    directory.mkdir(parents=True,exist_ok=True)
    if sys.stdout is None or sys.stderr is None:
        stream=open(directory/'updater.log','a',encoding='utf-8',buffering=1)
        if sys.stdout is None:sys.stdout=stream
        if sys.stderr is None:sys.stderr=stream
    try:
        if (directory/'pending-update').exists() and (directory/'server-running.json').exists():
            info=json.loads((directory/'server-running.json').read_text())
            try:
                with urllib.request.urlopen('http://127.0.0.1:'+str(int(info['port']))+'/api/status',timeout=2) as response:running=json.load(response)
            except Exception:running={}
            if running.get('product')=='MyPhoneLibrary':
                raise ValueError('Close the running MyPhoneLibrary server, then start again.')
        apply(root,directory)
    except Exception as e:print('Update was not applied: '+str(e));sys.exit(1)
