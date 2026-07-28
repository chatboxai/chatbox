package com.chatbox.plugins.webdavhttp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.util.Map;
import okhttp3.OkHttpClient;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class WebDAVHttpTransportTest {
    private MockWebServer server;
    private WebDAVHttpTransport transport;

    @Before
    public void setUp() throws Exception {
        HeldCertificate certificate = new HeldCertificate.Builder()
            .addSubjectAlternativeName("localhost")
            .build();
        HandshakeCertificates serverCertificates = new HandshakeCertificates.Builder()
            .heldCertificate(certificate)
            .build();
        HandshakeCertificates clientCertificates = new HandshakeCertificates.Builder()
            .addTrustedCertificate(certificate.certificate())
            .build();
        server = new MockWebServer();
        server.useHttps(serverCertificates.sslSocketFactory(), false);
        server.start();
        transport = new WebDAVHttpTransport(
            new OkHttpClient.Builder()
                .sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager())
                .followRedirects(false)
                .followSslRedirects(false)
                .build()
        );
    }

    @After
    public void tearDown() throws Exception {
        server.shutdown();
    }

    @Test
    public void sendsMkcolWithoutHttpUrlConnectionMethodRestrictions() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(201));

        try (Response response = transport.execute(baseUrl(), url("ChatboxSync/"), "MKCOL", Map.of(), null)) {
            assertEquals(201, response.code());
        }
        assertEquals("MKCOL", takeRequest().getMethod());
    }

    @Test
    public void sendsPropfindAndPreservesDepthHeader() throws Exception {
        server.enqueue(new MockResponse().setResponseCode(207));

        try (
            Response response = transport.execute(
                baseUrl(),
                url("ChatboxSync/v1/snapshot.json.enc"),
                "PROPFIND",
                Map.of("Depth", "0"),
                null
            )
        ) {
            assertEquals(207, response.code());
        }
        RecordedRequest request = takeRequest();
        assertEquals("PROPFIND", request.getMethod());
        assertEquals("0", request.getHeader("Depth"));
    }

    @Test
    public void doesNotFollowRedirects() throws Exception {
        server.enqueue(
            new MockResponse()
                .setResponseCode(302)
                .setHeader("Location", url("ChatboxSync/v1/snapshot.json.enc"))
        );

        try (
            Response response = transport.execute(
                baseUrl(),
                url("ChatboxSync/v1/snapshot.json.enc"),
                "GET",
                Map.of(),
                null
            )
        ) {
            assertEquals(302, response.code());
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    public void rejectsTargetsOutsideTheFixedSyncPath() throws Exception {
        try {
            transport.execute(baseUrl(), url("private.json"), "GET", Map.of(), null);
            fail("Expected fixed target validation to reject the request");
        } catch (IllegalArgumentException expected) {
            assertEquals("WebDAV request target is not allowed", expected.getMessage());
        }
        assertEquals(0, server.getRequestCount());
    }

    private String baseUrl() {
        return server.url("/dav/").toString();
    }

    private String url(String relativePath) {
        return baseUrl() + relativePath;
    }

    private RecordedRequest takeRequest() throws Exception {
        return server.takeRequest();
    }
}
