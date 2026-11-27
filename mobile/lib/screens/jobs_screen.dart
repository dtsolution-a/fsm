import 'package:flutter/material.dart';
import '../l10n.dart';
import '../api/api_client.dart';
import '../offline.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'job_detail_screen.dart';

String fmtWhen(dynamic iso) => iso == null ? tr('not_scheduled') : fmtDate('EEE d MMM, hh:mm a', DateTime.parse(iso as String).toLocal());

/// The engineer's jobs: Active (assigned / in progress) and History. Works offline from the last list it downloaded.
class JobsScreen extends StatefulWidget {
  final ApiClient api;
  const JobsScreen({super.key, required this.api});

  @override
  State<JobsScreen> createState() => _JobsScreenState();
}

class _JobsScreenState extends State<JobsScreen> {
  bool _history = false;
  List<Map<String, dynamic>>? _jobs;
  bool _loading = true;
  bool _offline = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    OfflineQueue.instance.addListener(_onQueue);
    _load();
  }

  @override
  void dispose() {
    OfflineQueue.instance.removeListener(_onQueue);
    super.dispose();
  }

  void _onQueue() {
    if (mounted) setState(() {});
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    await OfflineQueue.instance.load();
    try {
      await OfflineQueue.instance.flush(widget.api);
      final raw = await widget.api.get(_history ? '/engineers/me/jobs?scope=history' : '/engineers/me/jobs');
      final data = raw is List ? raw : <dynamic>[];
      final list = data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
      if (!_history) await OfflineQueue.instance.cacheJobs(list);
      if (mounted) setState(() { _jobs = list; _offline = false; _error = null; });
    } on ApiException catch (e) {
      if (e.isNetwork && !_history) {
        final cached = await OfflineQueue.instance.cachedJobs();
        if (mounted) setState(() { _jobs = cached ?? []; _offline = true; _error = cached == null ? e.message : null; });
      } else if (mounted) {
        setState(() => _error = e.message);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = OfflineQueue.instance;
    return Column(children: [
      UnderlineTabs(
        labels: [tr('tab_active'), tr('tab_history')],
        index: _history ? 1 : 0,
        onChanged: (i) { setState(() { _history = i == 1; _jobs = null; }); _load(); },
      ),
      if (_offline) Notice(icon: Icons.cloud_off_outlined, color: AppColors.warning, text: tr('offline_jobs')),
      if (q.pending.isNotEmpty) Notice(icon: Icons.sync, text: tr('sync_waiting', {'n': '${q.pending.length}'})),
      for (final f in q.failures) Notice(icon: Icons.error_outline, color: AppColors.danger, text: f, onClose: q.clearFailures),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: _loading && _jobs == null
              ? ListView(padding: const EdgeInsets.all(16), children: [for (var i = 0; i < 4; i++) const Padding(padding: EdgeInsets.only(bottom: 10), child: Skeleton(height: 110, radius: 20))])
              : (_jobs == null || _jobs!.isEmpty)
                  ? ListView(children: [
                      EmptyState(
                        icon: _error != null ? Icons.cloud_off_outlined : Icons.task_alt_outlined,
                        title: _error ?? (_history ? tr('no_done_jobs') : tr('no_jobs')),
                        message: tr('pull_refresh'),
                      ),
                    ])
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: _jobs!.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (_, i) => FadeIn(order: i, child: _JobCard(job: _jobs![i], api: widget.api, onChanged: _load)),
                    ),
        ),
      ),
    ]);
  }
}

class _JobCard extends StatelessWidget {
  final Map<String, dynamic> job;
  final ApiClient api;
  final Future<void> Function() onChanged;
  const _JobCard({required this.job, required this.api, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final override = OfflineQueue.instance.statusOverride(job['id'] as String);
    final code = override ?? (job['status'] as Map)['code'] as String;
    final machine = job['siteProduct'] as Map?;
    final model = machine == null ? null : ((machine['model'] as Map?)?['name'] ?? machine['rawModel']);
    final prio = (job['priority'] as Map)['code'] as String;
    final site = (job['site'] as Map?)?['siteName'] as String?;
    final color = statusColor(code);
    final needsAccept = job['accepted'] == false && code == 'assigned';

    return Container(
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: AppColors.shadowSoft),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () async {
          await Navigator.of(context).push(MaterialPageRoute(builder: (_) => JobDetailScreen(api: api, initial: job)));
          await onChanged();
        },
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(width: 5, color: color),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 14, 14),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(job['jobNumber'] as String, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.textMuted, letterSpacing: 0.2))),
                    if (prio == 'high' || prio == 'critical') ...[Pill(tr(prio == 'critical' ? 'pr_critical' : 'pr_high'), color: AppColors.danger), const SizedBox(width: 6)],
                    Pill(statusLabel(code), color: color),
                  ]),
                  const SizedBox(height: 8),
                  Text((job['client'] as Map)['companyName'] as String, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleMedium),
                  if (site != null || model != null) ...[
                    const SizedBox(height: 4),
                    Text([?site, ?model].join('  ·  '), maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
                  ],
                  const SizedBox(height: 10),
                  Row(children: [
                    const Icon(Icons.schedule, size: 15, color: AppColors.textFaint),
                    const SizedBox(width: 6),
                    Expanded(child: Text(fmtWhen(job['scheduledStart']), style: const TextStyle(fontSize: 13, color: AppColors.text))),
                    if (needsAccept) Text(tr('action_needed'), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.warning)),
                  ]),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}
