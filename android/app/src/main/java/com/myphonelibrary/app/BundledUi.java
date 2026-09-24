package com.myphonelibrary.app;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;

/** Serve only the APK's listed UI files, under the existing server origin. */
final class BundledUi {
    private final AssetManager assets;
    private final Set<String> files = new HashSet<>();

    BundledUi(AssetManager assets) {
        this.assets = assets;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(assets.open("ui-files.txt"), StandardCharsets.UTF_8))) {
            String path;
            while ((path = reader.readLine()) != null) files.add(path);
        } catch (Exception error) {
            throw new IllegalStateException("APK frontend is missing", error);
        }
        if (!files.contains("index.html")) throw new IllegalStateException("APK frontend entry point is missing");
    }

    private static int port(Uri uri) {
        return uri.getPort() >= 0 ? uri.getPort() : "https".equals(uri.getScheme()) ? 443 : 80;
    }

    WebResourceResponse intercept(WebResourceRequest request, String server) {
        if (!"GET".equals(request.getMethod()) || server.isEmpty()) return null;
        Uri uri = request.getUrl(), origin = Uri.parse(server);
        if (uri.getHost() == null || !uri.getHost().equalsIgnoreCase(origin.getHost())
                || !uri.getScheme().equals(origin.getScheme()) || port(uri) != port(origin)) return null;
        String path = uri.getPath();
        if (path == null) return null;
        if (path.equals("/")) path = "/index.html";
        // API, media and unknown routes always reach the real server.
        if (!path.startsWith("/") || path.contains("..") || path.contains("\\")) return null;
        path = path.substring(1);
        if (!files.contains(path)) return null;
        HashMap<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        headers.put("Referrer-Policy", "no-referrer");
        try {
            return new WebResourceResponse(mime(path), "UTF-8", 200, "OK", headers, assets.open("ui/" + path));
        } catch (Exception error) {
            // Never silently mix a damaged APK with a newer server frontend.
            return new WebResourceResponse("text/plain", "UTF-8", 503, "Missing APK asset", headers,
                    new ByteArrayInputStream("Reinstall the Android application.".getBytes(StandardCharsets.UTF_8)));
        }
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webmanifest") || path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }
}
