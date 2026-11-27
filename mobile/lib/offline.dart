import 'l10n.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api/api_client.dart';

/// One action the engineer did that still has to reach the server.
class QueuedOp {
  final String id;
  final String jobId;
  final String kind; // 'post' | 'upload'
  final String path;
  final Map<String, dynamic>? body;
  final String? filePath;
  final String label;
  final String? statusAfter; // what the job looks like locally once this is synced
  QueuedOp({required this.id, required this.jobId, required this.kind, required this.path, this.body, this.filePath, required this.label, this.statusAfter});

  Map<String, dynamic> toJson() => {'id': id, 'jobId': jobId, 'kind': kind, 'path': path, 'body': body, 'filePath': filePath, 'label': label, 'statusAfter': statusAfter};
  factory QueuedOp.fromJson(Map<String, dynamic> j) => QueuedOp(
        id: j['id'] as String, jobId: j['jobId'] as String, kind: j['kind'] as String, path: j['path'] as String,
        body: j['body'] == null ? null : Map<String, dynamic>.from(j['body'] as Map), filePath: j['filePath'] as String?,
        label: j['label'] as String, statusAfter: j['statusAfter'] as String?,
      );
}

/// Offline mode (PRD 3.4): when there is no network the action is stored on the phone and sent later, in order.
/// Jobs the engineer last saw are cached so the list still opens without a connection.
class OfflineQueue extends ChangeNotifier {
  OfflineQueue._();
  static final OfflineQueue instance = OfflineQueue._();

  static const _qKey = 'offline.queue.v1';
  static const _cacheKey = 'offline.jobs.v1';
  final List<QueuedOp> _ops = [];
  final List<String> failures = [];
  bool _loaded = false;
  bool _flushing = false;

  List<QueuedOp> get pending => List.unmodifiable(_ops);
  bool hasPendingFor(String jobId) => _ops.any((o) => o.jobId == jobId);
  bool hasQueued(String jobId, String suffix) => _ops.any((o) => o.jobId == jobId && o.path.endsWith(suffix));
  String? statusOverride(String jobId) {
    for (final o in _ops.reversed) {
      if (o.jobId == jobId && o.statusAfter != null) return o.statusAfter;
    }
    return null;
  }

  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_qKey);
    if (raw != null) {
      try {
        for (final j in jsonDecode(raw) as List) {
          _ops.add(QueuedOp.fromJson(Map<String, dynamic>.from(j as Map)));
        }
      } catch (_) {/* a damaged queue file must not block the app */}
    }
    notifyListeners();
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_qKey, jsonEncode(_ops.map((o) => o.toJson()).toList()));
  }

  String _id() => '${DateTime.now().microsecondsSinceEpoch}-${_ops.length}';

  /// Sends the request now; if the network is down (or earlier actions for this job are still waiting) it is stored instead.
  /// Returns true when the action was queued rather than delivered.
  Future<bool> post(ApiClient api, String jobId, String path, Map<String, dynamic> body, {required String label, String? statusAfter}) async {
    await load();
    final op = QueuedOp(id: _id(), jobId: jobId, kind: 'post', path: path, body: body, label: label, statusAfter: statusAfter);
    if (!hasPendingFor(jobId)) {
      try {
        await api.post(path, body);
        return false;
      } on ApiException catch (e) {
        if (!e.isNetwork) rethrow;
      }
    }
    _ops.add(op);
    await _save();
    notifyListeners();
    return true;
  }

  Future<bool> upload(ApiClient api, String jobId, String path, List<int> bytes, String filename, {required String label}) async {
    await load();
    if (!hasPendingFor(jobId)) {
      try {
        await api.upload(path, bytes, filename);
        return false;
      } on ApiException catch (e) {
        if (!e.isNetwork) rethrow;
      }
    }
    final dir = await getApplicationDocumentsDirectory();
    final q = Directory('${dir.path}/queue');
    if (!await q.exists()) await q.create(recursive: true);
    final id = _id();
    final f = File('${q.path}/$id-$filename');
    await f.writeAsBytes(bytes);
    _ops.add(QueuedOp(id: id, jobId: jobId, kind: 'upload', path: path, filePath: f.path, label: label));
    await _save();
    notifyListeners();
    return true;
  }

  /// Sends waiting actions oldest first. Stops at the first network failure; an action the server refuses is dropped and reported.
  Future<int> flush(ApiClient api) async {
    await load();
    if (_flushing || _ops.isEmpty) return 0;
    _flushing = true;
    var sent = 0;
    try {
      while (_ops.isNotEmpty) {
        final op = _ops.first;
        try {
          if (op.kind == 'post') {
            await api.post(op.path, op.body ?? {});
          } else {
            final f = File(op.filePath!);
            if (await f.exists()) await api.upload(op.path, await f.readAsBytes(), f.uri.pathSegments.last);
          }
          sent++;
        } on ApiException catch (e) {
          if (e.isNetwork) break;
          if (e.status == 401) break; // session handling deals with it
          if (e.status == 403 && e.message.contains('check in first')) { failures.add(tr('wait_checkin', {'t': op.label})); break; } // keep it; nothing is lost
          failures.add('${op.label}: ${e.message}');
        }
        _ops.removeAt(0);
        if (op.filePath != null) { try { await File(op.filePath!).delete(); } catch (_) {} }
        await _save();
        notifyListeners();
      }
    } finally {
      _flushing = false;
      notifyListeners();
    }
    return sent;
  }

  void clearFailures() {
    failures.clear();
    notifyListeners();
  }

  // ───── cached job list ─────
  Future<void> cacheJobs(List<dynamic> jobs) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_cacheKey, jsonEncode(jobs));
  }

  /// Keeps the saved list in step with what the engineer just saw online, so offline never shows an older state.
  Future<void> updateCachedJob(Map<String, dynamic> job) async {
    final list = await cachedJobs();
    if (list == null) return;
    final i = list.indexWhere((j) => j['id'] == job['id']);
    if (i < 0) return;
    list[i] = job;
    await cacheJobs(list);
  }

  Future<List<Map<String, dynamic>>?> cachedJobs() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_cacheKey);
    if (raw == null) return null;
    try {
      return (jsonDecode(raw) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return null;
    }
  }
}
