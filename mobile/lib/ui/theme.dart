import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/services.dart';
import '../l10n.dart';

/// Design tokens: Shah Engineers blue, a soft cool-grey canvas, white cards with big radii and gentle shadows.
class AppColors {
  static const primary = Color(0xFF2F5BEA);
  static const primaryDark = Color(0xFF1B2F8C);
  static const primarySoft = Color(0xFFE8EEFF);
  static const accent = Color(0xFF14B8A6);
  static const bg = Color(0xFFF4F6FB);
  static const surface = Colors.white;
  static const border = Color(0xFFE6EAF2);
  static const text = Color(0xFF111B33);
  static const textMuted = Color(0xFF5B6784);
  static const textFaint = Color(0xFF98A2B8);
  static const success = Color(0xFF12A36B);
  static const warning = Color(0xFFE08A00);
  static const danger = Color(0xFFE5484D);
  static const info = Color(0xFF2F5BEA);
  static const neutral = Color(0xFF6B7690);

  /// Hero gradient used on headers and the main call-to-action areas.
  static const hero = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF1B2F8C), Color(0xFF2F5BEA), Color(0xFF4C7BFF)]);
  static const List<BoxShadow> shadow = [BoxShadow(color: Color(0x14111B33), blurRadius: 24, offset: Offset(0, 8)), BoxShadow(color: Color(0x0A111B33), blurRadius: 4, offset: Offset(0, 1))];
  static const List<BoxShadow> shadowSoft = [BoxShadow(color: Color(0x0F111B33), blurRadius: 16, offset: Offset(0, 4))];
}

Color statusColor(String code, [ColorScheme? _]) => switch (code) {
      'completed' || 'closed' => AppColors.success,
      'in_progress' => AppColors.info,
      'pending_review' || 'rescheduled' || 'open' || 'on_hold' => AppColors.warning,
      'cancelled' => AppColors.neutral,
      _ => AppColors.primary, // assigned
    };

String statusLabel(String code) {
  final t = tr('st_$code');
  if (t != 'st_$code') return t;
  return code.isEmpty ? '' : code[0].toUpperCase() + code.substring(1).replaceAll('_', ' ');
}

ThemeData buildTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.primary,
    onPrimary: Colors.white,
    secondary: AppColors.accent,
    onSecondary: Colors.white,
    error: AppColors.danger,
    onError: Colors.white,
    surface: AppColors.surface,
    onSurface: AppColors.text,
    onSurfaceVariant: AppColors.textMuted,
    outline: AppColors.border,
    outlineVariant: AppColors.border,
    primaryContainer: AppColors.primarySoft,
    onPrimaryContainer: AppColors.primaryDark,
    errorContainer: Color(0xFFFDEBEC),
    onErrorContainer: Color(0xFF7A1B1F),
    surfaceContainerHighest: Color(0xFFEDF0F7),
  );
  final field = BorderRadius.circular(16);
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: field, borderSide: BorderSide(color: c, width: w));

  return ThemeData(
    useMaterial3: true,
    fontFamily: 'Poppins',
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.bg,
    canvasColor: AppColors.surface,
    dividerColor: AppColors.border,
    splashFactory: InkSparkle.splashFactory,
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: ZoomPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: AppColors.text, letterSpacing: -0.4),
      headlineSmall: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.text, letterSpacing: -0.3),
      titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text, letterSpacing: -0.1),
      titleMedium: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: AppColors.text),
      titleSmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textFaint, letterSpacing: 0.8),
      bodyLarge: TextStyle(fontSize: 15.5, color: AppColors.text, height: 1.4),
      bodyMedium: TextStyle(fontSize: 14, color: AppColors.text, height: 1.4),
      bodySmall: TextStyle(fontSize: 12.5, color: AppColors.textMuted, height: 1.35),
      labelLarge: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
    ),
    // Screens open under a deep-blue bar with softly rounded bottom corners
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.primaryDark,
      foregroundColor: Colors.white,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      systemOverlayStyle: SystemUiOverlayStyle(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light, statusBarBrightness: Brightness.dark),
      titleTextStyle: TextStyle(fontFamily: 'Poppins', fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white),
      iconTheme: IconThemeData(color: Colors.white),
      actionsIconTheme: IconThemeData(color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(bottom: Radius.circular(22))),
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shadowColor: const Color(0x14111B33),
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.transparent,
      elevation: 0,
      height: 68,
      indicatorColor: AppColors.primarySoft,
      indicatorShape: const StadiumBorder(),
      surfaceTintColor: Colors.transparent,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontFamily: 'Poppins', fontSize: 11.5, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500, color: s.contains(WidgetState.selected) ? AppColors.primary : AppColors.textMuted)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 24, color: s.contains(WidgetState.selected) ? AppColors.primary : AppColors.textFaint)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFF8F9FD),
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: border(AppColors.border),
      enabledBorder: border(AppColors.border),
      focusedBorder: border(AppColors.primary, 1.8),
      errorBorder: border(AppColors.danger),
      focusedErrorBorder: border(AppColors.danger, 1.8),
      labelStyle: const TextStyle(color: AppColors.textMuted, fontSize: 14),
      floatingLabelStyle: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600),
      hintStyle: const TextStyle(color: AppColors.textFaint),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        disabledBackgroundColor: const Color(0xFFD5DBEA),
        disabledForegroundColor: Colors.white,
        minimumSize: const Size.fromHeight(54),
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontFamily: 'Poppins', fontSize: 15.5, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        minimumSize: const Size.fromHeight(54),
        side: const BorderSide(color: Color(0xFFD3DBF0), width: 1.4),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: const TextStyle(fontFamily: 'Poppins', fontSize: 15.5, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: AppColors.primary, minimumSize: const Size(0, 38), tapTargetSize: MaterialTapTargetSize.shrinkWrap, textStyle: const TextStyle(fontFamily: 'Poppins', fontSize: 14, fontWeight: FontWeight.w600))),
    chipTheme: ChipThemeData(shape: const StadiumBorder(), side: const BorderSide(color: AppColors.border), selectedColor: AppColors.primarySoft, backgroundColor: Colors.white, labelStyle: const TextStyle(fontFamily: 'Poppins', fontWeight: FontWeight.w600)),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: AppColors.text, contentTextStyle: const TextStyle(fontFamily: 'Poppins', color: Colors.white), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
    dialogTheme: DialogThemeData(backgroundColor: AppColors.surface, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24))),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: AppColors.surface, surfaceTintColor: Colors.transparent, showDragHandle: true, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26)))),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1, space: 1),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.primary),
  );
}
