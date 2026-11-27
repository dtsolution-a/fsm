import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'api/api_client.dart';
import 'api/token_store.dart';
import 'config.dart';
import 'l10n.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'session.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]); // portrait only (project requirement)
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.dark, systemNavigationBarColor: Colors.white, systemNavigationBarIconBrightness: Brightness.dark));
  await initializeDateFormatting();
  await AppLang.load();
  final session = Session(ApiClient(baseUrl: apiUrl, store: SecureTokenStore()));
  runApp(FsmApp(session: session));
  session.restore();
}

class FsmApp extends StatelessWidget {
  final Session session;
  const FsmApp({super.key, required this.session});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(valueListenable: AppLang.current, builder: (context, lang, _) => MaterialApp(
      key: ValueKey(lang),
      title: 'कार्यसेतु',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: ListenableBuilder(
        listenable: session,
        builder: (context, _) => switch (session.state) {
          AuthState.unknown => const Scaffold(body: Center(child: CircularProgressIndicator())),
          AuthState.signedOut => LoginScreen(session: session),
          AuthState.signedIn => HomeShell(session: session),
        },
      ),
    ));
  }
}
