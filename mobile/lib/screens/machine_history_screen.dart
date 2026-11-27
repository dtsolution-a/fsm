import 'package:flutter/material.dart';
import '../l10n.dart';
import 'package:intl/intl.dart';
import '../api/api_client.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'async_view.dart';

/// What was done on this machine before — shown to the engineer before they start (PRD 3.4).
class MachineHistoryScreen extends StatelessWidget {
  final ApiClient api;
  final String machineId;
  const MachineHistoryScreen({super.key, required this.api, required this.machineId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(tr('machine_history'), style: TextStyle(fontSize: 16))),
      body: AsyncView<Map<String, dynamic>>(
        load: () async => Map<String, dynamic>.from(await api.get('/machines/$machineId/history') as Map),
        builder: (context, data, reload) {
          final m = Map<String, dynamic>.from(data['machine'] as Map);
          final jobs = (data['jobs'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
          return ListView(padding: const EdgeInsets.all(16), physics: const AlwaysScrollableScrollPhysics(), children: [
            Section(
              title: tr('machine'),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${m['model'] ?? tr('machine')}', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 2),
                Text('${m['client']} · ${m['site']}', style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 8),
                Field2(tr('serial_number'), m['serialNumber'] as String?),
                for (final c in (m['contracts'] as List)) Field2(tr('contract'), '${c['contractType']['label']} · ${c['contractNumber']}'),
              ]),
            ),
            const SizedBox(height: 16),
            Text(tr('service_history', {'n': '${jobs.length}'}).toUpperCase(), style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            if (jobs.isEmpty) EmptyState(icon: Icons.history, title: tr('no_earlier'), message: tr('nothing_recorded')),
            for (final j in jobs)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(j['jobNumber'] as String, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14))),
                        Text(DateFormat('d MMM y').format(DateTime.parse((j['actualEnd'] ?? j['scheduledStart'] ?? DateTime.now().toIso8601String()) as String).toLocal()), style: Theme.of(context).textTheme.bodySmall),
                      ]),
                      const SizedBox(height: 2),
                      Text('${j['jobType']['label']} · ${j['status']['label']}', style: Theme.of(context).textTheme.bodySmall),
                      if (j['description'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(j['description'] as String, style: const TextStyle(fontSize: 14))),
                      if (j['closureNotes'] != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('resolution', {'t': '${j['closureNotes']}'}), style: const TextStyle(fontSize: 13.5, color: AppColors.success))),
                      if ((j['partsUsed'] as List).isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('parts_lbl', {'t': (j['partsUsed'] as List).map((p) => '${p['quantity']}× ${p['sparePart']['name']}').join(', ')}), style: Theme.of(context).textTheme.bodySmall)),
                    ]),
                  ),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
