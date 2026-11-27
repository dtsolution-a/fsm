import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fsm_engineer/api/api_client.dart';
import 'package:fsm_engineer/api/token_store.dart';
import 'package:fsm_engineer/main.dart';
import 'package:fsm_engineer/screens/home_screen.dart';
import 'package:fsm_engineer/screens/leave_screen.dart';
import 'package:fsm_engineer/session.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('login: empty form is validated, wrong password shows the server message, right one enters the app', (tester) async {
    var ok = false;
    final store = MemoryTokenStore();
    final session = Session(ApiClient(baseUrl: 'http://x', store: store, client: MockClient((req) async {
      if (req.url.path == '/auth/login') {
        final b = jsonDecode(req.body);
        if (b['password'] == 'good') { ok = true; return json(201, {'accessToken': 'A', 'refreshToken': 'R', 'user': {'name': 'Ravi Kumar', 'role': 'engineer'}}); }
        return json(401, {'message': 'Invalid credentials'});
      }
      if (req.url.path == '/engineers/me/attendance/today') return json(200, {'date': '2026-10-10', 'record': null});
      if (req.url.path == '/engineers/me') return json(200, {'user': {'fullName': 'Ravi Kumar', 'userCode': 'User10'}, 'zones': [], 'skills': [], 'city': 'Surat'});
      if (req.url.path == '/leave-requests') return json(200, []);
      return json(200, {});
    })));
    await session.restore();
    await tester.pumpWidget(FsmApp(session: session));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pump();
    expect(find.text('Enter your user ID'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('login-id')), 'User10');
    await tester.enterText(find.byKey(const Key('login-password')), 'bad');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login-error')), findsOneWidget);
    expect(find.text('Invalid credentials'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('login-password')), 'good');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(ok, isTrue);
    expect(find.text('Hello, Ravi'), findsOneWidget);
    expect(find.text('Jobs'), findsOneWidget); // bottom navigation
    expect(find.text('Leave'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('home: check in then check out updates the status', (tester) async {
    Map<String, dynamic>? record;
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      switch (req.url.path) {
        case '/engineers/me/attendance/today':
          return json(200, {'date': '2026-10-10', 'record': record});
        case '/engineers/me/attendance/check-in':
          record = {'checkInAt': '2026-10-10T04:30:00.000Z', 'checkOutAt': null, 'isLate': false};
          return json(201, record!);
        case '/engineers/me/attendance/check-out':
          record = {...record!, 'checkOutAt': '2026-10-10T12:30:00.000Z'};
          return json(201, record!);
      }
      return json(404, {});
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: HomeScreen(api: api, userName: 'Ravi Kumar'))));
    await tester.pumpAndSettle();

    expect(find.text('Not checked in'), findsOneWidget);
    expect(find.byKey(const Key('check-out')), findsNothing);

    await tester.tap(find.byKey(const Key('check-in')));
    await tester.pumpAndSettle();
    String status() => tester.widget<Text>(find.byKey(const Key('attendance-status'))).data!;
    expect(status(), 'Checked in');
    expect(find.byKey(const Key('check-in')), findsNothing);
    expect(find.byKey(const Key('check-out')), findsOneWidget);

    await tester.tap(find.byKey(const Key('check-out')));
    await tester.pumpAndSettle();
    expect(status(), 'Day complete');
    expect(find.byKey(const Key('check-in')), findsNothing);
    expect(find.byKey(const Key('check-out')), findsNothing);
  });

  testWidgets('home: a refusal from the server is shown to the engineer, not swallowed', (tester) async {
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      if (req.url.path == '/engineers/me/attendance/today') return json(200, {'date': 'd', 'record': null});
      return json(409, {'message': 'Already checked in today'});
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: HomeScreen(api: api, userName: 'Ravi'))));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('check-in')));
    await tester.pumpAndSettle();
    expect(find.text('Already checked in today'), findsOneWidget);
  });

  testWidgets('home: when the server cannot be reached a retry button is shown', (tester) async {
    var online = false;
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      if (!online) throw http.ClientException('offline');
      return json(200, {'date': 'd', 'record': null});
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: HomeScreen(api: api, userName: 'Ravi'))));
    await tester.pumpAndSettle();
    expect(find.textContaining('internet'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    online = true;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('Not checked in'), findsOneWidget);
  });

  testWidgets('leave: lists requests; the server\'s backdated-leave refusal is shown on the form', (tester) async {
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      if (req.method == 'GET') {
        return json(200, [
          {'startDate': '2026-10-12T00:00:00.000Z', 'endDate': '2026-10-13T00:00:00.000Z', 'reason': 'Family function', 'status': 'approved'},
          {'startDate': '2026-11-01T00:00:00.000Z', 'endDate': '2026-11-01T00:00:00.000Z', 'reason': null, 'status': 'pending'},
        ]);
      }
      return json(400, {'message': 'Backdated leave applications are not allowed. This attempt has been reported to the GA Head.'});
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: LeaveScreen(api: api))));
    await tester.pumpAndSettle();
    expect(find.text('12 Oct 2026 → 13 Oct 2026'), findsOneWidget); // dates not shifted by timezone
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('Pending'), findsOneWidget);
    expect(find.text('Family function'), findsOneWidget);

    await tester.tap(find.byKey(const Key('apply-leave')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('leave-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('leave-error')), findsOneWidget);
    expect(find.textContaining('Backdated leave'), findsOneWidget);
  });
}
