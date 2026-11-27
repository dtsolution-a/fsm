import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import '../l10n.dart';
import '../api/api_client.dart';
import '../offline.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

/// Closing a job: what was done, parts used, and the customer's signature (PRD 3.4).
class CompleteScreen extends StatefulWidget {
  final ApiClient api;
  final Map<String, dynamic> job;
  const CompleteScreen({super.key, required this.api, required this.job});

  @override
  State<CompleteScreen> createState() => _CompleteScreenState();
}

class _PartLine {
  final String id;
  final String name;
  final String number;
  int qty;
  _PartLine(this.id, this.name, this.number, this.qty);
}

/// A spare the office gave to the engineer: how many he was given and how many he used.
class _Given {
  final String id;
  final String name;
  final String number;
  final int given;
  int used;
  _Given(this.id, this.name, this.number, this.given) : used = given;
}

class _CompleteScreenState extends State<CompleteScreen> {
  final _notes = TextEditingController();
  final _signer = TextEditingController();
  final _pad = SignaturePadController();
  final List<_PartLine> _parts = [];
  final List<_Given> _given = [];
  bool _allUsed = true; // "all the spares I was given were used"
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // parts the office allocated are pre-filled; the engineer adjusts the quantity actually used
    final byPart = <String, _Given>{};
    for (final p in (widget.job['partsUsed'] as List? ?? []).where((p) => p['allocatedAt'] != null && p['consumedAt'] == null)) {
      final id = p['sparePartId'] as String;
      final q = p['quantity'] as int;
      final g = byPart[id];
      byPart[id] = g == null ? _Given(id, p['sparePart']['name'] as String, p['sparePart']['partNumber'] as String, q) : (_Given(id, g.name, g.number, g.given + q));
    }
    _given.addAll(byPart.values);
  }

  @override
  void dispose() {
    _notes.dispose();
    _signer.dispose();
    super.dispose();
  }

  void _err(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m), backgroundColor: Theme.of(context).colorScheme.error));

  Future<void> _addPart() async {
    final p = await showModalBottomSheet<_PartLine>(context: context, isScrollControlled: true, builder: (_) => _PartSearch(api: widget.api));
    if (p != null && !_parts.any((x) => x.id == p.id)) setState(() => _parts.add(p));
  }

  Future<void> _submit() async {
    if (_signer.text.trim().isEmpty) { _err(tr('sig_name_required')); return; }
    if (_pad.isEmpty) { _err(tr('sig_required')); return; }
    setState(() => _busy = true);
    final id = widget.job['id'] as String;
    final no = widget.job['jobNumber'] as String;
    try {
      final png = await _pad.toPng();
      var queued = await OfflineQueue.instance.upload(widget.api, id, '/jobs/$id/attachments?type=signature', png, 'signature.png', label: '$no: signature');
      queued = await OfflineQueue.instance.post(
            widget.api, id, '/jobs/$id/complete',
            {
              'closureNotes': _notes.text.trim().isEmpty ? null : _notes.text.trim(),
              'signedByName': _signer.text.trim(),
              if (_given.isNotEmpty) 'allSparesUsed': _allUsed,
              'parts': [
                if (_given.isNotEmpty && !_allUsed) ..._given.map((g) => {'sparePartId': g.id, 'quantity': g.used}),
                ..._parts.where((p) => !_given.any((g) => g.id == p.id)).map((p) => {'sparePartId': p.id, 'quantity': p.qty}),
              ],
            },
            label: '$no: completion', statusAfter: 'completed',
          ) ||
          queued;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(queued ? tr('saved_phone') : tr('job_completed'))));
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      _err(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(tr('complete_title', {'job': '${widget.job['jobNumber']}'}), style: const TextStyle(fontSize: 16))),
      bottomNavigationBar: ActionBar(children: [
        FilledButton.icon(
          onPressed: _busy ? null : _submit,
          icon: _busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.task_alt, size: 20),
          label: Text(tr('submit_completion')),
        ),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Section(title: tr('work_done_title'), child: TextField(controller: _notes, maxLines: 4, decoration: InputDecoration(hintText: tr('describe_work'))))
        ,
        if (_given.isNotEmpty) ...[
          const SizedBox(height: 12),
          Section(
            title: tr('given_spares'),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              for (final g in _given) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('${g.name}  ×  ${g.given}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              const SizedBox(height: 10),
              _ChoiceTile(selected: _allUsed, icon: Icons.check_circle_outline, label: tr('all_used'), onTap: () => setState(() => _allUsed = true)),
              const SizedBox(height: 8),
              _ChoiceTile(selected: !_allUsed, icon: Icons.inventory_2_outlined, label: tr('some_left'), onTap: () => setState(() => _allUsed = false)),
              if (!_allUsed) ...[
                const SizedBox(height: 12),
                for (final g in _given)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(g.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                        Text(tr('used_of', {'u': '${g.used}', 'n': '${g.given}'}), style: const TextStyle(fontSize: 13, color: AppColors.textMuted)),
                        if (g.given - g.used > 0) Text(tr('take_back', {'n': '${g.given - g.used}'}), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: AppColors.warning)),
                      ])),
                      IconButton(iconSize: 32, onPressed: g.used > 0 ? () => setState(() => g.used--) : null, icon: const Icon(Icons.remove_circle_outline)),
                      SizedBox(width: 30, child: Text('${g.used}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
                      IconButton(iconSize: 32, onPressed: g.used < g.given ? () => setState(() => g.used++) : null, icon: const Icon(Icons.add_circle_outline)),
                    ]),
                  ),
                Padding(padding: const EdgeInsets.only(top: 6), child: Text(tr('return_hint'), style: const TextStyle(fontSize: 13, color: AppColors.textMuted, height: 1.35))),
              ],
            ]),
          ),
        ],
        const SizedBox(height: 12),
        Section(
          title: tr('parts_used'),
          trailing: TextButton.icon(onPressed: _addPart, icon: Icon(Icons.add, size: 18), label: Text(tr('add_part'))),
          padding: const EdgeInsets.fromLTRB(16, 4, 8, 8),
          child: _parts.isEmpty
              ? Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text(tr('no_parts'), style: TextStyle(color: AppColors.textMuted)))
              : Column(children: [
                  for (final p in _parts)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(children: [
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(p.name, style: const TextStyle(fontSize: 14), maxLines: 2, overflow: TextOverflow.ellipsis), Text(p.number, style: Theme.of(context).textTheme.bodySmall)])),
                        IconButton(visualDensity: VisualDensity.compact, onPressed: p.qty > 1 ? () => setState(() => p.qty--) : null, icon: const Icon(Icons.remove_circle_outline, size: 22)),
                        SizedBox(width: 24, child: Text('${p.qty}', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))),
                        IconButton(visualDensity: VisualDensity.compact, onPressed: () => setState(() => p.qty++), icon: const Icon(Icons.add_circle_outline, size: 22)),
                        IconButton(visualDensity: VisualDensity.compact, onPressed: () => setState(() => _parts.remove(p)), icon: const Icon(Icons.delete_outline, size: 22, color: AppColors.danger)),
                      ]),
                    ),
                ]),
        ),
        const SizedBox(height: 12),
        Section(
          title: tr('cust_signoff'),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(controller: _signer, textCapitalization: TextCapitalization.words, decoration: InputDecoration(labelText: tr('cust_name'))),
            const SizedBox(height: 12),
            Container(
              height: 170,
              decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(8), color: Colors.white),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Stack(children: [
                  Positioned(left: 12, top: 10, child: Text(tr('sign_here'), style: TextStyle(fontSize: 12, color: AppColors.textFaint))),
                  Positioned(left: 16, right: 16, bottom: 36, child: Container(height: 1, color: AppColors.border)),
                  SignaturePad(controller: _pad),
                ]),
              ),
            ),
            Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => setState(_pad.clear), child: Text(tr('clear_sig')))),
          ]),
        ),
      ]),
    );
  }
}

