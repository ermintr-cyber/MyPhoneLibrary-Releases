package com.mylibraries.installer;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.widget.*;
import android.graphics.Color;
import androidx.core.content.FileProvider;
import java.io.*;
import java.util.ArrayList;
public class MainActivity extends Activity {
 private ArrayList<String> queue=new ArrayList<>(); private int position=0; private TextView status; private CheckBox media,phone; private Button install;
 @Override public void onCreate(Bundle state){super.onCreate(state);if(state!=null){queue=state.getStringArrayList("queue");if(queue==null)queue=new ArrayList<>();position=state.getInt("position");}
  LinearLayout root=new LinearLayout(this);root.setOrientation(1);int p=(int)(24*getResources().getDisplayMetrics().density);root.setPadding(p,p,p,p);root.setBackgroundColor(Color.rgb(14,16,18));
  TextView title=new TextView(this);title.setText("My Libraries");title.setTextSize(26);title.setTextColor(0xffffb900);root.addView(title);
  TextView help=new TextView(this);help.setText("Choose one or both applications. Android will ask you to confirm each installation. Both packages are included; no download is needed.");help.setTextColor(Color.WHITE);root.addView(help);
  media=new CheckBox(this);media.setText("My Media Library");media.setTextColor(Color.WHITE);media.setChecked(true);root.addView(media);
  phone=new CheckBox(this);phone.setText("My Phone Library");phone.setTextColor(Color.WHITE);phone.setChecked(true);root.addView(phone);
  install=new Button(this);install.setText("Install selected applications");root.addView(install);status=new TextView(this);status.setTextColor(Color.WHITE);root.addView(status);setContentView(root);
  install.setOnClickListener(v->{queue.clear();if(media.isChecked())queue.add("media.apk");if(phone.isChecked())queue.add("phone.apk");position=0;if(queue.isEmpty()){status.setText("Select at least one application.");return;}if(!getPackageManager().canRequestPackageInstalls()){status.setText("Allow this installer to install apps, then return here.");startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())),40);}else next();});
 }
 private void next(){if(position>=queue.size()){status.setText("Installation finished. Open the applications from your app list.");install.setEnabled(true);return;}install.setEnabled(false);String file=queue.get(position);try{
  File folder=new File(getCacheDir(),"apks");folder.mkdirs();File apk=new File(folder,file);try(InputStream in=getAssets().open(file);OutputStream out=new FileOutputStream(apk)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);}
  status.setText("Confirm installation: "+(file.equals("media.apk")?"My Media Library":"My Phone Library"));Uri uri=FileProvider.getUriForFile(this,getPackageName()+".files",apk);
  Intent intent=new Intent(Intent.ACTION_INSTALL_PACKAGE);intent.setDataAndType(uri,"application/vnd.android.package-archive");intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.putExtra(Intent.EXTRA_RETURN_RESULT,true);startActivityForResult(intent,41);
 }catch(Exception e){status.setText("Installation could not start: "+e.getMessage());install.setEnabled(true);}}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==40){if(getPackageManager().canRequestPackageInstalls())next();else status.setText("Installation permission was not granted.");}if(request==41){if(result==RESULT_OK){position++;next();}else{status.setText("Installation cancelled or failed. You can retry the selected applications.");install.setEnabled(true);}}}
 @Override protected void onSaveInstanceState(Bundle out){out.putStringArrayList("queue",queue);out.putInt("position",position);super.onSaveInstanceState(out);}
}
