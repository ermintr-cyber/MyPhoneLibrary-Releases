"""Exercise the real Android bundle installer through Android's confirmation UI."""
import subprocess,time,re,xml.etree.ElementTree as ET
last_ui=None

def adb(*args):return subprocess.check_output(['adb',*args],text=True)
def tap(texts):
 global last_ui
 try:
  adb('shell','uiautomator','dump','/sdcard/window.xml');xml=adb('shell','cat','/sdcard/window.xml')
  nodes=list(ET.fromstring(xml).iter('node'))
  labels=[n.get('text','') for n in nodes if n.get('text','')]
  if labels!=last_ui:print('Visible UI:',labels,flush=True);last_ui=labels
  if 'Allow from this source' in labels:
   switch=next((n for n in nodes if n.get('checkable')=='true'),None)
   if switch is not None and switch.get('checked')!='true':
    a=list(map(int,re.findall(r'\d+',switch.get('bounds',''))));adb('shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2));time.sleep(1)
   adb('shell','input','keyevent','4');return True
  for node in nodes:
   if node.get('text','').lower() in texts and node.get('enabled')=='true':
    a=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
    if len(a)==4:adb('shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2));return True
 except Exception as e:print('UI read:',str(e),flush=True)
 return False
adb('shell','am','start','-n','com.mylibraries.installer/.MainActivity')
for i in range(50):
 tap({'install selected applications','install','update','done'})
 packages=adb('shell','pm','list','packages')
 if 'package:com.myphonelibrary.app' in packages and 'package:com.mymedialibrary.app' in packages:break
 time.sleep(2)
else:
 print(adb('shell','logcat','-d','-s','AndroidRuntime','PackageInstaller','PackageManager'),flush=True)
 print('Installed:',packages,flush=True)
 raise RuntimeError('The combined Android installer did not install both applications.')
adb('shell','am','start','-n','com.myphonelibrary.app/.MainActivity');time.sleep(3)
assert adb('shell','pidof','com.myphonelibrary.app').strip(),'Phone Android app failed to start'
print('Android bundle installed both original packages; Phone app launched.')
# Verify HttpOnly persistent cookies survive a real app-process restart.
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import threading
signed=threading.Event();restored=threading.Event();restarting=False
class CookieFixture(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  cookie='mpl_session=android-persistent-test' in self.headers.get('Cookie','')
  if self.path=='/api/status':body=b'{"version":"1.13.0"}';kind='application/json'
  elif self.path=='/confirmed':
   if cookie:signed.set()
   body=b'{}';kind='application/json'
  else:
   if restarting and cookie:restored.set()
   body=(b'<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#101010;color:white">Remembered login verified</body></html>' if restarting else b'<html><meta name="viewport" content="width=device-width,initial-scale=1"><body>Cookie persistence test<script>fetch("/session",{method:"POST"}).then(()=>{MyPhoneLibraryAndroid.sessionChanged();return fetch("/confirmed")})</script></body></html>');kind='text/html'
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_POST(self):
  self.send_response(200);self.send_header('Set-Cookie','mpl_session=android-persistent-test; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000');self.send_header('Content-Length','2');self.end_headers();self.wfile.write(b'{}')
fixture=ThreadingHTTPServer(('0.0.0.0',9000),CookieFixture);threading.Thread(target=fixture.serve_forever,daemon=True).start()
for i in range(15):
 adb('shell','uiautomator','dump','/sdcard/window.xml');nodes=list(ET.fromstring(adb('shell','cat','/sdcard/window.xml')).iter('node'))
 fields=[n for n in nodes if n.get('class')=='android.widget.EditText']
 if fields:
  a=list(map(int,re.findall(r'\d+',fields[0].get('bounds',''))));adb('shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2));adb('shell','input','text','http://10.0.2.2:9000');adb('shell','input','keyevent','4');tap({'save and connect'});break
 tap({'connection settings'});time.sleep(1)
assert signed.wait(25),'WebView did not receive the persistent session cookie'
adb('shell','input','keyevent','3');time.sleep(1)
adb('shell','am','force-stop','com.myphonelibrary.app')
restarting=True
adb('shell','am','start','-n','com.myphonelibrary.app/.MainActivity')
assert restored.wait(25),'Remembered WebView session did not survive process restart'
fixture.shutdown();print('Android persistent HttpOnly session survived closing and restarting the app.',flush=True)
