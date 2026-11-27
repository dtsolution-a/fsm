import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fsm_engineer/api/api_client.dart';
import 'package:fsm_engineer/api/token_store.dart';
import 'package:fsm_engineer/offline.dart';
import 'package:fsm_engineer/screens/jobs_screen.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Map<String, dynamic> job({String status = 'assigned', bool accepted = false}) => {
      'id': '11111111-1111-1111-1111-111111111111',
      'jobNumber': 'JOB-20261010-0001',
      'client': {'companyName': 'Acme Industries'},
      'site': {'siteName': 'Plant 1', 'address': 'MIDC'},
      'siteProduct': {'id': '22222222-2222-2222-2222-222222222222', 'serialNumber': 'SN1', 'rawModel': 'GA-37', 'model': {'name': 'GA 37'}},
      'jobType': {'label': 'Breakdown Repair'},
      'priority': {'code': 'high', 'label': 'High'},
      'status': {'code': status, 'label': status},
      'scheduledStart': '2026-10-10T05:00:00.000Z',
      'engineers': [],
      'partsUsed': [],
      'attachments': [],
      'myRole': 'primary',
      'accepted': accepted,
    };

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('jobs: lists assigned jobs and opens the detail with Accept / Flag', (tester) async {
    final posts = <String>[];
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      if (req.method == 'POST') { posts.add(req.url.path); return json(201, {'ok': true}); }
      if (req.url.path == '/engineers/me/jobs') return json(200, [job()]);
      if (req.url.path.startsWith('/jobs/')) return json(200, job());
      return json(404, {});
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JobsScreen(api: api))));
    await tester.pumpAndSettle();
    expect(find.text('JOB-20261010-0001'), findsOneWidget);
    expect(find.text('Acme Industries'), findsOneWidget);
    expect(find.text('Action needed'), findsOneWidget);

    await tester.tap(find.text('Acme Industries'));
    await tester.pumpAndSettle();
    expect(find.text('Accept this job'), findsOneWidget);
    expect(find.text('I cannot take it'), findsOneWidget);
    await tester.tap(find.text('Accept this job'));
    await tester.pumpAndSettle();
    expect(posts, contains('/jobs/11111111-1111-1111-1111-111111111111/accept'));
  });

  testWidgets('jobs: offline shows the saved list and a banner', (tester) async {
    var online = true;
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      if (!online) throw http.ClientException('no network');
      return json(200, [job()]);
    }));
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JobsScreen(api: api))));
    await tester.pumpAndSettle();
    expect(find.text('JOB-20261010-0001'), findsOneWidget);

    online = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: JobsScreen(key: UniqueKey(), api: api))));
    await tester.pumpAndSettle();
    expect(find.text('JOB-20261010-0001'), findsOneWidget);
    expect(find.textContaining('Offline'), findsOneWidget);
  });

  test('offline queue: an action taken offline is stored, kept in order, and sent when the network returns', () async {
    SharedPreferences.setMockInitialValues({});
    var online = false;
    final sent = <String>[];
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
      if (!online) throw http.ClientException('no network');
      sent.add(req.url.path);
      return json(201, {'ok': true});
    }));
    final q = OfflineQueue.instance;
    await q.load();
    final before = q.pending.length;
    expect(await q.post(api, 'job-q1', '/jobs/job-q1/start', {}, label: 'start', statusAfter: 'in_progress'), isTrue);
    expect(await q.post(api, 'job-q1', '/jobs/job-q1/complete', {'signedByName': 'X'}, label: 'complete', statusAfter: 'completed'), isTrue);
    expect(q.pending.length, before + 2);
    expect(q.statusOverride('job-q1'), 'completed');
    online = true;
    await q.flush(api);
    expect(sent, ['/jobs/job-q1/start', '/jobs/job-q1/complete']);
    expect(q.hasPendingFor('job-q1'), isFalse);
  });
}
