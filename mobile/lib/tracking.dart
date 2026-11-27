import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'api/api_client.dart';

/// A location problem that the person can fix (GPS off, permission refused, no signal). `key` is a text key for tr().
class FixError implements Exception {
  final String key;
  const FixError(this.key);
  @override
  String toString() => key;
}

/// Live GPS (PRD 3.5). While the engineer is checked in the phone reports its position to the server (every ~45 seconds when it moved 30 m+).
/// While a trip to a site is running it reports every ~15 seconds when it moved 20 m+: that track is how the kilometres are measured.
/// Points are kept on the phone until the server has them, so a patch without signal does not lose part of the trip.
class TrackingService {
  TrackingService._();
  static final TrackingService instance = TrackingService._();

  StreamSubscription<Position>? _sub;
  final List<Map<String, dynamic>> _buffer = [];
  DateTime _lastFlush = DateTime.fromMillisecondsSinceEpoch(0);
  bool _travel = false;
  ApiClient? _api;
  bool get running => _sub != null;
  bool get travelling => _travel;
  String? lastProblem;

  Duration get _every => _travel ? const Duration(seconds: 15) : const Duration(seconds: 45);

  Future<bool> start(ApiClient api) async {
    _api = api;
    try {
      return await _start(api);
    } catch (_) {
      lastProblem = 'Location is not available on this device.';
      return false;
    }
  }

  static Future<void> ensurePermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) throw const FixError('gps_off');
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) throw const FixError('location_perm');
  }

  /// One good position right now (used at Start and at the QR scan).
  static Future<Position> fix() async {
    await ensurePermission();
    try {
      return await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 25)));
    } catch (_) {
      final last = await Geolocator.getLastKnownPosition();
      if (last != null && DateTime.now().difference(last.timestamp).inMinutes < 3) return last;
      throw const FixError('gps_wait');
    }
  }

  Future<bool> _start(ApiClient api) async {
    if (_sub != null) return true;
    try { await ensurePermission(); } on FixError catch (e) { lastProblem = e.key == 'gps_off' ? 'Turn on location (GPS) on your phone.' : 'Location permission is needed so the office can see where you are.'; return false; }
    lastProblem = null;
    _listen();
    // send one right away so the live map shows the engineer immediately
    try {
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)));
      _add(p);
      await flush(api);
    } catch (_) {}
    return true;
  }

  void _listen() {
    _sub?.cancel();
    final settings = AndroidSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: _travel ? 20 : 30,
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationTitle: _travel ? 'Trip in progress' : 'FSM — on duty',
        notificationText: _travel ? 'Your distance to the site is being measured.' : 'Sharing your location with the office while you are checked in.',
        enableWakeLock: true,
      ),
    );
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen((p) {
      _add(p);
      if (DateTime.now().difference(_lastFlush) >= _every && _api != null) flush(_api!);
    }, onError: (_) {});
  }

  void _add(Position p) {
    _buffer.add({'lat': double.parse(p.latitude.toStringAsFixed(6)), 'lng': double.parse(p.longitude.toStringAsFixed(6)), 'accuracyM': p.accuracy.round(), 'at': p.timestamp.toUtc().toIso8601String()});
    if (_buffer.length > 600) _buffer.removeRange(0, _buffer.length - 600);
  }

  /// Faster, finer tracking while on the road.
  Future<void> setTravel(bool on, ApiClient api) async {
    _api = api;
    if (_travel == on) return;
    _travel = on;
    if (_sub != null) _listen();
    if (!on) await flush(api);
  }

  /// Hands every waiting point to the server. On failure the points stay and go with the next try.
  Future<bool> flush(ApiClient api) async {
    if (_buffer.isEmpty) { _lastFlush = DateTime.now(); return true; }
    _lastFlush = DateTime.now();
    final batch = List<Map<String, dynamic>>.from(_buffer);
    try {
      await api.post('/engineers/me/locations/batch', {'points': batch.length > 300 ? batch.sublist(batch.length - 300) : batch});
      _buffer.removeRange(0, batch.length);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    _travel = false;
  }
}
