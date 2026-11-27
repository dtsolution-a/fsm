import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../api/api_client.dart';
import '../l10n.dart';
import '../offline.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'complete_screen.dart';
import 'jobs_screen.dart' show fmtWhen;
import 'machine_history_screen.dart';
import 'spare_request_screen.dart';
import 'travel_flow.dart';

/// One job: details, then the next action pinned at the bottom (accept / start / complete).
class JobDetailScreen extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic> initial;
  const JobDetailScreen({super.key, required this.api, required this.initial});

  @override
  State<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends State<JobDetailScreen> {
  late Map<String, dynamic> _job = widget.initial;
  bool _busy = false;
  bool _stale = false;
  bool? _onDuty; // null = not known yet (e.g. offline): the server still enforces the rule
  int _before = 0;
  int _after = 0;

  String get _id => _job['id'] as String;
  String get _code => OfflineQueue.instance.statusOverride(_id) ?? (_job['status'] as Map)['code'] as String;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    try {
      final j = Map<String, dynamic>.from(await widget.api.get('/jobs/$_id') as Map);
      final atts = (j['attachments'] as List?) ?? [];
      if (mounted) {
        setState(() {
          _job = {...widget.initial, ...j};
          OfflineQueue.instance.updateCachedJob(_job);
          _stale = false;
          _before = atts.where((a) => a['type'] == 'photo_before').length;
          _after = atts.where((a) => a['type'] == 'photo_after').length;
        });
      }
    } on ApiException {
      if (mounted) setState(() => _stale = true);
    }
    try {
      final t = await widget.api.get('/engineers/me/attendance/today') as Map;
      final rec = t['record'] as Map?;
      if (mounted) setState(() => _onDuty = rec != null && rec['checkOutAt'] == null);
    } on ApiException {/* keep the last known state */}
  }

  void _msg(String m, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m), backgroundColor: error ? AppColors.danger : null));
  }

  Future<void> _do(String label, String path, {Map<String, dynamic>? body, String? statusAfter}) async {
    setState(() => _busy = true);
    try {
      final queued = await OfflineQueue.instance.post(widget.api, _id, path, body ?? {}, label: '${_job['jobNumber']}: $label', statusAfter: statusAfter);
      _msg(queued ? tr('saved_sync') : tr('done'));
      await _refresh();
    } on ApiException catch (e) {
      _msg(e.message, error: true);
      await _refresh();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _decline() async {
    final c = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr('flag_title')),
        content: TextField(controller: c, autofocus: true, maxLines: 3, decoration: InputDecoration(labelText: tr('why_cannot'))),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: Text(tr('cancel'))), TextButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: Text(tr('send_office')))],
      ),
    );
    if (reason == null || reason.length < 3) return;
    await _do('Declined', '/jobs/$_id/decline', body: {'reason': reason});
    if (mounted && !_stale) Navigator.of(context).maybePop();
  }

  Future<void> _photo(String type) async {
    final shot = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 80);
    if (shot == null) return;
    setState(() => _busy = true);
    try {
      final bytes = await shot.readAsBytes();
      final queued = await OfflineQueue.instance.upload(widget.api, _id, '/jobs/$_id/attachments?type=$type', bytes, '$type.jpg', label: '${_job['jobNumber']}: photo');
      setState(() { if (type == 'photo_before') { _before++; } else { _after++; } });
      _msg(queued ? tr('photo_saved') : tr('photo_up'));
    } on ApiException catch (e) {
      _msg(e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final code = _code;
    final site = _job['site'] as Map?;
    final machine = _job['siteProduct'] as Map?;
    final model = machine == null ? null : ((machine['model'] as Map?)?['name'] ?? machine['rawModel']) as String?;
    final q = OfflineQueue.instance;
    final accepted = _job['accepted'] == true || q.hasQueued(_id, '/accept');
    final waiting = q.hasPendingFor(_id);
    final myRole = _job['myRole'] as String?;
    final team = ((_job['engineers'] as List?) ?? []).where((e) => e['declinedAt'] == null).map((e) => '${e['engineer']['user']['fullName']}${e['role'] == 'supporting' ? ' (support)' : ''}').join(', ');
    final parts = ((_job['partsUsed'] as List?) ?? []).where((p) => p['allocatedAt'] != null).toList();
    final prio = _job['priority'] as Map;
    final needsAccept = (code == 'assigned' || code == 'rescheduled') && !accepted && myRole != null;
    final canStart = const ['assigned', 'open', 'rescheduled', 'on_hold'].contains(code);
    final inProgress = code == 'in_progress';
    final color = statusColor(code);

    // ---- where is this job in its journey? ----
    final phase = _job['phase'] as String?;
    final spares = ((_job['spareRequests'] as List?) ?? const []).cast<Map>();
    final lastSpare = spares.isEmpty ? null : Map<String, dynamic>.from(spares.first);
    final waitingSpares = code == 'on_hold' && lastSpare?['status'] == 'requested';
    final sparesReady = lastSpare?['status'] == 'allocated' && lastSpare?['collectedAt'] == null && (code == 'rescheduled' || code == 'on_hold');
    final travelling = inProgress && phase == 'travelling';
    final working = inProgress && !travelling;
    final step = (code == 'completed' || code == 'closed' || code == 'pending_review') ? 5 : needsAccept ? 0 : travelling ? 2 : working ? 3 : 1;
    final legs = ((_job['travelLegs'] as List?) ?? const []).cast<Map>();
    final arrivedAt = legs.isNotEmpty && legs.first['endedAt'] != null ? DateTime.tryParse('${legs.first['endedAt']}')?.toLocal() : (_job['actualStart'] != null ? DateTime.tryParse('${_job['actualStart']}')?.toLocal() : null);

    Future<void> openJourney() async {
      final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => TravelScreen(api: widget.api, job: _job)));
      await _refresh();
      if (ok == true && mounted) _msg(tr('working_now'));
    }

    Widget? bar;
    if (_onDuty == false && myRole != null && (needsAccept || canStart || inProgress)) {
      bar = ActionBar(children: [
        _Banner(icon: Icons.lock_outline, text: tr('not_checked_lock'), color: AppColors.danger),
        const SizedBox(height: 10),
        FilledButton.icon(key: Key('go-check-in'), onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst), icon: Icon(Icons.login, size: 20), label: Text(tr('go_home_check_in')))
      ]);
    } else if (needsAccept) {
      bar = ActionBar(children: [
        BigButton(label: tr('accept'), icon: Icons.check_circle_outline, onPressed: _busy ? null : () => _do('Accepted', '/jobs/$_id/accept')),
        const SizedBox(height: 10),
        BigButton(label: tr('flag'), icon: Icons.flag_outlined, secondary: true, color: AppColors.textMuted, onPressed: _busy ? null : _decline),
      ]);
    } else if (waitingSpares) {
      bar = null; // nothing to press: the office is working on it
    } else if (canStart) {
      bar = ActionBar(children: [BigButton(label: tr('start_job'), icon: Icons.play_arrow_rounded, onPressed: _busy ? null : openJourney)]);
    } else if (travelling) {
      bar = ActionBar(children: [BigButton(label: tr('reached'), icon: Icons.qr_code_scanner, onPressed: _busy ? null : openJourney)]);
    } else if (working) {
      bar = ActionBar(children: [
        BigButton(
          label: tr('work_done'),
          icon: Icons.task_alt,
          onPressed: _busy
              ? null
              : () async {
                  final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => CompleteScreen(api: widget.api, job: _job)));
                  if (done == true && mounted) await _refresh();
                },
        ),
        const SizedBox(height: 10),
        BigButton(
          label: tr('need_spares'),
          icon: Icons.build_circle_outlined,
          secondary: true,
          onPressed: _busy
              ? null
              : () async {
                  final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => SpareRequestScreen(api: widget.api, job: _job)));
                  if (sent == true && mounted) await _refresh();
                },
        ),
      ]);
    }

    // the one thing to do now, in words and a picture
    Widget now() {
      IconData icon; String title; String? text; Color color = AppColors.primary;
      if (step == 5) { icon = Icons.check_circle; title = statusLabel(code); text = null; color = AppColors.success; }
      else if (needsAccept) { icon = Icons.assignment_turned_in_outlined; title = tr('new_job'); text = null; }
      else if (waitingSpares) { icon = Icons.hourglass_top; title = tr('waiting_spares'); text = tr('waiting_spares_text'); color = AppColors.warning; }
      else if (sparesReady) { icon = Icons.inventory_2_outlined; title = tr('spares_ready'); text = '${tr('collect_at', {'hub': '${lastSpare?['hubName'] ?? ''}'})}${(lastSpare?['hubAddress'] ?? '').toString().isEmpty ? '' : '\n${lastSpare?['hubAddress']}'}${(lastSpare?['decisionNote'] ?? '').toString().isEmpty ? '' : '\n${lastSpare?['decisionNote']}'}\n\n${tr('collect_then')}'; color = AppColors.success; }
      else if (lastSpare?['status'] == 'rejected' && code == 'on_hold') { icon = Icons.report_gmailerrorred_outlined; title = tr('spares_no'); text = '${lastSpare?['decisionNote'] ?? ''}'; color = AppColors.danger; }
      else if (travelling) { icon = Icons.local_shipping_outlined; title = tr('on_the_way'); text = null; }
      else if (working) {
        final d = arrivedAt == null ? null : DateTime.now().difference(arrivedAt);
        icon = Icons.build_outlined; title = tr('working_now'); text = d == null ? null : '${tr('work_time')}: ${d.inHours > 0 ? '${d.inHours} h ' : ''}${d.inMinutes % 60} min'; color = AppColors.info;
      } else { icon = Icons.play_circle_outline; title = tr('start_job'); text = tr('start_hint'); }
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(14), border: Border.all(color: color.withValues(alpha: 0.35))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (step < 5) _StepBar(step: step),
          if (step < 5) const SizedBox(height: 12),
          Row(children: [Icon(icon, size: 34, color: color), const SizedBox(width: 12), Expanded(child: Text(title, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: color)))]),
          if (text != null && text.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(text, style: const TextStyle(fontSize: 15, height: 1.4, color: AppColors.text))),
        ]),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(_job['jobNumber'] as String, style: const TextStyle(fontSize: 16)),
        actions: [IconButton(onPressed: _refresh, icon: Icon(Icons.refresh, size: 22), tooltip: tr('refresh'))],
      ),
      bottomNavigationBar: bar,
      body: Column(children: [
        if (_stale) Notice(icon: Icons.cloud_off_outlined, color: AppColors.warning, text: tr('offline_details')),
        if (waiting) Notice(icon: Icons.sync, text: tr('last_action_saved')),
        Expanded(
          child: ListView(padding: const EdgeInsets.all(16), children: [
            now(),
            const SizedBox(height: 14),
            Row(children: [Pill(statusLabel(code), color: color), const SizedBox(width: 6), Pill(tr('prio_label', {'p': '${prio['label']}'}), color: (prio['code'] == 'high' || prio['code'] == 'critical') ? AppColors.danger : AppColors.neutral)]),
            const SizedBox(height: 10),
            Text((_job['client'] as Map)['companyName'] as String, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 14),
            Section(title: tr('site_machine'), child: Column(children: [
              Field2(tr('site'), [site?['siteName'], site?['address'] ?? site?['city']].where((e) => e != null && '$e'.isNotEmpty).join(' · '), icon: Icons.place_outlined),
              if (site?['siteContactName'] != null) Field2(tr('site_contact'), '${site!['siteContactName']}  ${site['siteContactPhone'] ?? ''}'.trim(), icon: Icons.person_outline),
              Field2(tr('machine'), model == null ? null : '$model${machine?['serialNumber'] != null ? '  ·  ${machine!['serialNumber']}' : ''}', icon: Icons.precision_manufacturing_outlined),
              if (machine != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 36)),
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MachineHistoryScreen(api: widget.api, machineId: machine['id'] as String))),
                    icon: const Icon(Icons.history, size: 18),
                    label: Text(tr('view_history')),
                  ),
                ),
            ])),
            const SizedBox(height: 12),
            Section(title: tr('schedule'), child: Column(children: [
              Field2(tr('scheduled'), fmtWhen(_job['scheduledStart']), icon: Icons.schedule),
              Field2(tr('job_type'), (_job['jobType'] as Map)['label'] as String, icon: Icons.build_outlined),
              Field2(tr('assigned_team'), team.isEmpty ? null : team, icon: Icons.groups_outlined),
            ])),
            if (_job['description'] != null) ...[
              const SizedBox(height: 12),
              Section(title: tr('work_requested'), child: Text(_job['description'] as String, style: TextStyle(fontSize: 14.5, height: 1.4))),
            ],
            if (parts.isNotEmpty) ...[
              const SizedBox(height: 12),
              Section(title: tr('parts_to_you'), padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Column(children: [
                for (final p in parts)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(p['sparePart']['name'] as String, style: const TextStyle(fontSize: 14)), Text(p['sparePart']['partNumber'] as String, style: Theme.of(context).textTheme.bodySmall)])),
                      Text('× ${p['quantity']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    ]),
                  ),
              ])),
            ],
            if (working) ...[
              const SizedBox(height: 12),
              Section(title: tr('photos'), child: Row(children: [
                Expanded(child: _PhotoTile(label: tr('before'), count: _before, onTap: _busy ? null : () => _photo('photo_before'))),
                const SizedBox(width: 10),
                Expanded(child: _PhotoTile(label: tr('after'), count: _after, onTap: _busy ? null : () => _photo('photo_after'))),
              ])),
            ],
            if (code == 'pending_review') ...[SizedBox(height: 12), _Banner(icon: Icons.hourglass_top, text: tr('wait_approve'))],
            if (((_job['partsUsed'] as List?) ?? const []).any((p) => (p['returnQty'] ?? 0) > 0 && p['returnedAt'] == null)) ...[
              const SizedBox(height: 12),
              Section(title: tr('return_title'), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                for (final p in ((_job['partsUsed'] as List?) ?? const []).where((p) => (p['returnQty'] ?? 0) > 0 && p['returnedAt'] == null))
                  Padding(padding: const EdgeInsets.symmetric(vertical: 4), child: Text('${p['returnQty']} ×  ${p['sparePart']['name']}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.warning))),
                Text(tr('return_hint'), style: const TextStyle(fontSize: 13, color: AppColors.textMuted, height: 1.35)),
              ])),
            ],
            if (code == 'completed' || code == 'closed') ...[SizedBox(height: 12), _Banner(icon: Icons.check_circle_outline, text: tr('job_is_completed'), color: AppColors.success)],
          ]),
        ),
      ]),
    );
  }
}

