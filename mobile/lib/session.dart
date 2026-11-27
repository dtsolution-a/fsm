import 'package:flutter/foundation.dart';
import 'api/api_client.dart';

enum AuthState { unknown, signedOut, signedIn }

/// Who is signed in. The UI listens to this and switches between the login screen and the app.
class Session extends ChangeNotifier {
  final ApiClient api;
  AuthState state = AuthState.unknown;
  Map<String, dynamic>? user;

  Session(this.api) {
    api.onSessionExpired = () {
      user = null;
      state = AuthState.signedOut;
      notifyListeners();
    };
  }

  /// On app start: if a token is saved, check it still works.
  Future<void> restore() async {
    final t = await api.store.read();
    if (t == null) {
      state = AuthState.signedOut;
    } else {
      try {
        user = Map<String, dynamic>.from(await api.get('/auth/me') as Map);
        state = _isEngineer(user) ? AuthState.signedIn : AuthState.signedOut;
        if (state == AuthState.signedOut) await api.logout();
      } on ApiException catch (e) {
        // offline at start-up: keep the saved login, the screens will show their own network errors
        if (e.isNetwork) {
          state = AuthState.signedIn;
        } else {
          await api.store.clear();
          state = AuthState.signedOut;
        }
      }
    }
    notifyListeners();
  }

  Future<void> login(String identifier, String password) async {
    final u = await api.login(identifier, password);
    if (!_isEngineer(u)) {
      await api.logout();
      throw const ApiException(403, 'This app is for field engineers. Office staff should use the web admin panel.');
    }
    user = u;
    state = AuthState.signedIn;
    notifyListeners();
  }

  Future<void> logout() async {
    await api.logout();
    user = null;
    state = AuthState.signedOut;
    notifyListeners();
  }

  static bool _isEngineer(Map<String, dynamic>? u) => u != null && u['role'] == 'engineer';
}
