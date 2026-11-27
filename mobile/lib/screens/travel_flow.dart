import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:url_launcher/url_launcher.dart';
import '../api/api_client.dart';
import '../l10n.dart';
import '../tracking.dart';
import '../ui/theme.dart';

/// Big, single-purpose button used by every step of the journey.
class BigButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool secondary;
  final Color? color;
  const BigButton({super.key, required this.label, required this.icon, this.onPressed, this.secondary = false, this.color});

  @override
  Widget build(BuildContext context) {
    final child = Row(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, size: 24), const SizedBox(width: 10), Flexible(child: Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)))]);
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
    return SizedBox(
      width: double.infinity,
      height: 64,
      child: secondary
          ? OutlinedButton(onPressed: onPressed, style: OutlinedButton.styleFrom(shape: shape, side: BorderSide(color: color ?? AppColors.primary, width: 1.5), foregroundColor: color ?? AppColors.primary), child: child)
          : FilledButton(onPressed: onPressed, style: FilledButton.styleFrom(shape: shape, backgroundColor: color ?? AppColors.primary), child: child),
    );
  }
}

double _km(double lat1, double lng1, double lat2, double lng2) {
  double r(double d) => d * math.pi / 180;
  final a = math.pow(math.sin(r(lat2 - lat1) / 2), 2) + math.cos(r(lat1)) * math.cos(r(lat2)) * math.pow(math.sin(r(lng2 - lng1) / 2), 2);
  return 6371 * 2 * math.asin(math.sqrt(a));
}

String _problem(Object e) => switch (e) {
      FixError f => tr(f.key),
      ApiException a => a.isNetwork ? tr('need_net') : a.message,
      _ => tr('need_net'),
    };

Future<void> openRoute(double lat, double lng) async {
  final nav = Uri.parse('google.navigation:q=$lat,$lng&mode=d');
  if (await canLaunchUrl(nav)) { await launchUrl(nav); return; }
  await launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving'), mode: LaunchMode.externalApplication);
}

/// Start -> where am I -> choose how to go -> on the way -> (scan) -> at the machine.
/// Pops with true when the engineer is at the machine and the work has started.
class TravelScreen extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic> job;
  const TravelScreen({super.key, required this.api, required this.job});

  @override
  State<TravelScreen> createState() => _TravelScreenState();
}

enum _Stage { locating, choose, atSite, unknown, travelling, error }

class _TravelScreenState extends State<TravelScreen> {
  _Stage _stage = _Stage.locating;
  Map<String, dynamic>? _check;
  Map<String, dynamic>? _leg;
  double? _destLat, _destLng, _kmLeft;
  String? _err;
  bool _busy = false;
  Timer? _tick;
  StreamSubscription<Position>? _pos;
  DateTime? _since;

  String get _id => widget.job['id'] as String;

