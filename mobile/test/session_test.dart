import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:fsm_engineer/api/api_client.dart';
import 'package:fsm_engineer/api/token_store.dart';
import 'package:fsm_engineer/session.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Session make(MemoryTokenStore store, Future<http.Response> Function(http.Request) h) => Session(ApiClient(baseUrl: 'http://x', store: store, client: MockClient(h)));

void main() {
  test('engineer can sign in', () async {
    final s = make(MemoryTokenStore(), (_) async => json(201, {'accessToken': 'A', 'refreshToken': 'R', 'user': {'name': 'Ravi', 'role': 'engineer'}}));
    await s.login('User10', 'pw');
    expect(s.state, AuthState.signedIn);
    expect(s.user!['name'], 'Ravi');
  });

  test('office roles are refused and left signed out (they use the web panel)', () async {
    final store = MemoryTokenStore();
    final s = make(store, (req) async {
      if (req.url.path == '/auth/login') return json(201, {'accessToken': 'A', 'refreshToken': 'R', 'user': {'name': 'Boss', 'role': 'admin'}});
      return json(201, {'ok': true});
    });
    await expectLater(s.login('Admin', 'pw'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)));
    expect(s.state, isNot(AuthState.signedIn));
    expect(await store.read(), isNull, reason: 'the admin token must not stay on an engineer app');
  });

  test('start-up with no saved login shows the login screen', () async {
    final s = make(MemoryTokenStore(), (_) async => json(200, {}));
    await s.restore();
    expect(s.state, AuthState.signedOut);
  });

  test('start-up with a valid saved login goes straight in', () async {
    final store = MemoryTokenStore()..write(const Tokens('A', 'R'));
    final s = make(store, (_) async => json(200, {'name': 'Ravi', 'role': 'engineer'}));
    await s.restore();
    expect(s.state, AuthState.signedIn);
  });

  test('start-up while offline keeps the saved login (engineers work in poor coverage)', () async {
    final store = MemoryTokenStore()..write(const Tokens('A', 'R'));
    final s = make(store, (_) async => throw http.ClientException('offline'));
    await s.restore();
    expect(s.state, AuthState.signedIn);
    expect(await store.read(), isNotNull);
  });

  test('start-up with a revoked login (deactivated account) signs out and clears tokens', () async {
    final store = MemoryTokenStore()..write(const Tokens('A', 'R'));
    final s = make(store, (_) async => json(401, {'message': 'Unauthorized'}));
    await s.restore();
    expect(s.state, AuthState.signedOut);
    expect(await store.read(), isNull);
  });

  test('logout returns to signed-out', () async {
    final s = make(MemoryTokenStore(), (_) async => json(201, {'accessToken': 'A', 'refreshToken': 'R', 'user': {'name': 'Ravi', 'role': 'engineer'}}));
    await s.login('u', 'p');
    await s.logout();
    expect(s.state, AuthState.signedOut);
    expect(s.user, isNull);
  });
}
