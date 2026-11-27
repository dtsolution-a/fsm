import 'package:flutter/foundation.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'l10n_more.dart';

/// App language. Short, simple sentences so that every step is clear to everyone.
/// The chosen language is also used for speaking a reason (voice to text).
class AppLang {
  static const options = <String, String>{'en': 'English', 'hi': 'हिन्दी', 'gu': 'ગુજરાતી', 'mr': 'मराठी'};
  static const speechLocale = <String, String>{'en': 'en_IN', 'hi': 'hi_IN', 'gu': 'gu_IN', 'mr': 'mr_IN'};
  static final ValueNotifier<String> current = ValueNotifier('en');
  static const _key = 'app_lang';

  static Future<void> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      final v = p.getString(_key);
      if (v != null && options.containsKey(v)) current.value = v;
    } catch (_) {/* default language */}
  }

  static Future<void> set(String code) async {
    if (!options.containsKey(code)) return;
    current.value = code;
    try { await (await SharedPreferences.getInstance()).setString(_key, code); } catch (_) {}
  }
}

/// tr('key', {'km': '12'}) -> text in the chosen language (English if a word is missing).
final Map<String, Map<String, String>> _all = {for (final e in _t.entries) e.key: {...e.value, ...?moreT[e.key]}};

/// Date / time in the chosen language (month and day names, numerals as the language writes them).
String fmtDate(String pattern, DateTime d) {
  try { return DateFormat(pattern, AppLang.current.value).format(d); } catch (_) { return DateFormat(pattern).format(d); }
}

String tr(String key, [Map<String, String>? args]) {
  var s = _all[AppLang.current.value]?[key] ?? _all['en']![key] ?? key;
  args?.forEach((k, v) => s = s.replaceAll('{$k}', v));
  return s;
}

