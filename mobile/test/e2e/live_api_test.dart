// Runs the REAL mobile API client against a REAL running backend. Skipped unless FSM_E2E=1.
//   cd backend && npm run build && npm start     (dev DB, seeded)
//   cd mobile  && FSM_E2E=1 flutter test test/e2e   (optional: FSM_API, FSM_ADMIN_PASSWORD)
// It creates one engineer "E2E<timestamp>"; remove it afterwards with: node backend/scripts/cleanup-test-users.js E2E
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:fsm_engineer/api/api_client.dart';
import 'package:fsm_engineer/api/token_store.dart';
import 'package:fsm_engineer/session.dart';
import 'package:intl/intl.dart';

void main() {
  final enabled = Platform.environment['FSM_E2E'] == '1';
  final base = Platform.environment['FSM_API'] ?? 'http://localhost:3001/api/v1';
  final adminPw = Platform.environment['FSM_ADMIN_PASSWORD'] ?? 'ChangeMe#2026';

  test('engineer app against the live API', () async {
    final stamp = DateTime.now().millisecondsSinceEpoch.toString().substring(5);
    final code = 'E2E$stamp';
    const pw = 'E2e-Test-Pass-1234';

    // office side: create an engineer through the admin API
    final admin = ApiClient(baseUrl: base, store: MemoryTokenStore());
    await admin.login('Admin', adminPw);
    final zones = await admin.get('/zones') as List;
    final skills = await admin.get('/lookups/skill-categories') as List;
    await admin.post('/engineers', {
      'fullName': 'E2E Engineer $stamp', 'userCode': code, 'password': pw, 'phone': '9000000000', 'city': 'Surat',
      'primaryZoneId': zones.first['id'], 'skillIds': [skills.first['id']],
    });

    // engineer side: the real app code
    final store = MemoryTokenStore();
    final session = Session(ApiClient(baseUrl: base, store: store));

    await expectLater(session.login(code, 'wrong-password'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(session.state, isNot(AuthState.signedIn));

    await session.login(code, pw);
    expect(session.state, AuthState.signedIn);
    expect(session.user!['role'], 'engineer');

    // the screens' response shapes
    final me = await session.api.get('/engineers/me') as Map;
    expect((me['user'] as Map)['fullName'], 'E2E Engineer $stamp');
    expect(((me['zones'] as List).first as Map)['zone']['name'], isA<String>());
    expect(((me['skills'] as List).first as Map)['skill']['label'], isA<String>());
    expect(me['city'], 'Surat');

    var today = await session.api.get('/engineers/me/attendance/today') as Map;
    expect(today['record'], isNull);
    await session.api.post('/engineers/me/attendance/check-in');
    today = await session.api.get('/engineers/me/attendance/today') as Map;
    expect((today['record'] as Map)['checkInAt'], isA<String>());
    expect((today['record'] as Map)['checkOutAt'], isNull);
    await expectLater(session.api.post('/engineers/me/attendance/check-in'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 409)));
    await session.api.post('/engineers/me/attendance/check-out');
    today = await session.api.get('/engineers/me/attendance/today') as Map;
    expect((today['record'] as Map)['checkOutAt'], isA<String>());

    // leave: backdated is refused with the server's own message; a future one is accepted and listed
    final fmt = DateFormat('yyyy-MM-dd');
    final yesterday = fmt.format(DateTime.now().subtract(const Duration(days: 1)));
    await expectLater(
      session.api.post('/leave-requests', {'startDate': yesterday, 'endDate': yesterday}),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('Backdated'))),
    );
    final next = fmt.format(DateTime.now().add(const Duration(days: 20)));
    await session.api.post('/leave-requests', {'startDate': next, 'endDate': next, 'reason': 'e2e'});
    final leaves = await session.api.get('/leave-requests') as List;
    expect(leaves.length, 1);
    expect(leaves.first['status'], 'pending');
    expect((leaves.first['startDate'] as String).substring(0, 10), next);

    // an expired access token is renewed silently
    await store.write(Tokens('not-a-valid-token', (await store.read())!.refresh));
    final again = await session.api.get('/engineers/me') as Map;
    expect((again['user'] as Map)['userCode'], code);
    expect((await store.read())!.access, isNot('not-a-valid-token'));

    // an office account cannot use the engineer app
    final office = Session(ApiClient(baseUrl: base, store: MemoryTokenStore()));
    await expectLater(office.login('Admin', adminPw), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)));

    await session.logout();
    expect(await store.read(), isNull);

    // deactivating the account locks the engineer out
    final list = await admin.get('/engineers?search=$code') as Map;
    final id = (list['data'] as List).first['id'];
    await admin.post('/engineers/$id/deactivate');
    final locked = Session(ApiClient(baseUrl: base, store: MemoryTokenStore()));
    await expectLater(locked.login(code, pw), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
  }, skip: enabled ? false : 'set FSM_E2E=1 to run against a live backend');
}
