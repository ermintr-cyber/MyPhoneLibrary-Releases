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

def data_locations():
    legacy=Path(os.environ.get('LOCALAPPDATA',str(Path.home()/'.local/share')))/'MyPhoneLibrary'
    target=Path(os.environ.get('PROGRAMDATA',os.environ.get('ProgramData','C:/ProgramData')))/'MyPhoneLibrary' if os.name=='nt' else legacy
    return legacy.resolve(),target.resolve()

def resolve_data_directory(requested=None):
    legacy,target=data_locations()
    chosen=Path(requested).expanduser().resolve() if requested else target
    if chosen not in (legacy,target):return chosen
    if target==legacy:return target
    migrate_data(legacy,target)
    return target

def migrate_data(source,target):
    """Copy a stopped legacy store; keep the source intact as a recovery copy."""
    import sqlite3
    import contextlib
    source,target=Path(source),Path(target)
    if (target/'library.sqlite3').exists():return
    if not (source/'library.sqlite3').exists():
        target.mkdir(parents=True,exist_ok=True);return
    running=source/'server-running.json'
    if running.exists():
        try:
            info=json.loads(running.read_text())
            with urllib.request.urlopen('http://127.0.0.1:'+str(int(info['port']))+'/api/status',timeout=2) as response:status=json.load(response)
        except (OSError,ValueError,KeyError):status={}
        if status.get('product')=='MyPhoneLibrary':raise ValueError('Stop the existing MyPhoneLibrary server before moving its data to ProgramData.')
    target.parent.mkdir(parents=True,exist_ok=True)
    lock=target.parent/(target.name+'.migration-lock')
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError:raise ValueError('Data migration is already running. Wait for it to finish before starting another instance.')
    os.close(fd)
    try:
        if (target/'library.sqlite3').exists():return
        if target.exists() and any(target.iterdir()):raise ValueError('The new data folder is not empty. Existing files were not overwritten: '+str(target))
        with tempfile.TemporaryDirectory(prefix='MyPhoneLibrary-migration-',dir=target.parent) as tmp:
            stage=Path(tmp)/'verified';stage.mkdir()
            with contextlib.closing(sqlite3.connect(source/'library.sqlite3')) as src,contextlib.closing(sqlite3.connect(stage/'library.sqlite3')) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('The legacy database failed its integrity check. Original data was preserved.')
                row=dst.execute("SELECT value FROM meta WHERE key='settings'").fetchone()
                if row:
                    settings=json.loads(row[0])
                    for key in ('backup_primary','backup_directory'):
                        if settings.get(key) and Path(settings[key]).resolve()==(source/'backups').resolve():settings[key]=str(target/'backups')
                    dst.execute("UPDATE meta SET value=? WHERE key='settings'",(json.dumps(settings),));dst.commit()
            for folder in ('media','backups'):
                origin=source/folder
                if not origin.exists():continue
                for item in origin.rglob('*'):
                    if item.is_symlink():raise ValueError('Data migration cannot copy symbolic links: '+str(item))
                    dest=stage/item.relative_to(source)
                    if item.is_dir():dest.mkdir(parents=True,exist_ok=True)
                    elif item.is_file():
                        dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(item,dest)
                        with item.open('rb') as a,dest.open('rb') as b:
                            if hashlib.file_digest(a,'sha256').digest()!=hashlib.file_digest(b,'sha256').digest():raise ValueError('File verification failed: '+str(item))
            (stage/'migration.json').write_text(json.dumps({'source':str(source),'verified':True}),encoding='utf-8')
            if target.exists():target.rmdir()
            stage.replace(target)
    finally:lock.unlink(missing_ok=True)

def read_update_status(directory):
    directory=Path(directory)
    current=directory/'updates/status.json'
    if current.exists():return read_status(current)
    # The updater that launched the migration still reports to the old data folder.
    try:
        migration=json.loads((directory/'migration.json').read_text(encoding='utf-8'))
        return read_status(Path(migration['source'])/'updates/status.json')
    except (OSError,ValueError,KeyError):return read_status(current)

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
    installed=root/'app-manifest.json'
    if installed.exists():
        current=json.loads(installed.read_text(encoding='utf-8')).get('version')
        if current and version(manifest['version'])<=version(current):
            shutil.rmtree(pending)
            return False
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