  @override
  void initState() {
    super.initState();
    final legs = (widget.job['travelLegs'] as List?) ?? const [];
    final open = legs.cast<Map>().where((l) => l['status'] == 'travelling').toList();
    if (widget.job['phase'] == 'travelling' && open.isNotEmpty) {
      _leg = Map<String, dynamic>.from(open.first);
      final sl = _leg!['siteLat'], sg = _leg!['siteLng'];
      if (sl != null && sg != null) { _destLat = double.tryParse('$sl'); _destLng = double.tryParse('$sg'); }
      _since = DateTime.tryParse('${_leg!['startedAt']}')?.toLocal();
      _stage = _Stage.travelling;
      _watch();
    } else {
      _locate();
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    _pos?.cancel();
    super.dispose();
  }

  Future<void> _locate() async {
    setState(() { _stage = _Stage.locating; _err = null; });
    try {
      final p = await TrackingService.fix();
      final r = Map<String, dynamic>.from(await widget.api.post('/jobs/$_id/travel/check', {'lat': p.latitude, 'lng': p.longitude, 'accuracyM': p.accuracy}) as Map);
      if (!mounted) return;
      final dest = r['destination'] as Map?;
      setState(() {
        _check = r;
        _destLat = dest == null ? null : (dest['lat'] as num).toDouble();
        _destLng = dest == null ? null : (dest['lng'] as num).toDouble();
        _stage = r['atSite'] == true ? _Stage.atSite : r['siteKnown'] == true ? _Stage.choose : _Stage.unknown;
      });
    } catch (e) {
      if (mounted) setState(() { _err = _problem(e); _stage = _Stage.error; });
    }
  }

  Future<void> _start(String? mode) async {
    setState(() => _busy = true);
    try {
      final p = await TrackingService.fix();
      final r = Map<String, dynamic>.from(await widget.api.post('/jobs/$_id/start', {'lat': p.latitude, 'lng': p.longitude, 'accuracyM': p.accuracy, 'mode': ?mode}) as Map);
      await TrackingService.instance.setTravel(true, widget.api);
      _leg = r['leg'] == null ? null : Map<String, dynamic>.from(r['leg'] as Map);
      _since = DateTime.tryParse('${_leg?['startedAt']}')?.toLocal() ?? DateTime.now();
      if (!mounted) return;
      setState(() => _stage = _Stage.travelling);
      _watch();
      if (mode == 'app_route' && _destLat != null) await openRoute(_destLat!, _destLng!);
    } on ApiException catch (e) {
      if (mounted) { _toast(e.message); }
    } catch (e) {
      if (mounted) _toast(_problem(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _watch() {
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
    _pos?.cancel();
    if (_destLat == null) return;
    _pos = Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 25)).listen((p) {
      if (mounted) setState(() => _kmLeft = _km(p.latitude, p.longitude, _destLat!, _destLng!));
    }, onError: (_) {});
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m), backgroundColor: AppColors.danger));

  Future<void> _scan() async {
    final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ScanScreen(api: widget.api, job: widget.job)));
    if (ok == true && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final el = _since == null ? null : DateTime.now().difference(_since!);
    String clock(Duration d) => '${d.inHours.toString().padLeft(2, '0')}:${(d.inMinutes % 60).toString().padLeft(2, '0')}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';
    final c = _check;
    return Scaffold(
      appBar: AppBar(title: Text(widget.job['jobNumber'] as String, style: const TextStyle(fontSize: 16))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: switch (_stage) {
            _Stage.locating => Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Center(child: CircularProgressIndicator()), const SizedBox(height: 20), Text(tr('checking_location'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 18))]),
            _Stage.error => Column(mainAxisAlignment: MainAxisAlignment.center, children: [const Icon(Icons.location_off, size: 56, color: AppColors.danger), const SizedBox(height: 16), Text(_err ?? '', textAlign: TextAlign.center, style: const TextStyle(fontSize: 17)), const SizedBox(height: 24), BigButton(label: tr('try_again'), icon: Icons.refresh, onPressed: _locate)]),
            _Stage.atSite => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Spacer(), const Icon(Icons.where_to_vote, size: 72, color: AppColors.success), const SizedBox(height: 16),
                Text(tr('you_are_here'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)), const SizedBox(height: 8),
                Text(tr('scan_hint'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textMuted)), const Spacer(),
                BigButton(label: tr('start_job'), icon: Icons.play_arrow, onPressed: _busy ? null : () async { await _start(null); if (_stage == _Stage.travelling && mounted) await _scan(); }),
              ]),
            _Stage.unknown => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Spacer(), const Icon(Icons.explore_outlined, size: 72, color: AppColors.primary), const SizedBox(height: 16),
                Text(tr('site_unknown'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 17, height: 1.4)), const SizedBox(height: 12),
                Text(tr('start_hint'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: AppColors.textMuted)), const Spacer(),
                BigButton(label: tr('start_job'), icon: Icons.play_arrow, onPressed: _busy ? null : () => _start('direct')),
              ]),
            _Stage.choose => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Spacer(),
                const Icon(Icons.directions_car_filled_outlined, size: 64, color: AppColors.primary), const SizedBox(height: 14),
                Text(tr('you_are_away', {'km': '${(c?['routeKm'] ?? c?['straightKm'] ?? 0)}', 'min': '${c?['routeMinutes'] ?? '-'}'}), textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, height: 1.3)),
                const SizedBox(height: 8),
                Text(tr('start_hint'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 14, color: AppColors.textMuted)),
                const SizedBox(height: 22),
                Text(tr('choose_how'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const Spacer(),
                BigButton(label: tr('show_route'), icon: Icons.alt_route, onPressed: _busy ? null : () => _start('app_route')),
                const SizedBox(height: 12),
                BigButton(label: tr('own_way'), icon: Icons.directions_walk, secondary: true, onPressed: _busy ? null : () => _start('direct')),
                const SizedBox(height: 6),
                Text(tr('own_way_hint'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint)),
              ]),
            _Stage.travelling => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Spacer(),
                const Icon(Icons.local_shipping_outlined, size: 64, color: AppColors.primary), const SizedBox(height: 10),
                Text(tr('on_the_way'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)), const SizedBox(height: 18),
                Text(tr('travel_time'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: AppColors.textFaint)),
                Text(el == null ? '--' : clock(el), textAlign: TextAlign.center, style: const TextStyle(fontSize: 44, fontWeight: FontWeight.w800, fontFeatures: [FontFeature.tabularFigures()])),
                if (_kmLeft != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('km_left', {'km': _kmLeft!.toStringAsFixed(1)}), textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, color: AppColors.textMuted))),
                const Spacer(),
                if (_destLat != null) ...[BigButton(label: tr('open_map'), icon: Icons.map_outlined, secondary: true, onPressed: () => openRoute(_destLat!, _destLng!)), const SizedBox(height: 12)],
                BigButton(label: tr('reached'), icon: Icons.qr_code_scanner, onPressed: _scan),
              ]),
          },
        ),
      ),
    );
  }
}

