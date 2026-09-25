#!/usr/bin/env python3
"""MyPhoneLibrary: private, single-user LAN/Tailscale collection server. Python 3.11+."""
import argparse
import base64
import copy
import contextlib
import csv
import datetime as dt
import hashlib
import hmac
import io
import ipaddress
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import sqlite3
import threading
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
import zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from html import unescape

VERSION = '1.25.0'
PRODUCT = 'MyPhoneLibrary'
BASE = Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
MAX_BODY = 100 * 1024 * 1024
ACTIVE = {'U kolekciji', 'Posuđen'}
STATES = ['Netestiran', 'Ispravan', 'Djelimično ispravan', 'Neispravan']
def check_fields(value):
    if not isinstance(value,list) or len(value)>150: raise ValueError('Invalid To check fields.')
    if any(not isinstance(k,str) or not k or len(k)>150 or any(ord(c)<32 for c in k) for k in value): raise ValueError('Invalid To check field.')
    return list(dict.fromkeys(value))

TEXT_FIELDS = ['brand','model','alias','type','battery','charger','os','introduced','released','note','gsm','wiki','color','location','source','purchase_date','currency','condition','purpose','declared_qty','declared_parts','part_category','wish_note']
DEFAULTS = {'columns':['image','inv','brand','model','alias','type','product_code','colors','editions','battery','charger','rating','owned','box','os','released','introduced','qty','parts','gsm','wiki','note','actions'], 'options':{'brand':['Nokia','Sony Ericsson','Ericsson','Motorola','Samsung','Siemens','Apple','LG','HTC','BlackBerry','Alcatel','Huawei'], 'color':['Crna','Bijela','Srebrna','Crvena','Plava','Zlatna'], 'location':[], 'battery':['BL-5J','BL-4D','BL-4U','BL-6F','BP-4L','BP-5M'], 'charger':['2mm','3.5mm Nokia','microUSB 2.0','miniUSB','USB-C','Lightning','Vlasnički'], 'os':['Series 40','Symbian','Maemo 5','Android','iOS','Windows Mobile','Windows Phone'], 'part_category':['Baterija','Punjač','Ekran','Kućište','Tipkovnica','Poklopac','Kutija','Kabl','Ostalo']}, 'custom_fields':[], 'comparison_hidden':[], 'views':[], 'backup_days':1, 'backup_copies':14, 'backup_directory':'', 'backup_primary':'', 'network_local':'', 'network_remote':'', 'theme':'dark', 'default_page':'all', 'density':'compact', 'layout':'list', 'update_repo':'ermintr-cyber/MyPhoneLibrary-Releases'}