# Independent installer worker, modelled on MyMediaLibrary's update lifecycle.
ACTIVE = {'starting','downloading','installing','verifying'}

def write_status(path,**values):
    import time
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    values['updated_at']=time.time()
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(values),encoding='utf-8');temporary.replace(path)

def read_status(path):
    try:return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError,ValueError):return {'status':'idle'}

def latest_installer(repo,current):
    repo=repository(repo)
    release=json.loads(github_bytes('https://api.github.com/repos/'+repo+'/releases/latest',2*1024*1024))
    if release.get('draft') or release.get('prerelease'):raise ValueError('A stable published release is required.')
    tag=release.get('tag_name','');new=tag.removeprefix('v');version(new)
    if version(new)<=version(current):return {'available':False,'version':new}
    filename='MyPhoneLibrary_Setup_'+new+'.exe'
    assets=[a for a in release.get('assets',[]) if a.get('name')==filename and a.get('state')=='uploaded']
    if len(assets)!=1:raise ValueError('The Windows installer is not published yet. Try again shortly.')
    asset=assets[0];size=asset.get('size',0);digest=asset.get('digest','')
    if not isinstance(size,int) or not 0<size<=100*1024*1024:raise ValueError('Invalid installer size.')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}',digest or ''):raise ValueError('The installer has no verified SHA-256 digest.')
    from urllib.parse import quote
    expected='https://github.com/'+repo+'/releases/download/'+quote(tag,safe='')+'/'+filename
    if asset.get('browser_download_url')!=expected:raise ValueError('The installer does not belong to this repository.')
    return {'available':True,'version':new,'size':size,'digest':digest[7:],'url':expected}

def download_installer(info,destination,progress):
    check_download_url(info['url']);digest=hashlib.sha256();count=0
    partial=Path(destination).with_suffix('.partial')
    try:
        req=urllib.request.Request(info['url'],headers={'User-Agent':'MyPhoneLibrary-Updater'})
        with urllib.request.build_opener(GitHubRedirect()).open(req,timeout=45) as response,partial.open('wb') as output:
            while chunk:=response.read(256*1024):
                count+=len(chunk)
                if count>info['size']:raise ValueError('Installer exceeds its published size.')
                output.write(chunk);digest.update(chunk);progress(count*100//info['size'])
        if count!=info['size'] or digest.hexdigest()!=info['digest']:raise ValueError('Installer checksum verification failed. Nothing was installed.')
        partial.replace(destination)
    finally:partial.unlink(missing_ok=True)

def worker_request(job,path):
    req=urllib.request.Request('http://127.0.0.1:'+str(job['port'])+path,data=b'{}',headers={'Content-Type':'application/json','X-MPL-Client':'1','X-MPL-CSRF':job['csrf'],'Cookie':'mpl_session='+job['session']})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=120) as response:return json.load(response)

def wait_for_exit(pid,timeout=30):
    import ctypes
    from ctypes import wintypes as w
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];kernel.OpenProcess.restype=w.HANDLE
    kernel.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD];kernel.WaitForSingleObject.restype=w.DWORD
    kernel.CloseHandle.argtypes=[w.HANDLE]
    handle=kernel.OpenProcess(0x100000,False,pid)
    if not handle:return
    try:
        if kernel.WaitForSingleObject(handle,timeout*1000)!=0:raise RuntimeError('The old server did not stop. Nothing was installed. Close MyPhoneLibrary and retry.')
    finally:kernel.CloseHandle(handle)

def launch_server(job):
    import subprocess
    root=Path(job['root'])
    return subprocess.Popen([str(root/'runtime/pythonw.exe'),str(root/'server.py'),'--no-browser','--host',job['host'],'--port',str(job['port']),'--data',job['data']],cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))

