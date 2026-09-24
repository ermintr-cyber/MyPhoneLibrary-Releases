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
