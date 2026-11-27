import 'package:flutter/material.dart';
import '../l10n.dart';
import '../api/api_client.dart';
import '../session.dart';
import '../ui/theme.dart';
import '../ui/widgets.dart';
import 'async_view.dart';

class ProfileScreen extends StatelessWidget {
  final Session session;
  const ProfileScreen({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    return AsyncView<Map<String, dynamic>>(
      load: () async => Map<String, dynamic>.from(await session.api.get('/engineers/me') as Map),
      builder: (context, e, reload) {
        final user = Map<String, dynamic>.from((e['user'] as Map?) ?? const {});
        final zones = ((e['zones'] as List?) ?? const []).map((z) => (z['zone']['name'] as String)).toList();
        final skills = ((e['skills'] as List?) ?? const []).map((s) => (s['skill']['label'] as String)).toList();
        final name = (user['fullName'] as String?) ?? '';
        final initials = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).take(2).map((w) => w[0].toUpperCase()).join();
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            SoftCard(
              gradient: AppColors.hero,
              shadow: AppColors.shadow,
              padding: const EdgeInsets.all(20),
              child: Row(children: [
                Container(
                  width: 64,
                  height: 64,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(color: Color(0x33FFFFFF), shape: BoxShape.circle),
                  child: Text(initials.isEmpty ? '?' : initials, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white)),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(name, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700, color: Colors.white)),
                    if (e['designation'] != null) Text(e['designation'] as String, style: const TextStyle(fontSize: 13, color: Color(0xCCFFFFFF))),
                    if (user['userCode'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Pill('ID ${user['userCode']}', color: Colors.white)),
                  ]),
                ),
              ]),
            ),
            const SizedBox(height: 12),
            Section(title: tr('contact'), child: Column(children: [
              Field2(tr('phone'), user['phone'] as String? ?? '—', icon: Icons.phone_outlined),
              Field2(tr('email'), user['email'] as String? ?? '—', icon: Icons.mail_outline),
              Field2(tr('city'), e['city'] as String? ?? '—', icon: Icons.location_city_outlined),
            ])),
            const SizedBox(height: 12),
            Section(title: tr('assignment'), child: Column(children: [
              Field2(tr('zone'), zones.isEmpty ? '—' : zones.join(', '), icon: Icons.map_outlined),
              Field2(tr('skills'), skills.isEmpty ? '—' : skills.join(', '), icon: Icons.build_outlined),
            ])),
            const SizedBox(height: 12),
            Section(title: tr('language'), child: ValueListenableBuilder<String>(
              valueListenable: AppLang.current,
              builder: (context, lang, _) => Wrap(spacing: 8, runSpacing: 8, children: [
                for (final e in AppLang.options.entries)
                  InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => AppLang.set(e.key),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                      decoration: BoxDecoration(
                        color: lang == e.key ? AppColors.primary : const Color(0xFFF1F4FB),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: lang == e.key ? AppColors.primary : AppColors.border),
                      ),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        if (lang == e.key) const Padding(padding: EdgeInsets.only(right: 6), child: Icon(Icons.check, size: 18, color: Colors.white)),
                        Text(e.value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: lang == e.key ? Colors.white : AppColors.text)),
                      ]),
                    ),
                  ),
              ]),
            )),
            const SizedBox(height: 12),
            Section(
              title: tr('security'),
              child: OutlinedButton.icon(
                key: const Key('change-password'),
                onPressed: () => _changePassword(context),
                icon: const Icon(Icons.lock_reset, size: 20),
                label: Text(tr('change_password')),
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              key: const Key('logout'),
              style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
              onPressed: () => session.logout(),
              icon: const Icon(Icons.logout, size: 20),
              label: Text(tr('sign_out')),
            ),
          ],
        );
      },
    );
  }

  Future<void> _changePassword(BuildContext context) async {
    final cur = TextEditingController();
    final next = TextEditingController();
    String? error;
    bool busy = false;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: Text(tr('change_password')),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: cur, obscureText: true, decoration: InputDecoration(labelText: tr('current_password'))),
            const SizedBox(height: 12),
            TextField(controller: next, obscureText: true, decoration: InputDecoration(labelText: tr('new_password'), helperText: tr('password_rule'), helperMaxLines: 2)),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
          ]),
          actions: [
            TextButton(onPressed: busy ? null : () => Navigator.pop(ctx), child: Text(tr('cancel'))),
            FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size(110, 46)),
              onPressed: busy
                  ? null
                  : () async {
                      setState(() { busy = true; error = null; });
                      try {
                        await session.api.post('/auth/change-password', {'currentPassword': cur.text, 'newPassword': next.text});
                        if (ctx.mounted) Navigator.pop(ctx);
                        if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('password_changed'))));
                      } on ApiException catch (e) {
                        setState(() { busy = false; error = e.message; });
                      }
                    },
              child: Text(tr('save')),
            ),
          ],
        ),
      ),
    );
    cur.dispose();
    next.dispose();
  }
}