class _PhotoTile extends StatelessWidget {
  final String label;
  final int count;
  final VoidCallback? onTap;
  const _PhotoTile({required this.label, required this.count, this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(border: Border.all(color: count > 0 ? AppColors.success : AppColors.border), borderRadius: BorderRadius.circular(8), color: count > 0 ? AppColors.success.withValues(alpha: 0.05) : AppColors.bg),
          child: Column(children: [
            Icon(count > 0 ? Icons.check_circle : Icons.photo_camera_outlined, size: 24, color: count > 0 ? AppColors.success : AppColors.textMuted),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            Text(count > 0 ? tr('n_taken', {'n': '$count'}) : tr('tap_capture'), style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
          ]),
        ),
      );
}

class _Banner extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;
  const _Banner({required this.icon, required this.text, this.color = AppColors.warning});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: color.withValues(alpha: 0.3))),
        child: Row(children: [Icon(icon, color: color, size: 20), const SizedBox(width: 10), Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13.5)))]),
      );
}


/// Accept - Go - Scan - Work - Finish: where the engineer is, at a glance.
class _StepBar extends StatelessWidget {
  final int step;
  const _StepBar({required this.step});

  @override
  Widget build(BuildContext context) {
    final names = [tr('step_accept'), tr('step_travel'), tr('step_scan'), tr('step_work'), tr('step_finish')];
    return Row(children: [
      for (var i = 0; i < names.length; i++) ...[
        Expanded(
          child: Column(children: [
            Container(height: 6, decoration: BoxDecoration(color: i < step ? AppColors.success : i == step ? AppColors.primary : AppColors.border, borderRadius: BorderRadius.circular(3))),
            const SizedBox(height: 4),
            Text(names[i], style: TextStyle(fontSize: 11.5, fontWeight: i == step ? FontWeight.w800 : FontWeight.w500, color: i == step ? AppColors.primary : AppColors.textMuted)),
          ]),
        ),
        if (i < names.length - 1) const SizedBox(width: 4),
      ],
    ]);
  }
}
