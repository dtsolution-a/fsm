import 'dart:async';
import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../l10n.dart';
import '../offline.dart';
import '../tracking.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'async_view.dart';
import 'job_detail_screen.dart';

/// Today at a glance: attendance (check in / out), job counts, and the next job.
class HomeScreen extends StatelessWidget {
  final ApiClient api;
  final String userName;
  final VoidCallback? onOpenJobs;
  const HomeScreen({super.key, required this.api, required this.userName, this.onOpenJobs});

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () async => Map<String, dynamic>.from(await api.get('/engineers/me/attendance/today') as Map),
      builder: (context, data, reload) => _Body(api: api, userName: userName, data: data, reload: reload, onOpenJobs: onOpenJobs),
    );
  }
}

class _Body extends StatefulWidget {
  final ApiClient api;
  final String userName;
  final Map<String, dynamic> data;
  final Future<void> Function() reload;
  final VoidCallback? onOpenJobs;
  const _Body({required this.api, required this.userName, required this.data, required this.reload, this.onOpenJobs});

  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  bool _busy = false;
  String? _gpsNote;
  List<Map<String, dynamic>> _jobs = [];
  List<Map<String, dynamic>> _alerts = [];
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _syncTracking();
    _loadJobs();
    _loadAlerts();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _loadAlerts());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _loadAlerts() async {
    try {
      final r = await widget.api.get('/notifications?unread=true') as Map;
      final items = ((r['items'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).where((n) => n['isRead'] != true).toList();
      if (mounted) setState(() => _alerts = items);
    } catch (_) {/* messages are optional */}
  }

  Future<void> _readAlert(String id) async {
    try { await widget.api.patch('/notifications/$id/read'); } catch (_) {}
    await _loadAlerts();
  }

  static (String, String) _alertText(Map<String, dynamic> n) {
    final p = Map<String, dynamic>.from((n['payload'] as Map?) ?? const {});
    final job = '${p['job'] ?? ''}';
    return switch (n['eventCode']) {
      'spare_allocated' => (tr('spares_ready'), '$job\n${tr('collect_at', {'hub': '${p['hub'] ?? ''}'})}${(p['address'] ?? '').toString().isEmpty ? '' : '\n${p['address']}'}${(p['note'] ?? '').toString().isEmpty ? '' : '\n${p['note']}'}\n${tr('collect_then')}'),
      'spare_rejected' => (tr('spares_no'), '$job ${p['note'] ?? ''}'.trim()),
      'spares_to_return' => (tr('return_title'), '$job\n${((p['items'] as List?) ?? const []).map((i) => '${i['qty']} × ${i['part']}${i['hub'] == null ? '' : ' → ${i['hub']}'}').join('\n')}'),
      'job_assigned' => (tr('job_update'), job),
      'parts_allocated' => (tr('parts_allocated'), job),
      'job_reminder' => (tr('job_reminder'), job),
      _ => ('${n['eventCode']}'.replaceAll('_', ' '), job),
    };
  }

  Future<void> _loadJobs() async {
    try {
      final raw = await widget.api.get('/engineers/me/jobs');
      if (raw is List && mounted) setState(() => _jobs = raw.map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } on ApiException {
      final cached = await OfflineQueue.instance.cachedJobs();
      if (cached != null && mounted) setState(() => _jobs = cached);
    } catch (_) {/* summary is optional */}
  }

  // GPS sharing runs only while checked in and not yet checked out
  Future<void> _syncTracking() async {
    final rec = widget.data['record'] as Map<String, dynamic>?;
    final onDuty = rec != null && rec['checkOutAt'] == null;
    if (onDuty) {
      final ok = await TrackingService.instance.start(widget.api);
      if (mounted) setState(() => _gpsNote = ok ? null : TrackingService.instance.lastProblem);
    } else {
      await TrackingService.instance.stop();
      if (mounted) setState(() => _gpsNote = null);
    }
  }

  @override
  void didUpdateWidget(covariant _Body old) {
    super.didUpdateWidget(old);
    _syncTracking();
  }

  Future<void> _act(String path, String done) async {
    setState(() => _busy = true);
    try {
      await widget.api.post(path);
      await widget.reload();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), backgroundColor: AppColors.danger));
      await widget.reload();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static String _time(dynamic iso) => fmtDate('hh:mm a', DateTime.parse(iso as String).toLocal());

  @override
  Widget build(BuildContext context) {
    final rec = widget.data['record'] as Map<String, dynamic>?;
    final checkedIn = rec != null;
    final checkedOut = rec != null && rec['checkOutAt'] != null;
    final today = fmtDate('EEEE, d MMMM yyyy', DateTime.now());

    String status;
    Color color;
    if (!checkedIn) {
      status = tr('not_checked_in');
      color = AppColors.danger;
    } else if (checkedOut) {
      status = tr('day_complete');
      color = AppColors.primary;
    } else if (rec['isLate'] == true) {
      status = tr('checked_in_late');
      color = AppColors.warning;
    } else {
      status = tr('checked_in');
      color = AppColors.success;
    }

    final active = _jobs.where((j) => !const ['completed', 'closed', 'cancelled', 'pending_review'].contains((j['status'] as Map)['code'])).toList();
    final inProgress = active.where((j) => (j['status'] as Map)['code'] == 'in_progress').length;
    final toAccept = active.where((j) => j['accepted'] == false && (j['status'] as Map)['code'] != 'in_progress').length;
    final next = active.where((j) => (j['status'] as Map)['code'] != 'in_progress').toList()
      ..sort((a, b) => ((a['scheduledStart'] as String?) ?? '9').compareTo((b['scheduledStart'] as String?) ?? '9'));

    final worked = (widget.data['workedMinutes'] as num?)?.toInt() ?? 0;
    final stretches = ((widget.data['sessions'] as List?) ?? const []).length;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      children: [
        HeroHeader(
          padding: const EdgeInsets.fromLTRB(22, 6, 22, 30),
          child: FadeIn(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(today, style: const TextStyle(fontSize: 13, color: Color(0xB3FFFFFF), fontWeight: FontWeight.w500)),
              const SizedBox(height: 2),
              Text(tr('hello', {'name': widget.userName.split(' ').first}), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: Colors.white, letterSpacing: -0.4)),
              const SizedBox(height: 16),
              Row(children: [
                Expanded(child: _HeroStat(label: tr('active_jobs'), value: '${active.length}', onTap: widget.onOpenJobs)),
                const SizedBox(width: 10),
                Expanded(child: _HeroStat(label: tr('in_progress'), value: '$inProgress', onTap: widget.onOpenJobs)),
                const SizedBox(width: 10),
                Expanded(child: _HeroStat(label: tr('to_accept'), value: '$toAccept', alert: toAccept > 0, onTap: widget.onOpenJobs)),
              ]),
            ]),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_alerts.isNotEmpty) ...[
          Section(
            title: tr('alerts'),
            child: Column(children: [
              for (final n in _alerts.take(3))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(n['eventCode'] == 'spare_allocated' ? Icons.inventory_2_outlined : Icons.notifications_active_outlined, color: AppColors.primary),
                    const SizedBox(width: 10),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(_alertText(n).$1, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700)), Text(_alertText(n).$2, style: const TextStyle(fontSize: 14, height: 1.35, color: AppColors.textMuted))])),
                    TextButton(onPressed: () => _readAlert(n['id'] as String), child: Text(tr('ok'))),
                  ]),
                ),
            ]),
          ),
          const SizedBox(height: 12),
        ],
        Section(
          title: tr('attendance'),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(status, key: const Key('attendance-status'), style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: color)),
            const SizedBox(height: 6),
            Text(checkedIn ? '${tr('in_time', {'t': _time(rec['checkInAt'])})}${checkedOut ? '   ·   ${tr('out_time', {'t': _time(rec['checkOutAt'])})}' : ''}' : tr('check_in_hint'), style: Theme.of(context).textTheme.bodySmall),
            if (checkedIn && !checkedOut) ...[
              const SizedBox(height: 10),
              Row(children: [
                Icon(_gpsNote == null ? Icons.my_location : Icons.location_off_outlined, size: 16, color: _gpsNote == null ? AppColors.success : AppColors.danger),
                const SizedBox(width: 6),
                Expanded(child: Text(_gpsNote ?? tr('sharing_loc'), style: TextStyle(fontSize: 12.5, color: _gpsNote == null ? AppColors.textMuted : AppColors.danger))),
              ]),
            ],
            if (checkedIn && worked > 0) ...[
              const SizedBox(height: 6),
              Text(tr('worked_today', {'t': '${worked ~/ 60}h ${(worked % 60).toString().padLeft(2, '0')}m', 'n': '$stretches'}), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textMuted)),
            ],
            const SizedBox(height: 16),
            if (!checkedIn)
              FilledButton.icon(key: const Key('check-in'), onPressed: _busy ? null : () => _act('/engineers/me/attendance/check-in', tr('checked_in')), icon: const Icon(Icons.login, size: 20), label: Text(tr('check_in')))
            else if (checkedOut)
              // the engineer can start again as many times as needed in a day
              FilledButton.icon(key: const Key('check-in-again'), onPressed: _busy ? null : () => _act('/engineers/me/attendance/check-in', tr('checked_in')), icon: const Icon(Icons.login, size: 20), label: Text(tr('check_in_again')))
            else
              OutlinedButton.icon(key: const Key('check-out'), onPressed: _busy ? null : () => _act('/engineers/me/attendance/check-out', 'Checked out'), icon: const Icon(Icons.logout, size: 20), label: Text(tr('check_out'))),
          ]),
        ),
        const SizedBox(height: 12),
        Section(
          title: tr('up_next'),
          trailing: TextButton(onPressed: widget.onOpenJobs, child: Text(tr('all_jobs'))),
          child: next.isEmpty
              ? Text(tr('no_upcoming'), style: Theme.of(context).textTheme.bodySmall)
              : InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () async {
                    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => JobDetailScreen(api: widget.api, initial: next.first)));
                    _loadJobs();
                  },
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(next.first['jobNumber'] as String, style: const TextStyle(fontSize: 12.5, color: AppColors.textMuted, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 2),
                        Text((next.first['client'] as Map)['companyName'] as String, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 4),
                        Text(_when(next.first['scheduledStart']), style: Theme.of(context).textTheme.bodySmall),
                      ]),
                    ),
                    const Icon(Icons.chevron_right, color: AppColors.textFaint),
                  ]),
                ),
        ),
          ]),
        ),
      ],
    );
  }

  static String _when(dynamic iso) => iso == null ? tr('not_scheduled') : fmtDate('EEE d MMM, hh:mm a', DateTime.parse(iso as String).toLocal());
}

class _HeroStat extends StatelessWidget {
  final String label;
  final String value;
  final bool alert;
  final VoidCallback? onTap;
  const _HeroStat({required this.label, required this.value, this.alert = false, this.onTap});

  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0x26FFFFFF),
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: alert ? const Color(0xFFFFD27A) : Colors.white, height: 1.2)),
              const SizedBox(height: 2),
              Text(label, maxLines: 2, style: const TextStyle(fontSize: 11.5, color: Color(0xCCFFFFFF), height: 1.25)),
            ]),
          ),
        ),
      );
}
