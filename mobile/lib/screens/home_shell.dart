import 'dart:async';
import 'package:flutter/material.dart';
import '../l10n.dart';
import '../offline.dart';
import '../session.dart';
import '../ui/theme.dart';
import 'home_screen.dart';
import 'jobs_screen.dart';
import 'leave_screen.dart';
import 'profile_screen.dart';

/// Bottom navigation: Home, Jobs, Leave, Profile. One slim header shows the section title.
class HomeShell extends StatefulWidget {
  final Session session;
  const HomeShell({super.key, required this.session});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;
  Timer? _sync;

  static List<String> get _titles => ['कार्यसेतु', tr('title_my_jobs'), tr('nav_leave'), tr('nav_profile')];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    OfflineQueue.instance.load();
    // Offline mode: actions saved on the phone are retried every 30 s and whenever the app comes back to the front.
    _sync = Timer.periodic(const Duration(seconds: 30), (_) => OfflineQueue.instance.flush(widget.session.api));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) OfflineQueue.instance.flush(widget.session.api);
  }

  @override
  void dispose() {
    _sync?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = widget.session.api;
    final pages = <Widget>[
      HomeScreen(api: api, userName: widget.session.user?['name'] as String? ?? '', onOpenJobs: () => setState(() => _index = 1)),
      JobsScreen(api: api),
      LeaveScreen(api: api),
      ProfileScreen(session: widget.session),
    ];
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: 60,
        flexibleSpace: Container(decoration: const BoxDecoration(gradient: AppColors.hero, borderRadius: BorderRadius.vertical(bottom: Radius.circular(22)))),
        title: Row(children: [
          Container(padding: const EdgeInsets.all(2), decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle), child: ClipOval(child: Image.asset('assets/brand/shah-mark.png', width: 30, height: 30))),
          const SizedBox(width: 10),
          Text(_titles[_index]),
        ]),
      ),
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: Container(
        margin: const EdgeInsets.fromLTRB(14, 0, 14, 12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(30), boxShadow: AppColors.shadow),
        child: SafeArea(top: false, child: ClipRRect(borderRadius: BorderRadius.circular(30), child: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: [
            NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: tr('nav_home')),
            NavigationDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: tr('nav_jobs')),
            NavigationDestination(icon: Icon(Icons.event_available_outlined), selectedIcon: Icon(Icons.event_available), label: tr('nav_leave')),
            NavigationDestination(icon: Icon(Icons.account_circle_outlined), selectedIcon: Icon(Icons.account_circle), label: tr('nav_profile')),
          ],
        ))),
      ),
    );
  }
}
