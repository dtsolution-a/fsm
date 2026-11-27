import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class Tokens {
  final String access;
  final String refresh;
  const Tokens(this.access, this.refresh);
}

/// Where the login tokens live. Production uses the OS keystore/keychain; tests use an in-memory one.
abstract class TokenStore {
  Future<Tokens?> read();
  Future<void> write(Tokens t);
  Future<void> clear();
}

class SecureTokenStore implements TokenStore {
  static const _a = 'access_token';
  static const _r = 'refresh_token';
  final FlutterSecureStorage _s = const FlutterSecureStorage();

  @override
  Future<Tokens?> read() async {
    final a = await _s.read(key: _a);
    final r = await _s.read(key: _r);
    return (a == null || r == null) ? null : Tokens(a, r);
  }

  @override
  Future<void> write(Tokens t) async {
    await _s.write(key: _a, value: t.access);
    await _s.write(key: _r, value: t.refresh);
  }

  @override
  Future<void> clear() async {
    await _s.delete(key: _a);
    await _s.delete(key: _r);
  }
}

class MemoryTokenStore implements TokenStore {
  Tokens? _t;
  @override
  Future<Tokens?> read() async => _t;
  @override
  Future<void> write(Tokens t) async => _t = t;
  @override
  Future<void> clear() async => _t = null;
}
