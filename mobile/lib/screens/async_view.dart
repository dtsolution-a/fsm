import 'package:flutter/material.dart';
import '../l10n.dart';
import '../api/api_client.dart';
import '../ui/theme.dart';

/// Loads something once, shows a spinner / a retry button on failure / the content.
class AsyncView<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(BuildContext, T, Future<void> Function() reload) builder;
  const AsyncView({super.key, required this.load, required this.builder});

  @override
  State<AsyncView<T>> createState() => _AsyncViewState<T>();
}

class _AsyncViewState<T> extends State<AsyncView<T>> {
  T? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    if (mounted) setState(() => _loading = true);
    try {
      final d = await widget.load();
      if (mounted) setState(() { _data = d; _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = tr('went_wrong'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const Center(child: CircularProgressIndicator(strokeWidth: 2.5));
    if (_data == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textFaint),
            const SizedBox(height: 12),
            Text(_error ?? tr('could_not_load'), textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted)),
            const SizedBox(height: 16),
            SizedBox(width: 160, child: OutlinedButton(onPressed: _reload, child: Text(tr('try_again')))),
          ]),
        ),
      );
    }
    return RefreshIndicator(onRefresh: _reload, child: widget.builder(context, _data as T, _reload));
  }
}
