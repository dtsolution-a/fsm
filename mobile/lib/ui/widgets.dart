import 'package:flutter/material.dart';
import 'theme.dart';

/// A soft white card with a big radius and a gentle shadow. The base of every block in the app.
class SoftCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final Gradient? gradient;
  final List<BoxShadow>? shadow;
  final BorderRadius? radius;
  const SoftCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap, this.color, this.gradient, this.shadow, this.radius});

  @override
  Widget build(BuildContext context) {
    final r = radius ?? BorderRadius.circular(20);
    return Container(
      decoration: BoxDecoration(color: gradient == null ? (color ?? AppColors.surface) : null, gradient: gradient, borderRadius: r, boxShadow: shadow ?? AppColors.shadowSoft),
      child: Material(
        color: Colors.transparent,
        borderRadius: r,
        child: InkWell(borderRadius: r, onTap: onTap, child: Padding(padding: padding, child: child)),
      ),
    );
  }
}

/// Fades and slides its child in; `order` staggers a list so cards arrive one after another.
class FadeIn extends StatelessWidget {
  final Widget child;
  final int order;
  const FadeIn({super.key, required this.child, this.order = 0});

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: Duration(milliseconds: 380 + order.clamp(0, 8) * 60),
        curve: Curves.easeOutCubic,
        builder: (context, t, c) => Opacity(opacity: t, child: Transform.translate(offset: Offset(0, (1 - t) * 14), child: c)),
        child: child,
      );
}

/// Small status label: tinted background, coloured text, no outline.
class Pill extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;
  const Pill(this.text, {super.key, required this.color, this.icon});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 13, color: color), const SizedBox(width: 4)],
          Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color)),
        ]),
      );
}

/// A block with a small title row.
class Section extends StatelessWidget {
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsetsGeometry? padding;
  const Section({super.key, this.title, this.trailing, required this.child, this.padding});

  @override
  Widget build(BuildContext context) => SoftCard(
        padding: EdgeInsets.zero,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 16, 10, 0),
              child: Row(children: [
                Container(width: 4, height: 14, decoration: BoxDecoration(color: AppColors.primary, borderRadius: BorderRadius.circular(2))),
                const SizedBox(width: 8),
                Expanded(child: Text(title!.toUpperCase(), style: Theme.of(context).textTheme.titleSmall)),
                ?trailing,
              ]),
            ),
          Padding(padding: padding ?? EdgeInsets.fromLTRB(18, title == null ? 18 : 10, 18, 18), child: child),
        ]),
      );
}

/// Label + value pair used in detail blocks, with a round icon chip.
class Field2 extends StatelessWidget {
  final String label;
  final String? value;
  final IconData? icon;
  const Field2(this.label, this.value, {super.key, this.icon});

  @override
  Widget build(BuildContext context) {
    if (value == null || value!.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (icon != null)
          Container(
            width: 36, height: 36, margin: const EdgeInsets.only(right: 12),
            decoration: BoxDecoration(color: AppColors.primarySoft, borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, size: 18, color: AppColors.primary),
          ),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(label, style: const TextStyle(fontSize: 11.5, color: AppColors.textFaint, fontWeight: FontWeight.w500)),
            const SizedBox(height: 1),
            Text(value!, style: const TextStyle(fontSize: 14.5, color: AppColors.text, height: 1.3, fontWeight: FontWeight.w500)),
          ]),
        ),
      ]),
    );
  }
}

/// Bottom action area that stays on screen while the page scrolls.
class ActionBar extends StatelessWidget {
  final List<Widget> children;
  const ActionBar({super.key, required this.children});

  @override
  Widget build(BuildContext context) => Container(
        decoration: const BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.vertical(top: Radius.circular(26)), boxShadow: [BoxShadow(color: Color(0x1A111B33), blurRadius: 24, offset: Offset(0, -6))]),
        child: SafeArea(top: false, child: Padding(padding: const EdgeInsets.fromLTRB(18, 16, 18, 14), child: Column(mainAxisSize: MainAxisSize.min, children: children))),
      );
}

/// Inline notice (offline, waiting to sync, errors) as a soft rounded strip.
class Notice extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;
  final VoidCallback? onClose;
  const Notice({super.key, required this.icon, required this.text, this.color = AppColors.info, this.onClose});

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        margin: const EdgeInsets.fromLTRB(14, 10, 14, 0),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(fontSize: 13, color: color, fontWeight: FontWeight.w600))),
          if (onClose != null) InkWell(onTap: onClose, child: Icon(Icons.close, size: 18, color: color)),
        ]),
      );
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  const EmptyState({super.key, required this.icon, required this.title, this.message});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 64),
        child: Column(children: [
          Container(width: 92, height: 92, decoration: const BoxDecoration(color: AppColors.primarySoft, shape: BoxShape.circle), child: Icon(icon, size: 42, color: AppColors.primary)),
          const SizedBox(height: 18),
          Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          if (message != null) ...[const SizedBox(height: 6), Text(message!, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center)],
        ]),
      );
}

/// Pill-shaped switch between a few views (Active / History).
class UnderlineTabs extends StatelessWidget {
  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;
  const UnderlineTabs({super.key, required this.labels, required this.index, required this.onChanged});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
        child: Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(color: const Color(0xFFE9EDF7), borderRadius: BorderRadius.circular(18)),
          child: Row(children: [
            for (var i = 0; i < labels.length; i++)
              Expanded(
                child: GestureDetector(
                  onTap: () => onChanged(i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    curve: Curves.easeOut,
                    alignment: Alignment.center,
                    height: 40,
                    decoration: BoxDecoration(color: i == index ? Colors.white : Colors.transparent, borderRadius: BorderRadius.circular(14), boxShadow: i == index ? AppColors.shadowSoft : null),
                    child: Text(labels[i], style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: i == index ? AppColors.primary : AppColors.textMuted)),
                  ),
                ),
              ),
          ]),
        ),
      );
}

/// Blue gradient header block (title area of Home and Profile) with rounded bottom corners.
class HeroHeader extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  const HeroHeader({super.key, required this.child, this.padding = const EdgeInsets.fromLTRB(20, 12, 20, 28)});

  @override
  Widget build(BuildContext context) => Container(
        decoration: const BoxDecoration(gradient: AppColors.hero, borderRadius: BorderRadius.vertical(bottom: Radius.circular(32))),
        child: SafeArea(bottom: false, child: Padding(padding: padding, child: child)),
      );
}

/// Grey shimmer blocks shown while something loads.
class Skeleton extends StatefulWidget {
  final double height;
  final double? width;
  final double radius;
  const Skeleton({super.key, this.height = 16, this.width, this.radius = 12});

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        builder: (context, _) => Container(
          width: widget.width, height: widget.height,
          decoration: BoxDecoration(color: Color.lerp(const Color(0xFFE6EAF4), const Color(0xFFF2F4FA), _c.value), borderRadius: BorderRadius.circular(widget.radius)),
        ),
      );
}
