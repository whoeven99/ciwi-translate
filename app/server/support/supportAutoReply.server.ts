import { APP_I18N_LANGUAGE_CODES } from "~/lib/appI18nLanguages";

/** 非工作时间自动回复文案（按 App UI 语言）。缺省回退 en。 */
const AUTO_REPLY_BY_LOCALE: Record<string, string> = {
  en: `Hello, we have received your message. Sorry — due to time zone differences, we are currently outside business hours and cannot reply immediately. Our support team will review your message and get back to you as soon as possible!

Please leave your email address. We will reply in the app and by email.

Our commitment:
If we do not reply within 12 hours, we will proactively compensate you with 1,000,000 credits.
If we do not resolve your issue or provide a clear answer within 24 hours, we will proactively refund your current month's subscription fee.`,

  "zh-CN": `你好，已经收到您的消息。很抱歉，因为时差问题，我们当前并非工作时间，无法及时回复。我们的人工客服看到消息后会尽快回复并帮你解决问题！

请你留下你的邮箱，我们会在 app 内和发邮件的方式给您答复。

我们承诺：
如果超过 12 小时未回复，我们会主动补偿 100 万积分。
如果超过 24 小时未解决问题或者给出明确的答复，我们会主动退款当月套餐费用。`,

  "zh-TW": `您好，已收到您的訊息。很抱歉，因時差因素，我們目前不在工作時間，無法即時回覆。人工客服看到訊息後會盡快回覆並協助您解決問題！

請留下您的電子郵件，我們會在 app 內及以電子郵件方式回覆您。

我們承諾：
若超過 12 小時未回覆，我們將主動補償 100 萬積分。
若超過 24 小時未解決問題或未給出明確答覆，我們將主動退還當月套餐費用。`,

  fr: `Bonjour, nous avons bien reçu votre message. Désolé — en raison du décalage horaire, nous sommes actuellement en dehors des heures ouvrables et ne pouvons pas répondre immédiatement. Notre équipe examinera votre message et vous répondra dès que possible !

Veuillez laisser votre adresse e-mail. Nous vous répondrons dans l'application et par e-mail.

Notre engagement :
Si nous ne répondons pas sous 12 heures, nous vous compenserons proactivement avec 1 000 000 crédits.
Si nous ne résolvons pas votre problème ou ne fournissons pas de réponse claire sous 24 heures, nous rembourserons proactivement les frais d'abonnement du mois en cours.`,

  de: `Hallo, wir haben Ihre Nachricht erhalten. Aufgrund der Zeitzone sind wir derzeit außerhalb der Geschäftszeiten und können nicht sofort antworten. Unser Support-Team wird Ihre Nachricht prüfen und sich so schnell wie möglich bei Ihnen melden!

Bitte hinterlassen Sie Ihre E-Mail-Adresse. Wir antworten in der App und per E-Mail.

Unser Versprechen:
Wenn wir nicht innerhalb von 12 Stunden antworten, erstatten wir Ihnen proaktiv 1.000.000 Credits.
Wenn wir Ihr Anliegen nicht innerhalb von 24 Stunden lösen oder eine klare Antwort geben, erstatten wir proaktiv die Abogebühr des laufenden Monats.`,

  es: `Hola, hemos recibido tu mensaje. Lo sentimos: debido a la diferencia horaria, estamos fuera del horario laboral y no podemos responder de inmediato. Nuestro equipo revisará tu mensaje y te responderá lo antes posible.

Por favor, deja tu correo electrónico. Responderemos en la app y por correo.

Nuestro compromiso:
Si no respondemos en 12 horas, te compensaremos proactivamente con 1.000.000 créditos.
Si no resolvemos tu problema o no damos una respuesta clara en 24 horas, reembolsaremos proactivamente la cuota de suscripción del mes en curso.`,

  ja: `こんにちは、メッセージを受け取りました。時差の関係で現在は営業時間外のため、すぐには返信できません。担当者が確認次第、できるだけ早く返信いたします。

メールアドレスをご記入ください。アプリ内とメールの両方でご返信します。

お約束：
12時間以内に返信がない場合、100万クレジットを能動的に補償します。
24時間以内に問題が解決しない、または明確な回答がない場合、当月のプラン料金を能動的に返金します。`,

  pt: `Olá, recebemos a sua mensagem. Pedimos desculpa — devido ao fuso horário, estamos fora do horário de expediente e não podemos responder de imediato. A nossa equipa irá analisar a sua mensagem e responder o mais rapidamente possível!

Por favor, deixe o seu e-mail. Responderemos na app e por e-mail.

O nosso compromisso:
Se não respondermos em 12 horas, compensaremos proativamente com 1.000.000 créditos.
Se não resolvermos o seu problema ou não dermos uma resposta clara em 24 horas, reembolsaremos proativamente a taxa de subscrição do mês em curso.`,

  nl: `Hallo, we hebben uw bericht ontvangen. Vanwege het tijdsverschil zijn we momenteel buiten kantooruren en kunnen we niet meteen reageren. Ons supportteam bekijkt uw bericht en antwoordt zo snel mogelijk!

Laat uw e-mailadres achter. We antwoorden in de app en per e-mail.

Onze belofte:
Als we niet binnen 12 uur reageren, compenseren we u proactief met 1.000.000 credits.
Als we uw probleem niet binnen 24 uur oplossen of geen duidelijk antwoord geven, betalen we proactief het abonnementsgeld van de lopende maand terug.`,

  sv: `Hej, vi har tagit emot ditt meddelande. På grund av tidszonsskillnader är vi för närvarande utanför kontorstid och kan inte svara direkt. Vårt supportteam går igenom meddelandet och återkommer så snart som möjligt!

Lämna din e-postadress. Vi svarar i appen och via e-post.

Vårt löfte:
Om vi inte svarar inom 12 timmar kompenserar vi proaktivt med 1 000 000 credits.
Om vi inte löser ditt ärende eller ger ett tydligt svar inom 24 timmar återbetalar vi proaktivt månadens prenumerationsavgift.`,

  it: `Ciao, abbiamo ricevuto il tuo messaggio. A causa del fuso orario siamo attualmente fuori dall'orario lavorativo e non possiamo rispondere subito. Il nostro team esaminerà il messaggio e ti risponderà il prima possibile!

Lascia il tuo indirizzo e-mail. Risponderemo nell'app e via e-mail.

Il nostro impegno:
Se non rispondiamo entro 12 ore, ti compenseremo proattivamente con 1.000.000 crediti.
Se non risolviamo il problema o non forniamo una risposta chiara entro 24 ore, rimborseremo proattivamente l'abbonamento del mese in corso.`,

  uk: `Вітаємо, ми отримали ваше повідомлення. Через різницю в часових поясах зараз поза робочим часом, тому не можемо відповісти одразу. Наша команда перегляне повідомлення та відповість якомога швидше!

Будь ласка, залиште свою електронну адресу. Ми відповімо в додатку та електронною поштою.

Наші зobов'язання:
Якщо ми не відповімо протягом 12 годин, проактивно компенсуємо 1 000 000 кредитів.
Якщо протягом 24 годин не вирішимо проблему або не дамо чіткої відповіді, проактивно повернемо оплату підписки за поточний місяць.`,

  ru: `Здравствуйте, мы получили ваше сообщение. Из-за разницы часовых поясов сейчас нерабочее время, и мы не можем ответить сразу. Наша команда рассмотрит сообщение и ответит как можно скорее!

Пожалуйста, оставьте свой адрес электронной почты. Мы ответим в приложении и по электронной почте.

Наши обязательства:
Если мы не ответим в течение 12 часов, проактивно компенсируем 1 000 000 кредитов.
Если в течение 24 часов не решим проблему или не дадим чёткий ответ, проактивно вернём оплату подписки за текущий месяц.`,

  ko: `안녕하세요, 메시지를 받았습니다. 시차로 인해 현재 근무 시간이 아니어서 즉시 답변드리기 어렵습니다. 담당자가 확인 후 최대한 빨리 답변드리겠습니다!

이메일 주소를 남겨 주세요. 앱 내 및 이메일로 답변드립니다.

약속:
12시간 내 답변이 없으면 100만 크레딧을 적극적으로 보상합니다.
24시간 내 문제가 해결되지 않거나 명확한 답변을 드리지 못하면 당월 구독 요금을 적극적으로 환불합니다.`,

  tr: `Merhaba, mesajınızı aldık. Saat farkı nedeniyle şu anda mesai saatleri dışındayız ve hemen yanıt veremiyoruz. Destek ekibimiz mesajınızı inceleyip en kısa sürede size dönecektir!

Lütfen e-posta adresinizi bırakın. Uygulama içinde ve e-posta ile yanıt vereceğiz.

Taahhüdümüz:
12 saat içinde yanıt vermezsek, proaktif olarak 1.000.000 kredi tazmin ederiz.
24 saat içinde sorununuzu çözmez veya net bir yanıt vermezsek, o ayın abonelik ücretini proaktif olarak iade ederiz.`,
};

