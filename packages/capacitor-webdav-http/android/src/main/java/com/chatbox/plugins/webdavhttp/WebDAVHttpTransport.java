package com.chatbox.plugins.webdavhttp;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class WebDAVHttpTransport {
    private static final Map<String, Set<String>> ALLOWED_TARGETS;
    private static final Set<String> ALLOWED_HEADERS = immutableSet(
        "authorization",
        "content-type",
        "depth",
        "if-match",
        "if-none-match"
    );

    static {
        Map<String, Set<String>> targets = new HashMap<>();
        targets.put("ChatboxSync/", immutableSet("MKCOL"));
        targets.put("ChatboxSync/v1/", immutableSet("MKCOL"));
        targets.put("ChatboxSync/v1/snapshot.json.enc", immutableSet("GET", "PUT", "PROPFIND"));
        ALLOWED_TARGETS = Collections.unmodifiableMap(targets);
    }

    private final OkHttpClient client;

    WebDAVHttpTransport() {
        this(
            new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .build()
        );
    }

    WebDAVHttpTransport(OkHttpClient client) {
        this.client = client;
    }

    Response execute(
        String baseUrl,
        String requestUrl,
        String method,
        Map<String, String> headers,
        String body
    ) throws IOException {
        HttpUrl target = validateTarget(baseUrl, requestUrl, method, headers, body);
        Request.Builder request = new Request.Builder().url(target);
        for (Map.Entry<String, String> header : headers.entrySet()) {
            request.header(header.getKey(), header.getValue());
        }

        RequestBody requestBody = null;
        if ("PUT".equals(method)) {
            String contentType = "application/octet-stream";
            for (Map.Entry<String, String> header : headers.entrySet()) {
                if ("content-type".equalsIgnoreCase(header.getKey())) {
                    contentType = header.getValue();
                    break;
                }
            }
            requestBody = RequestBody.create(body == null ? "" : body, MediaType.parse(contentType));
        }
        return client.newCall(request.method(method, requestBody).build()).execute();
    }

    private static HttpUrl validateTarget(
        String baseUrl,
        String requestUrl,
        String method,
        Map<String, String> headers,
        String body
    ) {
        HttpUrl base = HttpUrl.get(baseUrl);
        HttpUrl target = HttpUrl.get(requestUrl);
        if (!"https".equals(base.scheme()) || !"https".equals(target.scheme())) {
            throw new IllegalArgumentException("WebDAV URL must use HTTPS");
        }
        if (base.query() != null || base.fragment() != null || target.query() != null || target.fragment() != null) {
            throw new IllegalArgumentException("WebDAV request target is not allowed");
        }
        if (!base.scheme().equals(target.scheme()) || !base.host().equals(target.host()) || base.port() != target.port()) {
            throw new IllegalArgumentException("WebDAV request target is not allowed");
        }

        String basePath = base.encodedPath().endsWith("/") ? base.encodedPath() : base.encodedPath() + "/";
        if (!target.encodedPath().startsWith(basePath)) {
            throw new IllegalArgumentException("WebDAV request target is not allowed");
        }
        String relativePath = target.encodedPath().substring(basePath.length());
        Set<String> allowedMethods = ALLOWED_TARGETS.get(relativePath);
        if (allowedMethods == null || !allowedMethods.contains(method)) {
            throw new IllegalArgumentException("WebDAV request target is not allowed");
        }
        for (Map.Entry<String, String> header : headers.entrySet()) {
            if (!ALLOWED_HEADERS.contains(header.getKey().toLowerCase(Locale.ROOT))) {
                throw new IllegalArgumentException("WebDAV request target is not allowed");
            }
        }
        if (body != null && !"PUT".equals(method)) {
            throw new IllegalArgumentException("WebDAV request target is not allowed");
        }
        return target;
    }

    private static Set<String> immutableSet(String... values) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values)));
    }
}
