import 'package:flutter/material.dart';
import '../l10n.dart';
import 'package:intl/intl.dart';
import '../api/api_client.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'async_view.dart';

/// The engineer's leave requests, and a form to apply for new leave.
/// Past dates cannot be picked here, and the server also rejects (and reports) backdated leave.
class LeaveScreen extends StatefulWidget {
  final ApiClient api;
  const LeaveScreen({super.key, required this.api});

  @override
  State<LeaveScreen> createState() => _LeaveScreenState();
}

class _LeaveScreenState extends State<LeaveScreen> {
  int _version = 0; // bump to reload the list

  // "2026-10-12T00:00:00.000Z" -> 12 Oct 2026 (take the date part as-is: no timezone shifting)
  static String _day(dynamic iso) => fmtDate('d MMM yyyy', DateTime.parse((iso as String).substring(0, 10)));

  Future<void> _apply() async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _ApplySheet(api: widget.api),
    );
    if (done == true && mounted) {
      setState(() => _version++);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('leave_sent'))));
    }
  }

  static int _days(dynamic a, dynamic b) => DateTime.parse((b as String).substring(0, 10)).difference(DateTime.parse((a as String).substring(0, 10))).inDays + 1;

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: const BoxDecoration(color: AppColors.surface, border: Border(bottom: BorderSide(color: AppColors.border))),
        child: FilledButton.icon(key: Key('apply-leave'), onPressed: _apply, icon: Icon(Icons.add, size: 20), label: Text(tr('apply_leave'))),
      ),
      Expanded(
        child: AsyncView<List<dynamic>>(
          key: ValueKey(_version),
          load: () async => List<dynamic>.from(await widget.api.get('/leave-requests') as List),
          builder: (context, items, reload) {
            if (items.isEmpty) {
              return ListView(physics: AlwaysScrollableScrollPhysics(), children: [EmptyState(icon: Icons.event_available_outlined, title: tr('no_leave'), message: tr('no_leave_msg'))]);
            }
            return ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                final l = items[i] as Map<String, dynamic>;
                final status = l['status'] as String;
                final color = switch (status) { 'approved' => AppColors.success, 'rejected' => AppColors.danger, _ => AppColors.warning };
                final n = _days(l['startDate'], l['endDate']);
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text('${_day(l['startDate'])} → ${_day(l['endDate'])}', style: Theme.of(context).textTheme.titleMedium)),
                        Pill(tr('lv_$status') == 'lv_$status' ? status[0].toUpperCase() + status.substring(1) : tr('lv_$status'), color: color),
                      ]),
                      const SizedBox(height: 4),
                      Text(tr('days_n', {'n': '$n'}), style: Theme.of(context).textTheme.bodySmall),
                      if ((l['reason'] as String?)?.isNotEmpty == true) ...[const SizedBox(height: 8), Text(l['reason'] as String, style: const TextStyle(fontSize: 14))],
                    ]),
                  ),
                );
              },
            );
          },
        ),
      ),
    ]);
  }
}

class _ApplySheet extends StatefulWidget {
  final ApiClient api;
  const _ApplySheet({required this.api});

  @override
  State<_ApplySheet> createState() => _ApplySheetState();
}

class _ApplySheetState extends State<_ApplySheet> {
  final _reason = TextEditingController();
  final _fmt = DateFormat('yyyy-MM-dd');
  late DateTime _from;
  late DateTime _to;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = _to = DateTime(now.year, now.month, now.day);
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pick(bool isFrom) async {
    final today = DateTime.now();
    final first = DateTime(today.year, today.month, today.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? _from : _to,
      firstDate: isFrom ? first : _from, // no past dates, and the end cannot be before the start
      lastDate: first.add(const Duration(days: 365)),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = picked;
        if (_to.isBefore(_from)) _to = _from;
      } else {
        _to = picked;
      }
    });
  }

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    try {
      await widget.api.post('/leave-requests', {
        'startDate': _fmt.format(_from),
        'endDate': _fmt.format(_to),
        if (_reason.text.trim().isNotEmpty) 'reason': _reason.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final show = _LocalFmt('EEE, d MMM yyyy');
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(tr('apply_leave'), style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(tr('leave_note'), style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: OutlinedButton(key: const Key('leave-from'), onPressed: () => _pick(true), child: Text('${tr('from')}\n${show.format(_from)}', textAlign: TextAlign.center))),
          const SizedBox(width: 12),
          Expanded(child: OutlinedButton(key: const Key('leave-to'), onPressed: () => _pick(false), child: Text('${tr('to')}\n${show.format(_to)}', textAlign: TextAlign.center))),
        ]),
        const SizedBox(height: 12),
        TextField(controller: _reason, maxLines: 2, decoration: InputDecoration(labelText: tr('reason_opt'))),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Container(key: const Key('leave-error'), padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: cs.errorContainer, borderRadius: BorderRadius.circular(8)), child: Text(_error!, style: TextStyle(color: cs.onErrorContainer))),
        ],
        const SizedBox(height: 16),
        FilledButton(key: const Key('leave-submit'), onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Send request')),
      ]),
    );
  }
}

/// Same call shape as DateFormat('...').format(d), but in the chosen language.
class _LocalFmt {
  final String pattern;
  const _LocalFmt(this.pattern);
  String format(DateTime d) => fmtDate(pattern, d);
}