/// Scans the QR on the machine. The server checks it is the right machine and that the phone really is at the station.
class ScanScreen extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic> job;
  const ScanScreen({super.key, required this.api, required this.job});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _ctl = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _busy = false;
  String? _msg;
  String get _id => widget.job['id'] as String;
  static final _uuid = RegExp(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}');

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  Future<void> _arrive({String? machineId, String? reason, String? reasonLang, bool voice = false, String? override}) async {
    setState(() { _busy = true; _msg = tr('scanning'); });
    try {
      final p = await TrackingService.fix();
      await TrackingService.instance.flush(widget.api); // the server needs the whole track to measure the trip
      await widget.api.post('/jobs/$_id/arrive', {
        'lat': p.latitude, 'lng': p.longitude, 'accuracyM': p.accuracy,
        'machineId': ?machineId, 'reason': ?reason, 'reasonLang': ?reasonLang, 'reasonVoice': voice, 'overrideReason': ?override,
      });
      await TrackingService.instance.setTravel(false, widget.api);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      await _handle(e, machineId, override);
    } catch (e) {
      if (mounted) setState(() { _msg = _problem(e); _busy = false; });
    }
  }

  Future<void> _handle(ApiException e, String? machineId, String? override) async {
    if (!mounted) return;
    final d = e.data ?? const {};
    switch (e.code) {
      case 'WRONG_MACHINE':
        setState(() { _msg = tr('wrong_machine'); _busy = false; });
      case 'TOO_FAR':
        final m = (d['distanceM'] as num?)?.toInt() ?? 0;
        setState(() { _msg = tr('too_far', {'m': m >= 1000 ? '${(m / 1000).toStringAsFixed(1)} km' : '$m m'}); _busy = false; });
      case 'REASON_REQUIRED':
        final r = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => ReasonScreen(expectedKm: (d['expectedKm'] as num?)?.toDouble(), actualKm: (d['actualKm'] as num?)?.toDouble())));
        if (r == null) { if (mounted) setState(() { _busy = false; _msg = null; }); return; }
        await _arrive(machineId: machineId, reason: r['reason'] as String, reasonLang: r['lang'] as String, voice: r['voice'] == true, override: override);
      default:
        setState(() { _msg = e.isNetwork ? tr('need_net') : e.message; _busy = false; });
    }
  }

  void _onDetect(BarcodeCapture cap) {
    if (_busy) return;
    for (final b in cap.barcodes) {
      final m = _uuid.firstMatch(b.rawValue ?? '');
      if (m != null) { _arrive(machineId: m.group(0)!.toLowerCase()); return; }
    }
    setState(() => _msg = tr('wrong_machine'));
  }

  Future<void> _noQr() async {
    final r = await Navigator.of(context).push<Map<String, dynamic>>(MaterialPageRoute(builder: (_) => const ReasonScreen(title: 'qr_not_working')));
    if (r == null) return;
    await _arrive(override: r['reason'] as String);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(title: Text(tr('scan_title'), style: const TextStyle(fontSize: 16)), backgroundColor: Colors.black, foregroundColor: Colors.white),
        body: Stack(children: [
          MobileScanner(controller: _ctl, onDetect: _onDetect, errorBuilder: (c, e) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(tr('camera_perm'), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 17))))),
          Center(child: Container(width: 250, height: 250, decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(18)))),
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: Container(
              color: Colors.black87,
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: SafeArea(top: false, child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text(_msg ?? tr('scan_hint'), textAlign: TextAlign.center, style: TextStyle(color: _msg != null && !_busy ? Colors.amber : Colors.white, fontSize: 16, height: 1.35)),
                const SizedBox(height: 14),
                BigButton(label: tr('qr_not_working'), icon: Icons.qr_code_2, secondary: true, color: Colors.white, onPressed: _busy ? null : _noQr),
              ])),
            ),
          ),
        ]),
      );
}