export const SUPPORT_OFF_HOURS_AUTO_REPLY_KIND = "off_hours_auto_reply";

const SUPPORTED_LOCALES = new Set<string>(APP_I18N_LANGUAGE_CODES);

/** 归一化客户端 locale（如 en-US → en，zh → zh-CN）。 */
export function normalizeSupportLocale(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-cn") || lower === "zh-hans") return "zh-CN";
  if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower === "zh-hant") return "zh-TW";
  const base = trimmed.split("-")[0]?.toLowerCase();
  if (base === "zh") return "zh-CN";
  for (const code of APP_I18N_LANGUAGE_CODES) {
    if (code.toLowerCase() === lower || code.toLowerCase() === base) return code;
  }
  return null;
}

/** 从消息正文推断语言（无法识别时返回 null）。 */
export function detectLocaleFromMessageContent(content: string): string | null {
  const text = content.trim();
  if (!text) return null;

  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0400-\u04ff]/.test(text)) {
    return /[іїєґ]/i.test(text) ? "uk" : "ru";
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    const traditionalHints =
      /[體國語聯繫讓這們為時問題處裡訊息無時區費用當月]/u.test(text);
    return traditionalHints ? "zh-TW" : "zh-CN";
  }

  const lower = text.toLowerCase();
  const wordHints: Array<[RegExp, string]> = [
    [/\b(hola|gracias|por favor|mensaje)\b/i, "es"],
    [/\b(bonjour|merci|message|veuillez)\b/i, "fr"],
    [/\b(hallo|danke|bitte|nachricht)\b/i, "de"],
    [/\b(olá|obrigad|mensagem|por favor)\b/i, "pt"],
    [/\b(hallo|bedankt|bericht|alstublieft)\b/i, "nl"],
    [/\b(hej|tack|meddelande|snälla)\b/i, "sv"],
    [/\b(ciao|grazie|messaggio|per favore)\b/i, "it"],
    [/\b(merhaba|teşekkür|mesaj|lütfen)\b/i, "tr"],
  ];
  for (const [pattern, locale] of wordHints) {
    if (pattern.test(lower)) return locale;
  }

  return null;
}

/** 消息语言 > 客户端 UI 语言 > en。 */
export function resolveSupportAutoReplyLocale(
  content: string,
  clientLocale?: string | null,
): string {
  const fromContent = detectLocaleFromMessageContent(content);
  if (fromContent && SUPPORTED_LOCALES.has(fromContent)) return fromContent;

  const fromClient = normalizeSupportLocale(clientLocale);
  if (fromClient && SUPPORTED_LOCALES.has(fromClient)) return fromClient;

  return "en";
}

export function getSupportAutoReplyText(locale: string): string {
  return AUTO_REPLY_BY_LOCALE[locale] ?? AUTO_REPLY_BY_LOCALE.en;
}