def wait_for_version(job):
    import time
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(90):
        try:
            with opener.open('http://127.0.0.1:'+str(job['port'])+'/api/status',timeout=2) as response:state=json.load(response)
            if state.get('product')=='MyPhoneLibrary' and state.get('version')==job['version'] and state.get('instance')!=job.get('instance'):return
        except (OSError,ValueError):pass
        time.sleep(.5)
    raise RuntimeError('Installation finished, but the new server could not be confirmed. Reopen MyPhoneLibrary. See updates/status.json.')

def run_job(job_path):
    import subprocess
    job_path=Path(job_path);job=json.loads(job_path.read_text(encoding='utf-8'));status_path=Path(job['status_path'])
    def report(stage,message,**extra):write_status(status_path,status=stage,version=job['version'],message=message,**extra)
    stopped=False;started=False
    try:
        report('downloading','Downloading update…',progress=0)
        installer=job_path.parent/'installer.exe'
        download_installer(job['artifact'],installer,lambda p:report('downloading','Downloading update…',progress=p))
        report('installing','Creating backup and stopping the old server…')
        worker_request(job,'/api/update-quiesce')
        wait_for_exit(job['pid']);stopped=True
        report('installing','Installing the verified Windows update…')
        # NSIS /D must be last and unquoted. The installation path is supplied by
        # this server, not by the browser or release metadata.
        command='"'+str(installer)+'" /S /D='+job['root']
        result=subprocess.run(command,timeout=180,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode:raise RuntimeError('Windows installer failed (code '+str(result.returncode)+').')
        installed=json.loads((Path(job['root'])/'app-manifest.json').read_text(encoding='utf-8'))
        if installed.get('version')!=job['version']:raise RuntimeError('Installer did not install the requested version.')
        # Old staged ZIPs must never overwrite the newly installed application.
        pending=Path(job['data'])/'pending-update'
        if pending.exists():shutil.rmtree(pending)
        report('verifying','Starting and verifying the updated server…')
        launch_server(job);started=True;wait_for_version(job)
        report('completed','Update completed. Version '+job['version']+' is ready.')
        installer.unlink(missing_ok=True)
    except Exception as error:
        report('failed',str(error))
        if stopped and not started:
            try:launch_server(job)
            except Exception:pass
    finally:
        # Do not leave session credentials in the update job after completion.
        job.pop('session',None);job.pop('csrf',None)
        job_path.write_text(json.dumps(job),encoding='utf-8')

def start_install(root,directory,artifact,port,host,pid,instance,session,csrf):
    import subprocess,uuid,time
    if os.name!='nt':raise ValueError('Automatic Windows installation requires the Windows host.')
    root=Path(root);directory=Path(directory);status_path=directory/'updates/status.json'
    previous=read_status(status_path)
    if previous.get('status') in ACTIVE and time.time()-previous.get('updated_at',0)<600:return previous
    folder=directory/'updates'/uuid.uuid4().hex;folder.mkdir(parents=True)
    # Copy the runtime too: the worker must not lock files Setup replaces.
    shutil.copytree(root/'runtime',folder/'runtime')
    shutil.copy2(root/'updater.py',folder/'updater.py')
    job={'root':str(root),'data':str(directory),'artifact':artifact,'version':artifact['version'],'port':port,'host':host,'pid':pid,'instance':instance,'session':session,'csrf':csrf,'status_path':str(status_path)}
    path=folder/'job.json';path.write_text(json.dumps(job),encoding='utf-8')
    write_status(status_path,status='starting',version=artifact['version'],message='Starting independent updater…')
    try:subprocess.Popen([str(folder/'runtime/pythonw.exe'),str(folder/'updater.py'),'--install-job',str(path)],cwd=folder,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    except Exception as error:
        write_status(status_path,status='failed',version=artifact['version'],message=str(error));raise
    return read_status(status_path)

if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='--install-job':
        run_job(sys.argv[2]);raise SystemExit(0)
    root=Path(__file__).resolve().parent
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',default=None)
    args,_=parser.parse_known_args()
    legacy,target=data_locations()
    directory=Path(args.data).resolve() if args.data else (target if (target/'library.sqlite3').exists() else legacy)
    if directory==legacy and (target/'library.sqlite3').exists():directory=target
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
