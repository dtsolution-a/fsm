/// Backend address. Set per build:
///   flutter run --dart-define=API_URL=http://10.0.2.2:3001/api/v1     (Android emulator -> your PC)
///   flutter build apk --dart-define=API_URL=https://fsm.yourcompany.com/api/v1
/// Release builds must use https.
const String apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3001/api/v1');
