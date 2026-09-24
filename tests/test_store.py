import copy
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
import zipfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store, AppServer, Conflict, password_hash

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def phone(self,model='N73',instances=None):
        return self.store.save_record({'kind':'phone','brand':'Nokia','model':model,'instances':instances if instances is not None else [{'color':'Srebrna','edition':'Obična','imei':'111111111111111','state':'Ispravan'}]})
    def test_three_instances_preserve_edition_imei_and_photos_after_restart(self):
        r=self.phone();r['instances'].extend([{'color':'Crna','edition':'Music Edition','imei':'222222222222222'},{'color':'Crvena','edition':'Obična','imei':'333333333333333','photos':['/media/'+'a'*32+'.jpg']}])
        r=self.store.save_record(r,r['rev']);reopened=Store(self.tmp.name).all_data()['records']
        self.assertEqual(len(reopened),1);self.assertEqual(len(reopened[0]['instances']),3)
        self.assertEqual(len({u['inv'] for u in r['instances']}),3)
        self.assertEqual(reopened[0]['instances'][1]['edition'],'Music Edition')
        self.assertEqual(reopened[0]['instances'][2]['photos'],['/media/'+'a'*32+'.jpg'])
        self.assertEqual(reopened[0]['instances'][0]['photos'],[])
    def test_stale_edits_do_not_overwrite(self):
        r=self.phone();stale=copy.deepcopy(r);r['note']='novije';self.store.save_record(r,r['rev'])
        stale['note']='starije'
        with self.assertRaises(Conflict):self.store.save_record(stale,stale['rev'])
        self.assertEqual(self.store.records()[0]['note'],'novije')
    def test_duplicate_models_and_inventory_ids_rejected(self):
        r=self.phone()
        with self.assertRaises(Conflict):self.phone('n73')
        with self.assertRaises(ValueError):self.phone('6600',[{'inv':r['instances'][0]['inv']}])
        self.assertEqual(len(self.store.records()),1)
    def test_unknown_not_false_and_no_silent_instance_deletion(self):
        r=self.phone();self.assertIsNone(r['instances'][0]['box'])
        r['instances'][0]['box']=False;r=self.store.save_record(r,r['rev'])
        self.assertIs(r['instances'][0]['box'],False)
        r['instances']=[]
        with self.assertRaises(ValueError):self.store.save_record(r,r['rev'])
    def test_stock_reservation_install_and_negative_guard(self):
        phone=self.phone();part=self.store.save_record({'kind':'part','model':'Ekran','quantity':3,'compatible':[phone['id']]})
        self.store.move({'part_id':part['id'],'action':'Rezerviši','quantity':1})
        self.store.move({'part_id':part['id'],'action':'Ugradi rezervisano','quantity':1,'record_id':phone['id'],'instance_id':phone['instances'][0]['id']})
        p=next(r for r in self.store.records() if r['kind']=='part');self.assertEqual((p['quantity'],p['reserved']),(2,0))
        with self.assertRaises(ValueError):self.store.move({'part_id':p['id'],'action':'Otpiši','quantity':3})
        self.assertEqual(len(self.store.all_data()['movements']),2)
    def test_soft_delete_restore_preserves_instances(self):
        r=self.phone();self.store.trash(r['id'],r['rev'])
        self.assertEqual(self.store.records(),[]);deleted=self.store.records(trash=True)[0]
        self.store.trash(r['id'],deleted['rev'],True);self.assertEqual(self.store.records()[0]['instances'][0]['imei'],'111111111111111')
    def test_inventory_does_not_delete_missing(self):
        r=self.phone(instances=[{'location':'A3'},{'location':'A3'},{'location':'B1'}]);inv=self.store.inventory({'location':'A3'})
        self.assertEqual(len(inv['expected']),2)
        inv=self.store.inventory({'id':inv['id'],'instance_id':r['instances'][0]['id'],'found':True});self.assertEqual(len(inv['found']),1)
        self.store.inventory({'id':inv['id'],'action':'close'})
        self.assertEqual(len(self.store.records()[0]['instances']),3)
    def test_backup_and_restore_database_and_photos(self):
        r=self.phone();photo=self.store.media/('a'*32+'.png');photo.write_bytes(b'fake photo for archive hash test')
        backup=self.store.backup();self.phone('6600');photo.unlink()
        self.store.restore((self.store.backups/backup['name']).read_bytes())
        self.assertEqual(len(self.store.records()),1);self.assertTrue(photo.exists())
        self.assertGreaterEqual(len(list(self.store.backups.glob('*.zip'))),2)
    def test_tampered_backup_rejected_without_data_loss(self):
        self.phone();backup=self.store.backup();raw=(self.store.backups/backup['name']).read_bytes();out=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(raw)) as src,zipfile.ZipFile(out,'w') as dst:
            for f in src.namelist():dst.writestr(f,b'corrupt' if f=='library.sqlite3' else src.read(f))
        with self.assertRaises(ValueError):self.store.restore(out.getvalue())
        self.assertEqual(len(self.store.records()),1)
    def test_import_preview_uncertain_and_duplicate_handling(self):
        rows=[{'Brand':'Nokia','Model':'N900','Qty':'2???','Parts':'1???'},{'Brand':'Nokia','Model':'6500 Slide','Qty':'2','Box':'yes'}]
        preview=self.store.import_rows(rows);self.assertEqual(len(preview['rows']),2);self.assertEqual(self.store.records(),[])
        result=self.store.import_rows(rows,True);self.assertEqual(result['imported'],2)
        n900=next(r for r in self.store.records() if r['model']=='N900');self.assertEqual(n900['instances'],[]);self.assertEqual(n900['declared_qty'],'2???')
        slide=next(r for r in self.store.records() if r['model']=='6500 Slide');self.assertEqual(len(slide['instances']),2);self.assertIsNone(slide['instances'][0]['box'])
        self.assertEqual(self.store.import_rows(rows,True)['skipped'],2)
    def test_native_import_keeps_compatibility(self):
        phone=self.phone();self.store.save_record({'kind':'part','model':'Baterija','quantity':3,'compatible':[phone['id']]})
        with tempfile.TemporaryDirectory() as tmp:
            other=Store(tmp)
            preview=other.import_rows(self.store.records(),False)
            self.assertEqual(preview['errors'],[]);self.assertEqual(len(preview['rows']),2)
            self.assertEqual(other.records(),[])
            result=other.import_rows(self.store.records(),True)
            self.assertEqual(result['errors'],[]);self.assertEqual(result['imported'],2)
            self.assertEqual(next(r for r in other.records() if r['kind']=='part')['compatible'],[phone['id']])

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(self.tmp.name);self.server=AppServer(('127.0.0.1',0),self.store)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.base='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def request(self,path,data=None,headers=None):
        raw=json.dumps(data).encode() if data is not None else None
        req=urllib.request.Request(self.base+path,data=raw,headers={'Content-Type':'application/json','X-MPL-Client':'1',**(headers or {})})
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.loads(r.read()),r.headers
        except urllib.error.HTTPError as e:return e.code,json.loads(e.read()),e.headers
    def test_authentication_csrf_and_origin(self):
        self.assertEqual(self.request('/api/data')[0],401)
        status,data,h=self.request('/api/setup',{'password':'test-password-2026'});self.assertEqual(status,200)
        cookie=h['Set-Cookie'].split(';')[0];csrf=data['csrf']
        self.assertEqual(self.request('/api/data',headers={'Cookie':cookie})[0],200)
        self.assertEqual(self.request('/api/record',{'record':{'kind':'phone','brand':'Nokia','model':'N73'}},headers={'Cookie':cookie})[0],403)
        self.assertEqual(self.request('/api/record',{},headers={'Cookie':cookie,'X-MPL-CSRF':csrf,'Origin':'https://wrong.example'})[0],403)
        status,_,_=self.request('/api/record',{'record':{'kind':'phone','brand':'Nokia','model':'N73','instances':[{}]}},headers={'Cookie':cookie,'X-MPL-CSRF':csrf})
        self.assertEqual(status,200)
    def test_setup_requires_local_hostname(self):
        self.assertEqual(self.request('/api/setup',{'password':'test-password'},headers={'Host':'evil.example'})[0],403)
    def test_http_backup_download_and_streamed_restore(self):
        _,login,h=self.request('/api/setup',{'password':'test-backup-2026'})
        cookie=h['Set-Cookie'].split(';')[0];headers={'Cookie':cookie,'X-MPL-CSRF':login['csrf']}
        self.request('/api/record',{'record':{'kind':'phone','brand':'Nokia','model':'6600','instances':[{},{}]}},headers)
        status,backup,_=self.request('/api/backup',{},headers);self.assertEqual(status,200)
        req=urllib.request.Request(self.base+'/api/download-backup?name='+backup['name'],headers=headers)
        with urllib.request.urlopen(req) as response:content=response.read()
        self.assertTrue(zipfile.is_zipfile(io.BytesIO(content)))
        self.request('/api/record',{'record':{'kind':'phone','brand':'Nokia','model':'N73','instances':[{}]}},headers)
        req=urllib.request.Request(self.base+'/api/restore',data=content,headers={**headers,'X-MPL-Client':'1','Content-Type':'application/zip'})
        with urllib.request.urlopen(req) as response:self.assertEqual(response.status,200)
        self.assertEqual(self.request('/api/data',headers=headers)[0],401)
        self.assertEqual(len(self.store.records()),1);self.assertEqual(len(self.store.records()[0]['instances']),2)

if __name__=='__main__':unittest.main(verbosity=2)
