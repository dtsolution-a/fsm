import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:fsm_engineer/api/api_client.dart';
import 'package:fsm_engineer/api/token_store.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  late MemoryTokenStore store;
  setUp(() => store = MemoryTokenStore());

  test('login stores both tokens and returns the user', () async {
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async {
      expect(req.url.path, '/auth/login');
      expect(jsonDecode(req.body), {'identifier': 'User10', 'password': 'pw'});
      return json(201, {'accessToken': 'A1', 'refreshToken': 'R1', 'user': {'name': 'Ravi', 'role': 'engineer'}});
    }));
    final user = await api.login('User10', 'pw');
    expect(user['name'], 'Ravi');
    final t = await store.read();
    expect(t!.access, 'A1');
    expect(t.refresh, 'R1');
  });

  test('wrong password gives a plain message and stores nothing', () async {
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((_) async => json(401, {'message': 'Invalid credentials'})));
    await expectLater(api.login('a', 'b'), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Invalid credentials').having((e) => e.status, 'status', 401)));
    expect(await store.read(), isNull);
  });

  test('requests carry the bearer token', () async {
    await store.write(const Tokens('TOKEN', 'R'));
    String? seen;
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async {
      seen = req.headers['Authorization'];
      return json(200, {'ok': true});
    }));
    await api.get('/anything');
    expect(seen, 'Bearer TOKEN');
  });

  test('expired access token: refreshes once, retries, and saves the new tokens', () async {
    await store.write(const Tokens('OLD', 'R-OLD'));
    final calls = <String>[];
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async {
      calls.add('${req.method} ${req.url.path} ${req.headers['Authorization'] ?? ''}');
      if (req.url.path == '/auth/refresh') {
        expect(jsonDecode(req.body)['refreshToken'], 'R-OLD');
        return json(201, {'accessToken': 'NEW', 'refreshToken': 'R-NEW', 'user': {}});
      }
      return req.headers['Authorization'] == 'Bearer NEW' ? json(200, {'data': 1}) : json(401, {'message': 'Unauthorized'});
    }));
    final res = await api.get('/engineers/me');
    expect(res['data'], 1);
    expect(calls, ['GET /engineers/me Bearer OLD', 'POST /auth/refresh ', 'GET /engineers/me Bearer NEW']);
    final t = await store.read();
    expect(t!.access, 'NEW');
    expect(t.refresh, 'R-NEW');
  });

  test('several requests expiring together trigger only ONE refresh (the refresh token is single-use)', () async {
    await store.write(const Tokens('OLD', 'R-OLD'));
    var refreshes = 0;
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async {
      if (req.url.path == '/auth/refresh') {
        refreshes++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return json(201, {'accessToken': 'NEW', 'refreshToken': 'R-NEW', 'user': {}});
      }
      return req.headers['Authorization'] == 'Bearer NEW' ? json(200, {'ok': true}) : json(401, {'message': 'Unauthorized'});
    }));
    final results = await Future.wait([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results.length, 3);
    expect(refreshes, 1);
  });

  test('refresh rejected: tokens wiped and the app is told to sign in again', () async {
    await store.write(const Tokens('OLD', 'R-DEAD'));
    var expired = false;
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async => json(401, {'message': 'Invalid refresh token'})))
      ..onSessionExpired = () => expired = true;
    await expectLater(api.get('/engineers/me'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(expired, isTrue);
    expect(await store.read(), isNull);
  });

  test('being offline during a refresh does NOT sign the engineer out', () async {
    await store.write(const Tokens('OLD', 'R'));
    var expired = false;
    var first = true;
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async {
      if (first) { first = false; return json(401, {'message': 'Unauthorized'}); }
      throw http.ClientException('no network');
    }))..onSessionExpired = () => expired = true;
    await expectLater(api.get('/x'), throwsA(isA<ApiException>()));
    expect(await store.read(), isNotNull, reason: 'tokens must survive a network blip');
    expect(expired, isFalse);
  });

  test('no network gives a friendly, non-technical message', () async {
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((_) async => throw http.ClientException('socket')));
    await expectLater(api.get('/x'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true).having((e) => e.message, 'message', contains('internet'))));
  });

  test('validation errors (array) are joined; rate limit and server errors are readable', () async {
    ApiClient apiWith(http.Response r) => ApiClient(baseUrl: 'http://x', store: store, client: MockClient((_) async => r));
    await expectLater(apiWith(json(400, {'message': ['startDate must be a date', 'endDate must be a date']})).get('/x'), throwsA(isA<ApiException>().having((e) => e.message, 'm', 'startDate must be a date, endDate must be a date')));
    await expectLater(apiWith(json(429, {'message': 'ThrottlerException: Too Many Requests'})).login('a', 'b'), throwsA(isA<ApiException>().having((e) => e.status, 's', 429)));
    await expectLater(apiWith(http.Response('<html>bad gateway</html>', 502)).get('/x'), throwsA(isA<ApiException>().having((e) => e.message, 'm', contains('server'))));
  });

  test('logout clears tokens even if the server cannot be reached', () async {
    await store.write(const Tokens('A', 'R'));
    final api = ApiClient(baseUrl: 'http://x', store: store, client: MockClient((_) async => throw http.ClientException('offline')));
    await api.logout();
    expect(await store.read(), isNull);
  });
}