class _PartSearch extends StatefulWidget {
  final ApiClient api;
  const _PartSearch({required this.api});
  @override
  State<_PartSearch> createState() => _PartSearchState();
}

class _PartSearchState extends State<_PartSearch> {
  List<Map<String, dynamic>> _res = [];
  String? _msg;
  Future<void> _search(String q) async {
    if (q.trim().length < 2) { setState(() { _res = []; _msg = null; }); return; }
    try {
      final r = await widget.api.get('/jobs/parts-lookup?search=${Uri.encodeQueryComponent(q.trim())}') as List;
      if (mounted) setState(() { _res = r.map((e) => Map<String, dynamic>.from(e as Map)).toList(); _msg = _res.isEmpty ? tr('no_match_part') : null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _msg = e.isNetwork ? tr('part_search_net') : e.message);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(autofocus: true, onChanged: _search, decoration: InputDecoration(prefixIcon: Icon(Icons.search), hintText: tr('part_hint'), border: OutlineInputBorder())),
          if (_msg != null) Padding(padding: const EdgeInsets.all(12), child: Text(_msg!)),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 280),
            child: ListView(shrinkWrap: true, children: [for (final p in _res) ListTile(title: Text(p['name'] as String), subtitle: Text(p['partNumber'] as String), onTap: () => Navigator.pop(context, _PartLine(p['id'] as String, p['name'] as String, p['partNumber'] as String, 1)))]),
          ),
        ]),
      );
}