def stamp(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def ident(): return uuid.uuid4().hex
def dump(v): return json.dumps(v, ensure_ascii=False, separators=(',',':'))
def number(v, minimum=0, maximum=100000, integer=False):
    try: n = float(v or 0)
    except (ValueError, TypeError): raise ValueError('Invalid number.')
    if not minimum <= n <= maximum or (integer and n != int(n)): raise ValueError('Number is outside the allowed range.')
    return int(n) if integer else n
def url(v):
    if not v: return ''
    p=urllib.parse.urlsplit(str(v))
    if p.scheme not in ('http','https') or not p.hostname or p.username: raise ValueError('Link must start with http:// or https://.')
    return str(v)[:2000]
def image_url(v):
    if not v: return ''
    if re.fullmatch(r'/media/[a-f0-9]{32}\.(jpg|png|webp|gif)',str(v)): return v
    if not str(v).startswith('https://'): raise ValueError('Image must be an upload or HTTPS link.')
    return url(v)
def file_hash(path):
    with open(path,'rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def password_hash(password, salt=None):
    salt=salt or secrets.token_hex(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),300000).hex()
    return {'salt':salt,'hash':digest}

def network_info(port,test=False):
    endpoints=[{'label':'This computer','url':f'http://127.0.0.1:{port}','status':'Available on the host'}]
    ips=set()
    try:ips={r[4][0] for r in socket.getaddrinfo(socket.gethostname(),None,socket.AF_INET)}
    except OSError:pass
    for ip in sorted(ips):
        addr=ipaddress.ip_address(ip)
        if not addr.is_loopback and addr.is_private and addr not in ipaddress.ip_network('100.64.0.0/10'):
            endpoints.append({'label':'Local network','url':f'http://{ip}:{port}','status':'Adapter detected'})
    candidates=[shutil.which('tailscale'),str(Path(os.environ.get('ProgramFiles','C:/Program Files'))/'Tailscale/tailscale.exe')]
    exe=next((x for x in candidates if x and Path(x).is_file()),None)
    state='Not installed';error=''
    if exe:
        try:
            result=subprocess.run([exe,'status','--json'],capture_output=True,text=True,timeout=6,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if result.returncode:raise ValueError('Tailscale status unavailable. Open Tailscale on the host.')
            data=json.loads(result.stdout);state=data.get('BackendState','Unknown');me=data.get('Self') or {}
            for ip in me.get('TailscaleIPs',[]):
                if ':' not in ip:endpoints.append({'label':'Tailscale IP','url':f'http://{ip}:{port}','status':state})
            dns=me.get('DNSName','').rstrip('.')
            if dns:endpoints.append({'label':'Tailscale MagicDNS','url':f'http://{dns}:{port}','status':state})
        except (OSError,ValueError,subprocess.TimeoutExpired) as e:error=str(e)
    if test:
        for endpoint in endpoints:
            parsed=urllib.parse.urlsplit(endpoint['url'])
            try:
                with socket.create_connection((parsed.hostname,port),timeout=2):pass
                endpoint['status']='Reachable from server'
            except OSError:endpoint['status']='Not reachable from server'
    return {'port':port,'endpoints':endpoints,'tailscale':state,'error':error}

class Conflict(Exception): pass

class Store:
    def __init__(self, directory):
        self.directory=Path(directory).resolve(); self.directory.mkdir(parents=True,exist_ok=True)
        self.media=self.directory/'media'; self.media.mkdir(exist_ok=True)
        self.backups=self.directory/'backups'; self.backups.mkdir(exist_ok=True)
        self.path=self.directory/'library.sqlite3'; self.lock=threading.RLock()
        with self.connect() as c:
            c.executescript('''CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, at TEXT, record_id TEXT, action TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS repairs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS inventories(id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS remembered_sessions(token_hash TEXT PRIMARY KEY,expires REAL NOT NULL);''')
            if not c.execute('SELECT 1 FROM meta WHERE key=?',('settings',)).fetchone(): self.setmeta(c,'settings',DEFAULTS)
            settings=self.meta('settings',DEFAULTS,c)
            if not settings.get('update_repo') and DEFAULTS.get('update_repo'):
                settings['update_repo']=DEFAULTS['update_repo'];self.setmeta(c,'settings',settings)
            if not self.meta('product_code_column',False,c):
                cols=settings.get('columns',[])
                if 'product_code' not in cols:cols.insert(cols.index('type')+1 if 'type' in cols else len(cols),'product_code')
                settings['columns']=cols;self.setmeta(c,'settings',settings)
                self.setmeta(c,'product_code_column',True)
            self.setmeta(c,'schema',1)
            # Older versions reserved inventory numbers in Trash.
            for r in self.records(c,True):
                if any(u.get('inv') for u in r.get('instances',[])):
                    self.release_numbers(r)
                    c.execute('UPDATE records SET data=?,rev=rev+1 WHERE id=?',(dump(r),r['id']))
        self.last_backup=max((p.stat().st_mtime for p in self.backups.glob('*.zip')),default=0)
    @contextlib.contextmanager
    def connect(self):
        with self.lock:
            c=sqlite3.connect(self.path,timeout=20); c.row_factory=sqlite3.Row
            c.execute('PRAGMA foreign_keys=ON'); c.execute('PRAGMA busy_timeout=20000')
            try:
                yield c
                c.commit()
            except Exception:
                c.rollback()
                raise
            finally:c.close()
    def remember(self,token,expires):
        with self.connect() as c:
            c.execute('DELETE FROM remembered_sessions WHERE expires<=?',(time.time(),))
            c.execute('INSERT OR REPLACE INTO remembered_sessions VALUES(?,?)',(hashlib.sha256(token.encode()).hexdigest(),expires))
    def remembered(self,token):
        if not token or len(token)>128:return None
        with self.connect() as c:
            row=c.execute('SELECT expires FROM remembered_sessions WHERE token_hash=? AND expires>?',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
            return row[0] if row else None
    def forget(self,token=None):
        with self.connect() as c:
            if token:c.execute('DELETE FROM remembered_sessions WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))
            else:c.execute('DELETE FROM remembered_sessions')
    def meta(self,key,default=None,c=None):
        if c is None:
            with self.connect() as db: return self.meta(key,default,db)
        r=c.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone()
        return json.loads(r[0]) if r else copy.deepcopy(default)
    def setmeta(self,c,key,value): c.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',(key,dump(value)))
    def records(self,c=None,trash=False):
        if c is None:
            with self.connect() as db: return self.records(db,trash)
        return [dict(json.loads(r['data']),id=r['id'],rev=r['rev'],deleted=bool(r['deleted'])) for r in c.execute('SELECT * FROM records WHERE deleted=? ORDER BY rowid',(int(trash),))]
    def get(self,c,rid):
        r=c.execute('SELECT * FROM records WHERE id=?',(rid,)).fetchone()
        if not r: raise ValueError('Record not found.')
        return dict(json.loads(r['data']),id=r['id'],rev=r['rev'],deleted=bool(r['deleted']))
    def log(self,c,rid,action,data): c.execute('INSERT INTO history(at,record_id,action,data) VALUES(?,?,?,?)',(stamp(),rid,action,dump(data)))
    def validate_catalog_values(self,c,data):
        items=self.catalog(c);known={key:{e['name'].casefold() for e in items if e['category']==key} for key in DEFAULTS['options']}
        old=self.get(c,data['id']) if data.get('id') else {}
        old_units={u['id']:u for u in old.get('instances',[])}
        for obj,previous in [(data,old)]+[(u,old_units.get(u.get('id'),{})) for u in data.get('instances',[])]:
            for key,values in known.items():
                value=str(obj.get(key,'') or '').strip()
                if value and value.casefold() not in values and value!=previous.get(key):raise ValueError('Choose an existing '+key+' from Catalogs. Add the catalog item first.')
    def save_record(self,data,expected=None,importing=False,strict_catalog=False):
        with self.lock, self.connect() as c:
            if strict_catalog:self.validate_catalog_values(c,data)
            return self._save(c,data,expected,importing)
    def _save(self,c,data,expected=None,importing=False):
        if not isinstance(data,dict): raise ValueError('Invalid record.')
        rid=data.get('id') or ident()
        if not re.fullmatch(r'[a-f0-9]{32}',rid): raise ValueError('Invalid ID.')
        found=c.execute('SELECT 1 FROM records WHERE id=?',(rid,)).fetchone()
        old=self.get(c,rid) if found else None
        if old and old['deleted']: raise ValueError('Restore this record from Trash before editing it.')
        if old and expected != old['rev']: raise Conflict('Record changed on another device. Reopen it before saving.')
        r={'id':rid,'kind':data.get('kind','phone'),'created':old['created'] if old else stamp(),'updated':stamp()}
        if r['kind'] not in ('phone','part'): raise ValueError('Unknown record type.')
        if old and old['kind']!=r['kind']: raise ValueError('An existing record cannot change type.')
        for k in TEXT_FIELDS: r[k]=str(data.get(k,'') or '')[:12000 if k=='note' else 2000]
        if not r['model'].strip(): raise ValueError('Enter a model or part name.')
        if r['kind']=='phone' and not r['brand'].strip(): raise ValueError('Enter the phone brand.')
        normalized=lambda s:' '.join(str(s).casefold().split())
        if r['kind']=='phone' and any(x['id']!=rid and x['kind']=='phone' and normalized(x['brand'])==normalized(r['brand']) and normalized(x['model'])==normalized(r['model']) for x in self.records(c)):
            raise Conflict('This model already exists. Add a unit from its row or reopen Add phone.')
        for k in ('gsm','wiki'): r[k]=url(r[k].strip())
        if not r['currency']:r['currency']='KM'
        r['image']=image_url(data.get('image',''))
        if len(data.get('photos',[]))>100:raise ValueError('Maximum 100 photos per model.')
        r['photos']=[image_url(p) for p in data.get('photos',[])]
        r['favorite']=bool(data.get('favorite'));r['wishlist']=bool(data.get('wishlist'))
        r['wish_priority']=str(data.get('wish_priority',''))
        if r['wish_priority'] not in ('','High','Medium','Low'): raise ValueError('Unknown wishlist priority.')
        r['wish_price']=None if data.get('wish_price') in (None,'') else number(data.get('wish_price'),0,100000000)
        r['rating']=number(data.get('rating'),0,5,True)
        r['to_check']=check_fields(data.get('to_check',(old or {}).get('to_check',[])))
        r['custom']=data.get('custom',{}) if isinstance(data.get('custom',{}),dict) else {}
        r['specs']=data.get('specs',{}) if isinstance(data.get('specs',{}),dict) else {}
        r['provenance']=old.get('provenance',{}) if old else {}
        if data.get('provenance'): r['provenance']=data['provenance']
        r['import_key']=old.get('import_key','') if old else str(data.get('import_key',''))[:200]
        for k in ('price','value'): r[k]=number(data.get(k),0,100000000)
        if r['kind']=='phone':
            r['instances']=[]
            existing={u['id']:u for u in (old or {}).get('instances',[])}
            incoming=data.get('instances',[])
            if not isinstance(incoming,list) or len(incoming)>500: raise ValueError('Maximum 500 units per model.')
            used={u.get('inv') for other in self.records(c) if other['id']!=rid for u in other.get('instances',[]) if u.get('inv')}
            other_ids={u.get('id') for other in self.records(c)+self.records(c,True) if other['id']!=rid for u in other.get('instances',[])}
            reserved_numbers=used|{str(x.get('inv','')).strip() for x in incoming if x.get('inv')}
            own_ids=set()
            for item in incoming:
                u={k:str(item.get(k,'') or '')[:4000] for k in ['inv','color','edition','alias','type','os','gsm','wiki','product_code','memory','firmware','state','condition','purpose','location','imei','imei2','serial','note','source','purchase_date','currency','lock','originality']}
                u['for_parts']=item.get('for_parts') is True or u['purpose']=='Donor'
                if u['for_parts']:u['purpose']='Donor'
                for link in ('gsm','wiki'):u[link]=url(u[link].strip())
                if not u['currency']:u['currency']='KM'
                u['id']=item.get('id') or ident()
                if not re.fullmatch(r'[a-f0-9]{32}',u['id']) or u['id'] in own_ids or u['id'] in other_ids: raise ValueError('Duplicate or invalid unit ID.')
                own_ids.add(u['id'])
                u['to_check']=check_fields(item.get('to_check',existing.get(u['id'],{}).get('to_check',[])))
                if u['state'] not in STATES: u['state']='Netestiran'
                if u['condition'] not in ACTIVE|{'Wanted','Prodan','Poklonjen','Rastavljen','Rashodovan'}: u['condition']='U kolekciji'
                if not u['inv']:
                    seq=1
                    numeric={int(v) for v in used|reserved_numbers if v.isdecimal()}
                    while seq in numeric:seq+=1
                    u['inv']=str(seq)
                if u['inv'] in used: raise ValueError('Inventory number already exists: '+u['inv'])
                used.add(u['inv'])
                u['rating']=number(item.get('rating'),0,5,True)
                for k in ('price','value'): u[k]=number(item.get(k),0,100000000)
                for k in ('box','battery_present','charger_present','manual','headphones','matching_box'):
                    v=item.get(k);u[k]=v if v is True or v is False else None
                if len(item.get('photos',[]))>100:raise ValueError('Maximum 100 photos per unit.')
                u['photos']=[image_url(p) for p in item.get('photos',[])]
                r['instances'].append(u)
            missing=set(existing)-own_ids
            if missing: raise ValueError('Keep existing units in the list; change their status to Sold, Dismantled or Retired.')
        else:
            r['instances']=[]
            r['quantity']=number(data.get('quantity'),0,100000,True)
            r['reserved']=old.get('reserved',0) if old else number(data.get('reserved'),0,r['quantity'],True) if importing else 0
            if old and r['quantity']!=old['quantity']: raise ValueError('Use Stock movements to change part quantities.')
            valid={x['id'] for x in self.records(c) if x['kind']=='phone'}
            catalog_item=str(data.get('catalog_item','') or '')
            if catalog_item and not any(e['id']==catalog_item for e in self.catalog(c)):raise ValueError('Catalog item not found.')
            r['catalog_item']=catalog_item
            r['compatible']=list(dict.fromkeys(str(x) for x in data.get('compatible',[])))
            if any(x not in valid for x in r['compatible']): raise ValueError('Compatible model not found.')
        rev=old['rev']+1 if old else 1
        c.execute('INSERT OR REPLACE INTO records(id,rev,deleted,data) VALUES(?,?,?,?)',(rid,rev,int((old or {}).get('deleted',False)),dump(r)))
        self.catalog(c)
        self.log(c,rid,'Izmjena' if old else 'Dodavanje',{'before':old,'after':r})
        return dict(r,rev=rev,deleted=bool((old or {}).get('deleted',False)))
    def bulk_units(self,data,strict_catalog=False):
        fields={'color','edition','location','state','condition','box','battery_present','charger_present','manual','headphones','os','to_check'}
        changes=data.get('changes',{});targets=data.get('targets',[])
        if not isinstance(changes,dict) or not changes or set(changes)-fields:raise ValueError('Choose supported unit fields to change.')
        if not isinstance(targets,list) or not 1<=len(targets)<=10000:raise ValueError('Select units to update.')
        if 'to_check' in changes:changes['to_check']=check_fields(changes['to_check'])
        if 'state' in changes and changes['state'] not in STATES:raise ValueError('Invalid working condition.')
        if 'condition' in changes and changes['condition'] not in ('U kolekciji','Wanted'):raise ValueError('Invalid ownership status.')
        for key in ('box','battery_present','charger_present','manual','headphones'):
            if key in changes and changes[key] is not None and type(changes[key]) is not bool:raise ValueError('Invalid accessory status.')
        with self.connect() as c:
            grouped={};seen=set()
            for target in targets:
                rid=target.get('record_id');r=grouped.setdefault(rid,self.get(c,rid))
                if r['deleted'] or r['kind']!='phone':raise ValueError('Select active phone units.')
                if target.get('rev')!=r['rev']:raise Conflict('A selected phone changed. Refresh and select it again. No changes were saved.')
                uid=target.get('unit_id')
                if uid in seen:raise ValueError('Duplicate unit selection.')
                seen.add(uid);u=next((u for u in r['instances'] if u['id']==uid),None)
                if not u:raise ValueError('Selected unit no longer exists.')
                u.update(changes)
            if strict_catalog:
                for r in grouped.values():self.validate_catalog_values(c,r)
            result=[self._save(c,r,r['rev']) for r in grouped.values()]
            return {'updated':len(seen),'records':result}
    @staticmethod
    def release_numbers(record):
        for unit in record.get('instances',[]):
            if unit.get('inv'):unit['previous_inv']=unit['inv']
            unit['inv']=''
    def purge(self,rid,rev):
        with self.connect() as c:
            r=self.get(c,rid)
            if r['rev']!=rev:raise Conflict('Record changed. Refresh Trash.')
            if not r['deleted']:raise ValueError('Move the record to Trash first.')
            if any(x.get('_unit_parent')==rid for x in self.records(c,True)):
                raise ValueError('Restore or permanently delete the individual phones in Trash before deleting their model.')
            # Historical repairs, stock movements and inventory snapshots remain audit records.
            for other in self.records(c)+self.records(c,True):
                if rid in other.get('compatible',[]):
                    other['compatible'].remove(rid)
                    c.execute('UPDATE records SET data=?,rev=rev+1 WHERE id=?',(dump(other),other['id']))
            c.execute('DELETE FROM records WHERE id=?',(rid,))
            self.log(c,rid,'Permanently deleted',{'name':r.get('model','')})
    def trash_unit(self,rid,uid,rev):
        with self.lock,self.connect() as c:
            old=self.get(c,rid)
            if old['rev']!=rev:raise Conflict('Record changed. Refresh the table.')
            if old['deleted'] or old['kind']!='phone':raise ValueError('Open an active phone model.')
            unit=next((u for u in old['instances'] if u['id']==uid),None)
            if unit is None:raise ValueError('Phone not found in this model.')
            removed=copy.deepcopy(old);removed['id']=ident();removed['instances']=[copy.deepcopy(unit)]
            removed['_unit_parent']=rid;removed['deleted']=True;removed['rev']=1
            self.release_numbers(removed)
            old['instances']=[u for u in old['instances'] if u['id']!=uid]
            c.execute('UPDATE records SET data=?,rev=rev+1 WHERE id=?',(dump(old),rid))
            c.execute('INSERT INTO records(id,rev,deleted,data) VALUES(?,?,?,?)',(removed['id'],1,1,dump(removed)))
            self.log(c,rid,'Phone moved to trash',{'unit':unit,'trash_id':removed['id']})
            return removed['id']

    def trash(self,rid,rev,restore=False):
        with self.lock,self.connect() as c:
            old=self.get(c,rid)
            if old['rev']!=rev: raise Conflict('Record changed. Refresh the table.')
            if old['deleted']!=restore:raise ValueError('Record is already in the requested location.')
            if restore and old.get('_unit_parent'):
                parent=self.get(c,old['_unit_parent'])
                if parent['deleted']:raise Conflict('Restore the original model first, then restore this phone.')
                used={u.get('inv') for r in self.records(c) for u in r.get('instances',[])}
                for unit in old['instances']:
                    if any(u['id']==unit['id'] for r in self.records(c) for u in r.get('instances',[])):
                        raise Conflict('This phone already exists in the collection.')
                    candidate=unit.get('previous_inv','')
                    if not candidate or candidate in used:
                        n=1
                        while str(n) in used:n+=1
                        candidate=str(n)
                    unit['inv']=candidate;used.add(candidate);parent['instances'].append(unit)
                c.execute('UPDATE records SET data=?,rev=rev+1 WHERE id=?',(dump(parent),parent['id']))
                c.execute('DELETE FROM records WHERE id=?',(rid,))
                self.log(c,parent['id'],'Phone restored from trash',{'units':old['instances']})
                return
            if restore and old['kind']=='phone' and any(r['kind']=='phone' and ' '.join(r['brand'].casefold().split())==' '.join(old['brand'].casefold().split()) and ' '.join(r['model'].casefold().split())==' '.join(old['model'].casefold().split()) for r in self.records(c)):
                raise Conflict('A model with this name already exists. Resolve the duplicate before restoring from Trash.')
            if not restore and old['kind']=='part' and old.get('reserved',0): raise ValueError('Release reserved stock first.')
            if restore:
                used={u.get('inv') for r in self.records(c) for u in r.get('instances',[])}
                for u in old.get('instances',[]):
                    candidate=u.get('previous_inv','')
                    if not candidate or candidate in used:
                        seq=self.meta('sequence',0,c)+1
                        while 'MOB-'+str(seq).zfill(5) in used:seq+=1
                        self.setmeta(c,'sequence',seq);candidate='MOB-'+str(seq).zfill(5)
                    u['inv']=candidate;used.add(candidate)
            else:self.release_numbers(old)
            c.execute('UPDATE records SET deleted=?,rev=rev+1,data=? WHERE id=?',(0 if restore else 1,dump(old),rid))
            self.log(c,rid,'Vraćanje iz korpe' if restore else 'Premještanje u korpu',{})
    def catalog(self,c):
        items=self.meta('catalog',[],c)
        blocked={tuple(x) for x in self.meta('catalog_deleted',[],c)}
        known={(e['category'],e['name'].strip().casefold()):e for e in items}
        def ensure(category,name):
            name=str(name or '').strip()
            if not name:return None
            key=(category,name.casefold())
            if key in blocked:return None
            if key not in known:
                e={'id':ident(),'rev':1,'category':category,'name':name,'description':'','specs':{},'source':''}
                items.append(e);known[key]=e
            return known[key]['id']
        settings={**copy.deepcopy(DEFAULTS),**self.meta('settings',DEFAULTS,c)}
        for category,values in settings['options'].items():
            if category in DEFAULTS['options']:
                for value in values:ensure(category,value)
        for r in self.records(c)+self.records(c,True):
            changed=False
            for obj in [r]+r.get('instances',[]):
                refs={k:ensure(k,obj.get(k)) for k in DEFAULTS['options'] if obj.get(k)}
                refs={k:v for k,v in refs.items() if v}
                if obj.get('catalog_refs')!=refs:obj['catalog_refs']=refs;changed=True
            if changed:
                c.execute('UPDATE records SET data=? WHERE id=?',(dump(r),r['id']))
        self.setmeta(c,'catalog',items)
        settings['options']={k:[e['name'] for e in items if e['category']==k] for k in DEFAULTS['options']}
        self.setmeta(c,'settings',settings)
        return items
    def delete_catalog(self,data):
        with self.connect() as c:
            items=self.catalog(c)
            item=next((e for e in items if e['id']==data.get('id')),None)
            if not item:raise ValueError('Catalog item not found.')
            if item['rev']!=data.get('rev'):raise Conflict('Catalog item changed. Reopen it.')
            linked=[r for r in self.records(c)+self.records(c,True) if any(o.get('catalog_refs',{}).get(item['category'])==item['id'] for o in [r]+r.get('instances',[]))]
            if linked and not data.get('confirm_linked'):raise Conflict('This item is linked to records. Confirm deletion to keep their text and remove the catalog link.')
            blocked=self.meta('catalog_deleted',[],c)
            blocked.append([item['category'],item['name'].strip().casefold()])
            self.setmeta(c,'catalog_deleted',blocked)
            for child in items:
                if item['id'] in child.get('compatible_batteries',[]):
                    child['compatible_batteries']=[x for x in child['compatible_batteries'] if x!=item['id']];child['rev']+=1
                if child.get('parent_id')==item['id']:child['parent_id']=item.get('parent_id','');child['rev']+=1
            for r in self.records(c)+self.records(c,True):
                if r.get('catalog_item')==item['id']:
                    r['catalog_item']='';c.execute('UPDATE records SET data=?,rev=rev+1 WHERE id=?',(dump(r),r['id']))
            self.setmeta(c,'catalog',[e for e in items if e['id']!=item['id']])
            self.catalog(c)
            for r in linked:
                c.execute('UPDATE records SET rev=rev+1 WHERE id=?',(r['id'],))
                self.log(c,r['id'],'Catalog item deleted',{'category':item['category'],'name':item['name']})
    def save_catalog(self,data):
        with self.connect() as c:
            items=self.catalog(c)
            old=next((e for e in items if e['id']==data.get('id')),None)
            if data.get('id') and not old:raise ValueError('Catalog item not found.')
            if old and data.get('rev')!=old['rev']:raise Conflict('This item changed. Reopen it before saving.')
            category=old['category'] if old else data.get('category')
            if category not in DEFAULTS['options']:raise ValueError('Unknown catalog.')
            name=str(data.get('name','')).strip()[:200]
            if not name:raise ValueError('Enter a name.')
            if any(e['category']==category and e['name'].casefold()==name.casefold() and e is not old for e in items):raise Conflict('This catalog name already exists.')
            specs=data.get('specs',{})
            if not isinstance(specs,dict) or len(specs)>100 or any(not isinstance(v,(str,int,float,bool)) for v in specs.values()):raise ValueError('Specifications must be named values.')
            item={'id':old['id'] if old else ident(),'rev':old['rev']+1 if old else 1,'category':category,'name':name,'description':str(data.get('description',''))[:12000],'specs':{str(k)[:120]:str(v)[:2000] for k,v in specs.items() if str(k).strip()},'source':url(data.get('source',''))}
            if category=='battery':
                models=data.get('supported_models',(old or {}).get('supported_models',[]))
                if not isinstance(models,list) or len(models)>1000 or any(not isinstance(m,dict) or not isinstance(m.get('brand'),str) or not isinstance(m.get('model'),str) for m in models):
                    raise ValueError('Supported phone models must contain brand and model names.')
                item['supported_models']=[{k:str(m.get(k,''))[:1000] for k in ('brand','model','note','warning')} for m in models]
                for k in ('source_models','manufacturer','suggestion_excluded','source_revision','source_warnings'):
                    if old and k in old:item[k]=old[k]
            parent_id=str(data.get('parent_id','') or '') if category=='location' else ''
            by_id={e['id']:e for e in items};visited={item['id']};current=parent_id
            while current:
                if current in visited:raise ValueError('Locations cannot contain a circular hierarchy.')
                visited.add(current);parent=by_id.get(current)
                if not parent or parent['category']!='location':raise ValueError('Parent location not found.')
                current=parent.get('parent_id','')
            item['parent_id']=parent_id
            compatible=list(dict.fromkeys(data.get('compatible',[])))
            valid={r['id'] for r in self.records(c) if r['kind']=='phone'}
            if any(rid not in valid for rid in compatible):raise ValueError('Compatible model not found.')
            item['compatible']=compatible
            links=data.get('compatible_batteries',(old or {}).get('compatible_batteries',[])) if category=='battery' else []
            if not isinstance(links,list) or any(not isinstance(x,str) for x in links):raise ValueError('Choose batteries from the catalog.')
            links=list(dict.fromkeys(links))
            if any(x==item['id'] or x not in by_id or by_id[x]['category']!='battery' for x in links):raise ValueError('Compatible battery not found or refers to itself.')
            item['compatible_batteries']=links
            for other in items:
                if other['category']!='battery' or other is old:continue
                current_links=other.get('compatible_batteries',[])
                next_links=[x for x in current_links if x!=item['id']]
                if other['id'] in links:next_links.append(item['id'])
                if set(next_links)!=set(current_links):other['compatible_batteries']=next_links;other['rev']+=1
            if old:
                for r in self.records(c)+self.records(c,True):
                    changed=False
                    for obj in [r]+r.get('instances',[]):
                        if obj.get('catalog_refs',{}).get(category)==old['id'] and obj.get(category)!=name:obj[category]=name;changed=True
                    if changed:
                        c.execute('UPDATE records SET rev=rev+1,data=? WHERE id=?',(dump(r),r['id']))
                        self.log(c,r['id'],'Catalog rename',{'id':old['id'],'before':old['name'],'after':name})
                items[items.index(old)]=item
            else:items.append(item)
            self.setmeta(c,'catalog_deleted',[x for x in self.meta('catalog_deleted',[],c) if x!=[category,name.casefold()]])
            self.setmeta(c,'catalog',items)
            settings=self.meta('settings',DEFAULTS,c)
            settings['options']={k:[e['name'] for e in items if e['category']==k] for k in DEFAULTS['options']}
            self.setmeta(c,'settings',settings)
            return item
    def settings(self,value):
        with self.lock,self.connect() as c:
            current={**copy.deepcopy(DEFAULTS),**self.meta('settings',DEFAULTS,c)}
            for k in DEFAULTS:
                if k in value and k!='options': current[k]=value[k]
            if current.get('update_repo'):
                from updater import repository
                current['update_repo']=repository(current['update_repo'])
            for field in ('network_local','network_remote'):
                current[field]=url(current.get(field,''))
            for field in ('backup_primary','backup_directory'):
                current[field]=str(current.get(field,'')).strip()
                if current[field] and not Path(current[field]).expanduser().is_absolute():raise ValueError('Backup locations must be absolute paths on the host computer.')
            if current.get('default_page','all') not in ('all','phone','part','wish'):raise ValueError('Unknown default page.')
            if current.get('density','compact') not in ('compact','comfortable'):raise ValueError('Unknown density.')
            if current.get('layout') not in ('list','cards'):raise ValueError('Unknown layout.')
            current['backup_days']=number(current['backup_days'],1,30,True)
            current['backup_copies']=number(current['backup_copies'],2,100,True)
            hidden=current.get('comparison_hidden',[])
            if not isinstance(hidden,list) or len(hidden)>1000 or any(not isinstance(k,str) or len(k)>500 for k in hidden): raise ValueError('Invalid comparison field preferences.')
            current['comparison_hidden']=list(dict.fromkeys(hidden))
            if not isinstance(current['custom_fields'],list) or len(current['custom_fields'])>50: raise ValueError('Maximum 50 custom fields.')
            if len({f.get('id') for f in current['custom_fields']})!=len(current['custom_fields']): raise ValueError('Duplicate field ID.')
            for f in current['custom_fields']:
                if f.get('type') not in ('text','number','date','select','checkbox'): raise ValueError('Unknown field type.')
            self.setmeta(c,'settings',current)
            return current
    def move(self,d):
        with self.lock,self.connect() as c:
            part=self.get(c,d['part_id']); n=number(d.get('quantity'),1,100000,True)
            if part['kind']!='part' or part['deleted']: raise ValueError('Part unavailable.')
            action=d.get('action'); free=part['quantity']-part['reserved']
            if action in ('Ugradi','Rezerviši','Otpiši') and n>free: raise ValueError('Not enough available parts.')
            if action in ('Oslobodi','Ugradi rezervisano') and n>part['reserved']: raise ValueError('Not enough reserved parts.')
            rid=d.get('record_id'); uid=d.get('instance_id')
            if action in ('Ugradi','Ugradi rezervisano'):
                phone=self.get(c,rid)
                if phone['deleted'] or phone['kind']!='phone' or not any(u['id']==uid for u in phone['instances']): raise ValueError('Select a phone and target unit.')
            if action=='Dodaj': part['quantity']+=n
            elif action=='Rezerviši': part['reserved']+=n
            elif action=='Oslobodi': part['reserved']-=n
            elif action in ('Ugradi','Otpiši'): part['quantity']-=n
            elif action=='Ugradi rezervisano': part['quantity']-=n;part['reserved']-=n
            else: raise ValueError('Unknown action.')
            m={'id':ident(),'at':stamp(),'part_id':part['id'],'action':action,'quantity':n,'record_id':rid,'instance_id':uid,'note':str(d.get('note',''))[:4000]}
            part['updated']=stamp();rev=part.pop('rev')+1;part.pop('deleted',None)
            c.execute('UPDATE records SET data=?,rev=? WHERE id=?',(dump(part),rev,part['id']))
            c.execute('INSERT INTO movements VALUES(?,?)',(m['id'],dump(m)));self.log(c,part['id'],'Kretanje zalihe',m)
            return m
    def repair(self,d):
        with self.lock,self.connect() as c:
            r=self.get(c,d['record_id'])
            if not any(u['id']==d.get('instance_id') for u in r.get('instances',[])): raise ValueError('Select a unit.')
            status=d.get('status','Otvoren')
            if status not in ('Otvoren','U radu','Čeka dijelove','Završen'): raise ValueError('Unknown status.')
            item={'id':d.get('id') or ident(),'at':stamp(),'record_id':r['id'],'instance_id':d['instance_id'],'status':status,'note':str(d.get('note',''))[:10000],'cost':number(d.get('cost'),0,1000000),'currency':str(d.get('currency','KM'))[:10]}
            if d.get('id'):
                old=c.execute('SELECT data FROM repairs WHERE id=?',(d['id'],)).fetchone()
                if not old or json.loads(old[0])['record_id']!=r['id']: raise ValueError('Repair not found.')
            c.execute('INSERT OR REPLACE INTO repairs VALUES(?,?)',(item['id'],dump(item)));self.log(c,r['id'],'Popravak',item)
            return item
    def inventory(self,d):
        with self.lock,self.connect() as c:
            if d.get('id'):
                raw=c.execute('SELECT data FROM inventories WHERE id=?',(d['id'],)).fetchone()
                if not raw: raise ValueError('Inventory check not found.')
                inv=json.loads(raw[0])
                if inv['closed']: raise ValueError('Inventory check is closed.')
                if d.get('action')=='close': inv['closed']=stamp()
                else:
                    uid=d.get('instance_id')
                    if uid not in inv['expected']: raise ValueError('Unit is not in this inventory check.')
                    if d.get('found',True): inv['found'][uid]=stamp()
                    else: inv['found'].pop(uid,None)
            else:
                loc=str(d.get('location','')).strip()
                expected={u['id']:{'inv':u['inv'],'record_id':r['id'],'model':r['brand']+' '+r['model'],'location':u.get('location',''),'condition':u.get('condition')} for r in self.records(c) for u in r.get('instances',[]) if u.get('condition') in ACTIVE and (not loc or u.get('location')==loc)}
                inv={'id':ident(),'at':stamp(),'location':loc,'expected':expected,'found':{},'closed':None}
            c.execute('INSERT OR REPLACE INTO inventories VALUES(?,?)',(inv['id'],dump(inv)))
            return inv
    def all_data(self):
        with self.lock,self.connect() as c:
            catalog=self.catalog(c)
            return {'catalog':catalog,'data_directory':str(self.directory),'backup_default':str(self.backups),'product':PRODUCT,'version':VERSION,'schema':1,'at':stamp(),'records':self.records(c),'trash':self.records(c,True),'settings':self.meta('settings',DEFAULTS,c), **{t:[json.loads(x[0]) for x in c.execute('SELECT data FROM '+t+' ORDER BY rowid DESC')] for t in ('repairs','movements','inventories')}}
    def backup_status(self):
        settings=self.meta('settings',DEFAULTS);saved=self.meta('backup_results',{})
        result=[]
        for key,label in [('backup_primary','First backup location'),('backup_directory','Second backup location')]:
            path=str(settings.get(key,'')).strip() or (str(self.backups) if key=='backup_primary' else '')
            old=saved.get(key,{}) if saved.get(key,{}).get('path')==path else {}
            result.append({'label':label,'path':path,'status':old.get('status','pending') if path else 'disabled','message':old.get('message','No backup recorded for this location yet.') if path else 'Not configured','last_success':old.get('last_success')})
        return result
    def record_backup_result(self,key,path,status,message):
        with self.connect() as c:
            results=self.meta('backup_results',{},c);old=results.get(key,{})
            results[key]={'path':path,'status':status,'message':message,'at':stamp(),'last_success':stamp() if status=='success' else old.get('last_success') if old.get('path')==path else None}
            self.setmeta(c,'backup_results',results)
    def backup(self):
        with self.lock:
            name='MyPhoneLibrary-'+dt.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(2)+'.zip'
            target=self.backups/name; tmp=self.directory/('snapshot-'+ident()+'.sqlite3')
            try:
                with self.connect() as src,contextlib.closing(sqlite3.connect(tmp)) as dst: src.backup(dst)
                with contextlib.closing(sqlite3.connect(tmp)) as check:
                    check.execute('DELETE FROM remembered_sessions');check.commit()
                    if check.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Database verification failed.')
                hashes={}
                with zipfile.ZipFile(target.with_suffix('.tmp'),'w',zipfile.ZIP_DEFLATED) as z:
                    for path,arc in [(tmp,'library.sqlite3')]+[(p,'media/'+p.name) for p in self.media.iterdir() if p.is_file()]:
                        content=path.read_bytes();hashes[arc]=hashlib.sha256(content).hexdigest();z.writestr(arc,content)
                    z.writestr('manifest.json',dump({'product':PRODUCT,'schema':1,'version':VERSION,'files':hashes,'at':stamp()}))
                with zipfile.ZipFile(target.with_suffix('.tmp')) as z:
                    if z.testzip(): raise ValueError('Archive verification failed.')
                target.with_suffix('.tmp').replace(target);self.last_backup=time.time()
                settings=self.meta('settings',DEFAULTS)
                warning=''
                for field,label in [('backup_primary','First'),('backup_directory','Second')]:
                    destination=str(settings.get(field,'')).strip()
                    if not destination:
                        if field=='backup_primary':self.record_backup_result(field,str(self.backups),'success','Last backup completed and verified.')
                        continue
                    temp_copy=None
                    try:
                        folder=Path(destination).expanduser();folder.mkdir(parents=True,exist_ok=True)
                        dest=folder/name
                        if dest.resolve()!=target.resolve():
                            temp_copy=folder/(name+'.tmp')
                            shutil.copy2(target,temp_copy)
                            if file_hash(temp_copy)!=file_hash(target):raise OSError('Backup checksum mismatch.')
                            temp_copy.replace(dest)
                        self.record_backup_result(field,destination,'success','Last backup completed and verified.')
                    except OSError as e:
                        self.record_backup_result(field,destination,'failed','Last backup failed: '+str(e))
                        warning+=label+' backup location failed: '+str(e)+'. A local recovery copy was saved. '
                    finally:
                        if temp_copy:
                            with contextlib.suppress(OSError):temp_copy.unlink(missing_ok=True)
                keep=int(settings.get('backup_copies',14))
                for old in sorted(self.backups.glob('MyPhoneLibrary-*.zip'),key=lambda p:p.stat().st_mtime,reverse=True)[keep:]: old.unlink()
                return {'name':name,'bytes':target.stat().st_size,'warning':warning}
            finally:
                tmp.unlink(missing_ok=True);target.with_suffix('.tmp').unlink(missing_ok=True)
    def restore(self,content):
        return self.restore_file(io.BytesIO(content))
    def restore_file(self,source):
        with self.lock,tempfile.TemporaryDirectory(prefix='restore-',dir=self.directory) as staging:
            staging=Path(staging)
            with zipfile.ZipFile(source) as z:
                manifest=json.loads(z.read('manifest.json'))
                if manifest.get('product')!=PRODUCT or manifest.get('schema')!=1: raise ValueError('Unsupported backup.')
                files=manifest.get('files',{})
                if 'library.sqlite3' not in files: raise ValueError('Database missing.')
                total=sum(z.getinfo(name).file_size for name in files)
                if total>20*1024**3 or total>shutil.disk_usage(self.directory).free//2:raise ValueError('Not enough free space for a safe restore.')
                for name,digest in files.items():
                    if name!='library.sqlite3' and not re.fullmatch(r'media/[a-f0-9]{32}\.(jpg|png|gif|webp)',name): raise ValueError('Invalid backup path.')
                    dest=staging/name;dest.parent.mkdir(parents=True,exist_ok=True);checksum=hashlib.sha256()
                    with z.open(name) as src,dest.open('wb') as out:
                        while True:
                            chunk=src.read(1024*1024)
                            if not chunk:break
                            checksum.update(chunk);out.write(chunk)
                    if checksum.hexdigest()!=digest:raise ValueError('Corrupted backup: '+name)
            tmp=staging/'library.sqlite3'
            with contextlib.closing(sqlite3.connect(tmp)) as c:
                if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Backup database is corrupted.')
                for table in ('meta','records','history','repairs','movements','inventories'): c.execute('SELECT * FROM '+table+' LIMIT 1')
                schema=c.execute('SELECT value FROM meta WHERE key=?',('schema',)).fetchone()
                if not schema or json.loads(schema[0])!=1: raise ValueError('Unsupported database version.')
            with contextlib.closing(sqlite3.connect(tmp)) as c:
                c.execute('CREATE TABLE IF NOT EXISTS remembered_sessions(token_hash TEXT PRIMARY KEY,expires REAL NOT NULL)')
                c.execute('DELETE FROM remembered_sessions');c.commit()
            previous=self.backup()
            media=staging/'media'
            if media.exists():
                for sourcefile in media.iterdir():os.replace(sourcefile,self.media/sourcefile.name)
            os.replace(tmp,self.path)
            return {'previous':previous['name']}
    def import_rows(self,rows,commit=False):
        if not isinstance(rows,list) or len(rows)>10000: raise ValueError('Expected a list of up to 10000 rows.')
        if commit:self.backup()
        with self.lock,self.connect() as c:
            if not commit:c.execute('SAVEPOINT preview_all')
            existing=self.records(c)+self.records(c,True);keys={r.get('import_key') for r in existing if r.get('import_key')}
            ids={r['id'] for r in existing};seen=set();valid=[];errors=[];skipped=0
            aliases={'brand':'brand','marka':'brand','model':'model','naziv2':'alias','alias':'alias','type':'type','baterija':'battery','punjač':'charger','punjac':'charger','operativnisistem':'os','os':'os','released':'released','introduced':'introduced','note':'note','bilješka':'note','gsm':'gsm','wiki':'wiki','qty':'declared_qty','parts':'declared_parts','slika':'image','image':'image','invbr':'inv','invno':'inv','box':'box','imam':'owned','stanje':'rating'}
            for index,source in enumerate(rows):
                try:
                    if not isinstance(source,dict): raise ValueError('Row must be an object.')
                    key=source.get('import_key') or hashlib.sha256(dump(source).encode()).hexdigest()
                    if key in keys or key in seen or source.get('id') in ids:skipped+=1;continue
                    if source.get('kind') in ('phone','part'): r=copy.deepcopy(source);r.pop('rev',None);r.pop('deleted',None)
                    else:
                        mapped={aliases.get(re.sub(r'[\s.?!_-]','',str(k)).lower(),str(k)):v for k,v in source.items()}
                        r={k:mapped.get(k,'') for k in TEXT_FIELDS};r.update(kind='phone',image=mapped.get('image',''),instances=[])
                        qty=str(mapped.get('declared_qty','')).strip()
                        if not qty and str(mapped.get('owned','')).lower() in ('true','1','da','yes','✓'):qty='1'
                        if qty.isdigit() and int(qty)<=500:
                            count=int(qty);r['declared_qty']=''
                            for i in range(count):
                                box=str(mapped.get('box','')).lower();state=mapped.get('rating',0)
                                try:rating=int(float(state))
                                except (ValueError,TypeError):rating=str(state).count('★')
                                r['instances'].append({'inv':str(mapped.get('inv','')) if count==1 and str(mapped.get('inv',''))!='-' else '', 'rating':min(5,rating) if count==1 else 0,'box':(True if box in ('1','true','da','yes','✓') else False if box in ('0','false','ne','no','✕','×') else None) if count==1 else None})
                        elif qty:r['declared_qty']=qty
                        r['rating']=0
                    r['import_key']=key
                    if not str(r.get('model','')).strip():raise ValueError('Model missing.')
                    if r.get('kind')=='phone' and not str(r.get('brand','')).strip():raise ValueError('Brand missing.')
                    c.execute('SAVEPOINT row_import')
                    try:
                        created=self._save(c,r,None,True)
                        valid.append({'row':index+1,'brand':created['brand'],'model':created['model'],'quantity':len(created['instances']) if created['kind']=='phone' else created['quantity'],'uncertain':created['declared_qty']})
                        c.execute('RELEASE row_import');seen.add(key)
                    except Exception:
                        c.execute('ROLLBACK TO row_import');c.execute('RELEASE row_import');raise
                except (ValueError,KeyError,TypeError,Conflict) as e:errors.append({'row':index+1,'error':str(e)})
            if not commit:c.execute('ROLLBACK TO preview_all');c.execute('RELEASE preview_all')
            return {'rows':valid,'errors':errors,'skipped':skipped,'imported':len(valid) if commit else 0}

_folder_picker_lock=threading.Lock()
_folder_picker_process=None

def cancel_folder_picker():
    global _folder_picker_process
    with _folder_picker_lock:
        process=_folder_picker_process
        _folder_picker_process=None
        if process and process.poll() is None:
            process.terminate()

def native_folder_dialog(initial=''):
    """Explorer-style IFileOpenDialog; folder mode with address bar and search."""
    import ctypes
    from ctypes import wintypes as w
    class GUID(ctypes.Structure):
        _fields_=[('data1',w.DWORD),('data2',w.WORD),('data3',w.WORD),('data4',ctypes.c_ubyte*8)]
        @classmethod
        def parse(cls,value):return cls.from_buffer_copy(uuid.UUID(value).bytes_le)
    ole=ctypes.WinDLL('ole32');shell=ctypes.WinDLL('shell32');user=ctypes.WinDLL('user32')
    ole.CoInitializeEx.argtypes=[ctypes.c_void_p,w.DWORD];ole.CoInitializeEx.restype=ctypes.c_long
    ole.CoCreateInstance.argtypes=[ctypes.POINTER(GUID),ctypes.c_void_p,w.DWORD,ctypes.POINTER(GUID),ctypes.POINTER(ctypes.c_void_p)]
    ole.CoCreateInstance.restype=ctypes.c_long
    ole.CoTaskMemFree.argtypes=[ctypes.c_void_p]
    shell.SHCreateItemFromParsingName.argtypes=[w.LPCWSTR,ctypes.c_void_p,ctypes.POINTER(GUID),ctypes.POINTER(ctypes.c_void_p)]
    shell.SHCreateItemFromParsingName.restype=ctypes.c_long
    user.GetForegroundWindow.restype=w.HWND
    def method(obj,index,types,*args):
        table=ctypes.cast(obj,ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        return ctypes.WINFUNCTYPE(ctypes.c_long,ctypes.c_void_p,*types)(table[index])(obj,*args)
    def check(hr):
        if hr<0:raise OSError('Windows folder dialog failed (0x%08X).'%(hr&0xffffffff))
    check(ole.CoInitializeEx(None,2))
    dialog=ctypes.c_void_p();item=ctypes.c_void_p();start=ctypes.c_void_p()
    try:
        clsid=GUID.parse('DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7')
        iid=GUID.parse('D57C7288-D4AD-4768-BE02-9D969532D960')
        shell_iid=GUID.parse('43826D1E-E718-42EE-BC55-A1E261C37BFE')
        check(ole.CoCreateInstance(ctypes.byref(clsid),None,1,ctypes.byref(iid),ctypes.byref(dialog)))
        options=w.DWORD()
        check(method(dialog,10,[ctypes.POINTER(w.DWORD)],ctypes.byref(options)))
        # FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
        check(method(dialog,9,[w.DWORD],options.value|0x20|0x40|0x800))
        check(method(dialog,17,[w.LPCWSTR],'Choose automatic backup folder'))
        check(method(dialog,18,[w.LPCWSTR],'Select Folder'))
        if initial and Path(initial).is_dir():
            hr=shell.SHCreateItemFromParsingName(str(Path(initial)),None,ctypes.byref(shell_iid),ctypes.byref(start))
            if hr>=0:check(method(dialog,12,[ctypes.c_void_p],start))
        hr=method(dialog,3,[w.HWND],user.GetForegroundWindow())
        if hr&0xffffffff==0x800704c7:return None
        check(hr)
        check(method(dialog,20,[ctypes.POINTER(ctypes.c_void_p)],ctypes.byref(item)))
        path=ctypes.c_void_p()
        check(method(item,5,[w.DWORD,ctypes.POINTER(ctypes.c_void_p)],0x80058000,ctypes.byref(path)))
        try:return ctypes.wstring_at(path)
        finally:ole.CoTaskMemFree(path)
    finally:
        for obj in (item,start,dialog):
            if obj.value:method(obj,2,[])
        ole.CoUninitialize()

def choose_backup_folder(value=''):
    global _folder_picker_process
    if os.name!='nt':raise ValueError('Windows Browse is available on the Windows host. You can also type a folder path.')
    initial=base64.b64encode(str(value).encode('utf-8')).decode('ascii')
    with _folder_picker_lock:
        previous=_folder_picker_process
        if previous and previous.poll() is None:previous.terminate()
        process=subprocess.Popen([sys.executable,str(BASE/'server.py'),'--folder-picker',initial],stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        _folder_picker_process=process
    try:
        try:output,error=process.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            process.kill();process.communicate()
            raise ValueError('Folder selection timed out. Click Browse to try again.')
        with _folder_picker_lock:
            if _folder_picker_process is not process:return {'path':None}
        if process.returncode:raise ValueError('Windows could not open Browse. Enter the backup folder path manually.')
        if not output.strip():return {'path':None}
        selected=base64.b64decode(output.strip(),validate=True).decode('utf-8')
        if not Path(selected).is_dir():raise ValueError('The selected folder is no longer available.')
        return {'path':selected}
    finally:
        with _folder_picker_lock:
            if _folder_picker_process is process:_folder_picker_process=None

def folder_listing(value=''):
    import string
    roots=[str(Path(letter+':/')) for letter in string.ascii_uppercase if Path(letter+':/').is_dir()] if os.name=='nt' else ['/']
    path=Path(str(value).strip()).expanduser() if value else Path.home()
    path=path.resolve()
    if not path.is_dir():raise ValueError('Folder not found on the host computer.')
    try:children=sorted(({'name':x.name,'path':str(x)} for x in path.iterdir() if x.is_dir()),key=lambda x:x['name'].casefold())
    except OSError:raise ValueError('This folder cannot be opened. Choose another folder.')
    return {'path':str(path),'parent':str(path.parent),'roots':roots,'folders':children[:1000],'truncated':len(children)>1000}

def gsm_address(address,redirect=False,images=False):
    address=str(address).strip().replace('\u200b','').replace('\ufeff','')
    p=urllib.parse.urlsplit(address)
    allowed={'fdn2.gsmarena.com','fdn.gsmarena.com'} if images else {'www.gsmarena.com','gsmarena.com','m.gsmarena.com'}
    if p.hostname not in allowed or p.port not in (None,443) or p.username or p.password or p.scheme not in (('https','http') if redirect else ('https',)):
        raise ValueError('GSMArena redirected to an unsupported address.' if redirect else 'Use an HTTPS model link from www.gsmarena.com.')
    host=p.hostname
    if not images and not redirect:host='www.gsmarena.com'
    return urllib.parse.urlunsplit(('https',host,p.path,p.query,''))

def remote_get(address,images=False):
    address=gsm_address(address,images=images)
    def validate(a):
        p=urllib.parse.urlsplit(a)
        gsm_address(a,images=images)
        for result in socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM):
            if not ipaddress.ip_address(result[4][0]).is_global:raise ValueError('Private addresses are not allowed.')
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):
            newurl=gsm_address(newurl,redirect=True,images=images);validate(newurl)
            return super().redirect_request(req,fp,code,msg,headers,newurl)
    validate(address)
    opener=urllib.request.build_opener(SafeRedirect())
    req=urllib.request.Request(address,headers={'User-Agent':'Mozilla/5.0 (compatible; MyPhoneLibrary/1.5; user-requested lookup)'})
    with opener.open(req,timeout=15) as response:
        data=response.read(10*1024*1024+1)
        if len(data)>10*1024*1024:raise ValueError('Response is too large.')
        return data

def parse_gsm_html(html):
    from html.parser import HTMLParser
    class SpecsParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.fields={};self.meta={};self.stack=[];self.captures=[]
        def handle_starttag(self,tag,attrs):
            attrs=dict(attrs)
            if tag=='meta':self.meta[attrs.get('property',attrs.get('name','')).lower()]=attrs.get('content','')
            if tag in ('br','hr'): 
                for _,_,parts in self.captures:parts.append(' ')
            if tag in ('meta','img','br','hr','link','input','source','wbr'):return
            self.stack.append(tag)
            key=attrs.get('data-spec')
            if not key and tag=='h1' and 'specs-phone-name-title' in attrs.get('class','').split():key='modelname'
            if key:self.captures.append((key,len(self.stack),[]))
        def handle_data(self,data):
            for _,_,parts in self.captures:parts.append(data)
        def handle_endtag(self,tag):
            if tag not in self.stack:return
            depth=len(self.stack)-self.stack[::-1].index(tag)
            keep=[]
            for key,start,parts in self.captures:
                if start>=depth:self.fields[key]=' '.join(''.join(parts).split())
                else:keep.append((key,start,parts))
            self.captures=keep;self.stack=self.stack[:depth-1]
    parser=SpecsParser();parser.feed(html);parser.close()
    fields=parser.fields
    if not fields.get('modelname') and any(fields.get(k) for k in ('os','nettech','dimensions','announced')):
        title=parser.meta.get('og:title','')
        fields['modelname']=re.sub(r'\s*[-–|]\s*(?:full phone specifications|GSMArena).*$', '', title, flags=re.I).strip()
    return fields,parser.meta.get('og:image','')

def gsm_preview(address):
    address=gsm_address(address)
    if not re.fullmatch(r'/[a-zA-Z0-9_-]+-\d+\.php',urllib.parse.urlsplit(address).path):raise ValueError('Paste the GSMArena link for a specific model.')
    html=remote_get(address).decode('utf-8','replace')
    parsed,image=parse_gsm_html(html)
    name=parsed.pop('modelname','')
    if not name:
        if any(marker in html.lower() for marker in ('captcha','cf-chl-','verify you are human','just a moment','access denied')):
            raise ValueError('GSMArena returned an access check instead of phone specifications. Try later or enter the details manually.')
        raise ValueError('GSMArena returned a page without recognizable phone details. Enter the model manually or try later.')
    specs={key:parsed.get(key,'') for key in ('os','announced','status','usb','batdescription1','dimensions','weight','displaytype','displaysize','displayresolution','internalmemory','cam1modules','nettech','colors')}
    return {'name':name,'fields':{'os':specs['os'],'introduced':specs['announced'],'released':specs['status'],'charger':specs['usb'],'gsm':address,'image':image},'specs':specs,'source':address,'at':stamp()}

class HostHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        if os.name=='nt':
            self.allow_reuse_address=False
            self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        super().server_bind()

class AppServer(HostHTTPServer):
    daemon_threads=False
    def __init__(self,address,store):
        super().__init__(address,Handler);self.store=store;self.instance_id=secrets.token_hex(12);self.operation_lock=threading.RLock();self.installing=False;self.sessions={};self.attempts={};self.state_lock=threading.RLock()

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,fmt,*args):
        # Do not log credentials, cookies or uploaded content.
        if args and 'password' not in str(args[0]):super().log_message(fmt,*args)
    def send(self,status,value,ctype='application/json; charset=utf-8',extra=None):
        b=dump(value).encode() if isinstance(value,(dict,list)) else value.encode() if isinstance(value,str) else value
        self.close_connection=True
        self.send_response(status);self.send_header('Connection','close');self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(b)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','DENY')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        for k,v in (extra or {}).items():self.send_header(k,v)
        self.end_headers();self.wfile.write(b)
    def send_file(self,path,ctype,download_name):
        with path.open('rb') as source:
            self.close_connection=True
            self.send_response(200);self.send_header('Connection','close');self.send_header('Content-Type',ctype)
            self.send_header('Content-Length',str(os.fstat(source.fileno()).st_size))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Disposition','attachment; filename="'+download_name+'"')
            self.end_headers();shutil.copyfileobj(source,self.wfile,1024*1024)
    def session(self):
        cookie=SimpleCookie(self.headers.get('Cookie',''));token=cookie.get('mpl_session');token=token.value if token else ''
        with self.server.state_lock:
            s=self.server.sessions.get(token)
            if s and s['expires']>time.time():return token,s
        expiry=self.server.store.remembered(token)
        if expiry:
            with self.server.state_lock:
                s=self.server.sessions.setdefault(token,{'csrf':secrets.token_urlsafe(24),'expires':expiry})
            return token,s
        return '',None
    def read_body(self):
        n=int(self.headers.get('Content-Length','0'))
        if n<0 or n>MAX_BODY:raise ValueError('File is too large (maximum 100 MB).')
        return self.rfile.read(n)
    def do_GET(self): self.handle_request(False)
    def do_POST(self):
        if urllib.parse.urlsplit(self.path).path=='/api/backup-folder':
            if self.server.installing:return self.send(503,{'error':'Update installation is in progress.'})
            return self.handle_request(True)
        with self.server.operation_lock:
            if self.server.installing:return self.send(503,{'error':'Update installation is in progress. Please wait.'})
            self.handle_request(True)
    def handle_request(self,post):
        try:
            self.connection.settimeout(40)
            p=urllib.parse.urlsplit(self.path);path=p.path;store=self.server.store
            token,session=self.session()
            if post:
                origin=self.headers.get('Origin')
                if origin and urllib.parse.urlsplit(origin).netloc!=self.headers.get('Host'):return self.send(403,{'error':'Request origin is not allowed.'})
                if self.headers.get('X-MPL-Client')!='1':
                    self.close_connection=True
                    return self.send(403,{'error':'Request is not allowed.'})
                if path not in ('/api/login','/api/setup'):
                    if not session:
                        self.close_connection=True
                        return self.send(401,{'error':'Sign in to access the collection.'})
                    if not hmac.compare_digest(self.headers.get('X-MPL-CSRF',''),session['csrf']):
                        self.close_connection=True
                        return self.send(403,{'error':'Session expired. Refresh the app.'})
                if path=='/api/restore':
                    size=int(self.headers.get('Content-Length','0'))
                    if not 0<size<=10*1024**3:
                        self.close_connection=True
                        raise ValueError('Backup may not exceed 10 GB.')
                    if size>shutil.disk_usage(store.directory).free//3:
                        self.close_connection=True
                        raise ValueError('Not enough space for restore.')
                    with tempfile.TemporaryFile(dir=store.directory) as uploaded:
                        left=size
                        while left:
                            chunk=self.rfile.read(min(left,1024*1024))
                            if not chunk:raise ValueError('Backup upload was interrupted.')
                            uploaded.write(chunk);left-=len(chunk)
                        uploaded.seek(0);result=store.restore_file(uploaded)
                    with self.server.state_lock:self.server.sessions.clear()
                    return self.send(200,result)
                raw=self.read_body()
                binary=path in ('/api/upload','/api/restore','/api/image-import','/api/update')
                d={} if binary else json.loads(raw or b'{}')
                if not isinstance(d,dict):raise ValueError('Expected an object.')
            if path=='/api/status' and not post:
                from updater import read_update_status
                return self.send(200,{'update_job':read_update_status(store.directory),'version':VERSION,'instance':self.server.instance_id,'product':PRODUCT,'setup':not bool(store.meta('auth')),'authenticated':bool(session),'csrf':session['csrf'] if session else None})
            if path in ('/api/setup','/api/login') and post:
                ip=self.client_address[0]
                with self.server.state_lock:
                    attempts=[x for x in self.server.attempts.get(ip,[]) if x>time.time()-60]
                    if len(attempts)>=8:return self.send(429,{'error':'Wait one minute before trying again.'})
                    self.server.attempts[ip]=attempts+[time.time()]
                password=str(d.get('password',''))
                if len(password)>512:raise ValueError('Password is too long.')
                with store.lock,store.connect() as c:
                    auth=store.meta('auth',None,c)
                    if path=='/api/setup':
                        host=urllib.parse.urlsplit('http://'+self.headers.get('Host','')).hostname
                        if auth:raise ValueError('The app has already been set up.')
                        if not ipaddress.ip_address(ip).is_loopback or host not in ('localhost','127.0.0.1','::1'):return self.send(403,{'error':'Open the app on the host computer to set a password first.'})
                        if len(password)<8:raise ValueError('Password must have at least 8 characters.')
                        auth=password_hash(password);store.setmeta(c,'auth',auth)
                    elif not auth or not hmac.compare_digest(password_hash(password,auth['salt'])['hash'],auth['hash']):return self.send(401,{'error':'Incorrect password.'})
                remember=d.get('remember') is True
                token=secrets.token_urlsafe(32);s={'csrf':secrets.token_urlsafe(24),'expires':time.time()+(30*86400 if remember else 12*3600)}
                if remember:store.remember(token,s['expires'])
                with self.server.state_lock:self.server.sessions[token]=s;self.server.attempts.pop(ip,None)
                return self.send(200,{'ok':True,'csrf':s['csrf']},extra={'Set-Cookie':'mpl_session='+token+'; Path=/; HttpOnly; SameSite=Strict'+('; Max-Age=2592000' if remember else '')})
            if path.startswith('/api/') or path.startswith('/media/'):
                if not session:return self.send(401,{'error':'Sign in to access the collection.'})
                if post and not hmac.compare_digest(self.headers.get('X-MPL-CSRF',''),session['csrf']):return self.send(403,{'error':'Session expired. Refresh the app.'})
            if path=='/api/update-install' and post:
                from updater import latest_installer,start_install
                artifact=latest_installer(store.meta('settings',DEFAULTS).get('update_repo'),VERSION)
                if not artifact['available']:raise ValueError('The latest version is already installed.')
                result=start_install(BASE,store.directory,artifact,self.server.server_port,self.server.server_address[0],os.getpid(),self.server.instance_id,token,session['csrf'])
                return self.send(202,result)
            if path=='/api/update-quiesce' and post:
                from updater import read_update_status
                state=read_update_status(store.directory)
                if not ipaddress.ip_address(self.client_address[0]).is_loopback or state.get('status')!='installing':return self.send(403,{'error':'No local update worker is installing.'})
                cancel_folder_picker()
                with store.lock:store.backup();self.server.installing=True
                self.server.restart_requested=False
                self.send(200,{'ready':True})
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            if path=='/api/server-control' and post:
                if d.get('action') not in ('stop','restart'):raise ValueError('Unknown action.')
                cancel_folder_picker()
                self.server.restart_requested=d['action']=='restart'
                self.send(200,{'ok':True})
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            if path=='/api/logout' and post:
                store.forget(token)
                with self.server.state_lock:self.server.sessions.pop(token,None)
                return self.send(200,{'ok':True},extra={'Set-Cookie':'mpl_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'})
            if path=='/api/data' and not post:return self.send(200,store.all_data())
            if path=='/api/bulk-units' and post:return self.send(200,store.bulk_units(d,strict_catalog=True))
            if path=='/api/record' and post:return self.send(200,store.save_record(d.get('record'),d.get('rev'),strict_catalog=True))
            if path=='/api/trash-unit' and post:store.trash_unit(d['id'],d['unit'],d['rev']);return self.send(200,{'ok':True})
            if path in ('/api/trash','/api/untrash') and post:store.trash(d['id'],d['rev'],path.endswith('untrash'));return self.send(200,{'ok':True})
            if path=='/api/purge' and post:store.purge(d['id'],d['rev']);return self.send(200,{'ok':True})
            if path=='/api/catalog-delete' and post:store.delete_catalog(d);return self.send(200,{'ok':True})
            if path=='/api/catalog' and post:return self.send(200,store.save_catalog(d))
            if path=='/api/network-test' and post:return self.send(200,network_info(self.server.server_port,True))
            if path=='/api/network' and not post:return self.send(200,network_info(self.server.server_port))
            if path=='/api/backup-folder' and post:return self.send(200,choose_backup_folder(d.get('path','')))
            if path=='/api/folders' and post:return self.send(200,folder_listing(d.get('path','')))
            if path=='/api/settings' and post:return self.send(200,store.settings(d))
            if path=='/api/move' and post:return self.send(200,store.move(d))
            if path=='/api/repair' and post:return self.send(200,store.repair(d))
            if path=='/api/inventory' and post:return self.send(200,store.inventory(d))
            if path=='/api/import' and post:return self.send(200,store.import_rows(d.get('rows'),bool(d.get('commit'))))
            if path=='/api/history' and not post:
                rid=urllib.parse.parse_qs(p.query).get('id',[''])[0]
                with store.connect() as c:rows=[dict(r) for r in c.execute('SELECT at,action,data FROM history WHERE record_id=? ORDER BY id DESC LIMIT 100',(rid,))]
                return self.send(200,rows)
            if path=='/api/backup' and post:return self.send(200,store.backup())
            if path=='/api/backup-status' and not post:return self.send(200,store.backup_status())
            if path=='/api/backups' and not post:return self.send(200,[{'name':x.name,'bytes':x.stat().st_size,'at':dt.datetime.fromtimestamp(x.stat().st_mtime,dt.timezone.utc).isoformat()} for x in sorted(store.backups.glob('MyPhoneLibrary-*.zip'),reverse=True)])
            if path=='/api/download-backup' and not post:
                name=urllib.parse.parse_qs(p.query).get('name',[''])[0]
                if not re.fullmatch(r'MyPhoneLibrary-[\d-]+[a-f0-9]{4}\.zip',name):raise ValueError('Invalid backup filename.')
                return self.send_file(store.backups/name,'application/zip',name)
            if path=='/api/restore' and post:
                result=store.restore(raw)
                with self.server.state_lock:self.server.sessions.clear()
                return self.send(200,result)
            if path=='/api/export' and not post:
                return self.send(200,store.all_data(),extra={'Content-Disposition':'attachment; filename="MyPhoneLibrary-export.json"'})
            if path=='/api/update-state' and not post:
                pending=store.directory/'pending-update/app-manifest.json'
                target=json.loads(pending.read_text(encoding='utf-8'))['version'] if pending.exists() else None
                error=store.directory/'update-error.txt'
                from updater import read_update_status
                return self.send(200,{'job':read_update_status(store.directory),'installed':VERSION,'pending':target,'error':error.read_text(encoding='utf-8') if error.exists() else ''})
            if path=='/api/update-check' and post:
                if d.get('platform')=='android':
                    from updater import latest_android
                    return self.send(200,latest_android(d.get('current_version','')))
                if d.get('platform','windows')!='windows':raise ValueError('Unknown update platform.')
                from updater import latest_installer
                info=latest_installer(store.meta('settings',DEFAULTS).get('update_repo'),VERSION)
                return self.send(200,{k:v for k,v in info.items() if k in ('available','version','size')})
            if path=='/api/update-download' and post:
                from updater import download_release,stage
                content=download_release(store.meta('settings',DEFAULTS).get('update_repo'),VERSION)
                with store.lock:
                    store.backup()
                    result=stage(content,store.directory,VERSION)
                return self.send(200,{'version':result,'restart':True})
            if path=='/api/update' and post:
                from updater import stage
                with store.lock:
                    store.backup()
                    result=stage(raw,store.directory,VERSION)
                return self.send(200,{'version':result,'restart':True})
            if path=='/api/gsm' and post:
                try:return self.send(200,gsm_preview(url(d.get('url'))))
                except (OSError,urllib.error.URLError):return self.send(502,{'error':'GSMArena is unavailable or blocking downloads. Use manual entry; your saved data is unchanged.'})
            if path in ('/api/upload','/api/image-import') and post:
                if path=='/api/image-import':
                    address=json.loads(raw)['url'];raw=remote_get(address,True)
                if len(raw)>10*1024*1024:raise ValueError('Images may not exceed 10 MB.')
                if raw.startswith(b'\x89PNG\r\n\x1a\n'):ext='png'
                elif raw.startswith(b'\xff\xd8\xff'):ext='jpg'
                elif raw.startswith((b'GIF87a',b'GIF89a')):ext='gif'
                elif raw[:4]==b'RIFF' and raw[8:12]==b'WEBP':ext='webp'
                else:raise ValueError('Supported images: PNG, JPEG, GIF and WebP.')
                name=ident()+'.'+ext
                with store.lock:(store.media/name).write_bytes(raw)
                return self.send(200,{'url':'/media/'+name})
            if path=='/api/password' and post:
                auth=store.meta('auth');old=str(d.get('old',''));new=str(d.get('password',''))
                if not hmac.compare_digest(password_hash(old,auth['salt'])['hash'],auth['hash']):raise ValueError('Current password is incorrect.')
                if not 8<=len(new)<=512:raise ValueError('New password must have 8–512 characters.')
                store.forget()
                with store.lock,store.connect() as c:store.setmeta(c,'auth',password_hash(new))
                with self.server.state_lock:self.server.sessions.clear()
                return self.send(200,{'ok':True})
            if path.startswith('/media/'):
                if not re.fullmatch(r'/media/[a-f0-9]{32}\.(jpg|png|gif|webp)',path):raise ValueError('Invalid image.')
                file=store.media/Path(path).name
            elif not post and path in ('/','/index.html','/app.js','/qr.js','/style.css','/manifest.webmanifest','/icon.svg'):
                file=BASE/'web'/('index.html' if path=='/' else path[1:])
            else:return self.send(404,{'error':'Not found.'})
            if not file.is_file():return self.send(404,{'error':'File not found.'})
            return self.send(200,file.read_bytes(),mimetypes.guess_type(file.name)[0] or 'application/octet-stream')
        except Conflict as e:self.send(409,{'error':str(e)})
        except (ValueError,KeyError,TypeError,zipfile.BadZipFile,sqlite3.IntegrityError) as e:self.send(400,{'error':str(e)})
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception:
            traceback.print_exc()
            try:self.send(500,{'error':'Operation failed. Data was not committed; check the server window.'})
            except OSError:pass

def backup_worker(server):
    while not getattr(server,'stopping',False):
        time.sleep(30)
        try:
            days=server.store.meta('settings',DEFAULTS).get('backup_days',1)
            with server.operation_lock:
                if not server.installing and server.store.meta('auth') and time.time()-server.store.last_backup>days*86400:server.store.backup()
        except Exception as e:print('Backup:',str(e),flush=True)

def port_in_use(host,port):
    target='127.0.0.1' if host in ('0.0.0.0','',None) else host
    try:
        with socket.create_connection((target,port),timeout=.3):return True
    except OSError:return False

def bind_server(host,requested,store):
    ports=[9000,8091] if requested in (None,8091,9000) else [requested]
    last=None
    for port in ports:
        if port_in_use(host,port):
            last=OSError('Port '+str(port)+' is already in use.');continue
        try:return AppServer((host,port),store)
        except OSError as e:last=e
    raise last

def start_legacy_redirect(host,port):
    if port_in_use(host,8091):return None
    class LegacyHandler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path.split('?')[0]=='/api/status':
                body=dump({'product':PRODUCT,'version':VERSION,'port':port,'authenticated':False}).encode()
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body);return
            hostname=urllib.parse.urlsplit('http://'+self.headers.get('Host','localhost')).hostname or 'localhost'
            if ':' in hostname:hostname='['+hostname+']'
            self.send_response(302);self.send_header('Location',f'http://{hostname}:{port}/');self.send_header('Cache-Control','no-store');self.end_headers()
    try:redirect=HostHTTPServer((host,8091),LegacyHandler)
    except OSError:return None
    redirect.daemon_threads=True
    threading.Thread(target=redirect.serve_forever,daemon=True).start()
    return redirect

def ensure_windows_port(port):
    # A new port needs one Windows elevation; later launches reuse this exact rule.
    exe=str(Path(sys.executable).resolve()).replace("'","''")
    rule='MyPhoneLibrary - TCP '+str(port)
    check=f"$r=Get-NetFirewallRule -DisplayName '{rule}' -ErrorAction SilentlyContinue; $p=$r|Get-NetFirewallPortFilter; $a=$r|Get-NetFirewallApplicationFilter; if(($r.Enabled -contains 'True') -and ($r.Action -contains 'Allow') -and ($p.LocalPort -contains '{port}') -and ($a.Program -contains '{exe}')) {{exit 0}}; exit 1"
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    try:
        if subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',check],capture_output=True,timeout=20,creationflags=flags).returncode==0:return
        import base64
        command=f"Remove-NetFirewallRule -DisplayName '{rule}' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '{rule}' -Direction Inbound -Action Allow -Program '{exe}' -Protocol TCP -LocalPort {port} -RemoteAddress LocalSubnet,100.64.0.0/10 -Profile Any"
        encoded=base64.b64encode(command.encode('utf-16le')).decode()
        elevate="Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -EncodedCommand "+encoded+"'"
        subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',elevate],capture_output=True,timeout=60,creationflags=flags)
    except (OSError,subprocess.TimeoutExpired) as e:print('Network setup: '+str(e),flush=True)

def main():
    parser=argparse.ArgumentParser(description=PRODUCT)
    parser.add_argument('--port',type=int,default=None);parser.add_argument('--host',default='0.0.0.0')
    parser.add_argument('--data',default=None)
    parser.add_argument('--no-browser',action='store_true');parser.add_argument('--reset-password',action='store_true')
    args=parser.parse_args()
    from updater import resolve_data_directory
    store=Store(resolve_data_directory(args.data))
    from battery_catalog import apply_battery_catalog
    apply_battery_catalog(store)
    if sys.stdout is None or sys.stderr is None:
        logfile=store.directory/'server.log'
        if logfile.exists() and logfile.stat().st_size>2*1024*1024:
            try:logfile.replace(logfile.with_suffix('.previous.log'))
            except OSError:pass
        stream=open(logfile,'a',encoding='utf-8',buffering=1)
        if sys.stdout is None:sys.stdout=stream
        if sys.stderr is None:sys.stderr=stream
    if args.reset_password:
        store.forget()
        import getpass
        pw=getpass.getpass('Nova lozinka: ')
        if len(pw)<8:raise SystemExit('Najmanje 8 znakova.')
        with store.lock,store.connect() as c:store.setmeta(c,'auth',password_hash(pw))
        print('Lozinka je promijenjena. Ponovo pokreni aplikaciju.');return
    # Reopening the launcher must reuse the existing instance, including fallback ports.
    try:
        previous=json.loads((store.directory/'server-running.json').read_text(encoding='utf-8'))
        with urllib.request.urlopen(f"http://127.0.0.1:{int(previous['port'])}/api/status",timeout=1) as response:running=json.load(response)
        if running.get('product')==PRODUCT:
            if not args.no_browser:webbrowser.open(f"http://localhost:{int(previous['port'])}")
            return 0
    except (OSError,ValueError,KeyError):pass
    try:server=bind_server(args.host,args.port,store)
    except OSError as e:print('No available application port: '+str(e),flush=True);return 1
    args.port=server.server_port
    legacy=start_legacy_redirect(args.host,args.port) if args.port==9000 else None
    if os.name=='nt' and args.port in (9000,8091):threading.Thread(target=ensure_windows_port,args=(args.port,),daemon=True).start()
    running_file=store.directory/'server-running.json'
    running_file.write_text(dump({'port':args.port,'pid':os.getpid()}),encoding='utf-8')
    print(f'{PRODUCT} {VERSION}\nLokalno: http://localhost:{args.port}\nLAN/Tailscale: http://<IP-racunara>:{args.port}\nPodaci: {store.directory}\nZaustavi: Ctrl+C',flush=True)
    if not args.no_browser:threading.Timer(0.8,lambda:webbrowser.open(f'http://localhost:{args.port}')).start()
    threading.Thread(target=backup_worker,args=(server,),daemon=True).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        server.stopping=True;cancel_folder_picker();server.server_close()
        if legacy:legacy.shutdown();legacy.server_close()
        with store.lock:pass  # Let an active backup finish before process exit.
        try:
            if json.loads(running_file.read_text()).get('pid')==os.getpid():running_file.unlink()
        except (OSError,ValueError):pass
    if getattr(server,'restart_requested',False):
        restart_server(BASE,store.directory,args.port,args.host)

def restart_server(root,directory,port,host):
    # Apply to the exact running installation and data folder; do not delegate
    # to a launcher which may use a different default data directory.
    from updater import apply
    try:
        apply(root,directory)
        (Path(directory)/'update-error.txt').unlink(missing_ok=True)
    except Exception as e:
        (Path(directory)/'update-error.txt').write_text(str(e),encoding='utf-8')
        print('Update failed; restarting the previous version: '+str(e),flush=True)
    return subprocess.Popen([sys.executable,str(Path(root)/'server.py'),'--no-browser','--port',str(port),'--host',host,'--data',str(directory)],cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),start_new_session=os.name!='nt')

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--folder-picker':
        selected=native_folder_dialog(base64.b64decode(sys.argv[2]).decode('utf-8'))
        if selected:sys.stdout.write(base64.b64encode(selected.encode('utf-8')).decode('ascii'));sys.stdout.flush()
    else:raise SystemExit(main())
