import 'package:flutter/material.dart';
import '../l10n.dart';
import '../api/api_client.dart';
import '../session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';

class LoginScreen extends StatefulWidget {
  final Session session;
  const LoginScreen({super.key, required this.session});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _pw = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  bool _hide = true;
  String? _error;

  @override
  void dispose() {
    _id.dispose();
    _pw.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.session.login(_id.text.trim(), _pw.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = tr('sign_in_failed'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SingleChildScrollView(
        child: Column(children: [
          Container(
            width: double.infinity,
            padding: EdgeInsets.fromLTRB(28, MediaQuery.of(context).padding.top + 48, 28, 84),
            decoration: const BoxDecoration(gradient: AppColors.hero, borderRadius: BorderRadius.vertical(bottom: Radius.circular(44))),
            child: FadeIn(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                  child: ClipOval(child: Image.asset('assets/brand/shah-mark.png', width: 54, height: 54)),
                ),
                const SizedBox(height: 22),
                const Text('कार्यसेतु', style: TextStyle(fontSize: 36, fontWeight: FontWeight.w700, color: Colors.white, height: 1.4)),
                const SizedBox(height: 2),
                Text(tr('sign_in_continue'), style: const TextStyle(fontSize: 15.5, color: Color(0xCCFFFFFF))),
              ]),
            ),
          ),
          Transform.translate(
            offset: const Offset(0, -48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: FadeIn(
                  order: 2,
                  child: SoftCard(
                    shadow: AppColors.shadow,
                    padding: const EdgeInsets.all(22),
                    child: Form(
                      key: _form,
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text(tr('use_user_id'), style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(height: 18),
                        TextFormField(
                          key: const Key('login-id'),
                          controller: _id,
                          autocorrect: false,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.username],
                          decoration: InputDecoration(labelText: tr('user_id'), prefixIcon: const Icon(Icons.person_outline, size: 20)),
                          validator: (v) => (v == null || v.trim().isEmpty) ? tr('enter_user_id') : null,
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          key: const Key('login-password'),
                          controller: _pw,
                          obscureText: _hide,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.password],
                          onFieldSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: tr('password'),
                            prefixIcon: const Icon(Icons.lock_outline, size: 20),
                            suffixIcon: IconButton(icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined, size: 20), onPressed: () => setState(() => _hide = !_hide)),
                          ),
                          validator: (v) => (v == null || v.isEmpty) ? tr('enter_password') : null,
                        ),
                        if (_error != null) ...[
                          const SizedBox(height: 14),
                          Container(
                            key: const Key('login-error'),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(color: const Color(0xFFFDEBEC), borderRadius: BorderRadius.circular(14)),
                            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              const Icon(Icons.error_outline, size: 18, color: AppColors.danger),
                              const SizedBox(width: 8),
                              Expanded(child: Text(_error!, style: const TextStyle(color: Color(0xFF7A1B1F), fontSize: 13.5))),
                            ]),
                          ),
                        ],
                        const SizedBox(height: 22),
                        FilledButton(
                          key: const Key('login-submit'),
                          onPressed: _busy ? null : _submit,
                          child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : Text(tr('sign_in')),
                        ),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Padding(padding: const EdgeInsets.only(bottom: 28), child: Text(tr('trouble'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint))),
        ]),
      ),
    );
  }
}