// ───────── signature pad (no extra package) ─────────
class SignaturePadController {
  final List<List<Offset>> strokes = [];
  Size size = const Size(300, 180);
  bool get isEmpty => strokes.every((s) => s.length < 2);
  void clear() => strokes.clear();

  Future<Uint8List> toPng() async {
    final rec = ui.PictureRecorder();
    final c = Canvas(rec);
    c.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    _paintStrokes(c, strokes);
    final img = await rec.endRecording().toImage(size.width.round(), size.height.round());
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    return data!.buffer.asUint8List();
  }
}

void _paintStrokes(Canvas c, List<List<Offset>> strokes) {
  final p = Paint()..color = Colors.black..strokeWidth = 2.5..strokeCap = StrokeCap.round..style = PaintingStyle.stroke;
  for (final s in strokes) {
    if (s.length == 1) { c.drawCircle(s.first, 1.2, p..style = PaintingStyle.fill); p.style = PaintingStyle.stroke; continue; }
    final path = Path()..moveTo(s.first.dx, s.first.dy);
    for (final o in s.skip(1)) { path.lineTo(o.dx, o.dy); }
    c.drawPath(path, p);
  }
}

class SignaturePad extends StatefulWidget {
  final SignaturePadController controller;
  const SignaturePad({super.key, required this.controller});
  @override
  State<SignaturePad> createState() => _SignaturePadState();
}

class _SignaturePadState extends State<SignaturePad> {
  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, box) {
        widget.controller.size = Size(box.maxWidth, box.maxHeight);
        // The pad sits inside a scrolling list: claim the touch at once so drawing never turns into scrolling.
        return RawGestureDetector(
          gestures: {
            _EagerPan: GestureRecognizerFactoryWithHandlers<_EagerPan>(
              () => _EagerPan(),
              (g) {
                g.onStart = (d) => setState(() => widget.controller.strokes.add([d.localPosition]));
                g.onUpdate = (d) => setState(() { if (widget.controller.strokes.isNotEmpty) widget.controller.strokes.last.add(d.localPosition); });
              },
            ),
          },
          child: CustomPaint(size: Size.infinite, painter: _PadPainter(widget.controller.strokes.map((s) => List<Offset>.from(s)).toList())),
        );
      });
}

class _EagerPan extends PanGestureRecognizer {
  @override
  void addAllowedPointer(PointerDownEvent event) {
    super.addAllowedPointer(event);
    resolve(GestureDisposition.accepted);
  }
}

class _PadPainter extends CustomPainter {
  final List<List<Offset>> strokes;
  _PadPainter(this.strokes);
  @override
  void paint(Canvas canvas, Size size) => _paintStrokes(canvas, strokes);
  @override
  bool shouldRepaint(covariant _PadPainter old) => true;
}

/// A big tap target for a yes / no style choice.
class _ChoiceTile extends StatelessWidget {
  final bool selected;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _ChoiceTile({required this.selected, required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(color: selected ? AppColors.primary.withValues(alpha: 0.08) : null, border: Border.all(color: selected ? AppColors.primary : AppColors.border, width: selected ? 2 : 1), borderRadius: BorderRadius.circular(12)),
          child: Row(children: [Icon(selected ? Icons.radio_button_checked : Icons.radio_button_off, color: selected ? AppColors.primary : AppColors.textFaint), const SizedBox(width: 12), Expanded(child: Text(label, style: TextStyle(fontSize: 16, fontWeight: selected ? FontWeight.w700 : FontWeight.w500))), Icon(icon, color: AppColors.textFaint)]),
        ),
      );
}
