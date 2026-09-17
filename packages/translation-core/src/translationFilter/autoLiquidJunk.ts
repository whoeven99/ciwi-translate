/**
 * Auto Liquid collect junk: review widgets, prices, SKU tokens, fitment years,
 * product/model codes, brands/platforms, person names, size codes, locale labels.
 * Keep aligned with extensions/ciwi-switcher/assets/ciwi-ui.js `looksLikeAutoLiquidJunk`.
 */

function normalize(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** If present, text is likely human UI/marketing copy — not a product model code. */
const MODEL_CODE_COPY_WORDS =
  /\b(guide|warranty|support|guarantee|customer|optional|note|buying|money|back|hassle|free|shipping|delivery|account|sign|register|subscribe|collection|product|products|accessories|checkout|cart|subtotal|verified|review|reviews|rating|star|stars|sale|shop|home|menu|search|contact|about|help|policy|terms|privacy|login|logout|welcome|hello|thanks|thank|please|click|view|show|hide|read|more|less|add|remove|delete|edit|save|cancel|close|open|share|follow|like|buy|order|total|discount|coupon|gift|card|payment|address|email|phone|submit|continue|next|previous|select|choose|option|options|size|color|quantity|item|items|empty|full|new|used|all|none|yes|no|speak|listen|write|learn|change|create|provide|include|offer|return|install|setup|configure|update|upgrade|download|upload|print|copy|paste|import|export|sync|backup|restore|reset|clear|refresh|reload|retry|skip|ignore|accept|reject|approve|deny|enable|disable|lock|unlock|expand|collapse|minimize|maximize|enter|leave|invite|send|receive|reply|forward|archive|modify|replace|move|duplicate|merge|split|group|sort|filter|find|highlight|mark|flag|pin|star|favorite|favourite|bookmark|block|mute|report|verify|validate|confirm|authenticate|authorize|signup|signin|signout|activate|deactivate|suspend|resume|pause|abort|restart|shutdown|reboot|power|sleep|wake|online|offline|connected|disconnected|available|unavailable|ready|waiting|loading|loaded|pending|processing|processed|failed|error|success|warning|info|unknown|misc|various|multiple|single|double|triple|dual|multi|left|right|center|centre|front|rear|inside|outside|first|second|third|last|final|initial|original|previous|current|present|past|future|recent|today|tomorrow|yesterday|morning|afternoon|evening|night|day|week|month|year|hour|minute|time|date|schedule|calendar|clock|timer|reminder|deadline|duration|interval|frequency|cycle|period|session|event|activity|action|operation|task|job|project|program|plan|step|stage|phase|process|procedure|method|way|mode|style|format|form|type|kind|sort|class|category|group|set|series|batch|lot|order|sequence|list|array|collection|bundle|package|kit|pack|box|case|unit|item|piece|part|component|module|element|feature|benefit|advantage|spec|detail|info|information|data|content|text|copy|title|heading|header|footer|body|section|paragraph|sentence|word|letter|character|symbol|number|digit|figure|amount|count|total|sum|average|percent|percentage|ratio|rate|score|rank|level|grade|degree|round|turn|move|game|match|team|player|member|partner|client|buyer|seller|vendor|supplier|merchant|brand|store|site|page|post|blog|news|article|story|video|photo|image|picture|file|link|url|web|net|app|apps|tool|tools|manual|document|documents|form|forms|field|fields|label|labels|button|buttons|icon|icons|tab|tabs|panel|panels|block|blocks|row|rows|column|columns|table|tables|grid|grids|map|maps|chart|charts|graph|graphs|plan|plans|device|devices|machine|machines|equipment|gear|accessory|mount|mounts|bracket|brackets|adapter|adapters|cable|cables|wire|wires|cord|cords|plug|plugs|port|ports|slot|slots|socket|sockets|pin|pins|connector|connectors|sensor|sensors|camera|cameras|screen|screens|display|displays|monitor|monitors|control|controls|switch|switches|knob|knobs|dial|dials|lever|levers|handle|handles|grip|grips|pad|pads|cover|covers|shell|shells|frame|frames|base|bases|stand|stands|arm|arms|bar|bars|rod|rods|tube|tubes|pipe|pipes|hose|hoses|filter|filters|pump|pumps|motor|motors|engine|engines|battery|batteries|charger|chargers|power|supply|supplies|converter|converters|generator|generators|solar|wind|water|air|gas|oil|fuel|energy|electric|electrical|electronic|electronics|digital|analog|wireless|wired|bluetooth|wifi|wi-fi|gps|usb|hdmi|aux|network|networks|server|servers|cloud|local|remote|virtual|physical|hardware|software|firmware|update|updates|upgrade|upgrades|version|versions|release|releases|patch|patches|fix|fixes|bug|bugs|issue|issues|message|messages|notification|notifications|tip|tips|hint|hints|comment|comments|feedback|vote|votes|confirm|confirmation|verified|verify|validation|validate|valid|invalid|success|successful|fail|failed|failure|pending|processing|processed|complete|completed|cancelled|canceled|refund|refunds|exchange|exchanges|replace|replacement|repair|repairs|maintain|maintenance|installation|settings|setting|preference|preferences|profile|profiles|dashboard|overview|summary|summaries|report|reports|history|histories|log|logs|record|records|track|tracks|monitor|monitors|watch|watches|measure|measures|test|tests|check|checks|inspect|inspections|audit|audits|scan|scans|analyze|analysis|compare|comparison|match|matches|browse|browses|explore|explores|discover|discovers|study|studies|research|researches|develop|develops|design|designs|build|builds|make|makes|produce|produces|manufacture|manufactures|assemble|assembles|pack|packs|ship|ships|deliver|delivers|receive|receives|transfer|transaction|exchange|conversion|rebate|voucher|certificate|check|cheque|cash|coin|bill|currency|dollar|euro|pound|yen|yuan|price|prices|cost|costs|value|values|tax|taxes|fee|fees|charge|charges|payment|payments|installment|deposit|withdrawal|balance|credit|debit|loan|mortgage|lease|rent|fare|toll|premium|basic|standard|custom|default|primary|secondary|main|extra|additional|optional|required|mandatory|recommended|suggested|preferred|popular|featured|bestseller|bestselling|latest|recent|upcoming|coming|stock|sold|limited|exclusive|professional|enterprise|business|personal|individual|family|community|global|international|national|regional|domestic|foreign|native|original|genuine|authentic|official|unofficial|licensed|certified|approved|tested|trusted|safe|secure|protected|private|confidential|secret|hidden|visible|shown|displayed|listed|unlisted|published|unpublished|draft|live|active|inactive|enabled|disabled|positive|negative|mixed|partial|finished|unfinished|done|undone|incomplete|complete|full|empty|good|bad|great|excellent|perfect|awesome|amazing|wonderful|fantastic|terrible|horrible|poor|fair|average|neutral|high|medium|low|none|other|miscellaneous|various|multiple|single|mono|stereo|surround|upper|lower|middle|central|mid|half|quarter|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|early|late|earlier|later|soon|later|now|then|here|there|near|far|close|distant|public|general|specific|special|normal|advanced|mini|lite|pro|plus|max|ultra|super|hyper|mega|giga|micro|nano|mini|small|large|big|little|huge|tiny|wide|narrow|broad|deep|shallow|tall|short|long|thick|thin|heavy|light|soft|hard|firm|loose|tight|smooth|rough|sharp|dull|bright|dark|hot|cold|warm|cool|clean|dirty|wet|dry|fast|slow|quick|rapid|instant|immediate|delayed|automatic|manual|manuals|custom|customize|customise|personalize|personalise|localize|localise|translate|translation|language|languages|locale|locales|country|countries|region|regions|city|cities|state|states|province|provinces|district|districts|area|areas|zone|zones|location|locations|position|positions|place|places|spot|spots|site|sites|venue|venues|destination|destinations|origin|origins|source|sources|target|targets|goal|goals|objective|objectives|purpose|purposes|reason|reasons|cause|causes|effect|effects|impact|impacts|influence|influences|factor|factors|aspect|aspects|attribute|attributes|property|properties|characteristic|characteristics|quality|qualities|condition|conditions|status|statuses|state|states|mode|modes|type|types|kind|kinds|class|classes|category|categories|group|groups|set|sets|series|batch|batches|lot|lots|order|orders|sequence|sequences|step|steps|stage|stages|phase|phases|period|periods|term|terms|session|sessions|event|events|activity|activities|action|actions|operation|operations|task|tasks|job|jobs|project|projects|program|programs|plan|plans|schedule|schedules|calendar|calendars|date|dates|time|times|clock|clocks|timer|timers|alarm|alarms|reminder|reminders|deadline|deadlines|duration|durations|interval|intervals|frequency|frequencies|cycle|cycles|loop|loops|repeat|repeats|once|twice|again|always|never|sometimes|often|usually|rarely|seldom|frequently|occasionally|regularly|constantly|continuously|periodically|daily|weekly|monthly|yearly|annual|annually|quarterly|hourly|nightly|spring|summer|autumn|fall|winter|season|seasons|weather|climate|temperature|temperatures|rain|snow|wind|storm|cloud|sun|moon|star|sky|earth|world|land|sea|ocean|lake|river|mountain|hill|valley|forest|tree|plant|flower|animal|bird|fish|dog|cat|horse|car|bike|motor|motorcycle|truck|bus|train|plane|boat|ship|vehicle|vehicles|road|street|highway|path|route|routes|direction|directions|north|south|east|west|forward|backward|up|down|in|out|at|by|to|of|is|am|be|do|go|see|say|said|make|made|take|took|give|gave|find|found|think|know|want|need|try|let|put|keep|hold|turn|move|play|run|walk|talk|call|ask|tell|show|feel|look|seem|become|leave|stay|bring|send|build|break|start|stop|end|begin|help|work|live|believe|remember|understand|learn|change|grow|pay|cost|spend|win|lose|lead|follow|create|provide|include|offer|return|arrive|happen|continue|appear|remain|suggest|require|allow|expect|consider|develop|receive|report|result|increase|decrease|improve|reduce|raise|fall|rise|drop|pick|push|pull|carry|cover|fill|hit|catch|throw|draw|cut|the|and|for|are|was|were|has|have|had|not|but|can|will|may|must|should|would|could|been|being|does|did|done|get|got|set|use|using|used|also|just|only|very|too|each|every|some|any|many|much|most|other|another|such|than|then|when|where|what|which|who|how|why|while|because|since|until|unless|although|though|after|before|during|between|through|over|under|above|below|within|without|along|across|around|with|from|into|your|our|their|my|me|we|they|he|she|it|you|his|her|its|them|us|who|whom|whose|which|that|this|these|those|here|there|where|everywhere|anywhere|nowhere|somewhere|always|never|sometimes|often|usually|rarely|seldom|frequently|occasionally|regularly|constantly|continuously|periodically|yes|no|ok|okay|fine|well|good|bad|great|excellent|perfect|awesome|amazing|wonderful|fantastic|terrible|horrible|poor|fair|average|neutral|positive|negative|mixed|partial|full|empty|complete|incomplete|finished|unfinished|done|undone|ready|waiting|loading|loaded|pending|processing|processed|failed|error|success|warning|info|debug|trace|log|fatal|critical|high|medium|low|none|unknown|other|misc|various|multiple|single|double|triple|dual|multi)\b/i;

/** Review / rating widget copy — not merchant translatable copy. */
function looksLikeReviewWidgetText(text: string): boolean {
  if (
    /\b(reviews?|ratings?|verified|stars?|sterren|stelle|étoiles?|estrellas?|bewertungen?)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/★/.test(text)) return true;
  if (/\d+\s*stars?\s*:/i.test(text)) return true;
  if (/\d+\s*[:：]\s*\d+/.test(text) && /%/.test(text)) return true;
  return false;
}

/** Real money amounts and explicit SKU labels. */
function looksLikePriceOrSkuLabel(text: string): boolean {
  if (/[$€£¥₹]\s*\d[\d,.'’]*/.test(text)) return true;
  if (/\d[\d,.'’]*\s*(JPY|EUR|USD|GBP|CNY|RMB)\b/i.test(text)) return true;
  if (/^SKU\s*[：:]/i.test(text)) return true;
  return false;
}

/** Motorcycle / parts fitment year strings (short compatibility lines). */
function looksLikeFitmentYearText(text: string): boolean {
  if (/\b(19|20)\d{2}\s+and\s+later\b/i.test(text)) return true;
  if (text.length <= 80 && /\b(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}\b/.test(text)) {
    return true;
  }
  return false;
}

function looksLikeSkuToken(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (!/^[A-Z0-9]{4,12}$/i.test(text)) return false;
  return /\d/.test(text);
}

function looksLikePromoOrCurrencyLabel(text: string): boolean {
  if (/^\d+\s*%\s*OFF$/i.test(text)) return true;
  if (/^(EUR|USD|GBP|JPY|CNY|RMB)\s*[€$£¥]?$/i.test(text)) return true;
  // Bare ISO currency stubs from switchers / price widgets (not FAQ/PDF/etc).
  if (
    /^(USD|EUR|GBP|JPY|CNY|RMB|SGD|AUD|CAD|HKD|CHF|NZD|SEK|NOK|DKK|PLN|INR|KRW|TWD|THB|MYR|PHP|VND|IDR)\s*[$€£¥]?$/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

/** Short all-caps acronyms that are product/platform codes, not UI copy. */
const MODEL_ACRONYM_BLOCKLIST = new Set([
  "APP",
  "USB",
  "GPS",
  "WIFI",
  "HTML",
  "HTTP",
  "SHOP",
  "SALE",
  "CART",
  "FREE",
  "NEW",
  "THE",
  "AND",
  "FOR",
  "YOU",
  "OUR",
  "ALL",
  "OFF",
  "TOP",
  "FAQ",
  "PDF",
]);

/**
 * A) Brands / platforms / payment marks — exact short tokens (do not translate).
 * Keep FAQ / Price / Shop / Support out of this set.
 */
const BRAND_OR_PLATFORM_EXACT = new Set(
  [
    "facebook",
    "instagram",
    "youtube",
    "tiktok",
    "pinterest",
    "twitter",
    "linkedin",
    "whatsapp",
    "spotify",
    "audible",
    "google",
    "apple",
    "carplay",
    "hicar",
    "carlife",
    "cgplay",
    "bluetooth",
    "waze",
    "paypal",
    "visa",
    "mastercard",
    "bancontact",
    "amex",
    "maestro",
    "klarna",
    "apple pay",
    "google pay",
    "american express",
    "ducati",
    "yamaha",
    "honda",
    "suzuki",
    "triumph",
    "bmw",
    "ktm",
    "wifi",
    "wi-fi",
  ].map((s) => s.toLowerCase()),
);

/**
 * E) Language switcher labels — exact match only.
 * Intentionally excludes short UI like FAQ / Shop / Price.
 */
const LOCALE_LABEL_EXACT = new Set(
  [
    "english",
    "deutsch",
    "german",
    "italiano",
    "italian",
    "nederlands",
    "dutch",
    "polski",
    "polish",
    "français",
    "francais",
    "french",
    "español",
    "espanol",
    "spanish",
    "português",
    "portugues",
    "portuguese",
    "русский",
    "russian",
    "日本語",
    "japanese",
    "中文",
    "简体中文",
    "繁體中文",
    "繁体中文",
    "chinese",
    "한국어",
    "korean",
    "العربية",
    "arabic",
    "svenska",
    "swedish",
    "dansk",
    "danish",
    "norsk",
    "norwegian",
    "suomi",
    "finnish",
    "čeština",
    "cestina",
    "czech",
    "magyar",
    "hungarian",
    "română",
    "romana",
    "romanian",
    "ελληνικά",
    "greek",
    "türkçe",
    "turkce",
    "turkish",
    "ไทย",
    "thai",
    "українська",
    "ukrainian",
    "hrvatski",
    "croatian",
    "български",
    "bulgarian",
    "slovenčina",
    "slovak",
    "slovenščina",
    "slovenian",
    "latviešu",
    "lithuanian",
    "lietuvių",
    "estonian",
    "eesti",
    "hebrew",
    "עברית",
    "hindi",
    "हिन्दी",
  ].map((s) => s.toLowerCase()),
);

/** D) Apparel size codes. */
function looksLikeSizeCode(text: string): boolean {
  return /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$/i.test(text);
}

/** A) Brand / platform / payment exact tokens. */
function looksLikeBrandOrPlatform(text: string): boolean {
  return BRAND_OR_PLATFORM_EXACT.has(text.toLowerCase());
}

/** E) Locale switcher labels. */
function looksLikeLocaleSwitcherLabel(text: string): boolean {
  return LOCALE_LABEL_EXACT.has(text.toLowerCase());
}

/**
 * B) Reviewer / account display names — not storefront copy.
 * Conservative: "Mark H.", "R. A.", Anonymous, @handles.
 */
function looksLikePersonOrHandle(text: string): boolean {
  if (/^anonymous$/i.test(text)) return true;
  if (/^@[A-Za-z0-9._-]{2,40}$/.test(text)) return true;
  // First + last initial: "Mark H." / "Mark H"
  if (/^[A-Z][a-z]{1,20}\s+[A-Z]\.?$/.test(text)) return true;
  // Initials: "R. A." / "D M."
  if (/^[A-Z]\.?\s+[A-Z]\.?$/.test(text)) return true;
  return false;
}

/**
 * C) Spec / coupon / EU size / dimension fragments beyond product model codes.
 */
function looksLikeSpecOrCouponOrEuSize(text: string): boolean {
  // Dimensions: 161*90.5*22mm / 12 x 8 cm
  if (/\d+(?:\.\d+)?\s*[*x×]\s*\d+/i.test(text)) return true;
  // Unit-only measurements: 180 g / 70 cm / 60Hz / 5V (short)
  if (text.length <= 24 && /^\d+(?:[.,]\d+)?\s*(mm|cm|m|kg|g|hz|mhz|ghz|fps|v|w|mah)\b/i.test(text)) {
    return true;
  }
  // EU shoe / apparel numeric sizes: EU 42
  if (/^EU\s*\d{2}$/i.test(text)) return true;
  // Coupon-like ALLCAPS+digits: FRANKSAFFAIR12
  if (/^[A-Z]{6,}\d{2,}$/.test(text)) return true;
  // Leading comma brand fragments from broken TreeWalker: ", BMW"
  if (/^,\s*[A-Za-z0-9][A-Za-z0-9 ./-]{0,30}$/.test(text)) return true;
  // "N likes" social counters
  if (/^\d+\s+likes?$/i.test(text)) return true;
  return false;
}

/**
 * Product / vehicle model codes (R NineT, AIO-5 Play, CGOS, F900 R).
 * Conservative: skip when text looks like normal UI/marketing copy.
 */
export function looksLikeProductModelCode(value: string): boolean {
  const t = normalize(value);
  if (!t || t.length > 40) return false;
  const words = t.split(/\s+/);
  if (words.length > 4) return false;

  // Structural patterns first (e.g. AIO-5 Play — "play" must not veto via copy words).
  if (/\b[A-Z]{2,}-\d+\b/i.test(t)) return true;
  if (/^[A-Z]*\d+[A-Z]*\s+[A-Z]{1,4}$/i.test(t)) return true;
  if (/^[A-Z]\d{3,4}(\s+[A-Z]{1,4})?$/i.test(t)) return true;
  if (/^[A-Z]\s+[A-Z][a-z]+[A-Z][a-zA-Z0-9]*$/.test(t)) return true;
  // Letter(s) + space + digits: SMT 890 / GS 1300 / ADV 350 / CG OS 2
  if (/^[A-Z]{1,6}(?:\s+[A-Z]{1,4})?\s+\d{1,4}[A-Z]?$/i.test(t)) return true;

  if (MODEL_CODE_COPY_WORDS.test(t)) return false;

  if (words.length === 1) {
    // CGOS, TFT — short all-caps codes
    if (/^[A-Z0-9]{3,8}$/.test(t)) {
      if (MODEL_ACRONYM_BLOCKLIST.has(t)) return false;
      if (/\d/.test(t)) return true;
      if (/^[A-Z]{4,8}$/.test(t)) return true;
    }
  }

  return false;
}

export function looksLikeAutoLiquidJunk(value: string): boolean {
  const t = normalize(value);
  if (!t) return false;
  if (looksLikeReviewWidgetText(t)) return true;
  if (looksLikePriceOrSkuLabel(t)) return true;
  if (looksLikeFitmentYearText(t)) return true;
  if (looksLikeSkuToken(t)) return true;
  if (looksLikePromoOrCurrencyLabel(t)) return true;
  if (looksLikeBrandOrPlatform(t)) return true;
  if (looksLikeLocaleSwitcherLabel(t)) return true;
  if (looksLikeSizeCode(t)) return true;
  if (looksLikePersonOrHandle(t)) return true;
  if (looksLikeSpecOrCouponOrEuSize(t)) return true;
  if (looksLikeProductModelCode(t)) return true;
  return false;
}