/// Why did you take longer / go further? Type it, or speak it (turned into text on the phone, in the chosen language).
class ReasonScreen extends StatefulWidget {
  final double? expectedKm, actualKm;
  final String title;
  const ReasonScreen({super.key, this.expectedKm, this.actualKm, this.title = 'more_km_title'});

  @override
  State<ReasonScreen> createState() => _ReasonScreenState();
}

class _ReasonScreenState extends State<ReasonScreen> {
  final _text = TextEditingController();
  final _speech = stt.SpeechToText();
  bool _ready = false, _listening = false, _usedVoice = false;
  String? _note;

  @override
  void dispose() {
    _speech.stop();
    _text.dispose();
    super.dispose();
  }

  Future<void> _mic() async {
    if (_listening) { await _speech.stop(); setState(() => _listening = false); return; }
    if (!_ready) _ready = await _speech.initialize(onError: (_) { if (mounted) setState(() => _listening = false); }, onStatus: (s) { if (s == 'done' || s == 'notListening') { if (mounted) setState(() => _listening = false); } });
    if (!_ready) { setState(() => _note = tr('mic_unavailable')); return; }
    setState(() { _listening = true; _note = null; });
    await _speech.listen(
      listenOptions: stt.SpeechListenOptions(partialResults: true, listenMode: stt.ListenMode.dictation, localeId: AppLang.speechLocale[AppLang.current.value]),
      onResult: (r) { if (mounted) setState(() { _text.text = r.recognizedWords; _usedVoice = true; }); },
    );
  }

  @override
  Widget build(BuildContext context) {
    final ok = _text.text.trim().length >= 3;
    return Scaffold(
      appBar: AppBar(title: Text(tr(widget.title), style: const TextStyle(fontSize: 16))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (widget.expectedKm != null && widget.actualKm != null) Text(tr('more_km_text', {'exp': widget.expectedKm!.toStringAsFixed(1), 'act': widget.actualKm!.toStringAsFixed(1)}), style: const TextStyle(fontSize: 16, height: 1.4)),
            const SizedBox(height: 14),
            Expanded(child: TextField(controller: _text, maxLines: null, expands: true, textAlignVertical: TextAlignVertical.top, onChanged: (_) => setState(() {}), style: const TextStyle(fontSize: 18), decoration: InputDecoration(hintText: tr('reason_hint'), border: const OutlineInputBorder()))),
            if (_note != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_note!, style: const TextStyle(color: AppColors.danger))),
            const SizedBox(height: 12),
            BigButton(label: _listening ? tr('listening') : tr('speak'), icon: _listening ? Icons.stop_circle_outlined : Icons.mic, secondary: !_listening, color: _listening ? AppColors.danger : null, onPressed: _mic),
            const SizedBox(height: 10),
            BigButton(label: tr('send'), icon: Icons.send, onPressed: ok ? () => Navigator.of(context).pop({'reason': _text.text.trim(), 'lang': AppLang.current.value, 'voice': _usedVoice}) : null),
          ]),
        ),
      ),
    );
  }
}
