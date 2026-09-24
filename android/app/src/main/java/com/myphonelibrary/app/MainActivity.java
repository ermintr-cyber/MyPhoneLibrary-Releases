package com.myphonelibrary.app;

import android.app.Activity;
import android.provider.MediaStore;
import androidx.core.content.FileProvider;
import java.io.File;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.LinkProperties;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.window.OnBackInvokedDispatcher;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;


import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String PREFS = "mpl_connections";
    private static final String LOCAL_KEY = "local_url";
    private static final String REMOTE_KEY = "remote_url";
    private Uri capturedPhoto;
    private static final int FILE_CHOOSER_REQUEST = 3140;

    private static final int BG = Color.rgb(14, 15, 18);
    private static final int PANEL = Color.rgb(25, 28, 34);
    private static final int FIELD = Color.rgb(35, 39, 47);
    private static final int BORDER = Color.rgb(57, 63, 74);
    private static final int TEXT = Color.rgb(240, 242, 245);
    private static final int MUTED = Color.rgb(164, 172, 188);
    private static final int GOLD = Color.rgb(244, 180, 38);
    private static final int GREEN = Color.rgb(84, 208, 143);
    private static final int RED = Color.rgb(255, 126, 126);

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable scheduledConnectionCheck = this::recheckConnection;
    private WebView webView;
    private LinearLayout connectionPanel;
    private TextView connectionTitle;
    private TextView connectionMessage;
    private ProgressBar connectionProgress;
    private Button retryButton;
    private Button connectionButton;
    private ValueCallback<Uri[]> pendingFileChooser;
    private volatile String activeUrl = "";
    private BundledUi bundledUi;
    private boolean exitDialogVisible = false;
    private boolean foreground = false;
    private boolean connectionCheckRunning = false;
    private boolean connectionCheckPending = false;
    private boolean pageLoadFailed = false;
    private int connectionGeneration = 0;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(16, 18, 22));
        getWindow().setNavigationBarColor(Color.rgb(16, 18, 22));
        buildInterface();
        configureWebView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                this::handleBackNavigation
            );
        }
        registerNetworkMonitoring();
        connectAutomatically();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable background(int color, int radius, int strokeColor) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(color);
        shape.setCornerRadius(dp(radius));
        if (strokeColor != Color.TRANSPARENT) shape.setStroke(dp(1), strokeColor);
        return shape;
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }

    private Button button(String label, boolean accent) {
        Button value = new Button(this);
        value.setText(label);
        value.setTextSize(14);
        value.setAllCaps(false);
        value.setGravity(Gravity.CENTER);
        value.setPadding(dp(14), 0, dp(14), 0);
        value.setTextColor(accent ? Color.rgb(24, 20, 12) : TEXT);
        value.setTypeface(Typeface.DEFAULT, accent ? Typeface.BOLD : Typeface.NORMAL);
        value.setBackground(background(accent ? GOLD : Color.rgb(38, 42, 50), 11, accent ? Color.TRANSPARENT : BORDER));
        return value;
    }

    private void buildInterface() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });

        webView = new WebView(this);
        webView.setBackgroundColor(BG);

        // The page owns scrolling, including nested settings and form panels.
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        connectionPanel = new LinearLayout(this);
        connectionPanel.setOrientation(LinearLayout.VERTICAL);
        connectionPanel.setGravity(Gravity.CENTER_HORIZONTAL);
        connectionPanel.setPadding(dp(22), dp(22), dp(22), dp(22));
        connectionPanel.setBackground(background(PANEL, 18, BORDER));
        connectionPanel.setElevation(dp(12));

        TextView mark = text("M", 27, Color.rgb(20, 17, 10));
        mark.setGravity(Gravity.CENTER);
        mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        mark.setBackground(background(GOLD, 14, Color.TRANSPARENT));
        connectionPanel.addView(mark, new LinearLayout.LayoutParams(dp(58), dp(58)));

        connectionTitle = text("Connecting to My Phone Library", 19, TEXT);
        connectionTitle.setGravity(Gravity.CENTER);
        connectionTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-1, -2);
        titleParams.setMargins(0, dp(17), 0, 0);
        connectionPanel.addView(connectionTitle, titleParams);

        connectionMessage = text("Checking saved local and Tailscale addresses…", 13, MUTED);
        connectionMessage.setGravity(Gravity.CENTER);
        connectionMessage.setPadding(0, dp(8), 0, dp(14));
        connectionPanel.addView(connectionMessage, new LinearLayout.LayoutParams(-1, -2));

        connectionProgress = new ProgressBar(this);
        connectionPanel.addView(connectionProgress, new LinearLayout.LayoutParams(dp(34), dp(34)));

        retryButton = button("Retry", true);
        retryButton.setOnClickListener(view -> connectAutomatically());
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-1, dp(48));
        retryParams.setMargins(0, dp(16), 0, 0);
        connectionPanel.addView(retryButton, retryParams);

        connectionButton = button("Connection settings", false);
        connectionButton.setOnClickListener(view -> showConnectionSettings());
        LinearLayout.LayoutParams settingsParams = new LinearLayout.LayoutParams(-1, dp(48));
        settingsParams.setMargins(0, dp(8), 0, 0);
        connectionPanel.addView(connectionButton, settingsParams);

        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER);
        panelParams.setMargins(dp(22), dp(20), dp(22), dp(20));
        root.addView(connectionPanel, panelParams);
        setContentView(root);
        root.requestApplyInsets();
        showConnectionState(false, "Connecting to My Phone Library", "Checking saved local and Tailscale addresses…");
    }

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        bundledUi = new BundledUi(getAssets());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " MyPhoneLibraryAndroid/" + BuildConfig.VERSION_NAME);
        settings.setSafeBrowsingEnabled(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new AndroidBridge(), "MyPhoneLibraryAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    Intent intent;
                    capturedPhoto = null;
                    if (params.isCaptureEnabled()) {
                        File photos = new File(getCacheDir(), "photos"); photos.mkdirs();
                        File file = File.createTempFile("phone-", ".jpg", photos);
                        capturedPhoto = FileProvider.getUriForFile(MainActivity.this, getPackageName()+".files", file);
                        intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        intent.putExtra(MediaStore.EXTRA_OUTPUT, capturedPhoto);
                        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } else { intent = params.createIntent(); }
                    if (!params.isCaptureEnabled()) intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    pendingFileChooser = null;
                    Toast.makeText(MainActivity.this, "No file picker is available.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return bundledUi.intercept(request, activeUrl);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (pageLoadFailed || !url.equals(view.getUrl())) return;
                connectionPanel.setVisibility(View.GONE);
                view.evaluateJavascript("document.documentElement.classList.add('android-webview')", null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternalIfNeeded(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                if (!request.getUrl().toString().equals(webView.getUrl())) return;
                pageLoadFailed = true;
                CookieManager.getInstance().flush();
                tryFallbackOrShowError();
            }
        });

        webView.setDownloadListener(createDownloadListener());
    }

    private DownloadListener createDownloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(filename);
                request.setDescription("My Phone Library download");
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, "Downloading to the Downloads folder.", Toast.LENGTH_LONG).show();
            } catch (Exception error) {
                Toast.makeText(this, "Download could not be started: " + error.getMessage(), Toast.LENGTH_LONG).show();
            }
        };
    }

    private boolean openExternalIfNeeded(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null || scheme.equals("about") || scheme.equals("data") || scheme.equals("blob")) return false;
        try {
            URL active = new URL(activeUrl);
            if ((scheme.equals("http") || scheme.equals("https")) && uri.getHost() != null && uri.getHost().equalsIgnoreCase(active.getHost()) && scheme.equalsIgnoreCase(active.getProtocol()) && (uri.getPort()==active.getPort())) return false;
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    private void showConnectionState(boolean error, String title, String message) {
        connectionPanel.setVisibility(View.VISIBLE);
        connectionTitle.setText(title);
        connectionMessage.setText(message);
        connectionMessage.setTextColor(error ? RED : MUTED);
        connectionProgress.setVisibility(error ? View.GONE : View.VISIBLE);
        retryButton.setVisibility(error ? View.VISIBLE : View.GONE);
        connectionButton.setVisibility(error ? View.VISIBLE : View.GONE);
    }

    private String cleanUrl(String value) {
        String clean = value == null ? "" : value.trim();
        while (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
        return clean;
    }

    private String localUrl() {
        return cleanUrl(getSharedPreferences(PREFS, MODE_PRIVATE).getString(LOCAL_KEY, ""));
    }

    private String remoteUrl() {
        return cleanUrl(getSharedPreferences(PREFS, MODE_PRIVATE).getString(REMOTE_KEY, ""));
    }

    private boolean healthy(String base) {
        if (base.isEmpty()) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + "/api/status").openConnection();
            connection.setConnectTimeout(2400);
            connection.setReadTimeout(2400);
            connection.setRequestMethod("GET");
            return connection.getResponseCode() == 200;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private boolean isTailscaleAddress(InetAddress address) {
        if (!(address instanceof Inet4Address)) return false;
        byte[] value = address.getAddress();
        int first = value[0] & 0xff;
        int second = value[1] & 0xff;
        return first == 100 && second >= 64 && second <= 127;
    }

    private String findTailscaleIp() {
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp() || network.isLoopback()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (isTailscaleAddress(address)) return address.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private void connectAutomatically() {
        connectAutomatically(true);
    }

    private void recheckConnection() {
        connectAutomatically(false);
    }

    private void connectAutomatically(boolean showProgress) {
        if (isFinishing() || isDestroyed()) return;
        if (connectionCheckRunning) {
            connectionCheckPending = true;
            return;
        }
        mainHandler.removeCallbacks(scheduledConnectionCheck);
        connectionCheckRunning = true;
        if (showProgress || activeUrl.isEmpty()) {
            showConnectionState(false, "Connecting to My Phone Library", "Checking saved local and Tailscale addresses…");
        }
        final int generation = ++connectionGeneration;
        String local = localUrl();
        String remote = remoteUrl();
        String last = cleanUrl(getSharedPreferences(PREFS, MODE_PRIVATE).getString("last_server", ""));
        String preferred = !activeUrl.isEmpty() ? activeUrl : last;
        executor.execute(() -> {
            String chosen = (preferred.equals(local) || preferred.equals(remote)) && healthy(preferred) ? preferred : healthy(local) ? local : (healthy(remote) ? remote : "");
            runOnUiThread(() -> {
                connectionCheckRunning = false;
                if (generation != connectionGeneration || isFinishing() || isDestroyed()) return;
                if (!foreground) return;
                if (connectionCheckPending) {
                    connectionCheckPending = false;
                    scheduleConnectionCheck();
                    return;
                }
                if (!chosen.isEmpty()) {
                    if (!chosen.equals(activeUrl) || webView.getUrl() == null || pageLoadFailed) {
                        load(chosen);
                    } else {
                        connectionPanel.setVisibility(View.GONE);
                    }
                } else {
                    String tailscale = findTailscaleIp();
                    String detail = tailscale.isEmpty()
                        ? "The Windows server could not be reached. Check Wi-Fi or Tailscale and try again."
                        : "Tailscale is active on this phone, but the saved Windows server address could not be reached.";
                    showConnectionState(true, "Server unavailable", detail);
                    if (showProgress && local.isEmpty() && remote.isEmpty()) showConnectionSettings();
                }
                // VPN routes may settle after the last network callback. Keep
                // probing while visible, with at most one check in flight.
                if (!local.isEmpty() || !remote.isEmpty()) {
                    mainHandler.removeCallbacks(scheduledConnectionCheck);
                    mainHandler.postDelayed(scheduledConnectionCheck, chosen.isEmpty() ? 3000 : 15000);
                }
            });
        });
    }

    private void scheduleConnectionCheck() {
        if (!foreground || isFinishing() || isDestroyed()) return;
        mainHandler.removeCallbacks(scheduledConnectionCheck);
        mainHandler.postDelayed(scheduledConnectionCheck, 900);
    }

    private void registerNetworkMonitoring() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                scheduleConnectionCheck();
            }

            @Override
            public void onLost(Network network) {
                scheduleConnectionCheck();
            }

            @Override
            public void onCapabilitiesChanged(Network network, android.net.NetworkCapabilities capabilities) {
                scheduleConnectionCheck();
            }

            @Override
            public void onLinkPropertiesChanged(Network network, LinkProperties properties) {
                scheduleConnectionCheck();
            }
        };
        try {
            connectivityManager.registerNetworkCallback(
                new NetworkRequest.Builder()
                    .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                    .build(), networkCallback, mainHandler);
        } catch (RuntimeException ignored) {
            networkCallback = null;
        }
    }

    private void tryFallbackOrShowError() {
        showConnectionState(true, "Connection lost", "The Windows server is no longer reachable. Check Wi-Fi or Tailscale.");
        scheduleConnectionCheck();
    }

    private void load(String url) {
        pageLoadFailed = false;
        activeUrl = cleanUrl(url);
        showConnectionState(false, "Opening your library", activeUrl);
        String previous = webView.getUrl();
        String route = previous != null && previous.contains("#") ? previous.substring(previous.indexOf('#')) : "";
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("last_server",activeUrl).apply();
        webView.loadUrl(activeUrl + "/" + route);
    }

    private EditText addressField(String hint, String value) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setText(value);
        input.setTextColor(TEXT);
        input.setTextSize(14);
        input.setHintTextColor(Color.rgb(125, 134, 151));
        input.setSingleLine(true);
        input.setPadding(dp(12), dp(8), dp(12), dp(8));
        input.setBackground(background(FIELD, 9, BORDER));
        return input;
    }

    private TextView helperText(String value) {
        TextView helper = text(value, 12, MUTED);
        helper.setPadding(0, dp(3), 0, dp(9));
        return helper;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(14));
        card.setBackground(background(PANEL, 12, BORDER));
        return card;
    }

    private TextView sectionTitle(String value) {
        TextView title = text(value, 16, TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return title;
    }

    private void addCard(LinearLayout form, LinearLayout card) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.setMargins(0, 0, 0, dp(12));
        form.addView(card, params);
    }

    private boolean validOptionalUrl(String value) {
        return value.isEmpty() || value.startsWith("http://") || value.startsWith("https://");
    }

    private void showConnectionSettings() {
        runOnUiThread(() -> {
            ScrollView scroll = new ScrollView(this);
            scroll.setFillViewport(true);
            scroll.setBackgroundColor(BG);
            LinearLayout form = new LinearLayout(this);
            form.setOrientation(LinearLayout.VERTICAL);
            form.setPadding(dp(14), dp(12), dp(14), dp(8));
            scroll.addView(form, new ScrollView.LayoutParams(-1, -2));

            TextView intro = helperText("Scan the QR code from Windows Settings. The app tests the local address first and then Tailscale.");
            intro.setTextSize(13);
            form.addView(intro, new LinearLayout.LayoutParams(-1, -2));

            LinearLayout detection = card();
            detection.addView(sectionTitle("Tailscale on this phone"), new LinearLayout.LayoutParams(-1, dp(32)));
            TextView tailscaleState = helperText("Checking…");
            detection.addView(tailscaleState, new LinearLayout.LayoutParams(-1, -2));
            addCard(form, detection);

            LinearLayout qr = card();
            qr.addView(sectionTitle("Recommended setup"), new LinearLayout.LayoutParams(-1, dp(32)));
            qr.addView(helperText("Open Settings › Network on Windows and scan its connection QR code."));
            Button scan = button("Scan connection QR", true);
            qr.addView(scan, new LinearLayout.LayoutParams(-1, dp(48)));
            addCard(form, qr);

            LinearLayout manual = card();
            manual.addView(sectionTitle("Manual addresses"), new LinearLayout.LayoutParams(-1, dp(32)));
            TextView localLabel = helperText("LOCAL NETWORK");
            EditText local = addressField("http://192.168.x.x:9000", localUrl());
            TextView remoteLabel = helperText("TAILSCALE / REMOTE");
            remoteLabel.setPadding(0, dp(12), 0, dp(5));
            EditText remote = addressField("http://computer-name.tailnet.ts.net:9000", remoteUrl());
            manual.addView(localLabel, new LinearLayout.LayoutParams(-1, -2));
            manual.addView(local, new LinearLayout.LayoutParams(-1, dp(50)));
            manual.addView(remoteLabel, new LinearLayout.LayoutParams(-1, -2));
            manual.addView(remote, new LinearLayout.LayoutParams(-1, dp(50)));
            addCard(form, manual);

            AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Android connection")
                .setView(scroll)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save and connect", null)
                .create();

            scan.setOnClickListener(view -> scanConfiguration(local, remote));
            dialog.setOnShowListener(value -> {
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(GOLD);
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(MUTED);
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                    String localValue = cleanUrl(local.getText().toString());
                    String remoteValue = cleanUrl(remote.getText().toString());
                    if (localValue.isEmpty() && remoteValue.isEmpty()) {
                        local.setError("Enter or scan at least one address");
                        return;
                    }
                    if (!validOptionalUrl(localValue) || !validOptionalUrl(remoteValue)) {
                        local.setError("Addresses must start with http:// or https://");
                        return;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString(LOCAL_KEY, localValue)
                        .putString(REMOTE_KEY, remoteValue)
                        .apply();
                    dialog.dismiss();
                    connectAutomatically();
                });
                executor.execute(() -> {
                    String ip = findTailscaleIp();
                    runOnUiThread(() -> {
                        tailscaleState.setText(ip.isEmpty() ? "● Not detected" : "● Active · " + ip);
                        tailscaleState.setTextColor(ip.isEmpty() ? RED : GREEN);
                    });
                });
            });
            dialog.show();
            Window window = dialog.getWindow();
            if (window != null) {
                window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
                window.setLayout(-1, -2);
            }
        });
    }

    private void scanConfiguration(EditText local, EditText remote) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .enableAutoZoom()
            .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(this, options);
        Task<Barcode> task = scanner.startScan();
        task.addOnSuccessListener(barcode -> {
            try {
                String raw=barcode.getRawValue();
                if(raw!=null && (raw.startsWith("http://")||raw.startsWith("https://"))){
                    Uri uri=Uri.parse(raw);String host=uri.getHost();if(host==null)throw new IllegalArgumentException("Invalid address");
                    if(host.endsWith(".ts.net")||host.startsWith("100."))remote.setText(raw);else local.setText(raw);
                    Toast.makeText(this,"Address loaded. Tap Save and connect.",Toast.LENGTH_LONG).show();return;
                }
                JSONObject data = new JSONObject(raw);
                if (!"My Phone Library".equals(data.optString("app"))) throw new IllegalArgumentException("Wrong QR code");
                local.setText(data.optString("local_url", local.getText().toString()));
                remote.setText(data.optString("remote_url", remote.getText().toString()));
                Toast.makeText(this, "Addresses loaded. Tap Save and connect.", Toast.LENGTH_LONG).show();
            } catch (Exception error) {
                Toast.makeText(this, "This is not a My Phone Library connection QR code.", Toast.LENGTH_LONG).show();
            }
        }).addOnFailureListener(error -> Toast.makeText(this, "QR scan failed: " + error.getMessage(), Toast.LENGTH_LONG).show());
    }

    private class AndroidBridge {
        @JavascriptInterface
        public boolean hasBundledUi() { return true; }

        @JavascriptInterface
        public void sessionChanged() { runOnUiThread(() -> CookieManager.getInstance().flush()); }
        @JavascriptInterface
        public String getLibraryUi() {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getString("library_ui", "{}");
        }
        @JavascriptInterface
        public void saveLibraryUi(String value) {
            if (value != null && value.length() <= 100000) getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("library_ui", value).apply();
        }
        @JavascriptInterface
        public String getScrollPositions() {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getString("scroll_positions", "{}");
        }
        @JavascriptInterface
        public void saveScrollPositions(String value) {
            if (value != null && value.length() <= 20000) getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("scroll_positions", value).apply();
        }
        @JavascriptInterface
        public void openConnectionSettings() {
            showConnectionSettings();
        }

        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || pendingFileChooser == null) return;
        Uri[] result = resultCode == RESULT_OK && capturedPhoto != null ? new Uri[]{capturedPhoto} : WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        capturedPhoto = null;
        pendingFileChooser.onReceiveValue(result);
        pendingFileChooser = null;
    }

    @Override
    public void onBackPressed() {
        handleBackNavigation();
    }

    private void handleBackNavigation() {
        if (connectionPanel.getVisibility() == View.VISIBLE && webView.getUrl() != null) {
            connectionPanel.setVisibility(View.GONE);
            return;
        }
        if (webView.getUrl() == null) {
            showExitConfirmation();
            return;
        }
        webView.evaluateJavascript(
            "(function(){return typeof window.mplHandleAndroidBack==='function' ? !!window.mplHandleAndroidBack() : false;})()",
            handled -> {
                if (!"true".equals(handled)) showExitConfirmation();
            }
        );
    }

    private void showExitConfirmation() {
        if (exitDialogVisible || isFinishing()) return;
        exitDialogVisible = true;
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Exit My Phone Library?")
            .setMessage("You are already at the beginning. Do you want to close the app?")
            .setNegativeButton("Stay", null)
            .setPositiveButton("Exit", (value, which) -> finishAndRemoveTask())
            .create();
        dialog.setOnDismissListener(value -> exitDialogVisible = false);
        dialog.setOnShowListener(value -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(GOLD);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(MUTED);
        });
        dialog.show();
    }

    @Override
    protected void onPause() {
        foreground = false;
        mainHandler.removeCallbacks(scheduledConnectionCheck);
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        foreground = true;
        scheduleConnectionCheck();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacks(scheduledConnectionCheck);
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        executor.shutdownNow();
        if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
        webView.destroy();
        super.onDestroy();
    }
}
