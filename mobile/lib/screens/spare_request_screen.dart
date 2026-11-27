import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../l10n.dart';
import '../ui/theme.dart';
import 'travel_flow.dart' show BigButton;

/// "I need spare parts": pick the parts, say how many, send. The job goes on hold and its work clock stops until the office gives the parts.
class SpareRequestScreen extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic> job;
  const SpareRequestScreen({super.key, required this.api, required this.job});

  @override
  State<SpareRequestScreen> createState() => _SpareRequestScreenState();
}

class _SpareRequestScreenState extends State<SpareRequestScreen> {
  final _search = TextEditingController();
  final _note = TextEditingController();
  List<Map<String, dynamic>> _found = [];
  final Map<String, Map<String, dynamic>> _picked = {}; // partId -> {part, qty}
  String? _msg;
  bool _busy = false;

  @override
  void dispose() {
    _search.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _lookup(String q) async {
    if (q.trim().length < 2) { setState(() { _found = []; _msg = null; }); return; }
    try {
      final r = await widget.api.get('/jobs/parts-lookup?search=${Uri.encodeQueryComponent(q.trim())}') as List;
      if (mounted) setState(() { _found = r.map((e) => Map<String, dynamic>.from(e as Map)).toList(); _msg = _found.isEmpty ? '—' : null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _msg = e.isNetwork ? tr('need_net') : e.message);
    }
  }

  Future<void> _send() async {
    setState(() { _busy = true; _msg = null; });
    try {
      await widget.api.post('/jobs/${widget.job['id']}/spare-requests', {
        'items': [for (final e in _picked.values) {'sparePartId': e['part']['id'], 'quantity': e['qty']}],
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
      });
      if (mounted) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('spare_sent')))); Navigator.of(context).pop(true); }
    } on ApiException catch (e) {
      if (mounted) setState(() { _msg = e.isNetwork ? tr('need_net') : e.message; _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tr('need_spares'), style: const TextStyle(fontSize: 16))),
        body: SafeArea(
          child: Column(children: [
            Expanded(
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Text(tr('spare_title'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                TextField(controller: _search, onChanged: _lookup, style: const TextStyle(fontSize: 17), decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: tr('spare_search'), border: const OutlineInputBorder())),
                if (_msg != null) Padding(padding: const EdgeInsets.all(10), child: Text(_msg!, style: const TextStyle(color: AppColors.danger))),
                for (final p in _found)
                  Card(child: ListTile(
                    title: Text(p['name'] as String, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)), subtitle: Text(p['partNumber'] as String),
                    trailing: FilledButton(style: FilledButton.styleFrom(minimumSize: const Size(84, 44)), onPressed: () => setState(() { _picked.putIfAbsent(p['id'] as String, () => {'part': p, 'qty': 1}); _found = []; _search.clear(); }), child: Text(tr('spare_add'))),
                  )),
                if (_picked.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  for (final e in _picked.entries)
                    Card(child: Padding(padding: const EdgeInsets.fromLTRB(14, 10, 8, 10), child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(e.value['part']['name'] as String, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)), Text(e.value['part']['partNumber'] as String, style: const TextStyle(fontSize: 12, color: AppColors.textFaint))])),
                      IconButton(iconSize: 30, onPressed: (e.value['qty'] as int) > 1 ? () => setState(() => e.value['qty'] = (e.value['qty'] as int) - 1) : null, icon: const Icon(Icons.remove_circle_outline)),
                      SizedBox(width: 30, child: Text('${e.value['qty']}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
                      IconButton(iconSize: 30, onPressed: (e.value['qty'] as int) < 99 ? () => setState(() => e.value['qty'] = (e.value['qty'] as int) + 1) : null, icon: const Icon(Icons.add_circle_outline)),
                      IconButton(onPressed: () => setState(() => _picked.remove(e.key)), icon: const Icon(Icons.delete_outline, color: AppColors.danger)),
                    ]))),
                ],
                const SizedBox(height: 12),
                TextField(controller: _note, maxLines: 2, decoration: InputDecoration(labelText: tr('spare_note'), border: const OutlineInputBorder())),
              ]),
            ),
            Padding(padding: const EdgeInsets.all(16), child: BigButton(label: tr('spare_send'), icon: Icons.send, onPressed: _picked.isEmpty || _busy ? null : _send)),
          ]),
        ),
      );
}