const _t = <String, Map<String, String>>{
  'en': {
    'new_job': 'A new job for you', 'next_step': 'What to do now', 'step_accept': 'Accept', 'step_travel': 'Go', 'step_scan': 'Scan', 'step_work': 'Work', 'step_finish': 'Finish',
    'accept': 'Accept this job', 'flag': 'I cannot take it', 'start_job': 'Start job', 'start_hint': 'Your time starts when you press Start. The time you take to reach the site is counted too.',
    'checking_location': 'Finding where you are…', 'you_are_here': 'You are at the site', 'you_are_away': 'The site is {km} km from you (about {min} min by road)', 'site_unknown': 'The location of this site is not known yet. Go to the site, then scan the QR on the machine.',
    'choose_how': 'How will you go?', 'show_route': 'Show me the route', 'own_way': 'I will go on my own', 'own_way_hint': 'The app will not show the route. Your distance is still counted.',
    'on_the_way': 'On the way to the site', 'travel_time': 'Travel time', 'km_left': 'About {km} km to go', 'open_map': 'Open route in map', 'reached': 'I have reached - scan QR',
    'scan_title': 'Scan the QR on the machine', 'scan_hint': 'Stand next to the machine and point the camera at the QR sticker on it.', 'qr_not_working': 'The QR is not working', 'scanning': 'Checking…',
    'wrong_machine': 'This QR is of a different machine. Scan the QR on the machine of this job.', 'too_far': 'You are {m} away from the service station. Go to the machine and scan again.',
    'gps_off': 'Please turn on location (GPS) and allow it for this app.', 'gps_wait': 'Could not get your location. Go outside or near a window and try again.',
    'more_km_title': 'You travelled more than expected', 'more_km_text': 'Expected about {exp} km. You travelled {act} km. Please tell us why.',
    'reason_hint': 'Write the reason, or press the microphone and speak', 'speak': 'Speak', 'listening': 'Listening… speak now', 'send': 'Send', 'mic_unavailable': 'Speaking is not available on this phone. Please type the reason.',
    'working_now': 'Working at the machine', 'work_time': 'Work time', 'need_spares': 'I need spare parts', 'work_done': 'Work is finished',
    'spare_title': 'Which spare parts do you need?', 'spare_search': 'Search part name or number', 'spare_add': 'Add', 'spare_note': 'Anything to tell the office? (optional)', 'spare_send': 'Send request',
    'spare_sent': 'Request sent. The job is on hold and your work time has stopped.', 'waiting_spares': 'Waiting for spare parts', 'waiting_spares_text': 'The office has your request. You will get a message when the parts are ready.',
    'spares_ready': 'Spare parts are ready', 'collect_at': 'Collect from: {hub}', 'collect_then': 'After you collect them, press Start job again.', 'spares_no': 'Spare parts could not be given',
    'language': 'Language', 'alerts': 'Messages for you', 'ok': 'OK', 'try_again': 'Try again', 'cancel': 'Cancel', 'continue': 'Continue', 'need_net': 'Internet is needed for this step. Please check your connection and try again.',
    'location_perm': 'Allow location for this app, so the trip can be counted.', 'camera_perm': 'Allow the camera for this app to scan the QR.',
  },
  'hi': {
    'new_job': 'आपके लिए नया जॉब', 'next_step': 'अब क्या करना है', 'step_accept': 'स्वीकार', 'step_travel': 'जाएँ', 'step_scan': 'स्कैन', 'step_work': 'काम', 'step_finish': 'पूरा',
    'accept': 'यह जॉब स्वीकार करें', 'flag': 'मैं नहीं ले सकता', 'start_job': 'जॉब शुरू करें', 'start_hint': 'स्टार्ट दबाते ही आपका समय शुरू होगा। साइट तक पहुँचने का समय भी गिना जाएगा।',
    'checking_location': 'आपकी जगह देख रहे हैं…', 'you_are_here': 'आप साइट पर हैं', 'you_are_away': 'साइट आपसे {km} किमी दूर है (सड़क से लगभग {min} मिनट)', 'site_unknown': 'इस साइट की जगह अभी पता नहीं है। साइट पर जाएँ, फिर मशीन का QR स्कैन करें।',
    'choose_how': 'आप कैसे जाएँगे?', 'show_route': 'मुझे रास्ता दिखाएँ', 'own_way': 'मैं खुद चला जाऊँगा', 'own_way_hint': 'ऐप रास्ता नहीं दिखाएगा। आपकी दूरी फिर भी गिनी जाएगी।',
    'on_the_way': 'साइट के रास्ते में', 'travel_time': 'सफ़र का समय', 'km_left': 'लगभग {km} किमी बाकी', 'open_map': 'नक्शे में रास्ता खोलें', 'reached': 'मैं पहुँच गया - QR स्कैन करें',
    'scan_title': 'मशीन का QR स्कैन करें', 'scan_hint': 'मशीन के पास खड़े होकर कैमरा उस पर लगे QR स्टिकर की ओर करें।', 'qr_not_working': 'QR काम नहीं कर रहा', 'scanning': 'जाँच रहे हैं…',
    'wrong_machine': 'यह QR किसी दूसरी मशीन का है। इस जॉब की मशीन का QR स्कैन करें।', 'too_far': 'आप सर्विस स्टेशन से {m} दूर हैं। मशीन के पास जाकर फिर स्कैन करें।',
    'gps_off': 'कृपया लोकेशन (GPS) चालू करें और इस ऐप को अनुमति दें।', 'gps_wait': 'आपकी लोकेशन नहीं मिली। खुली जगह या खिड़की के पास जाकर फिर कोशिश करें।',
    'more_km_title': 'आपने उम्मीद से ज़्यादा सफ़र किया', 'more_km_text': 'लगभग {exp} किमी की उम्मीद थी। आपने {act} किमी सफ़र किया। कृपया कारण बताएँ।',
    'reason_hint': 'कारण लिखें, या माइक दबाकर बोलें', 'speak': 'बोलें', 'listening': 'सुन रहे हैं… अब बोलें', 'send': 'भेजें', 'mic_unavailable': 'इस फ़ोन पर बोलकर लिखना उपलब्ध नहीं है। कृपया कारण लिखें।',
    'working_now': 'मशीन पर काम चल रहा है', 'work_time': 'काम का समय', 'need_spares': 'मुझे स्पेयर पार्ट चाहिए', 'work_done': 'काम पूरा हो गया',
    'spare_title': 'आपको कौन से स्पेयर पार्ट चाहिए?', 'spare_search': 'पार्ट का नाम या नंबर खोजें', 'spare_add': 'जोड़ें', 'spare_note': 'ऑफिस को कुछ बताना है? (ज़रूरी नहीं)', 'spare_send': 'अनुरोध भेजें',
    'spare_sent': 'अनुरोध भेज दिया। जॉब रुकी हुई है और आपका काम का समय बंद हो गया है।', 'waiting_spares': 'स्पेयर पार्ट का इंतज़ार', 'waiting_spares_text': 'ऑफिस के पास आपका अनुरोध है। पार्ट तैयार होने पर आपको संदेश मिलेगा।',
    'spares_ready': 'स्पेयर पार्ट तैयार हैं', 'collect_at': 'यहाँ से लें: {hub}', 'collect_then': 'लेने के बाद फिर से जॉब शुरू करें दबाएँ।', 'spares_no': 'स्पेयर पार्ट नहीं दिए जा सके',
    'language': 'भाषा', 'alerts': 'आपके लिए संदेश', 'ok': 'ठीक है', 'try_again': 'फिर कोशिश करें', 'cancel': 'रद्द करें', 'continue': 'आगे बढ़ें', 'need_net': 'इस काम के लिए इंटरनेट चाहिए। कृपया कनेक्शन जाँचकर फिर कोशिश करें।',
    'location_perm': 'ऐप को लोकेशन की अनुमति दें, ताकि सफ़र गिना जा सके।', 'camera_perm': 'QR स्कैन करने के लिए ऐप को कैमरे की अनुमति दें।',
  },
  'gu': {
    'new_job': 'તમારા માટે નવી જોબ', 'next_step': 'હવે શું કરવાનું છે', 'step_accept': 'સ્વીકારો', 'step_travel': 'જાઓ', 'step_scan': 'સ્કેન', 'step_work': 'કામ', 'step_finish': 'પૂર્ણ',
    'accept': 'આ જોબ સ્વીકારો', 'flag': 'હું લઈ શકતો નથી', 'start_job': 'જોબ શરૂ કરો', 'start_hint': 'સ્ટાર્ટ દબાવતાં જ તમારો સમય શરૂ થશે. સાઇટ સુધી પહોંચવાનો સમય પણ ગણાશે.',
    'checking_location': 'તમારી જગ્યા જોઈ રહ્યા છીએ…', 'you_are_here': 'તમે સાઇટ પર છો', 'you_are_away': 'સાઇટ તમારાથી {km} કિમી દૂર છે (રસ્તે લગભગ {min} મિનિટ)', 'site_unknown': 'આ સાઇટની જગ્યા હજુ ખબર નથી. સાઇટ પર જાઓ, પછી મશીનનો QR સ્કેન કરો.',
    'choose_how': 'તમે કેવી રીતે જશો?', 'show_route': 'મને રસ્તો બતાવો', 'own_way': 'હું જાતે જઈશ', 'own_way_hint': 'એપ રસ્તો બતાવશે નહીં. તમારું અંતર છતાં ગણાશે.',
    'on_the_way': 'સાઇટ તરફ રસ્તામાં', 'travel_time': 'મુસાફરીનો સમય', 'km_left': 'લગભગ {km} કિમી બાકી', 'open_map': 'નકશામાં રસ્તો ખોલો', 'reached': 'હું પહોંચી ગયો - QR સ્કેન કરો',
    'scan_title': 'મશીનનો QR સ્કેન કરો', 'scan_hint': 'મશીન પાસે ઊભા રહી કેમેરો તેના પરના QR સ્ટીકર તરફ રાખો.', 'qr_not_working': 'QR કામ કરતો નથી', 'scanning': 'ચકાસી રહ્યા છીએ…',
    'wrong_machine': 'આ QR બીજા મશીનનો છે. આ જોબના મશીનનો QR સ્કેન કરો.', 'too_far': 'તમે સર્વિસ સ્ટેશનથી {m} દૂર છો. મશીન પાસે જઈને ફરી સ્કેન કરો.',
    'gps_off': 'કૃપા કરીને લોકેશન (GPS) ચાલુ કરો અને આ એપને પરવાનગી આપો.', 'gps_wait': 'તમારું લોકેશન મળ્યું નથી. ખુલ્લી જગ્યાએ કે બારી પાસે જઈને ફરી પ્રયત્ન કરો.',
    'more_km_title': 'તમે અપેક્ષા કરતાં વધુ મુસાફરી કરી', 'more_km_text': 'લગભગ {exp} કિમીની અપેક્ષા હતી. તમે {act} કિમી મુસાફરી કરી. કૃપા કરીને કારણ જણાવો.',
    'reason_hint': 'કારણ લખો, અથવા માઇક દબાવીને બોલો', 'speak': 'બોલો', 'listening': 'સાંભળી રહ્યા છીએ… હવે બોલો', 'send': 'મોકલો', 'mic_unavailable': 'આ ફોન પર બોલીને લખવું ઉપલબ્ધ નથી. કૃપા કરીને કારણ લખો.',
    'working_now': 'મશીન પર કામ ચાલે છે', 'work_time': 'કામનો સમય', 'need_spares': 'મને સ્પેર પાર્ટ જોઈએ છે', 'work_done': 'કામ પૂરું થયું',
    'spare_title': 'તમને કયા સ્પેર પાર્ટ જોઈએ છે?', 'spare_search': 'પાર્ટનું નામ અથવા નંબર શોધો', 'spare_add': 'ઉમેરો', 'spare_note': 'ઓફિસને કંઈ કહેવું છે? (જરૂરી નથી)', 'spare_send': 'વિનંતી મોકલો',
    'spare_sent': 'વિનંતી મોકલી. જોબ અટકેલી છે અને તમારો કામનો સમય બંધ થયો છે.', 'waiting_spares': 'સ્પેર પાર્ટની રાહ', 'waiting_spares_text': 'ઓફિસ પાસે તમારી વિનંતી છે. પાર્ટ તૈયાર થતાં તમને સંદેશ મળશે.',
    'spares_ready': 'સ્પેર પાર્ટ તૈયાર છે', 'collect_at': 'અહીંથી લો: {hub}', 'collect_then': 'લીધા પછી ફરીથી જોબ શરૂ કરો દબાવો.', 'spares_no': 'સ્પેર પાર્ટ આપી શકાયા નથી',
    'language': 'ભાષા', 'alerts': 'તમારા માટે સંદેશ', 'ok': 'બરાબર', 'try_again': 'ફરી પ્રયત્ન કરો', 'cancel': 'રદ કરો', 'continue': 'આગળ વધો', 'need_net': 'આ પગલા માટે ઇન્ટરનેટ જોઈએ. કૃપા કરીને કનેક્શન તપાસી ફરી પ્રયત્ન કરો.',
    'location_perm': 'એપને લોકેશનની પરવાનગી આપો, જેથી મુસાફરી ગણી શકાય.', 'camera_perm': 'QR સ્કેન કરવા એપને કેમેરાની પરવાનગી આપો.',
  },
  'mr': {
    'new_job': 'तुमच्यासाठी नवीन जॉब', 'next_step': 'आता काय करायचे', 'step_accept': 'स्वीकारा', 'step_travel': 'जा', 'step_scan': 'स्कॅन', 'step_work': 'काम', 'step_finish': 'पूर्ण',
    'accept': 'हा जॉब स्वीकारा', 'flag': 'मी घेऊ शकत नाही', 'start_job': 'जॉब सुरू करा', 'start_hint': 'स्टार्ट दाबताच तुमचा वेळ सुरू होईल. साइटवर पोहोचण्याचा वेळही मोजला जाईल.',
    'checking_location': 'तुमची जागा पाहत आहोत…', 'you_are_here': 'तुम्ही साइटवर आहात', 'you_are_away': 'साइट तुमच्यापासून {km} किमी दूर आहे (रस्त्याने सुमारे {min} मिनिटे)', 'site_unknown': 'या साइटची जागा अजून माहीत नाही. साइटवर जा, मग मशीनचा QR स्कॅन करा.',
    'choose_how': 'तुम्ही कसे जाणार?', 'show_route': 'मला रस्ता दाखवा', 'own_way': 'मी स्वतः जाईन', 'own_way_hint': 'ॲप रस्ता दाखवणार नाही. तुमचे अंतर तरीही मोजले जाईल.',
    'on_the_way': 'साइटकडे वाटेत', 'travel_time': 'प्रवासाचा वेळ', 'km_left': 'सुमारे {km} किमी बाकी', 'open_map': 'नकाशात रस्ता उघडा', 'reached': 'मी पोहोचलो - QR स्कॅन करा',
    'scan_title': 'मशीनचा QR स्कॅन करा', 'scan_hint': 'मशीनजवळ उभे राहून कॅमेरा त्यावरील QR स्टिकरकडे धरा.', 'qr_not_working': 'QR चालत नाही', 'scanning': 'तपासत आहोत…',
    'wrong_machine': 'हा QR दुसऱ्या मशीनचा आहे. या जॉबच्या मशीनचा QR स्कॅन करा.', 'too_far': 'तुम्ही सर्व्हिस स्टेशनपासून {m} दूर आहात. मशीनजवळ जाऊन पुन्हा स्कॅन करा.',
    'gps_off': 'कृपया लोकेशन (GPS) सुरू करा आणि या ॲपला परवानगी द्या.', 'gps_wait': 'तुमचे लोकेशन मिळाले नाही. मोकळ्या जागी किंवा खिडकीजवळ जाऊन पुन्हा प्रयत्न करा.',
    'more_km_title': 'तुम्ही अपेक्षेपेक्षा जास्त प्रवास केला', 'more_km_text': 'सुमारे {exp} किमीची अपेक्षा होती. तुम्ही {act} किमी प्रवास केला. कृपया कारण सांगा.',
    'reason_hint': 'कारण लिहा, किंवा माइक दाबून बोला', 'speak': 'बोला', 'listening': 'ऐकत आहोत… आता बोला', 'send': 'पाठवा', 'mic_unavailable': 'या फोनवर बोलून लिहिणे उपलब्ध नाही. कृपया कारण लिहा.',
    'working_now': 'मशीनवर काम सुरू आहे', 'work_time': 'कामाचा वेळ', 'need_spares': 'मला स्पेअर पार्ट हवेत', 'work_done': 'काम पूर्ण झाले',
    'spare_title': 'तुम्हाला कोणते स्पेअर पार्ट हवेत?', 'spare_search': 'पार्टचे नाव किंवा नंबर शोधा', 'spare_add': 'जोडा', 'spare_note': 'ऑफिसला काही सांगायचे आहे? (गरजेचे नाही)', 'spare_send': 'विनंती पाठवा',
    'spare_sent': 'विनंती पाठवली. जॉब थांबला आहे आणि तुमचा कामाचा वेळ बंद झाला आहे.', 'waiting_spares': 'स्पेअर पार्टची प्रतीक्षा', 'waiting_spares_text': 'ऑफिसकडे तुमची विनंती आहे. पार्ट तयार झाल्यावर तुम्हाला संदेश मिळेल.',
    'spares_ready': 'स्पेअर पार्ट तयार आहेत', 'collect_at': 'येथून घ्या: {hub}', 'collect_then': 'घेतल्यानंतर पुन्हा जॉब सुरू करा दाबा.', 'spares_no': 'स्पेअर पार्ट देता आले नाहीत',
    'language': 'भाषा', 'alerts': 'तुमच्यासाठी संदेश', 'ok': 'ठीक आहे', 'try_again': 'पुन्हा प्रयत्न करा', 'cancel': 'रद्द करा', 'continue': 'पुढे जा', 'need_net': 'या पायरीसाठी इंटरनेट हवे. कृपया कनेक्शन तपासून पुन्हा प्रयत्न करा.',
    'location_perm': 'ॲपला लोकेशनची परवानगी द्या, म्हणजे प्रवास मोजता येईल.', 'camera_perm': 'QR स्कॅन करण्यासाठी ॲपला कॅमेऱ्याची परवानगी द्या.',
  },
};
