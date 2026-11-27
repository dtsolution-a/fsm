import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fsm_engineer/api/api_client.dart';
import 'package:fsm_engineer/api/token_store.dart';
import 'package:fsm_engineer/l10n.dart';
import 'package:fsm_engineer/l10n_more.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:fsm_engineer/screens/complete_screen.dart';
import 'package:fsm_engineer/screens/job_detail_screen.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response json(int status, Object body) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

Map<String, dynamic> job(String status, {String? phase, List<Map<String, dynamic>> spares = const [], List<Map<String, dynamic>> legs = const []}) => {
      'id': '11111111-1111-1111-1111-111111111111', 'jobNumber': 'JOB-1', 'client': {'companyName': 'Acme Industries'}, 'site': {'siteName': 'Plant 1', 'address': 'MIDC'},
      'siteProduct': {'id': '22222222-2222-2222-2222-222222222222', 'serialNumber': 'SN1', 'rawModel': 'GA-37', 'model': {'name': 'GA 37'}},
      'jobType': {'label': 'Breakdown Repair'}, 'priority': {'code': 'high', 'label': 'High'}, 'status': {'code': status, 'label': status},
      'scheduledStart': '2026-10-10T05:00:00.000Z', 'engineers': [], 'partsUsed': [], 'attachments': [], 'myRole': 'primary', 'accepted': true,
      'phase': phase, 'spareRequests': spares, 'travelLegs': legs,
    };

