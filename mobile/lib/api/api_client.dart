import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'token_store.dart';

enum _Refresh { ok, rejected, offline }

class ApiException implements Exception {
  final int status;
  final String message;
  /// Machine-readable reason from the server (for example REASON_REQUIRED, TOO_FAR) and the full reply, when there is one.
  final String? code;
  final Map<String, dynamic>? data;
  const ApiException(this.status, this.message, {this.code, this.data});
  bool get isNetwork => status == 0;
  @override
  String toString() => message;
}

/// Talks to the FSM API. Adds the login token, and when the short-lived token has expired
/// it silently exchanges the refresh token once and retries the request.
class ApiClient {
  final String baseUrl;
  final http.Client _http;
  final TokenStore store;
  Future<_Refresh>? _refreshing;

  /// Called when the refresh token is rejected, i.e. the user must sign in again.
  void Function()? onSessionExpired;

  ApiClient({required this.baseUrl, required this.store, http.Client? client}) : _http = client ?? http.Client();

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<Map<String, dynamic>> login(String identifier, String password) async {
    final res = await _send('POST', '/auth/login', body: {'identifier': identifier, 'password': password}, auth: false);
    final data = res as Map<String, dynamic>;
    await store.write(Tokens(data['accessToken'] as String, data['refreshToken'] as String));
    return data['user'] as Map<String, dynamic>;
  }

  Future<void> logout() async {
    final t = await store.read();
    if (t != null) {
      try {
        await _send('POST', '/auth/logout', body: {'refreshToken': t.refresh}, auth: false);
      } catch (_) {/* signing out locally matters more than telling the server */}
    }
    await store.clear();
  }

  Future<dynamic> get(String path) => _authed('GET', path);

  /// Multipart upload of one file (job photos, signature). Retries once after a token refresh, like normal calls.
  Future<dynamic> upload(String path, List<int> bytes, String filename) async {
    try {
      return await _sendFile(path, bytes, filename);
    } on ApiException catch (e) {
      if (e.status != 401) rethrow;
      switch (await _refresh()) {
        case _Refresh.ok:
          return _sendFile(path, bytes, filename);
        case _Refresh.offline:
          throw const ApiException(0, 'Cannot reach the server. Check your internet connection.');
        case _Refresh.rejected:
          await store.clear();
          onSessionExpired?.call();
          rethrow;
      }
    }
  }

  Future<dynamic> _sendFile(String path, List<int> bytes, String filename) async {
    final t = await store.read();
    final req = http.MultipartRequest('POST', _uri(path));
    if (t != null) req.headers['Authorization'] = 'Bearer ${t.access}';
    req.headers['Accept'] = 'application/json';
    req.files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));
    http.Response res;
    try {
      res = await http.Response.fromStream(await _http.send(req).timeout(const Duration(seconds: 60)));
    } on TimeoutException {
      throw const ApiException(0, 'The upload took too long. Check your internet and try again.');
    } catch (_) {
      throw const ApiException(0, 'Cannot reach the server. Check your internet connection.');
    }
    dynamic data;
    if (res.body.isNotEmpty) {
      try { data = jsonDecode(utf8.decode(res.bodyBytes)); } catch (_) {}
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;
    throw ApiException(res.statusCode, _message(res.statusCode, data), code: data is Map ? data['code']?.toString() : null, data: data is Map ? Map<String, dynamic>.from(data) : null);
  }
  Future<dynamic> post(String path, [Map<String, dynamic>? body]) => _authed('POST', path, body: body ?? {});
  Future<dynamic> patch(String path, [Map<String, dynamic>? body]) => _authed('PATCH', path, body: body ?? {});

  Future<dynamic> _authed(String method, String path, {Map<String, dynamic>? body}) async {
    try {
      return await _send(method, path, body: body);
    } on ApiException catch (e) {
      if (e.status != 401) rethrow;
      switch (await _refresh()) {
        case _Refresh.ok:
          return _send(method, path, body: body);
        case _Refresh.offline:
          // We could not ask the server: that says nothing about the login. Keep it and report the network problem.
          throw const ApiException(0, 'Cannot reach the server. Check your internet connection.');
        case _Refresh.rejected:
          await store.clear();
          onSessionExpired?.call();
          rethrow;
      }
    }
  }

  // One refresh at a time, even if several requests hit 401 together (the refresh token is single-use).
  Future<_Refresh> _refresh() {
    return _refreshing ??= () async {
      try {
        final t = await store.read();
        if (t == null) return _Refresh.rejected;
        final res = await _send('POST', '/auth/refresh', body: {'refreshToken': t.refresh}, auth: false);
        final data = res as Map<String, dynamic>;
        await store.write(Tokens(data['accessToken'] as String, data['refreshToken'] as String));
        return _Refresh.ok;
      } on ApiException catch (e) {
        return e.isNetwork ? _Refresh.offline : _Refresh.rejected;
      } finally {
        Future.microtask(() => _refreshing = null);
      }
    }();
  }

  Future<dynamic> _send(String method, String path, {Map<String, dynamic>? body, bool auth = true}) async {
    final headers = <String, String>{'Content-Type': 'application/json', 'Accept': 'application/json'};
    if (auth) {
      final t = await store.read();
      if (t != null) headers['Authorization'] = 'Bearer ${t.access}';
    }
    http.Response res;
    try {
      final uri = _uri(path);
      final enc = body == null ? null : jsonEncode(body);
      res = await (switch (method) {
        'GET' => _http.get(uri, headers: headers),
        'POST' => _http.post(uri, headers: headers, body: enc),
        'PATCH' => _http.patch(uri, headers: headers, body: enc),
        _ => throw ArgumentError('unsupported method $method'),
      }).timeout(const Duration(seconds: 12));
    } on TimeoutException {
      throw const ApiException(0, 'The server took too long to respond. Check your internet and try again.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw const ApiException(0, 'Cannot reach the server. Check your internet connection.');
    }
    dynamic data;
    if (res.body.isNotEmpty) {
      try {
        data = jsonDecode(utf8.decode(res.bodyBytes));
      } catch (_) {/* non-JSON body */}
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;
    throw ApiException(res.statusCode, _message(res.statusCode, data), code: data is Map ? data['code']?.toString() : null, data: data is Map ? Map<String, dynamic>.from(data) : null);
  }

  static String _message(int status, dynamic data) {
    final m = data is Map ? data['message'] : null;
    if (m is List && m.isNotEmpty) return m.join(', ');
    if (m is String && m.isNotEmpty) return m;
    if (status == 401) return 'Wrong user ID or password.';
    if (status == 429) return 'Too many attempts. Please wait a minute and try again.';
    if (status >= 500) return 'The server had a problem. Please try again shortly.';
    return 'Something went wrong (error $status).';
  }
}