Future<void> open(WidgetTester tester, Map<String, dynamic> j) async {
  final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async {
    if (req.url.path == '/engineers/me/attendance/today') return json(200, {'date': '2026-10-10', 'record': {'checkInAt': '2026-10-10T03:00:00Z', 'checkOutAt': null}});
    return json(200, j);
  }));
  await tester.pumpWidget(MaterialApp(home: JobDetailScreen(api: api, initial: j)));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async { await initializeDateFormatting(); });
  setUp(() { SharedPreferences.setMockInitialValues({}); AppLang.current.value = 'en'; });

  test('every language has every word, and keeps the {placeholders}', () {
    final en = tr('start_hint'); expect(en, isNotEmpty);
    for (final lang in AppLang.options.keys) {
      AppLang.current.value = lang;
      for (final key in ['next_step', 'accept', 'start_job', 'you_are_away', 'km_left', 'too_far', 'more_km_text', 'collect_at', 'spare_sent', 'reached', 'work_done', 'need_spares', 'speak', 'language']) {
        expect(tr(key), isNot(key), reason: '$lang is missing $key');
      }
      expect(tr('you_are_away', {'km': '12', 'min': '30'}), allOf(contains('12'), contains('30')), reason: lang);
      expect(tr('more_km_text', {'exp': '12', 'act': '18'}), allOf(contains('12'), contains('18')), reason: lang);
      expect(tr('collect_at', {'hub': 'Surat Hub'}), contains('Surat Hub'), reason: lang);
      expect(tr('you_are_away'), contains('{km}'), reason: 'placeholders are only filled when given');
    }
  });

  test('every other text of the app exists in all four languages with the same {placeholders}', () {
    final en = moreT['en']!;
    for (final lang in ['hi', 'gu', 'mr']) {
      final m = moreT[lang]!;
      expect(m.keys.toSet(), en.keys.toSet(), reason: '$lang has different keys than English');
      for (final k in en.keys) {
        final ph = RegExp(r'\{(\w+)\}');
        expect(ph.allMatches(m[k]!).map((x) => x.group(1)).toSet(), ph.allMatches(en[k]!).map((x) => x.group(1)).toSet(), reason: '$lang / $k placeholders');
        expect(m[k]!.trim(), isNotEmpty, reason: '$lang / $k');
      }
    }
  });

  test('dates are written in the chosen language', () {
    final d = DateTime(2026, 11, 27, 15, 5);
    AppLang.current.value = 'en'; final e = fmtDate('EEEE, d MMMM yyyy', d);
    AppLang.current.value = 'hi'; final h = fmtDate('EEEE, d MMMM yyyy', d);
    AppLang.current.value = 'gu'; final g = fmtDate('EEEE', d);
    expect(e, contains('November')); expect(h, isNot(e)); expect(g, isNot(fmtDate('EEEE', d).isEmpty ? 'x' : 'Friday'));
  });

  testWidgets('assigned and accepted: one big button, Start job', (tester) async {
    await open(tester, job('assigned'));
    expect(find.text('Start job'), findsWidgets);
    expect(find.text('I need spare parts'), findsNothing);
  });

  testWidgets('on the road: the button takes you to the scan', (tester) async {
    await open(tester, job('in_progress', phase: 'travelling', legs: [{'status': 'travelling', 'startedAt': '2026-10-10T05:00:00Z'}]));
    expect(find.text('On the way to the site'), findsWidgets);
    expect(find.text('I have reached - scan QR'), findsOneWidget);
    expect(find.text('Work is finished'), findsNothing);
  });

  testWidgets('at the machine: finish or ask for spare parts', (tester) async {
    await open(tester, job('in_progress', phase: 'working', legs: [{'status': 'arrived', 'endedAt': '2026-10-10T05:30:00Z'}]));
    expect(find.text('Work is finished'), findsOneWidget);
    expect(find.text('I need spare parts'), findsOneWidget);
    expect(find.text('Working at the machine'), findsOneWidget);
  });

  testWidgets('waiting for the office to give spares: nothing to press, a clear message', (tester) async {
    await open(tester, job('on_hold', phase: 'on_hold', spares: [{'status': 'requested', 'items': []}]));
    expect(find.text('Waiting for spare parts'), findsOneWidget);
    expect(find.text('Start job'), findsNothing);
    expect(find.text('Work is finished'), findsNothing);
  });

  testWidgets('spares given: tells where to collect and to start again', (tester) async {
    await open(tester, job('rescheduled', spares: [{'status': 'allocated', 'collectedAt': null, 'hubName': 'Surat Hub', 'hubAddress': 'GIDC, Surat', 'decisionNote': 'Ask for Ramesh', 'items': []}]));
    expect(find.text('Spare parts are ready'), findsOneWidget);
    expect(find.textContaining('Surat Hub'), findsOneWidget);
    expect(find.textContaining('Ask for Ramesh'), findsOneWidget);
    expect(find.text('Start job'), findsWidgets);
  });

  testWidgets('the same screen in Hindi', (tester) async {
    AppLang.current.value = 'hi';
    await open(tester, job('in_progress', phase: 'working', legs: [{'status': 'arrived', 'endedAt': '2026-10-10T05:30:00Z'}]));
    expect(find.text('काम पूरा हो गया'), findsOneWidget);
    expect(find.text('मुझे स्पेयर पार्ट चाहिए'), findsOneWidget);
  });

  testWidgets('completion: all spares used, or some left over to take back', (tester) async {
    final j = job('in_progress', phase: 'working');
    j['partsUsed'] = [{'sparePartId': 'p1', 'quantity': 3, 'allocatedAt': '2026-10-10T05:00:00Z', 'consumedAt': null, 'sparePart': {'name': 'Oil filter', 'partNumber': 'OF-1'}}];
    final api = ApiClient(baseUrl: 'http://x', store: MemoryTokenStore()..write(const Tokens('A', 'R')), client: MockClient((req) async => json(200, j)));
    await tester.pumpWidget(MaterialApp(home: CompleteScreen(api: api, job: j)));
    await tester.pumpAndSettle();
    expect(find.text('SPARE PARTS GIVEN TO YOU'), findsOneWidget);
    expect(find.text('All the spares were used'), findsOneWidget);
    expect(find.textContaining('Used '), findsNothing);
    await tester.tap(find.text('Some spares are left over'));
    await tester.pumpAndSettle();
    expect(find.text('Used 3 of 3'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.remove_circle_outline).first);
    await tester.pumpAndSettle();
    expect(find.text('Used 2 of 3'), findsOneWidget);
    expect(find.text('Take back 1 to the hub'), findsOneWidget);
  });

  testWidgets('a finished job reminds what must go back to the hub', (tester) async {
    final j = job('completed');
    j['partsUsed'] = [{'sparePartId': 'p1', 'quantity': 1, 'returnQty': 2, 'returnedAt': null, 'sparePart': {'name': 'Oil filter', 'partNumber': 'OF-1'}}];
    await open(tester, j);
    await tester.scrollUntilVisible(find.text('TAKE THESE SPARES BACK'), 300, scrollable: find.byType(Scrollable).first);
    expect(find.text('TAKE THESE SPARES BACK'), findsOneWidget);
    expect(find.textContaining('Oil filter'), findsOneWidget);
  });
}
