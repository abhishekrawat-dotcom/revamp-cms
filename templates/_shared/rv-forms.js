/* RevampForms — the forms of a published or previewed site: a "Register now", "Express interest", "VIP
   delegates"… form opened in a pop-up from a button, or drawn in place inside the page.

   Loaded by the page's runtime block (functions/lib/api.js publishTransform, after rv-popups.js), so only on
   /preview/…, the editor's live view and the live page. Plain ES5 in one IIFE, no dependencies. Everything it
   builds is made with createElement / textContent (never HTML from data) and is never saved with the page:
   pages are only ever saved from the editor's canvas, where this file does nothing.

   ---------------------------------------------------------------------------------------------------------
   Markers in the page (written by the editor and the AI; see the multi-form spec §1.5)
   ---------------------------------------------------------------------------------------------------------
     a[data-rv-form="<formId>"]           a click opens that form in a pop-up (href "#rv-form-<formId>")
     a[data-register-cta]                 without data-rv-form: opens the event's default form (href "#register");
                                          with it, the form named there wins
     div.rv-block-form[data-rv-form-embed="<formId>"]
                                          the form drawn in place. data-rv-form-title="hide" leaves out its title
                                          (the section around it has a heading); its [data-rv-form-fallback]
                                          paragraph is the no-JavaScript text, hidden once the form is drawn
     #register, #rv-form-<formId>         in the address: that form is opened on arrival and on hashchange —
                                          unless an element with that id exists (a plain jump), or the form is
                                          drawn on the page (it is scrolled to and its first field focused)
     html[data-rv-modal]                  set while a pop-up is open (shared with rv-popups.js and et-runtime.js)

   ---------------------------------------------------------------------------------------------------------
   Where the forms come from
   ---------------------------------------------------------------------------------------------------------
     <script id="rv-forms" type="application/json"> written at publish / preview (the public definition,
     spec §1.4), and GET /api/public/forms?eventId= — always on a live page (so a form edited after the site
     was published shows its new fields within the server's 30 s cache), elsewhere only when the block is
     missing. A form whose rev changed is drawn again where the visitor has not started typing.

   ---------------------------------------------------------------------------------------------------------
   Modes
   ---------------------------------------------------------------------------------------------------------
     html[data-rv-editing] / data-rv-editor-mode="manual"   the editor's canvas: nothing at all happens
     data-rv-editor-mode="ai"   the editor's live view: forms open and are drawn, but a submit only checks the
                                answers and says that sending is turned off there; nothing is sent
     #rv-site-config mode "preview"   a submit is sent with preview:true (checked, not stored)
     #rv-site-config mode "live"      a real submit to POST /api/register

   ---------------------------------------------------------------------------------------------------------
   API: window.RevampForms (version 1)
   ---------------------------------------------------------------------------------------------------------
     render(form, host, opts) -> { el, values(), setErrors({id: msg}), destroy() }
         form  a public form (spec §1.4 forms[i]) or a builder draft
         opts  { mode: 'live'|'preview'|'ai-view'|'editor-preview', showTitle (default true), eventId,
                 waitlist, onDone(result) }
         'editor-preview' draws the same form with every control disabled and out of the tab order, no
         listeners and no honeypot, under the line "Form preview — visitors fill this in on the published page".
     validate(form, values) -> { fieldId: message }     the server's rules and its exact messages (spec §1.2)
     cleanValue(field, value) -> { value } | { error }  one answer as the server would store it (used by tests)
     ensureStyles(doc, opts)    <style data-rv-forms-style> once in doc.head; opts.editor also marks it
                                data-rv-editor so the editor never saves it
     open(formId, opener) -> bool      the pop-up (pages where this file runs on its own only)
     definitions() -> the public forms payload, or null while there is none
     guessCountry(win) -> 'IN'          the visitor's country, as a Mobile field's country code starts on it
     suggestEmail(text) -> 'a@gmail.com' | ''   the address a mistyped common one probably is
   The editor and the console set window.RV_FORMS_NO_AUTO = true before loading this file and use render and
   validate only. */
(function () {
  'use strict';
  if (window.__rvForms) return;
  window.__rvForms = true;

  var VERSION = 1;

  /* ---------- the rules (spec §1.2): the same as the server's, so an error reads the same from both ---------- */
  /* functions/lib/forms.js EMAIL_RE, verbatim */
  var EMAIL_RE = /^[A-Za-z0-9!#$%&'*+\/=?^_\x60{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_\x60{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,24}|xn--[A-Za-z0-9-]{1,59})$/;
  var EMAIL_MESSAGE = 'Please enter a valid email address, like name@company.com.';
  var URL_RE = /^https?:\/\/[^\s<>"]+\.[^\s<>"]+/i;
  var SCHEME_RE = /^[a-z][a-z0-9+.\-]*:\/\//i;
  var MAPPED_MAX = { name: 120, first_name: 60, last_name: 60, company: 120, designation: 120, city: 80 };
  var MAXLEN = { text: 200, textarea: 2000, email: 200, phone: 40, number: 40, url: 500, date: 10, location: 200 };
  var SHORT_TYPES = { text: 1, email: 1, phone: 1, number: 1, url: 1, date: 1, select: 1, country: 1, location: 1 };
  var AUTOCOMPLETE = { name: 'name', first_name: 'given-name', last_name: 'family-name', email: 'email', phone: 'tel-national',
    company: 'organization', designation: 'organization-title', city: 'address-level2' };
  /* the places a Location field suggests (functions/lib/api-forms.js handlePublicPlaces) */
  var PLACES_URL = '/api/public/places';
  /* the email services people most often mistype: "asha@gmial.com" is offered "asha@gmail.com" (never refused) */
  var EMAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rediffmail.com',
    'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.in', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com',
    'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'zohomail.in', 'mail.com', 'gmx.com', 'yandex.com'];
  var MODES = { live: 1, preview: 1, 'ai-view': 1, 'editor-preview': 1 };
  var FORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

  var MSG = {
    preview: 'Form preview — visitors fill this in on the published page',
    closed: 'This form is not taking responses at the moment.',
    waitlist: 'This event is full. If you register now, you will join the waitlist.',
    sending: 'Sending…',
    offline: 'We could not send your details. Please check your connection and try again.',
    aiView: 'Submitting is turned off in the editor. Open Preview to test this form.',
    loading: 'Loading the form…',
    loadFailed: 'This form could not be loaded. Please check your connection and try again.',
    unavailable: 'This form is not available right now.',
    again: 'Fill in again',
    retry: 'Retry',
    close: 'Close',
    choose: 'Choose…',
    untitled: 'Untitled field',
    honeypot: 'Website',
    countryCode: 'Country code',
    searchCountry: 'Search by country or code',
    noCountry: 'No country matches that.',
    placesNone: 'No place by that name in our list. You can keep what you typed.',
    placesUnverified: 'Not one of the suggested places: it will be sent as you typed it.',
    placesFailed: 'Suggestions are not available right now. Type your city, state and country.',
    didYouMean: 'Did you mean ',
    useIt: 'Use this'
  };

  /* ---------- countries: name, dialling code, digits (the same table as functions/lib/phone.js) ---------- */
  /* PHONE_DATA:BEGIN (generated by tools/build-places.js — do not edit by hand) */
  var PHONE_DATA = [
    "IN|India|91|10|10|[6-9];AF|Afghanistan|93|9|9|;AX|Åland Islands|358|5|12|;AL|Albania|355|8|9|",
    "DZ|Algeria|213|8|9|;AS|American Samoa|1|10|10|684;AD|Andorra|376|6|9|;AO|Angola|244|9|9|",
    "AI|Anguilla|1|10|10|264;AG|Antigua and Barbuda|1|10|10|268;AR|Argentina|54|10|11|;AM|Armenia|374|8|8|",
    "AW|Aruba|297|7|7|;AU|Australia|61|9|9|;AT|Austria|43|7|13|;AZ|Azerbaijan|994|9|9|;BS|Bahamas|1|10|10|242",
    "BH|Bahrain|973|8|8|;BD|Bangladesh|880|10|10|;BB|Barbados|1|10|10|246;BY|Belarus|375|9|10|;BE|Belgium|32|8|9|",
    "BZ|Belize|501|7|7|;BJ|Benin|229|8|10|;BM|Bermuda|1|10|10|441;BT|Bhutan|975|7|8|;BO|Bolivia|591|8|8|",
    "BA|Bosnia and Herzegovina|387|8|9|;BW|Botswana|267|7|8|;BR|Brazil|55|10|11|",
    "IO|British Indian Ocean Territory|246|5|12|;VG|British Virgin Islands|1|10|10|284;BN|Brunei|673|7|7|",
    "BG|Bulgaria|359|8|9|;BF|Burkina Faso|226|8|8|;BI|Burundi|257|8|8|;CV|Cabo Verde|238|7|7|;KH|Cambodia|855|8|9|",
    "CM|Cameroon|237|9|9|;CA|Canada|1|10|10|[2-9];BQ|Caribbean Netherlands|599|5|12|;KY|Cayman Islands|1|10|10|345",
    "CF|Central African Republic|236|8|8|;TD|Chad|235|8|8|;CL|Chile|56|9|9|;CN|China|86|9|11|",
    "CX|Christmas Island|61|5|12|;CC|Cocos (Keeling) Islands|61|5|12|;CO|Colombia|57|10|10|;KM|Comoros|269|7|7|",
    "CG|Congo|242|9|9|;CD|Congo (DRC)|243|9|9|;CK|Cook Islands|682|5|5|;CR|Costa Rica|506|8|8|",
    "CI|Côte d’Ivoire|225|10|10|;HR|Croatia|385|8|9|;CU|Cuba|53|8|8|;CW|Curaçao|599|7|8|;CY|Cyprus|357|8|8|",
    "CZ|Czechia|420|9|9|;DK|Denmark|45|8|8|;DJ|Djibouti|253|8|8|;DM|Dominica|1|10|10|767",
    "DO|Dominican Republic|1|10|10|809|829|849;EC|Ecuador|593|8|9|;EG|Egypt|20|9|10|;SV|El Salvador|503|8|8|",
    "GQ|Equatorial Guinea|240|9|9|;ER|Eritrea|291|7|7|;EE|Estonia|372|7|8|;SZ|Eswatini|268|8|8|;ET|Ethiopia|251|9|9|",
    "FK|Falkland Islands|500|5|5|;FO|Faroe Islands|298|6|6|;FJ|Fiji|679|7|7|;FI|Finland|358|5|12|;FR|France|33|9|9|",
    "GF|French Guiana|594|9|9|;PF|French Polynesia|689|8|8|;GA|Gabon|241|7|8|;GM|Gambia|220|7|7|;GE|Georgia|995|9|9|",
    "DE|Germany|49|6|13|;GH|Ghana|233|9|9|;GI|Gibraltar|350|8|8|;GR|Greece|30|10|10|;GL|Greenland|299|6|6|",
    "GD|Grenada|1|10|10|473;GP|Guadeloupe|590|9|9|;GU|Guam|1|10|10|671;GT|Guatemala|502|8|8|;GG|Guernsey|44|10|10|",
    "GN|Guinea|224|8|9|;GW|Guinea-Bissau|245|7|9|;GY|Guyana|592|7|7|;HT|Haiti|509|8|8|;HN|Honduras|504|8|8|",
    "HK|Hong Kong|852|8|8|;HU|Hungary|36|8|9|;IS|Iceland|354|7|7|;ID|Indonesia|62|9|12|;IR|Iran|98|10|10|",
    "IQ|Iraq|964|8|10|;IE|Ireland|353|7|9|;IM|Isle of Man|44|10|10|;IL|Israel|972|8|9|;IT|Italy|39|6|11|",
    "JM|Jamaica|1|10|10|876;JP|Japan|81|9|10|;JE|Jersey|44|10|10|;JO|Jordan|962|8|9|;KZ|Kazakhstan|7|10|10|[67]",
    "KE|Kenya|254|9|9|;KI|Kiribati|686|5|8|;XK|Kosovo|383|8|9|;KW|Kuwait|965|8|8|;KG|Kyrgyzstan|996|9|9|",
    "LA|Laos|856|8|10|;LV|Latvia|371|8|8|;LB|Lebanon|961|7|8|;LS|Lesotho|266|8|8|;LR|Liberia|231|7|9|",
    "LY|Libya|218|9|9|;LI|Liechtenstein|423|7|9|;LT|Lithuania|370|8|8|;LU|Luxembourg|352|6|11|;MO|Macao|853|8|8|",
    "MG|Madagascar|261|9|9|;MW|Malawi|265|7|9|;MY|Malaysia|60|9|10|;MV|Maldives|960|7|7|;ML|Mali|223|8|8|",
    "MT|Malta|356|8|8|;MH|Marshall Islands|692|7|7|;MQ|Martinique|596|9|9|;MR|Mauritania|222|8|8|",
    "MU|Mauritius|230|7|8|;YT|Mayotte|262|9|9|;MX|Mexico|52|10|10|;FM|Micronesia|691|7|7|;MD|Moldova|373|8|8|",
    "MC|Monaco|377|8|9|;MN|Mongolia|976|8|8|;ME|Montenegro|382|8|8|;MS|Montserrat|1|10|10|664;MA|Morocco|212|9|9|",
    "MZ|Mozambique|258|8|9|;MM|Myanmar|95|7|10|;NA|Namibia|264|8|9|;NR|Nauru|674|7|7|;NP|Nepal|977|8|10|",
    "NL|Netherlands|31|9|9|;NC|New Caledonia|687|6|6|;NZ|New Zealand|64|8|10|;NI|Nicaragua|505|8|8|",
    "NE|Niger|227|8|8|;NG|Nigeria|234|8|10|;NU|Niue|683|4|7|;NF|Norfolk Island|672|6|6|;KP|North Korea|850|8|10|",
    "MK|North Macedonia|389|8|8|;MP|Northern Mariana Islands|1|10|10|670;NO|Norway|47|8|8|;OM|Oman|968|8|8|",
    "PK|Pakistan|92|9|10|;PW|Palau|680|7|7|;PS|Palestine|970|8|9|;PA|Panama|507|7|8|;PG|Papua New Guinea|675|7|8|",
    "PY|Paraguay|595|9|9|;PE|Peru|51|8|9|;PH|Philippines|63|8|10|;PN|Pitcairn Islands|64|5|12|;PL|Poland|48|9|9|",
    "PT|Portugal|351|9|9|;PR|Puerto Rico|1|10|10|787|939;QA|Qatar|974|8|8|;RE|Réunion|262|9|9|;RO|Romania|40|9|9|",
    "RU|Russia|7|10|10|[3489];RW|Rwanda|250|9|9|;BL|Saint Barthélemy|590|5|12|;SH|Saint Helena|290|4|5|",
    "KN|Saint Kitts and Nevis|1|10|10|869;LC|Saint Lucia|1|10|10|758;MF|Saint Martin|590|5|12|",
    "PM|Saint Pierre and Miquelon|508|6|6|;VC|Saint Vincent and the Grenadines|1|10|10|784;WS|Samoa|685|5|7|",
    "SM|San Marino|378|6|10|;ST|São Tomé and Príncipe|239|7|7|;SA|Saudi Arabia|966|8|9|;SN|Senegal|221|9|9|",
    "RS|Serbia|381|8|9|;SC|Seychelles|248|7|7|;SL|Sierra Leone|232|8|8|;SG|Singapore|65|8|8|",
    "SX|Sint Maarten|1|10|10|721;SK|Slovakia|421|9|9|;SI|Slovenia|386|8|8|;SB|Solomon Islands|677|5|7|",
    "SO|Somalia|252|7|9|;ZA|South Africa|27|9|9|;KR|South Korea|82|8|10|;SS|South Sudan|211|9|9|;ES|Spain|34|9|9|",
    "LK|Sri Lanka|94|9|9|;SD|Sudan|249|9|9|;SR|Suriname|597|6|7|;SJ|Svalbard and Jan Mayen|47|8|8|",
    "SE|Sweden|46|7|10|;CH|Switzerland|41|9|9|;SY|Syria|963|8|9|;TW|Taiwan|886|8|9|;TJ|Tajikistan|992|9|9|",
    "TZ|Tanzania|255|9|9|;TH|Thailand|66|8|9|;TL|Timor-Leste|670|7|8|;TG|Togo|228|8|8|;TK|Tokelau|690|4|7|",
    "TO|Tonga|676|5|7|;TT|Trinidad and Tobago|1|10|10|868;TN|Tunisia|216|8|8|;TR|Türkiye|90|10|10|",
    "TM|Turkmenistan|993|8|8|;TC|Turks and Caicos Islands|1|10|10|649;TV|Tuvalu|688|5|7|",
    "VI|U.S. Virgin Islands|1|10|10|340;UG|Uganda|256|9|9|;UA|Ukraine|380|9|9|;AE|United Arab Emirates|971|8|9|",
    "GB|United Kingdom|44|9|10|;US|United States|1|10|10|[2-9];UY|Uruguay|598|8|8|;UZ|Uzbekistan|998|9|9|",
    "VU|Vanuatu|678|5|7|;VA|Vatican City|39|6|11|;VE|Venezuela|58|10|10|;VN|Vietnam|84|9|10|",
    "WF|Wallis and Futuna|681|6|6|;EH|Western Sahara|212|5|12|;YE|Yemen|967|7|9|;ZM|Zambia|260|9|9|",
    "ZW|Zimbabwe|263|7|9|"
  ].join(';');
  /* PHONE_DATA:END */
  /* ---------- which country each time zone is in: the visitor's country code, guessed ---------- */
  /* TZ_DATA:BEGIN (generated by tools/build-places.js from the IANA time zone database — do not edit by hand) */
  var TZ_DATA = [
    "AD:Europe/Andorra;AE:Asia/Dubai;AF:Asia/Kabul;AG:America/Antigua;AI:America/Anguilla;AL:Europe/Tirane",
    "AM:Asia/Yerevan;AO:Africa/Luanda",
    "AR:America/Argentina/Buenos_Aires America/Argentina/Catamarca America/Argentina/ComodRivadavia America/Argentina/Cordoba America/Argentina/Jujuy America/Argentina/La_Rioja America/Argentina/Mendoza America/Argentina/Rio_Gallegos America/Argentina/Salta America/Argentina/San_Juan America/Argentina/San_Luis America/Argentina/Tucuman America/Argentina/Ushuaia America/Buenos_Aires America/Catamarca America/Cordoba America/Jujuy America/Mendoza America/Rosario",
    "AS:Pacific/Midway Pacific/Pago_Pago Pacific/Samoa US/Samoa;AT:Europe/Vienna",
    "AU:Antarctica/Macquarie Australia/ACT Australia/Adelaide Australia/Brisbane Australia/Broken_Hill Australia/Canberra Australia/Currie Australia/Darwin Australia/Eucla Australia/Hobart Australia/LHI Australia/Lindeman Australia/Lord_Howe Australia/Melbourne Australia/NSW Australia/North Australia/Perth Australia/Queensland Australia/South Australia/Sydney Australia/Tasmania Australia/Victoria Australia/West Australia/Yancowinna",
    "AW:America/Aruba;AX:Europe/Mariehamn;AZ:Asia/Baku;BA:Europe/Sarajevo;BB:America/Barbados",
    "BD:Asia/Dacca Asia/Dhaka;BE:CET Europe/Brussels MET;BF:Africa/Ouagadougou;BG:Europe/Sofia;BH:Asia/Bahrain",
    "BI:Africa/Bujumbura;BJ:Africa/Porto-Novo;BL:America/St_Barthelemy;BM:Atlantic/Bermuda;BN:Asia/Brunei",
    "BO:America/La_Paz;BQ:America/Kralendijk",
    "BR:America/Araguaina America/Bahia America/Belem America/Boa_Vista America/Campo_Grande America/Cuiaba America/Eirunepe America/Fortaleza America/Maceio America/Manaus America/Noronha America/Porto_Acre America/Porto_Velho America/Recife America/Rio_Branco America/Santarem America/Sao_Paulo Brazil/Acre Brazil/DeNoronha Brazil/East Brazil/West",
    "BS:America/Nassau;BT:Asia/Thimbu Asia/Thimphu;BW:Africa/Gaborone;BY:Europe/Minsk;BZ:America/Belize",
    "CA:America/Atikokan America/Blanc-Sablon America/Cambridge_Bay America/Creston America/Dawson America/Dawson_Creek America/Edmonton America/Fort_Nelson America/Glace_Bay America/Goose_Bay America/Halifax America/Inuvik America/Iqaluit America/Moncton America/Montreal America/Nipigon America/Pangnirtung America/Rainy_River America/Rankin_Inlet America/Regina America/Resolute America/St_Johns America/Swift_Current America/Thunder_Bay America/Toronto America/Vancouver America/Whitehorse America/Winnipeg America/Yellowknife Canada/Atlantic Canada/Central Canada/Eastern Canada/Mountain Canada/Newfoundland Canada/Pacific Canada/Saskatchewan Canada/Yukon",
    "CC:Indian/Cocos;CD:Africa/Kinshasa Africa/Lubumbashi;CF:Africa/Bangui;CG:Africa/Brazzaville;CH:Europe/Zurich",
    "CI:Africa/Abidjan Africa/Timbuktu Iceland;CK:Pacific/Rarotonga",
    "CL:America/Coyhaique America/Punta_Arenas America/Santiago Chile/Continental Chile/EasterIsland Pacific/Easter",
    "CM:Africa/Douala;CN:Asia/Chongqing Asia/Chungking Asia/Harbin Asia/Kashgar Asia/Shanghai Asia/Urumqi PRC",
    "CO:America/Bogota;CR:America/Costa_Rica;CU:America/Havana Cuba;CV:Atlantic/Cape_Verde;CW:America/Curacao",
    "CX:Indian/Christmas;CY:Asia/Famagusta Asia/Nicosia Europe/Nicosia;CZ:Europe/Prague",
    "DE:Atlantic/Jan_Mayen Europe/Berlin Europe/Busingen;DJ:Africa/Djibouti;DK:Europe/Copenhagen;DM:America/Dominica",
    "DO:America/Santo_Domingo;DZ:Africa/Algiers;EC:America/Guayaquil Pacific/Galapagos;EE:Europe/Tallinn",
    "EG:Africa/Cairo Egypt;EH:Africa/El_Aaiun;ER:Africa/Asmara;ES:Africa/Ceuta Atlantic/Canary Europe/Madrid",
    "ET:Africa/Addis_Ababa;FI:Europe/Helsinki;FJ:Pacific/Fiji;FK:Atlantic/Stanley",
    "FM:Pacific/Chuuk Pacific/Kosrae Pacific/Pohnpei;FO:Atlantic/Faeroe Atlantic/Faroe;FR:Europe/Paris",
    "GA:Africa/Libreville;GB:Europe/Belfast Europe/London GB GB-Eire;GD:America/Grenada;GE:Asia/Tbilisi",
    "GF:America/Cayenne;GG:Europe/Guernsey;GH:Africa/Accra;GI:Europe/Gibraltar",
    "GL:America/Danmarkshavn America/Godthab America/Nuuk America/Scoresbysund America/Thule;GM:Africa/Banjul",
    "GN:Africa/Conakry;GP:America/Guadeloupe;GQ:Africa/Malabo;GR:EET Europe/Athens;GT:America/Guatemala",
    "GU:Pacific/Guam;GW:Africa/Bissau;GY:America/Guyana;HK:Asia/Hong_Kong Hongkong;HN:America/Tegucigalpa",
    "HR:Europe/Zagreb;HT:America/Port-au-Prince;HU:Europe/Budapest",
    "ID:Asia/Jakarta Asia/Jayapura Asia/Makassar Asia/Pontianak Asia/Ujung_Pandang;IE:Eire Europe/Dublin",
    "IL:Asia/Jerusalem Asia/Tel_Aviv Israel;IM:Europe/Isle_of_Man;IN:Asia/Calcutta Asia/Kolkata;IO:Indian/Chagos",
    "IQ:Asia/Baghdad;IR:Asia/Tehran Iran;IS:Atlantic/Reykjavik;IT:Europe/Rome;JE:Europe/Jersey",
    "JM:America/Jamaica Jamaica;JO:Asia/Amman;JP:Asia/Tokyo Japan;KE:Africa/Asmera Africa/Nairobi;KG:Asia/Bishkek",
    "KH:Asia/Phnom_Penh;KI:Pacific/Enderbury Pacific/Kanton Pacific/Kiritimati Pacific/Tarawa Pacific/Wake",
    "KM:Indian/Comoro;KN:America/St_Kitts;KP:Asia/Pyongyang;KR:Asia/Seoul ROK;KW:Asia/Kuwait;KY:America/Cayman",
    "KZ:Asia/Almaty Asia/Aqtau Asia/Aqtobe Asia/Atyrau Asia/Oral Asia/Qostanay Asia/Qyzylorda;LA:Asia/Vientiane",
    "LB:Asia/Beirut;LC:America/St_Lucia;LI:Europe/Vaduz;LK:Asia/Colombo;LR:Africa/Monrovia;LS:Africa/Maseru",
    "LT:Europe/Vilnius;LU:Europe/Luxembourg;LV:Europe/Riga;LY:Africa/Tripoli Libya;MA:Africa/Casablanca",
    "MC:Europe/Monaco;MD:Europe/Chisinau Europe/Tiraspol;ME:Europe/Podgorica;MF:America/Marigot",
    "MG:Indian/Antananarivo;MH:Kwajalein Pacific/Kwajalein Pacific/Majuro;MK:Europe/Skopje;ML:Africa/Bamako",
    "MM:Asia/Rangoon Asia/Yangon;MN:Asia/Choibalsan Asia/Hovd Asia/Ulaanbaatar Asia/Ulan_Bator",
    "MO:Asia/Macao Asia/Macau;MP:Pacific/Saipan;MQ:America/Martinique;MR:Africa/Nouakchott;MS:America/Montserrat",
    "MT:Europe/Malta;MU:Indian/Mauritius;MV:Indian/Kerguelen Indian/Maldives;MW:Africa/Blantyre",
    "MX:America/Bahia_Banderas America/Cancun America/Chihuahua America/Ciudad_Juarez America/Ensenada America/Hermosillo America/Matamoros America/Mazatlan America/Merida America/Mexico_City America/Monterrey America/Ojinaga America/Santa_Isabel America/Tijuana Mexico/BajaNorte Mexico/BajaSur Mexico/General",
    "MY:Asia/Kuala_Lumpur Asia/Kuching;MZ:Africa/Maputo;NA:Africa/Windhoek;NC:Pacific/Noumea;NE:Africa/Niamey",
    "NF:Pacific/Norfolk;NG:Africa/Lagos;NI:America/Managua;NL:Europe/Amsterdam;NO:Europe/Oslo",
    "NP:Asia/Kathmandu Asia/Katmandu;NR:Pacific/Nauru;NU:Pacific/Niue",
    "NZ:Antarctica/McMurdo Antarctica/South_Pole NZ NZ-CHAT Pacific/Auckland Pacific/Chatham;OM:Asia/Muscat",
    "PA:America/Coral_Harbour America/Panama EST;PE:America/Lima;PF:Pacific/Gambier Pacific/Marquesas Pacific/Tahiti",
    "PG:Antarctica/DumontDUrville Pacific/Bougainville Pacific/Port_Moresby Pacific/Truk Pacific/Yap;PH:Asia/Manila",
    "PK:Asia/Karachi;PL:Europe/Warsaw Poland;PM:America/Miquelon;PN:Pacific/Pitcairn",
    "PR:America/Puerto_Rico America/Virgin;PS:Asia/Gaza Asia/Hebron",
    "PT:Atlantic/Azores Atlantic/Madeira Europe/Lisbon Portugal WET;PW:Pacific/Palau;PY:America/Asuncion",
    "QA:Asia/Qatar;RE:Indian/Reunion;RO:Europe/Bucharest;RS:Europe/Belgrade",
    "RU:Asia/Anadyr Asia/Barnaul Asia/Chita Asia/Irkutsk Asia/Kamchatka Asia/Khandyga Asia/Krasnoyarsk Asia/Magadan Asia/Novokuznetsk Asia/Novosibirsk Asia/Omsk Asia/Sakhalin Asia/Srednekolymsk Asia/Tomsk Asia/Ust-Nera Asia/Vladivostok Asia/Yakutsk Asia/Yekaterinburg Europe/Astrakhan Europe/Kaliningrad Europe/Kirov Europe/Moscow Europe/Samara Europe/Saratov Europe/Ulyanovsk Europe/Volgograd W-SU",
    "RW:Africa/Kigali;SA:Antarctica/Syowa Asia/Riyadh;SB:Pacific/Guadalcanal Pacific/Ponape;SC:Indian/Mahe",
    "SD:Africa/Khartoum;SE:Europe/Stockholm;SG:Asia/Singapore Singapore;SH:Atlantic/St_Helena;SI:Europe/Ljubljana",
    "SJ:Arctic/Longyearbyen;SK:Europe/Bratislava;SL:Africa/Freetown;SM:Europe/San_Marino;SN:Africa/Dakar",
    "SO:Africa/Mogadishu;SR:America/Paramaribo;SS:Africa/Juba;ST:Africa/Sao_Tome;SV:America/El_Salvador",
    "SX:America/Lower_Princes;SY:Asia/Damascus;SZ:Africa/Mbabane;TC:America/Grand_Turk;TD:Africa/Ndjamena",
    "TG:Africa/Lome;TH:Asia/Bangkok;TJ:Asia/Dushanbe;TK:Pacific/Fakaofo;TL:Asia/Dili;TM:Asia/Ashgabat Asia/Ashkhabad",
    "TN:Africa/Tunis;TO:Pacific/Tongatapu;TR:Asia/Istanbul Europe/Istanbul Turkey;TT:America/Port_of_Spain",
    "TV:Pacific/Funafuti;TW:Asia/Taipei ROC;TZ:Africa/Dar_es_Salaam",
    "UA:Europe/Kiev Europe/Kyiv Europe/Simferopol Europe/Uzhgorod Europe/Zaporozhye;UG:Africa/Kampala",
    "US:America/Adak America/Anchorage America/Atka America/Boise America/Chicago America/Denver America/Detroit America/Fort_Wayne America/Indiana/Indianapolis America/Indiana/Knox America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Tell_City America/Indiana/Vevay America/Indiana/Vincennes America/Indiana/Winamac America/Indianapolis America/Juneau America/Kentucky/Louisville America/Kentucky/Monticello America/Knox_IN America/Los_Angeles America/Louisville America/Menominee America/Metlakatla America/New_York America/Nome America/North_Dakota/Beulah America/North_Dakota/Center America/North_Dakota/New_Salem America/Phoenix America/Shiprock America/Sitka America/Yakutat HST MST Navajo Pacific/Honolulu Pacific/Johnston US/Alaska US/Aleutian US/Arizona US/Central US/East-Indiana US/Eastern US/Hawaii US/Indiana-Starke US/Michigan US/Mountain US/Pacific",
    "UY:America/Montevideo;UZ:Asia/Samarkand Asia/Tashkent;VA:Europe/Vatican;VC:America/St_Vincent",
    "VE:America/Caracas;VG:America/Tortola;VI:America/St_Thomas;VN:Asia/Ho_Chi_Minh Asia/Saigon;VU:Pacific/Efate",
    "WF:Pacific/Wallis;WS:Pacific/Apia;YE:Asia/Aden;YT:Indian/Mayotte;ZA:Africa/Johannesburg;ZM:Africa/Lusaka",
    "ZW:Africa/Harare"
  ].join(';');
  /* TZ_DATA:END */

  /* ---------- phone numbers: the rules of functions/lib/phone.js, the same code ---------- */
  var PHONES = [], BY_CC = {}, BY_DIAL = {};
  PHONE_DATA.split(';').forEach(function (e) {
    var p = e.split('|');
    if (p.length < 6) return;
    var c = { cc: p[0], name: p[1], dial: p[2], min: +p[3], max: +p[4], lead: p.slice(5).join('|') };
    c.leadRe = c.lead ? new RegExp('^(?:' + c.lead + ')') : null;
    PHONES.push(c);
    BY_CC[c.cc] = c;
    (BY_DIAL[c.dial] = BY_DIAL[c.dial] || []).push(c);
  });
  var MAIN_OF_DIAL = { '1': 'US', '7': 'RU', '44': 'GB', '47': 'NO', '61': 'AU', '262': 'RE', '290': 'SH', '358': 'FI', '39': 'IT', '590': 'GP', '599': 'CW', '212': 'MA', '64': 'NZ', '672': 'NF' };
  function dialRank(c) {
    if (c.cc === MAIN_OF_DIAL[c.dial]) return 1;
    return c.lead && c.lead !== '[2-9]' ? 0 : 2;
  }
  Object.keys(BY_DIAL).forEach(function (d) {
    BY_DIAL[d].sort(function (a, b) { return dialRank(a) - dialRank(b); });
  });
  function phoneCountry(cc) { return BY_CC[String(cc || '').toUpperCase()] || null; }
  /* the countries whose own numbers may start with a 0 (Italy's landlines…); everywhere else it is the trunk 0 */
  var KEEPS_ZERO = { IT: 1, VA: 1, SM: 1, CI: 1, CG: 1 };
  function fits(c, n) { return !!c && /^\d+$/.test(n) && n.length >= c.min && n.length <= c.max && (!c.leadRe || c.leadRe.test(n)) && (n.charAt(0) !== '0' || !!KEEPS_ZERO[c.cc]); }
  function nationalOf(c, digits) {
    if (digits.charAt(0) === '0' && !KEEPS_ZERO[c.cc] && fits(c, digits.slice(1))) return digits.slice(1);
    if (fits(c, digits)) return digits;
    if (digits.indexOf(c.dial) === 0 && fits(c, digits.slice(c.dial.length))) return digits.slice(c.dial.length);
    return digits;
  }
  function fromInternational(digits, picked) {
    if (picked && digits.indexOf(picked.dial) === 0 && fits(picked, digits.slice(picked.dial.length))) {
      return { c: picked, national: digits.slice(picked.dial.length) };
    }
    for (var len = 1; len <= 3; len++) {
      var list = BY_DIAL[digits.slice(0, len)];
      if (!list) continue;
      var rest = digits.slice(len);
      for (var i = 0; i < list.length; i++) if (fits(list[i], rest)) return { c: list[i], national: rest };
      return { c: BY_CC[MAIN_OF_DIAL[list[0].dial]] || list[0], national: rest, bad: true };
    }
    return null;
  }
  function phoneMessage(c) {
    if (!c) return 'Please enter a valid phone number, with its country code.';
    var digits = c.min === c.max ? c.min + ' digits' : c.min + ' to ' + c.max + ' digits';
    if (c.cc === 'IN') return 'Please enter a valid phone number for India: 10 digits after +91, starting with 6, 7, 8 or 9.';
    return 'Please enter a valid phone number for ' + c.name + ': ' + digits + ' after +' + c.dial + '.';
  }
  var NO_COUNTRY_MESSAGE = 'Please choose your country code.';
  function cleanPhone(raw) {
    var picked = null, text;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      text = raw.number;
      if (raw.country != null && raw.country !== '') {
        picked = phoneCountry(raw.country);
        if (!picked) return { error: NO_COUNTRY_MESSAGE };
      }
    } else text = raw;
    if (typeof text === 'number' && isFinite(text)) text = String(text);
    text = typeof text === 'string' ? text.replace(/[\uFF10-\uFF19\uFF0B]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    var digits = text.replace(/\D/g, '');
    if (!digits) return text ? { error: phoneMessage(picked) } : { empty: true };
    if (/[^\d\s().+\-\/]/.test(text)) return { error: phoneMessage(picked) };
    var r;
    if (/^(\+|00)/.test(text)) {
      r = fromInternational(text.charAt(0) === '+' ? digits : digits.slice(2), picked);
      if (!r || r.bad) return { error: phoneMessage(r ? r.c : null) };
      return { value: '+' + r.c.dial + r.national, country: r.c.cc };
    }
    if (picked) {
      var n = nationalOf(picked, digits);
      if (!fits(picked, n)) return { error: phoneMessage(picked) };
      return { value: '+' + picked.dial + n, country: picked.cc };
    }
    var india = BY_CC.IN, ni = nationalOf(india, digits);
    if (fits(india, ni)) return { value: '+91' + ni, country: 'IN' };
    if (/^[\d\s().\-\/]{7,24}$/.test(text) && digits.length >= 7 && digits.length <= 15) return { value: text, country: '', legacy: true };
    return { error: phoneMessage(null) };
  }
  /* "IN" -> 🇮🇳 (two regional-indicator letters; a system without flag pictures shows the letters) */
  function flagOf(cc) {
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCharCode(0xD83C, 0xDDE6 + cc.charCodeAt(0) - 65, 0xD83C, 0xDDE6 + cc.charCodeAt(1) - 65);
  }

  /* ---------- the visitor's country: what a Mobile field's country code starts on ----------
     1. the country the server was told by the hosting (GET /api/public/forms `country`, when there is one);
     2. the browser's time zone (Asia/Kolkata, or Chrome's Asia/Calcutta -> India), from the IANA table above;
     3. the browser's language region (en-GB -> United Kingdom);
     4. India. The visitor can always choose another. */
  var TZ_MAP = null;
  function countryOfZone(tz) {
    if (!TZ_MAP) {
      TZ_MAP = {};
      TZ_DATA.split(';').forEach(function (e) {
        var at = e.indexOf(':');
        if (at < 0) return;
        var cc = e.slice(0, at);
        e.slice(at + 1).split(' ').forEach(function (z) { if (z) TZ_MAP[z] = cc; });
      });
    }
    return TZ_MAP.hasOwnProperty(tz) ? TZ_MAP[tz] : '';
  }
  var serverCountry = '';
  function guessCountry(win) {
    win = win || window;
    if (serverCountry && BY_CC[serverCountry]) return serverCountry;
    try {
      var tz = win.Intl && win.Intl.DateTimeFormat ? win.Intl.DateTimeFormat().resolvedOptions().timeZone : '';
      var byZone = countryOfZone(String(tz || ''));
      if (byZone && BY_CC[byZone]) return byZone;
    } catch (e) { /* no Intl */ }
    try {
      var nav = win.navigator || {}, langs = (nav.languages && nav.languages.length ? nav.languages : [nav.language || '']);
      for (var i = 0; i < langs.length; i++) {
        var m = /^[a-z]{2,3}[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2})\b/.exec(String(langs[i] || ''));
        if (m && BY_CC[m[1].toUpperCase()]) return m[1].toUpperCase();
      }
    } catch (e2) { /* no navigator */ }
    return 'IN';
  }

  /* "São Paulo" -> "sao paulo" (functions/lib/places.js fold, for matching what is typed) */
  function foldText(s) {
    s = s == null ? '' : String(s);
    try { s = s.normalize('NFKD'); } catch (e) { /* no normalize: accents stay and simply do not match */ }
    return s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'\x60]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* ---------- an email address that is probably a typo of a common one: offered, never imposed ---------- */
  /* letters added, dropped or changed, and two letters the wrong way round, each counted once */
  function editDistance(a, b) {
    var i, j, pp = null, prev = [], cur;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (pp && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      }
      pp = prev;
      prev = cur;
    }
    return prev[b.length];
  }
  function suggestEmail(value) {
    var s = line(value, 200).toLowerCase(), at = s.lastIndexOf('@');
    if (at < 1) return '';
    var local = s.slice(0, at), domain = s.slice(at + 1);
    if (!domain || EMAIL_DOMAINS.indexOf(domain) !== -1) return '';
    var fixed = domain.replace(/\.(con|cmo|ocm|vom|xom|comm|coom|cpm|om)$/, '.com').replace(/\.(cp|ci)\.in$/, '.co.in');
    if (fixed !== domain && EMAIL_RE.test(local + '@' + fixed)) return local + '@' + fixed;
    var best = '', bestD = 3;
    EMAIL_DOMAINS.forEach(function (d) {
      var dist = editDistance(domain, d);
      if (dist > 0 && dist < bestD && dist <= (d.length > 8 ? 2 : 1)) { best = d; bestD = dist; }
    });
    return best ? local + '@' + best : '';
  }

  function str(v) { return v == null ? '' : String(v); }
  /* one line: control characters and runs of space become one space (api-audience.js line()) */
  function line(v, max) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    if (typeof v !== 'string') return '';
    return v.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }
  /* several lines (api-audience.js multiline()) */
  function multiline(v, max) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    if (typeof v !== 'string') return '';
    return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
  }
  function labelOf(field) { return line(str(field && field.label), 200) || 'this field'; }
  function optionsOf(field) {
    return Array.isArray(field && field.options) ? field.options.map(function (o) { return str(o); }) : [];
  }
  function maxOf(field) {
    if (MAPPED_MAX[field.id] && field.type === 'text') return MAPPED_MAX[field.id];
    return MAXLEN[field.type] || 200;
  }
  function keyOf(field, i) { return field && field.id ? String(field.id) : 'field_' + (i + 1); }

  function requiredMessage(field) {
    var L = labelOf(field);
    if (field.id === 'name') return 'Please enter your name.';
    if (field.id === 'first_name') return 'Please enter your first name.';
    if (field.id === 'last_name') return 'Please enter your last name.';
    if (field.id === 'email') return 'Please enter your email address.';
    switch (field.type) {
      case 'checkbox': return 'Please tick ' + L + ' to continue.';
      case 'select': case 'radio': case 'country': return 'Please choose ' + L + '.';
      case 'multiselect': return 'Please choose at least one option for ' + L + '.';
      default: return 'Please fill in ' + L + '.';
    }
  }
  function notInList(field) { return 'Please choose one of the options for ' + labelOf(field) + '.'; }

  function realDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return false;
    return s >= '1900-01-01' && s <= '2100-12-31';
  }

  /* One answer as the server keeps it: { value } (value undefined when an optional answer is empty) or { error }. */
  function cleanValue(field, raw) {
    field = field || {};
    var req = !!field.required, type = field.type, s, opts;
    function empty() { return req ? { error: requiredMessage(field) } : { value: undefined, empty: true }; }
    switch (type) {
      case 'checkbox': {
        var on = raw === true || raw === 'true' || raw === 'on' || raw === 'yes' || raw === 1;
        if (!on && req) return { error: requiredMessage(field) };
        return { value: on };
      }
      case 'multiselect': {
        var list = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [raw]), seen = {}, items = [];
        list.forEach(function (x) {
          var v = line(typeof x === 'number' ? String(x) : x, 120);
          if (v && !seen.hasOwnProperty(v)) { seen[v] = 1; items.push(v); }
        });
        if (!items.length) return empty();
        opts = optionsOf(field);
        for (var i = 0; i < items.length; i++) if (opts.indexOf(items[i]) === -1) return { error: notInList(field) };
        return { value: items };
      }
      case 'select': case 'radio': case 'country': {
        s = line(raw, 200);
        if (!s) return empty();
        opts = optionsOf(field);
        // a country list lives on the server; a draft without it cannot be checked here
        if (type === 'country' && !opts.length) return { value: s };
        if (opts.indexOf(s) === -1) return { error: notInList(field) };
        return { value: s };
      }
      case 'email':
        s = line(raw, 200).toLowerCase();
        if (!s) return empty();
        if (s.indexOf('@') > 64 || !EMAIL_RE.test(s)) return { error: EMAIL_MESSAGE };
        return { value: s };
      case 'phone': {
        var ph = cleanPhone(raw);
        if (ph.error) return { error: ph.error };
        if (ph.empty) return empty();
        return { value: ph.value, country: ph.country };
      }
      case 'location':
        s = line(raw, MAXLEN.location);
        if (!s) return empty();
        return { value: s };
      case 'number': {
        s = typeof raw === 'number' ? (isFinite(raw) ? String(raw) : 'NaN') : line(raw, 40);
        if (!s) return empty();
        var n = Number(s);
        if (!isFinite(n) || Math.abs(n) > 1e12) return { error: 'Please enter a number for ' + labelOf(field) + '.' };
        return { value: n };
      }
      case 'url':
        s = line(raw, 500);
        if (!s) return empty();
        if (!SCHEME_RE.test(s)) s = 'https://' + s;
        if (!URL_RE.test(s)) return { error: 'Please enter a web address for ' + labelOf(field) + ', like https://example.com.' };
        return { value: s };
      case 'date':
        s = line(raw, 40);
        if (!s) return empty();
        if (!realDate(s)) return { error: 'Please enter a valid date for ' + labelOf(field) + '.' };
        return { value: s };
      case 'textarea':
        s = multiline(raw, 2000);
        if (!s) return empty();
        return { value: s };
      default:
        s = line(raw, maxOf({ id: field.id, type: 'text' }));
        if (!s) return empty();
        return { value: s };
    }
  }

  function validate(form, values) {
    var errors = {}, fields = form && Array.isArray(form.fields) ? form.fields : [];
    values = values || {};
    fields.forEach(function (f, i) {
      if (!f) return;
      var k = keyOf(f, i), r = cleanValue(f, values[k]);
      if (r.error) errors[k] = r.error;
    });
    return errors;
  }

  /* ---------- styles: travel with the script, written in the page's variables ---------- */
  var CSS = [
    'html[data-rv-modal],html[data-rv-modal] body{overflow:hidden!important}',
    '.rv-form-vh{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}',
    '.rv-form{--rvf-err:#b4001e;--rvf-line:rgba(127,127,127,.45);--rvf-line:color-mix(in srgb,currentColor 30%,transparent);--rvf-fill:rgba(127,127,127,.08);--rvf-fill:color-mix(in srgb,currentColor 6%,transparent);container:rvform/inline-size;box-sizing:border-box;width:100%;max-width:640px;margin:0;padding:0;background:transparent;color:inherit;font-family:var(--body-font-family,inherit);font-size:1rem;line-height:1.5;text-align:left}',
    '.rv-form.rv-form--on-dark{--rvf-err:#ffa3a3}',
    '.rv-form *,.rv-form *::before,.rv-form *::after{box-sizing:border-box}',
    '.rv-form [hidden],.rv-form-modal [hidden]{display:none!important}',
    '.rv-form .rv-form-title{margin:0 0 8px;font-family:var(--heading-font-family,inherit);font-size:1.5rem;font-weight:700;line-height:1.2;color:inherit;overflow-wrap:anywhere}',
    '.rv-form .rv-form-intro{margin:0 0 4px}',
    '.rv-form .rv-form-intro p{margin:0 0 8px;color:inherit;line-height:1.55;overflow-wrap:anywhere}',
    '.rv-form .rv-form-pvnote{margin:0 0 14px;padding:6px 10px;border:1px dashed var(--rvf-line);border-radius:6px;font-size:.8125rem;font-weight:600;line-height:1.4;color:inherit}',
    '.rv-form .rv-form-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:18px 20px;margin:16px 0 0;padding:0;border:0}',
    '@media (min-width:720px){@container rvform (min-width:480px){.rv-form .rv-form-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.rv-form .rv-form-field--wide{grid-column:1/-1}}}',
    '.rv-form .rv-form-field{min-width:0;margin:0;padding:0;border:0}',
    '.rv-form .rv-form-label,.rv-form .rv-form-legend{display:block;float:none;width:auto;margin:0 0 6px;padding:0;font-size:.9375rem;font-weight:600;line-height:1.35;color:inherit;overflow-wrap:anywhere}',
    '.rv-form .rv-form-req{margin-left:2px;color:inherit}',
    '.rv-form .rv-form-input{display:block;width:100%;min-height:46px;margin:0;padding:10px 12px;font:inherit;font-size:1rem;line-height:1.4;color:inherit;background:var(--rvf-fill);border:1px solid var(--rvf-line);border-radius:calc(var(--rv-radius,10px) * .6);box-shadow:none;-webkit-appearance:none;appearance:none;opacity:1;-webkit-text-fill-color:currentColor}',
    '.rv-form textarea.rv-form-input{min-height:112px;resize:vertical}',
    '.rv-form .rv-form-input::placeholder{color:inherit;opacity:.6}',
    '.rv-form .rv-form-select{position:relative;display:block}',
    '.rv-form .rv-form-select .rv-form-input{padding-right:40px;cursor:pointer}',
    '.rv-form .rv-form-select::after{content:"";position:absolute;right:16px;top:50%;width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-70%) rotate(45deg);pointer-events:none}',
    '.rv-form .rv-form-input:focus,.rv-form .rv-form-choice input:focus-visible{outline:2px solid var(--theme-color,#e4002b);outline-offset:2px}',
    '.rv-form .rv-form-input[aria-invalid="true"]{border-color:var(--rvf-err);border-width:2px}',
    '.rv-form .rv-form-choices{display:grid;gap:2px}',
    '.rv-form .rv-form-choice{display:flex;align-items:flex-start;gap:10px;min-height:44px;margin:0;padding:10px 0;font-size:1rem;font-weight:400;line-height:1.4;color:inherit;cursor:pointer}',
    '.rv-form .rv-form-choice input{flex:0 0 auto;width:20px;height:20px;margin:1px 0 0;accent-color:var(--theme-color,#e4002b);cursor:pointer}',
    '.rv-form .rv-form-choice span{min-width:0;overflow-wrap:anywhere}',
    '.rv-form .rv-form-check{font-weight:600}',
    '.rv-form .rv-form-help{margin:6px 0 0;font-size:.875rem;line-height:1.45;color:inherit;opacity:.82;overflow-wrap:anywhere}',
    '.rv-form .rv-form-err{margin:6px 0 0;font-size:.875rem;font-weight:600;line-height:1.4;color:var(--rvf-err);overflow-wrap:anywhere}',
    '.rv-form .rv-form-err:empty{display:none}',
    '.rv-form .rv-form-note,.rv-form .rv-form-alert{margin:18px 0 0;padding:12px 14px;border-radius:calc(var(--rv-radius,10px) * .6);background:var(--rvf-fill);border-left:4px solid var(--theme-color,#e4002b);font-size:.9375rem;line-height:1.5;color:inherit}',
    '.rv-form .rv-form-alert{border-left-color:var(--rvf-err);font-weight:600}',
    '.rv-form .rv-form-alert:empty{display:none}',
    '.rv-form .rv-form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:20px 0 0}',
    '.rv-form .rv-form-submit{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;min-width:44px;margin:0;padding:12px 28px;border:0;border-radius:var(--rv-radius,10px);background:var(--theme-color,#e4002b);color:var(--rv-on-theme,#ffffff);font:inherit;font-size:1rem;font-weight:700;line-height:1.2;text-align:center;cursor:pointer;-webkit-text-fill-color:currentColor;opacity:1}',
    '.rv-form .rv-form-submit:hover{filter:brightness(1.06)}',
    '.rv-form .rv-form-submit:focus-visible,.rv-form .rv-form-link:focus-visible,.rv-form .rv-form-btn2:focus-visible,.rv-form-modal-close:focus-visible{outline:2px solid var(--theme-color,#e4002b);outline-offset:3px}',
    '.rv-form .rv-form-submit[aria-busy="true"],.rv-form .rv-form-submit:disabled{cursor:default;opacity:.72}',
    '.rv-form .rv-form-link{display:inline-flex;align-items:center;min-height:44px;margin:0;padding:8px 0;border:0;background:none;color:inherit;font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
    '.rv-form .rv-form-btn2{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:10px 20px;border:1.5px solid currentColor;border-radius:var(--rv-radius,10px);background:transparent;color:inherit;font:inherit;font-weight:700;cursor:pointer}',
    '.rv-form .rv-form-status{display:flex;align-items:center;gap:10px;margin:0;padding:6px 0;font-size:.9375rem;color:inherit}',
    '.rv-form .rv-form-spin{flex:0 0 auto;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:rvf-spin .8s linear infinite}',
    '@keyframes rvf-spin{to{transform:rotate(360deg)}}',
    '.rv-form .rv-form-done{outline:none}',
    '.rv-form .rv-form-done p{margin:0 0 10px;line-height:1.6;color:inherit;overflow-wrap:anywhere}',
    /* the Mobile field: [country code][number]; the Location field's suggestions; the email hint */
    '.rv-form .rv-form-phone,.rv-form .rv-form-combo{position:relative;display:flex;align-items:stretch;gap:8px;min-width:0}',
    '.rv-form .rv-form-phone .rv-form-input,.rv-form .rv-form-combo .rv-form-input{flex:1 1 auto;min-width:0;width:auto}',
    '.rv-form .rv-form-cc{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;min-height:46px;min-width:44px;margin:0;padding:0 10px 0 12px;font:inherit;font-size:1rem;line-height:1;color:inherit;background:var(--rvf-fill);border:1px solid var(--rvf-line);border-radius:calc(var(--rv-radius,10px) * .6);cursor:pointer;white-space:nowrap;-webkit-text-fill-color:currentColor;opacity:1}',
    '.rv-form .rv-form-cc:focus-visible{outline:2px solid var(--theme-color,#e4002b);outline-offset:2px}',
    '.rv-form .rv-form-cc-flag{font-size:1.15rem;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}',
    '.rv-form .rv-form-cc-dial{font-variant-numeric:tabular-nums}',
    '.rv-form .rv-form-caret{width:7px;height:7px;margin:0 2px 3px 2px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);opacity:.75}',
    '.rv-form .rv-form-cc[aria-expanded="true"] .rv-form-caret{transform:rotate(225deg);margin-bottom:-3px}',
    '.rv-form .rv-form-pop{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:40;box-sizing:border-box;margin:0;padding:6px;background:var(--rv-surface,#ffffff);color:var(--rv-text,#1c1c1c);border:1px solid rgba(127,127,127,.35);border-radius:calc(var(--rv-radius,10px) * .6);box-shadow:0 14px 36px rgba(0,0,0,.22);text-align:left}',
    '.rv-form .rv-form-pop.rv-form-pop--up{top:auto;bottom:calc(100% + 6px)}',
    '.rv-form .rv-form-pop .rv-form-pop-search{display:block;width:100%;min-height:44px;margin:0 0 6px;color:inherit;background:rgba(127,127,127,.08);border-color:rgba(127,127,127,.45)}',
    '.rv-form .rv-form-list{list-style:none;margin:0;padding:0;max-height:260px;max-height:min(260px,45vh);overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}',
    '.rv-form ul.rv-form-pop.rv-form-list{padding:6px}',
    '.rv-form .rv-form-opt{display:flex;align-items:center;gap:10px;min-height:44px;margin:0;padding:8px 10px;border-radius:6px;font-size:.9375rem;line-height:1.3;color:inherit;cursor:pointer;list-style:none}',
    '.rv-form .rv-form-opt:hover,.rv-form .rv-form-opt.is-active{background:rgba(127,127,127,.16)}',
    '.rv-form .rv-form-opt.is-active{outline:2px solid var(--theme-color,#e4002b);outline-offset:-2px}',
    '.rv-form .rv-form-opt[aria-selected="true"] .rv-form-opt-name{font-weight:700}',
    '.rv-form .rv-form-opt-flag{flex:0 0 auto;font-size:1.15rem;line-height:1;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}',
    '.rv-form .rv-form-opt-name{min-width:0;overflow-wrap:anywhere}',
    '.rv-form .rv-form-opt-extra{margin-left:auto;padding-left:8px;opacity:.75;font-size:.875rem;text-align:right;font-variant-numeric:tabular-nums}',
    '.rv-form .rv-form-placelist .rv-form-opt{flex-wrap:wrap;gap:2px 8px}',
    '.rv-form .rv-form-placelist .rv-form-opt-name{font-weight:600}',
    '.rv-form .rv-form-placelist .rv-form-opt-extra{margin-left:0;padding-left:0;text-align:left}',
    '.rv-form .rv-form-pop-none{margin:6px 8px;font-size:.9375rem;color:inherit;opacity:.8}',
    '.rv-form .rv-form-suggest .rv-form-suggest-btn{min-height:32px;padding:0;font-weight:700}',
    '.rv-form.rv-form--preview .rv-form-cc{cursor:default}',
    '.rv-form.rv-form--preview{pointer-events:none;user-select:none}',
    '.rv-form.rv-form--preview .rv-form-input,.rv-form.rv-form--preview .rv-form-submit{cursor:default}',
    /* the pop-up: the site's panels and text, over a dimmed page */
    '.rv-form-modal{--rv-keep:1;position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,12,16,.62);opacity:0;transition:opacity .2s ease}',
    '.rv-form-modal.rv-open{opacity:1}',
    '.rv-form-modal-panel{position:relative;box-sizing:border-box;width:560px;width:min(560px,calc(100vw - 32px));max-height:90vh;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:var(--rv-surface,#ffffff);color:var(--rv-text,#1c1c1c);border-radius:var(--rv-radius,10px);box-shadow:0 30px 80px rgba(0,0,0,.35);font-family:var(--body-font-family,inherit);text-align:left;transform:translateY(12px);transition:transform .25s ease}',
    '.rv-form-modal.rv-open .rv-form-modal-panel{transform:none}',
    '.rv-form-modal-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;gap:12px;padding:20px 16px 10px 24px;background:var(--rv-surface,#ffffff)}',
    '.rv-form-modal-title{flex:1 1 auto;min-width:0;margin:6px 0 0;font-family:var(--heading-font-family,inherit);font-size:1.5rem;font-weight:700;line-height:1.2;color:inherit;overflow-wrap:anywhere}',
    '.rv-form-modal-close{flex:0 0 auto;display:grid;place-items:center;width:44px;height:44px;margin:0;padding:0;border:0;border-radius:50%;background:rgba(127,127,127,.14);background:color-mix(in srgb,currentColor 9%,transparent);color:inherit;cursor:pointer}',
    '.rv-form-modal-close svg{display:block;width:22px;height:22px}',
    '.rv-form-modal-close:disabled{cursor:default;opacity:.5}',
    '.rv-form-modal-body{padding:4px 24px 28px}',
    '.rv-form-modal-body .rv-form{max-width:none}',
    '@media (max-width:600px){',
    '.rv-form-modal{padding:0;align-items:stretch}',
    '.rv-form-modal-panel{width:100%;max-height:none;height:100vh;height:100dvh;border-radius:0;box-shadow:none;transform:translateY(24px)}',
    '.rv-form-modal-head{padding:12px 12px 10px 20px;box-shadow:0 1px 0 rgba(127,127,127,.25)}',
    '.rv-form-modal-title{font-size:1.25rem;margin-top:9px}',
    '.rv-form-modal-body{padding:16px 20px 32px}',
    '.rv-form-modal-body .rv-form-submit{width:100%}',
    '}',
    '@media (prefers-reduced-motion:reduce){.rv-form-modal,.rv-form-modal-panel{transition:none}.rv-form .rv-form-spin{animation:none;border-right-color:currentColor;opacity:.5}}'
  ].join('\n');

  function ensureStyles(doc, opts) {
    doc = doc || document;
    var head = doc.head || doc.getElementsByTagName('head')[0];
    if (!head) return null;
    var st = doc.querySelector('style[data-rv-forms-style]');
    if (!st) {
      st = doc.createElement('style');
      st.setAttribute('data-rv-forms-style', '');
      st.textContent = CSS;
      head.appendChild(st);
    }
    if (opts && opts.editor) st.setAttribute('data-rv-editor', '');
    return st;
  }

  /* ---------- small DOM helpers (any document) ---------- */
  function mk(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function paragraphs(doc, parent, text) {
    multiline(str(text), 4000).split(/\n+/).forEach(function (t) {
      t = t.trim();
      if (t) parent.appendChild(mk(doc, 'p', null, t));
    });
    return parent;
  }
  function closeIcon(doc) {
    var NS = 'http://www.w3.org/2000/svg', s = doc.createElementNS(NS, 'svg'), p = doc.createElementNS(NS, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    s.appendChild(p);
    return s;
  }
  function focusNode(n) { if (!n) return; try { n.focus({ preventScroll: false }); } catch (e) { try { n.focus(); } catch (e2) { /* not focusable */ } } }
  function reducedMotion(win) { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }

  /* light text on its ground (a dark section, a dark theme's panel): dark form controls and a lighter red;
     in a section whose text is centred, the form's column is centred too (its own text stays left-aligned) */
  function markTone(root) {
    try {
      var win = root.ownerDocument.defaultView, c = win.getComputedStyle(root).color;
      var host = root.parentElement;
      if (host && win.getComputedStyle(host).textAlign === 'center') { root.style.marginLeft = 'auto'; root.style.marginRight = 'auto'; }
      var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c || '');
      if (!m) return;
      var l = [m[1], m[2], m[3]].map(function (v) { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      var lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
      if (lum > 0.4) { root.classList.add('rv-form--on-dark'); root.style.colorScheme = 'dark'; }
      else { root.classList.remove('rv-form--on-dark'); root.style.colorScheme = 'light'; }
    } catch (e) { /* computed styles not available: the light defaults stay */ }
  }

  function utmOf(win) {
    var out = { source: '', medium: '', campaign: '' }, q = '';
    try { q = String(win.location.search || ''); } catch (e) { q = ''; }
    q.replace(/^\?/, '').split('&').forEach(function (pair) {
      var i = pair.indexOf('='), k = i === -1 ? pair : pair.slice(0, i), v = i === -1 ? '' : pair.slice(i + 1);
      try { k = decodeURIComponent(k.replace(/\+/g, ' ')); v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return; }
      if (k === 'utm_source') out.source = v.slice(0, 80);
      else if (k === 'utm_medium') out.medium = v.slice(0, 80);
      else if (k === 'utm_campaign') out.campaign = v.slice(0, 120);
    });
    return out;
  }

  /* ---------- render: one form, drawn into host ---------- */
  var instanceN = 0;

  function render(form, host, opts) {
    form = form || {};
    opts = opts || {};
    var doc = host.ownerDocument || document;
    var win = doc.defaultView || window;
    var mode = MODES[opts.mode] ? opts.mode : 'live';
    var pv = mode === 'editor-preview';
    var showTitle = opts.showTitle !== false;
    var n = ++instanceN, pre = 'rvf-' + n + '-';
    var fields = Array.isArray(form.fields) ? form.fields.filter(function (f) { return f && typeof f === 'object'; }) : [];
    var closed = form.open === false;
    var titleText = line(str(form.title), 200) || line(str(form.name), 200);

    ensureStyles(doc, { editor: pv });
    var root = mk(doc, 'div', 'rv-form' + (pv ? ' rv-form--preview' : ''));
    root.setAttribute('data-rv-form-root', '');
    if (form.id) root.setAttribute('data-rv-form-id', String(form.id));
    host.appendChild(root);
    markTone(root);

    var st = { busy: false, touched: false, destroyed: false, done: false };
    var parts = [];            // { key, field, wrap, err, controls, focus, get, set }
    var formEl = null, submitBtn = null, alertEl = null, noticeEl = null;

    function head() {
      if (showTitle && titleText) {
        var h = mk(doc, 'h3', 'rv-form-title', titleText);
        h.id = pre + 'title';
        root.appendChild(h);
      }
    }
    function intro() {
      if (line(str(form.intro), 10)) root.appendChild(paragraphs(doc, mk(doc, 'div', 'rv-form-intro'), form.intro));
    }

    function labelContent(parent, field) {
      var text = line(str(field.label), 200);
      parent.appendChild(doc.createTextNode(text || (pv ? MSG.untitled : labelOf(field))));
      if (field.required) {
        var star = mk(doc, 'span', 'rv-form-req', '*');
        star.setAttribute('aria-hidden', 'true');
        parent.appendChild(star);
        parent.appendChild(mk(doc, 'span', 'rv-form-vh', ' (required)'));
      }
    }

    function control(el) {
      if (pv) { el.disabled = true; el.setAttribute('tabindex', '-1'); }
      return el;
    }

    /* tells the form a value changed (the page runtime remembers typed values on 'input' / 'change') */
    function changed(el) {
      try {
        var ev = doc.createEvent('Event');
        ev.initEvent('change', true, true);
        el.dispatchEvent(ev);
      } catch (e) { /* an old browser: the next keystroke tells it */ }
    }
    /* A pop-up list opens below its field, or above it when there is more room there. The room is the window's,
       narrowed by every box around the field that cuts off what overflows it (a site's section often does,
       with overflow: hidden, and the pop-up window scrolls): a list that would not fit is made shorter (it
       scrolls) rather than cut off. */
    function placePop(popEl, anchor) {
      popEl.classList.remove('rv-form-pop--up');
      var list = popEl.classList.contains('rv-form-list') ? popEl : popEl.querySelector('.rv-form-list');
      if (list) list.style.maxHeight = '';
      try {
        var r = anchor.getBoundingClientRect(), top = 0, bottom = win.innerHeight || doc.documentElement.clientHeight;
        for (var el = anchor.parentNode; el && el.nodeType === 1 && el !== doc.body && el !== doc.documentElement; el = el.parentNode) {
          var oy = win.getComputedStyle(el).overflowY;
          if (oy && oy !== 'visible') {
            var er = el.getBoundingClientRect();
            if (er.top > top) top = er.top;
            if (er.bottom < bottom) bottom = er.bottom;
          }
        }
        var below = bottom - r.bottom - 8, above = r.top - top - 8, full = popEl.offsetHeight || 290;
        var up = below < Math.min(full, 290) && above > below;
        if (up) popEl.classList.add('rv-form-pop--up');
        var room = up ? above : below;
        if (list && room < full) {
          /* the search box and the padding stay; the list itself gets what is left (never under three rows) */
          list.style.maxHeight = Math.max(132, Math.floor(room - (full - (list.offsetHeight || 0)))) + 'px';
        }
      } catch (e) { /* no layout: below, as drawn */ }
    }
    function optionRow(li, flagText, name, extra) {
      if (flagText) { var f = mk(doc, 'span', 'rv-form-opt-flag', flagText); f.setAttribute('aria-hidden', 'true'); li.appendChild(f); }
      li.appendChild(mk(doc, 'span', 'rv-form-opt-name', name));
      if (extra) li.appendChild(mk(doc, 'span', 'rv-form-opt-extra', extra));
    }

    /* The Mobile field: [country code ▾][number]. The code starts on the visitor's country (guessCountry) and
       opens a searchable list of every country; a number typed with its code (+44 …) moves the picker to it.
       The answer is { country: 'IN', number: '98765 43210' }. */
    function phonePicker(num, id, part) {
      var box = mk(doc, 'div', 'rv-form-phone');
      var cc = phoneCountry(opts.country) || phoneCountry(guessCountry(win)) || BY_CC.IN;
      var pop = null;
      var btn = control(mk(doc, 'button', 'rv-form-cc'));
      btn.type = 'button';
      btn.id = id + '-cc';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      var flag = mk(doc, 'span', 'rv-form-cc-flag'), dial = mk(doc, 'span', 'rv-form-cc-dial'), caret = mk(doc, 'span', 'rv-form-caret');
      flag.setAttribute('aria-hidden', 'true');
      caret.setAttribute('aria-hidden', 'true');
      btn.appendChild(flag); btn.appendChild(dial); btn.appendChild(caret);
      box.appendChild(btn);
      box.appendChild(num);
      function show() {
        flag.textContent = flagOf(cc.cc);
        dial.textContent = '+' + cc.dial;
        btn.setAttribute('aria-label', MSG.countryCode + ': ' + cc.name + ' (+' + cc.dial + ')');
        btn.title = cc.name + ' (+' + cc.dial + ')';
      }
      show();
      function setCountry(c) {
        if (!c) return;
        cc = c;
        show();
      }
      part.get = function () { return { country: cc.cc, number: num.value }; };
      part.set = function (v) {
        if (v && typeof v === 'object') {
          setCountry(phoneCountry(v.country));
          num.value = v.number == null ? '' : String(v.number);
          return;
        }
        var s = str(v).trim(), r = /^(\+|00)/.test(s) ? cleanPhone(s) : null;
        if (r && r.value && BY_CC[r.country]) { setCountry(BY_CC[r.country]); num.value = r.value.slice(1 + BY_CC[r.country].dial.length); }
        else num.value = s;
      };
      part.country = function () { return cc.cc; };
      if (pv) return box;

      function closePop(focusButton) {
        if (!pop) return;
        if (pop.parentNode) pop.parentNode.removeChild(pop);
        pop = null;
        btn.setAttribute('aria-expanded', 'false');
        doc.removeEventListener('mousedown', outside, true);
        doc.removeEventListener('touchstart', outside, true);
        if (focusButton) focusNode(btn);
      }
      function outside(e) { if (pop && !box.contains(e.target)) closePop(false); }
      function openPop() {
        if (pop) return;
        pop = mk(doc, 'div', 'rv-form-pop rv-form-ccpop');
        pop.setAttribute('data-rv-esc', '');
        var search = mk(doc, 'input', 'rv-form-input rv-form-pop-search');
        search.type = 'text';
        search.setAttribute('role', 'combobox');
        search.setAttribute('aria-autocomplete', 'list');
        search.setAttribute('aria-expanded', 'true');
        search.setAttribute('aria-label', MSG.searchCountry);
        search.setAttribute('placeholder', MSG.searchCountry);
        search.setAttribute('autocomplete', 'off');
        search.setAttribute('spellcheck', 'false');
        var list = mk(doc, 'ul', 'rv-form-list');
        list.id = id + '-cclist';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', MSG.countryCode);
        search.setAttribute('aria-controls', list.id);
        var none = mk(doc, 'p', 'rv-form-pop-none', MSG.noCountry);
        none.hidden = true;
        pop.appendChild(search); pop.appendChild(list); pop.appendChild(none);
        box.appendChild(pop);
        btn.setAttribute('aria-expanded', 'true');
        placePop(pop, box);
        var shown = [], active = -1;
        function setActive(i, scroll) {
          var items = list.children;
          if (active >= 0 && items[active]) items[active].classList.remove('is-active');
          active = i;
          if (i < 0 || !items[i]) { search.removeAttribute('aria-activedescendant'); return; }
          items[i].classList.add('is-active');
          search.setAttribute('aria-activedescendant', items[i].id);
          if (scroll && items[i].scrollIntoView) { try { items[i].scrollIntoView({ block: 'nearest' }); } catch (e) { items[i].scrollIntoView(false); } }
        }
        function fill() {
          var q = foldText(search.value), qd = search.value.replace(/\D/g, '');
          clear(list);
          shown = PHONES.filter(function (c) {
            if (!q && !qd) return true;
            if (qd && c.dial.indexOf(qd) === 0) return true;
            if (!q) return false;
            var n = ' ' + foldText(c.name);
            return n.indexOf(' ' + q) !== -1 || c.cc.toLowerCase() === q;
          });
          shown.forEach(function (c) {
            var li = mk(doc, 'li', 'rv-form-opt');
            li.id = list.id + '-' + c.cc;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', c === cc ? 'true' : 'false');
            li.setAttribute('data-cc', c.cc);
            optionRow(li, flagOf(c.cc), c.name, '+' + c.dial);
            list.appendChild(li);
          });
          none.hidden = shown.length > 0;
          var at = shown.indexOf(cc);
          setActive(at >= 0 ? at : (shown.length ? 0 : -1), true);
        }
        function pick(c) {
          setCountry(c);
          closePop(false);
          focusNode(num);
          changed(num);
        }
        search.addEventListener('input', fill);
        search.addEventListener('keydown', function (e) {
          var k = e.key;
          if (k === 'ArrowDown' || k === 'Down') { e.preventDefault(); if (shown.length) setActive(Math.min(active + 1, shown.length - 1), true); }
          else if (k === 'ArrowUp' || k === 'Up') { e.preventDefault(); if (shown.length) setActive(Math.max(active - 1, 0), true); }
          else if (k === 'Home' && shown.length && !search.value) { e.preventDefault(); setActive(0, true); }
          else if (k === 'End' && shown.length && !search.value) { e.preventDefault(); setActive(shown.length - 1, true); }
          else if (k === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
          else if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); closePop(true); }
          else if (k === 'Tab') closePop(false);
        });
        list.addEventListener('mousedown', function (e) { e.preventDefault(); });
        list.addEventListener('click', function (e) {
          var li = e.target && e.target.closest ? e.target.closest('[data-cc]') : null;
          if (li) pick(BY_CC[li.getAttribute('data-cc')]);
        });
        doc.addEventListener('mousedown', outside, true);
        doc.addEventListener('touchstart', outside, true);
        fill();
        placePop(pop, box);       // again, now that the list has its countries (and its height)
        focusNode(search);
      }
      btn.addEventListener('click', function () { if (pop) closePop(true); else openPop(); });
      btn.addEventListener('keydown', function (e) {
        if ((e.key === 'ArrowDown' || e.key === 'Down') && !pop) { e.preventDefault(); openPop(); }
      });
      /* a number pasted or autofilled with its country code: the picker follows it */
      num.addEventListener('blur', function () {
        var s = num.value.trim();
        if (!/^(\+|00)/.test(s)) return;
        var r = cleanPhone({ country: cc.cc, number: s });
        if (r.value && BY_CC[r.country]) { setCountry(BY_CC[r.country]); num.value = r.value.slice(1 + BY_CC[r.country].dial.length); }
      });
      return box;
    }

    /* The Location field: a text box that suggests places as it is typed (GET /api/public/places), "City,
       State, Country", in the visitor's country first; picked with the mouse, a finger or the arrow keys and
       Enter. Anything else typed is kept as it is — and said to be, once the visitor moves on. */
    function placeBox(input, id, part, field) {
      var box = mk(doc, 'div', 'rv-form-combo');
      var list = mk(doc, 'ul', 'rv-form-list rv-form-pop rv-form-placelist');
      list.id = id + '-list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', labelOf(field));
      list.hidden = true;
      var note = mk(doc, 'p', 'rv-form-help rv-form-placenote');
      note.id = id + '-note';
      note.setAttribute('aria-live', 'polite');
      note.hidden = true;
      part.note = note;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', list.id);
      input.setAttribute('spellcheck', 'false');
      box.appendChild(input);
      box.appendChild(list);
      var items = [], active = -1, seq = 0, timer = null, picked = '', failed = false;
      part.get = function () { return input.value; };
      part.set = function (v) { input.value = v == null ? '' : String(v); picked = input.value; };
      if (pv) return box;

      function say(text) { note.textContent = text || ''; note.hidden = !text; }
      function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        input.removeAttribute('data-rv-esc');
        active = -1;
      }
      function setActive(i) {
        var lis = list.children;
        if (active >= 0 && lis[active]) { lis[active].classList.remove('is-active'); lis[active].setAttribute('aria-selected', 'false'); }
        active = i;
        if (i < 0 || !lis[i]) { input.removeAttribute('aria-activedescendant'); return; }
        lis[i].classList.add('is-active');
        lis[i].setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', lis[i].id);
        if (lis[i].scrollIntoView) { try { lis[i].scrollIntoView({ block: 'nearest' }); } catch (e) { /* old browser */ } }
      }
      function open(found) {
        clear(list);
        items = found;
        if (!found.length) { close(); return; }
        found.forEach(function (p, i) {
          var li = mk(doc, 'li', 'rv-form-opt');
          li.id = list.id + '-' + i;
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.setAttribute('data-i', String(i));
          var rest = str(p.label).slice(str(p.city).length).replace(/^,\s*/, '');
          optionRow(li, '', str(p.city) || str(p.label), rest);
          list.appendChild(li);
        });
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('data-rv-esc', '');
        placePop(list, input);
        active = -1;
      }
      function choose(i) {
        var p = items[i];
        if (!p) return;
        input.value = str(p.label);
        picked = input.value;
        close();
        say('');
        changed(input);
      }
      /* the country to look in first: the one this form's Mobile field is set to, else the visitor's */
      function homeCountry() {
        for (var k = 0; k < parts.length; k++) if (parts[k].country) return parts[k].country();
        return guessCountry(win);
      }
      function lookUp() {
        var q = input.value.replace(/\s+/g, ' ').trim();
        if (foldText(q).length < 2) { close(); return; }
        var mine = ++seq, fetcher = win.fetch || window.fetch;
        if (!fetcher) return;
        fetcher.call(win, PLACES_URL + '?q=' + encodeURIComponent(q.slice(0, 120)) + '&cc=' + encodeURIComponent(homeCountry()), {
          credentials: 'same-origin', headers: { Accept: 'application/json' }
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }).then(function (j) {
          if (mine !== seq || st.destroyed) return;
          failed = false;
          var found = j && Array.isArray(j.places) ? j.places.slice(0, 8) : [];
          open(found);
          say(found.length ? '' : MSG.placesNone);
        }, function () {
          if (mine !== seq || st.destroyed) return;
          close();
          failed = true;
          say(MSG.placesFailed);
        });
      }
      input.addEventListener('input', function () {
        picked = '';
        if (!failed) say('');
        clearTimeout(timer);
        timer = setTimeout(lookUp, 180);
      });
      input.addEventListener('keydown', function (e) {
        var k = e.key;
        if (list.hidden) {
          if ((k === 'ArrowDown' || k === 'Down') && items.length && input.value.trim() && !picked) { e.preventDefault(); open(items); setActive(0); }
          return;
        }
        if (k === 'ArrowDown' || k === 'Down') { e.preventDefault(); setActive(Math.min(active + 1, items.length - 1)); }
        else if (k === 'ArrowUp' || k === 'Up') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
        else if (k === 'Enter') { if (active >= 0) { e.preventDefault(); choose(active); } else close(); }
        else if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (k === 'Tab') close();
      });
      list.addEventListener('mousedown', function (e) { e.preventDefault(); });
      list.addEventListener('click', function (e) {
        var li = e.target && e.target.closest ? e.target.closest('[data-i]') : null;
        if (li) choose(+li.getAttribute('data-i'));
      });
      input.addEventListener('blur', function () {
        setTimeout(function () {
          if (st.destroyed || doc.activeElement === input) return;
          close();
          var v = input.value.replace(/\s+/g, ' ').trim();
          if (v && v !== picked && !failed) say(MSG.placesUnverified);
        }, 150);
      });
      return box;
    }

    /* "asha@gmial.com": a line under the field offers "asha@gmail.com" — one click takes it; the address as
       typed is still accepted */
    function emailHint(input, id) {
      var hint = mk(doc, 'p', 'rv-form-help rv-form-suggest');
      hint.id = id + '-suggest';
      hint.setAttribute('aria-live', 'polite');
      hint.hidden = true;
      function hide() { clear(hint); hint.hidden = true; }
      input.addEventListener('blur', function () {
        var s = suggestEmail(input.value);
        hide();
        if (!s) return;
        hint.appendChild(doc.createTextNode(MSG.didYouMean));
        var b = mk(doc, 'button', 'rv-form-link rv-form-suggest-btn', s);
        b.type = 'button';
        b.setAttribute('aria-label', MSG.useIt + ': ' + s);
        b.addEventListener('click', function () { input.value = s; hide(); changed(input); focusNode(input); });
        hint.appendChild(b);
        hint.appendChild(doc.createTextNode('?'));
        hint.hidden = false;
      });
      input.addEventListener('input', function () { if (!hint.hidden) hide(); });
      return hint;
    }

    function buildField(field, i) {
      var key = keyOf(field, i), type = field.type, id = pre + key.replace(/[^A-Za-z0-9_-]/g, '_');
      var wide = !SHORT_TYPES[type];
      var group = type === 'radio' || type === 'multiselect';
      var wrap = mk(doc, group ? 'fieldset' : 'div', 'rv-form-field rv-form-field--' + (type || 'text') + (wide ? ' rv-form-field--wide' : ''));
      var help = line(str(field.help), 300);
      var helpEl = mk(doc, 'p', 'rv-form-help', help || null);
      helpEl.id = id + '-help';
      if (!help) helpEl.hidden = true;
      var err = mk(doc, 'p', 'rv-form-err');
      err.id = id + '-err';
      if (!pv) err.setAttribute('role', 'alert');
      var described = (help ? helpEl.id + ' ' : '') + err.id;
      var part = { key: key, field: field, wrap: wrap, err: err, controls: [], focus: null };
      var placeholder = line(str(field.placeholder), 120);

      if (group) {
        var legend = mk(doc, 'legend', 'rv-form-legend');
        labelContent(legend, field);
        wrap.appendChild(legend);
        wrap.setAttribute('aria-describedby', described);
        var box = mk(doc, 'div', 'rv-form-choices');
        optionsOf(field).forEach(function (o, j) {
          var lab = mk(doc, 'label', 'rv-form-choice');
          var inp = control(mk(doc, 'input'));
          inp.type = type === 'radio' ? 'radio' : 'checkbox';
          inp.name = key;
          inp.value = o;
          inp.id = id + '-' + j;
          if (type === 'radio' && field.required) inp.required = true;
          lab.appendChild(inp);
          lab.appendChild(mk(doc, 'span', null, o));
          box.appendChild(lab);
          part.controls.push(inp);
        });
        wrap.appendChild(box);
        part.focus = part.controls[0] || null;
        part.get = function () {
          if (type === 'radio') {
            for (var k = 0; k < part.controls.length; k++) if (part.controls[k].checked) return part.controls[k].value;
            return '';
          }
          return part.controls.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        };
        part.set = function (v) {
          var list = Array.isArray(v) ? v.map(str) : [str(v)];
          part.controls.forEach(function (c) { c.checked = list.indexOf(c.value) !== -1; });
        };
      } else if (type === 'checkbox') {
        // one tick box: its own label is the field's label (a fieldset around one box would say it twice)
        var lab2 = mk(doc, 'label', 'rv-form-choice rv-form-check');
        var cb = control(mk(doc, 'input'));
        cb.type = 'checkbox';
        cb.name = key;
        cb.value = 'yes';
        cb.id = id;
        if (field.required) cb.required = true;
        cb.setAttribute('aria-describedby', described);
        lab2.appendChild(cb);
        var span = mk(doc, 'span');
        labelContent(span, field);
        lab2.appendChild(span);
        wrap.appendChild(lab2);
        part.controls.push(cb);
        part.focus = cb;
        part.get = function () { return cb.checked; };
        part.set = function (v) { cb.checked = v === true || v === 'true' || v === 'yes' || v === 'on'; };
      } else {
        var label = mk(doc, 'label', 'rv-form-label');
        label.htmlFor = id;
        labelContent(label, field);
        wrap.appendChild(label);
        var c;
        if (type === 'select' || type === 'country') {
          var holder = mk(doc, 'span', 'rv-form-select');
          c = control(mk(doc, 'select', 'rv-form-input'));
          var first = mk(doc, 'option', null, MSG.choose);
          first.value = '';
          c.appendChild(first);
          optionsOf(field).forEach(function (o) {
            var op = mk(doc, 'option', null, o);
            op.value = o;
            c.appendChild(op);
          });
          holder.appendChild(c);
          wrap.appendChild(holder);
        } else if (type === 'textarea') {
          c = control(mk(doc, 'textarea', 'rv-form-input'));
          c.rows = 4;
          wrap.appendChild(c);
        } else if (type === 'phone') {
          c = control(mk(doc, 'input', 'rv-form-input rv-form-phone-num'));
          try { c.type = 'tel'; } catch (e) { c.setAttribute('type', 'tel'); }
          c.setAttribute('inputmode', 'tel');
          wrap.appendChild(phonePicker(c, id, part));
        } else if (type === 'location') {
          c = control(mk(doc, 'input', 'rv-form-input'));
          c.type = 'text';
          wrap.appendChild(placeBox(c, id, part, field));
          if (part.note) described += ' ' + part.note.id;
        } else {
          c = control(mk(doc, 'input', 'rv-form-input'));
          var t = { email: 'email', url: 'url', date: 'date' }[type] || 'text';
          try { c.type = t; } catch (e) { c.setAttribute('type', t); }
          if (type === 'email') c.setAttribute('inputmode', 'email');
          if (type === 'number') c.setAttribute('inputmode', 'decimal');
          if (type === 'date') { c.setAttribute('min', '1900-01-01'); c.setAttribute('max', '2100-12-31'); }
          wrap.appendChild(c);
          if (type === 'email' && !pv) wrap.appendChild(emailHint(c, id));
        }
        c.id = id;
        c.name = key;
        if (type !== 'select' && type !== 'country' && type !== 'date') c.setAttribute('maxlength', String(maxOf(field)));
        if (placeholder && type !== 'select' && type !== 'country' && type !== 'date') c.setAttribute('placeholder', placeholder);
        c.setAttribute('autocomplete', type === 'country' ? 'country-name' : type === 'phone' ? 'tel-national' :
          type === 'location' ? 'off' : (AUTOCOMPLETE[field.id] || 'off'));
        if (field.required) c.required = true;
        c.setAttribute('aria-describedby', described);
        part.controls.push(c);
        part.focus = c;
        if (!part.get) part.get = function () { return c.value; };
        if (!part.set) part.set = function (v) { c.value = v == null ? '' : (Array.isArray(v) ? v.join(', ') : String(v)); };
      }
      if (part.note) wrap.appendChild(part.note);
      wrap.appendChild(helpEl);
      wrap.appendChild(err);
      parts.push(part);
      return wrap;
    }

    function partFor(key) { for (var i = 0; i < parts.length; i++) if (parts[i].key === key) return parts[i]; return null; }

    function values() {
      var out = {};
      parts.forEach(function (p) { out[p.key] = p.get(); });
      return out;
    }

    function setErrors(map) {
      map = map || {};
      var loose = [];
      parts.forEach(function (p) {
        var msg = map[p.key] ? str(map[p.key]) : '';
        p.err.textContent = msg;
        p.controls.forEach(function (c) {
          if (msg) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid');
        });
      });
      Object.keys(map).forEach(function (k) { if (map[k] && !partFor(k)) loose.push(str(map[k])); });
      if (alertEl) alertEl.textContent = loose.join(' ');
    }
    function firstInvalid(map) {
      for (var i = 0; i < parts.length; i++) if (map[parts[i].key]) return parts[i];
      return null;
    }
    function formError(msg) {
      if (alertEl) alertEl.textContent = msg || '';
    }

    function setBusy(on) {
      st.busy = on;
      if (!submitBtn) return;
      submitBtn.disabled = on;
      if (on) { submitBtn.setAttribute('aria-busy', 'true'); submitBtn.textContent = MSG.sending; }
      else { submitBtn.removeAttribute('aria-busy'); submitBtn.textContent = line(str(form.submitLabel), 80) || 'Submit'; }
      if (opts.onBusy) { try { opts.onBusy(on); } catch (e) { /* the host's own */ } }
    }

    function showDone(result) {
      st.done = true;
      clear(root);
      var panel = mk(doc, 'div', 'rv-form-done');
      panel.setAttribute('role', 'status');
      panel.setAttribute('tabindex', '-1');
      if (showTitle && titleText) panel.appendChild(mk(doc, 'h3', 'rv-form-title', titleText));
      paragraphs(doc, panel, (result && result.message) || 'Thank you. Your response has been received.');
      var acts = mk(doc, 'div', 'rv-form-actions');
      var again = mk(doc, 'button', 'rv-form-link', MSG.again);
      again.type = 'button';
      again.addEventListener('click', function () {
        st.done = false; st.touched = false;
        build({});
        focusNode(parts[0] && parts[0].focus);
      });
      acts.appendChild(again);
      if (typeof opts.onClose === 'function') {
        var close = mk(doc, 'button', 'rv-form-btn2', MSG.close);
        close.type = 'button';
        close.addEventListener('click', function () { opts.onClose(); });
        acts.appendChild(close);
      }
      panel.appendChild(acts);
      root.appendChild(panel);
      focusNode(panel);
    }

    function send(answers, website) {
      var body = {
        eventId: str(opts.eventId), formId: str(form.id), answers: answers, website: website,
        source: 'website', utm: utmOf(win), ref: str(doc.referrer), preview: mode === 'preview'
      };
      setBusy(true);
      formError('');
      var fetcher = win.fetch || window.fetch;
      var p;
      try {
        p = fetcher.call(win, '/api/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body)
        });
      } catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        return res.json().then(function (j) { return { status: res.status, ok: res.ok, body: j || {} }; },
          function () { return { status: res.status, ok: false, body: {} }; });
      }).then(function (r) {
        if (st.destroyed) return;
        setBusy(false);
        var b = r.body || {};
        if (r.ok && b.ok) {
          if (opts.onDone) { try { opts.onDone(b); } catch (e) { /* the host's own */ } }
          showDone(b);
          return;
        }
        if (r.status === 400 && b.fields && typeof b.fields === 'object') {
          var unknown = Object.keys(b.fields).filter(function (k) { return !partFor(k); });
          if (unknown.length && typeof opts.onStale === 'function') { opts.onStale(values(), b.fields); return; }
          setErrors(b.fields);
          var bad = firstInvalid(b.fields);
          if (bad) focusNode(bad.focus);
          return;
        }
        if (r.status === 409 && (b.code === 'duplicate' || (b.fields && b.fields.email))) {
          var m = {};
          m[partFor('email') ? 'email' : '_'] = (b.fields && b.fields.email) || b.error || 'This email has already been used for this form.';
          setErrors(m);
          if (partFor('email')) focusNode(partFor('email').focus);
          return;
        }
        if (r.status >= 500 || !r.status) { formError(MSG.offline); return; }
        formError(str(b.error) || MSG.offline);
      }, function () {
        if (st.destroyed) return;
        setBusy(false);
        formError(MSG.offline);
      });
    }

    function onSubmit(e) {
      if (e) e.preventDefault();
      if (pv || st.busy || st.done || st.destroyed) return;
      var vals = values();
      var errs = validate({ fields: fields }, vals);
      setErrors(errs);
      if (noticeEl) noticeEl.hidden = true;
      var bad = firstInvalid(errs);
      if (bad) { focusNode(bad.focus); return; }
      if (mode === 'ai-view') {
        if (noticeEl) { noticeEl.hidden = false; noticeEl.textContent = MSG.aiView; }
        return;
      }
      var answers = {};
      parts.forEach(function (p) { answers[p.key] = vals[p.key]; });
      var hp = formEl && formEl.querySelector('input[name="website"]');
      send(answers, hp ? hp.value : '');
    }

    function build(initial) {
      clear(root);
      parts = [];
      formEl = submitBtn = alertEl = noticeEl = null;
      head();
      intro();
      if (pv) root.appendChild(mk(doc, 'p', 'rv-form-pvnote', MSG.preview));
      if (closed && !pv) { root.appendChild(mk(doc, 'p', 'rv-form-note', MSG.closed)); return; }

      formEl = mk(doc, 'form', 'rv-form-form');
      formEl.setAttribute('novalidate', '');
      if (showTitle && titleText) formEl.setAttribute('aria-labelledby', pre + 'title');
      else if (titleText) formEl.setAttribute('aria-label', titleText);
      var grid = mk(doc, 'div', 'rv-form-grid');
      fields.forEach(function (f, i) { grid.appendChild(buildField(f, i)); });
      formEl.appendChild(grid);

      if (!pv) {
        var hp = mk(doc, 'div');
        hp.setAttribute('aria-hidden', 'true');
        hp.setAttribute('style', 'position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden');
        var hl = mk(doc, 'label', null, MSG.honeypot);
        var hi = mk(doc, 'input');
        hi.name = 'website';
        hi.type = 'text';
        hi.setAttribute('tabindex', '-1');
        hi.setAttribute('autocomplete', 'off');
        hl.appendChild(hi);
        hp.appendChild(hl);
        formEl.appendChild(hp);
      }
      if (closed && pv) formEl.appendChild(mk(doc, 'p', 'rv-form-note', MSG.closed));
      if (opts.waitlist && form.counts) formEl.appendChild(mk(doc, 'p', 'rv-form-note', MSG.waitlist));
      alertEl = mk(doc, 'p', 'rv-form-alert');
      if (!pv) alertEl.setAttribute('role', 'alert');
      formEl.appendChild(alertEl);
      noticeEl = mk(doc, 'p', 'rv-form-note');
      noticeEl.setAttribute('role', 'status');
      noticeEl.hidden = true;
      formEl.appendChild(noticeEl);

      var acts = mk(doc, 'div', 'rv-form-actions');
      submitBtn = control(mk(doc, 'button', 'rv-form-submit', line(str(form.submitLabel), 80) || 'Submit'));
      submitBtn.type = 'submit';
      acts.appendChild(submitBtn);
      formEl.appendChild(acts);
      root.appendChild(formEl);

      if (initial) parts.forEach(function (p) { if (initial.hasOwnProperty(p.key)) p.set(initial[p.key]); });
      if (pv) return;

      formEl.addEventListener('submit', onSubmit);
      /* the button's own click too: the editor's live view stops a submit button's default action before the
         form hears of it, and there the answers must still be checked */
      submitBtn.addEventListener('click', onSubmit);
      function touch() {
        st.touched = true;
        if (typeof opts.onInput === 'function') { try { opts.onInput(values()); } catch (e) { /* the host's own */ } }
      }
      formEl.addEventListener('input', touch);
      formEl.addEventListener('change', touch);
    }

    build(opts.values || null);

    return {
      el: root,
      values: values,
      setErrors: setErrors,
      destroy: function () {
        st.destroyed = true;
        if (root.parentNode) root.parentNode.removeChild(root);
      },
      /* for the page runtime */
      focusFirst: function () {
        var p = parts[0];
        if (p) focusNode(p.focus);
        return !!p;
      },
      isTouched: function () { return st.touched; },
      isBusy: function () { return st.busy; },
      isDone: function () { return st.done; }
    };
  }

  /* ======================================================================================================
     The page runtime: buttons, pop-up, forms drawn in place, links to #register / #rv-form-<id>
     ====================================================================================================== */
  var doc = window.document, html = doc && doc.documentElement;
  var page = {
    mode: null, eventId: '', payload: null, loading: false, failed: false,
    embeds: [], modal: null, memory: {}, started: false
  };

  function editing() { return !!html && (html.hasAttribute('data-rv-editing') || html.getAttribute('data-rv-editor-mode') === 'manual'); }
  function readJson(id) {
    var el = doc.getElementById(id);
    if (!el) return undefined;
    try { return JSON.parse(el.textContent || ''); } catch (e) { return null; }
  }
  function validPayload(p) { return !!p && typeof p === 'object' && Array.isArray(p.forms); }
  function pageMode() {
    if (editing()) return null;
    if (html.getAttribute('data-rv-editor-mode') === 'ai') return 'ai-view';
    var cfg = readJson('rv-site-config');
    if (cfg && cfg.mode === 'preview') return 'preview';
    if (cfg && cfg.mode === 'live') return 'live';
    return page.eventId ? 'live' : null;
  }
  function defaultFormId() {
    var p = page.payload;
    if (!p) return '';
    if (p.defaultFormId && findForm(p.defaultFormId)) return p.defaultFormId;
    return p.forms[0] ? p.forms[0].id : '';
  }
  function findForm(id) {
    var p = page.payload;
    if (!p || !id) return null;
    for (var i = 0; i < p.forms.length; i++) if (p.forms[i] && p.forms[i].id === id) return p.forms[i];
    return null;
  }
  function revsOf(p) {
    /* a form's questions too, not only its rev: an event's "Register now" that was never saved has rev 0 both
       before and after its standard questions changed (a page published before then holds the old ones) */
    return validPayload(p) ? p.forms.map(function (f) {
      return f.id + ':' + f.rev + ':' + f.open + ':' + (Array.isArray(f.fields) ? f.fields.map(function (x) { return x && (x.id + '/' + x.type + '/' + (x.required ? 1 : 0)); }).join(',') : '');
    }).join('|') + '|' + p.open + '|' + p.waitlist + '|' + p.defaultFormId + '|' + (p.country || '') : '';
  }
  function renderOpts(extra) {
    var o = { mode: page.mode, eventId: page.eventId, waitlist: !!(page.payload && page.payload.waitlist) };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    return o;
  }

  /* ---------- definitions ---------- */
  var waiters = [];
  function fetchDefinitions() {
    if (page.loading) return new Promise(function (resolve) { waiters.push(resolve); });
    if (!page.eventId || !window.fetch) {
      if (!page.payload && !page.failed) { page.failed = true; refreshAll(); }
      return Promise.resolve(false);
    }
    page.loading = true;
    page.failed = false;
    return window.fetch('/api/public/forms?eventId=' + encodeURIComponent(page.eventId), {
      credentials: 'same-origin', headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (p) {
      if (!validPayload(p)) throw new Error('not a forms payload');
      var changed = revsOf(p) !== revsOf(page.payload);
      /* the visitor's country, when the hosting told the server (an untouched Mobile field is drawn again with it) */
      if (typeof p.country === 'string' && BY_CC[p.country]) serverCountry = p.country;
      page.payload = p;
      return changed;
    }).then(function (changed) {
      page.loading = false;
      if (changed) refreshAll();
      settle(true);
      return true;
    }, function (err) {
      page.loading = false;
      if (window.console && console.warn) console.warn('[rv-forms] the forms could not be loaded:', err && err.message);
      if (!page.payload) { page.failed = true; refreshAll(); }
      settle(false);
      return false;
    });
  }
  function settle(ok) {
    var w = waiters;
    waiters = [];
    w.forEach(function (fn) { fn(ok); });
  }

  /* ---------- forms drawn in place ---------- */
  function statusLine(parent, text, spinner, retry) {
    var box = mk(doc, 'div', 'rv-form');
    box.setAttribute('data-rv-form-root', '');
    var p = mk(doc, 'p', 'rv-form-status');
    p.setAttribute('role', 'status');
    if (spinner) {
      var s = mk(doc, 'span', 'rv-form-spin');
      s.setAttribute('aria-hidden', 'true');
      p.appendChild(s);
    }
    p.appendChild(mk(doc, 'span', null, text));
    box.appendChild(p);
    if (retry) {
      var acts = mk(doc, 'div', 'rv-form-actions');
      var b = mk(doc, 'button', 'rv-form-btn2', MSG.retry);
      b.type = 'button';
      b.addEventListener('click', retry);
      acts.appendChild(b);
      box.appendChild(acts);
    }
    parent.appendChild(box);
    markTone(box);
    return box;
  }
  function retryLoad() {
    page.failed = false;
    refreshAll();
    fetchDefinitions();
  }

  function clearEmbed(e) {
    if (e.ctrl) { e.ctrl.destroy(); e.ctrl = null; }
    if (e.status && e.status.parentNode) e.status.parentNode.removeChild(e.status);
    e.status = null;
  }
  function drawEmbed(e, values, errors) {
    var el = e.el, fallback = el.querySelector('[data-rv-form-fallback]');
    clearEmbed(e);
    el.hidden = false;
    if (e.hidSection) { e.hidSection.hidden = false; e.hidSection = null; }
    if (!page.payload) {
      if (page.failed) {
        if (fallback) fallback.hidden = true;
        e.status = statusLine(el, MSG.loadFailed, false, retryLoad);
      } else if (fallback) {
        fallback.hidden = false;
        fallback.textContent = MSG.loading;
      } else {
        e.status = statusLine(el, MSG.loading, true, null);
      }
      return;
    }
    if (fallback) fallback.hidden = true;
    var form = findForm(e.formId);
    if (!form) {
      if (page.mode === 'live') {
        el.hidden = true;
        /* a section made only to hold this form (its heading, a line and the form) would be left as a heading
           over nothing: it goes too */
        var sec = el.parentElement;
        if (sec && sec.classList && sec.classList.contains('rv-generic') && Array.prototype.every.call(sec.children, function (c) {
          return c === el || /^(H[1-6]|P|STYLE|SCRIPT)$/.test(c.tagName);
        })) { sec.hidden = true; e.hidSection = sec; }
        return;
      }
      e.status = statusLine(el, 'This form (“' + e.formId + '”) no longer exists. Choose another form in the editor.', false, null);
      return;
    }
    e.ctrl = render(form, el, renderOpts({
      showTitle: el.getAttribute('data-rv-form-title') !== 'hide',
      values: values || null,
      onStale: function (vals, fields) { restale(function () { drawEmbed(e, vals, fields); }); }
    }));
    if (errors) e.ctrl.setErrors(errors);
    if (e.focusOnDraw) { e.focusOnDraw = false; e.ctrl.focusFirst(); }
  }
  /* the server named a field this page's copy of the form does not have: the form changed since the page
     was drawn. Fetch it again and draw it anew, keeping what was typed. */
  function restale(redraw) {
    fetchDefinitions().then(function () { redraw(); });
  }
  function startEmbeds() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-form-embed]'), function (el) {
      var id = String(el.getAttribute('data-rv-form-embed') || '').trim();
      var e = { el: el, formId: id, ctrl: null, status: null, focusOnDraw: false };
      page.embeds.push(e);
      drawEmbed(e);
    });
  }
  function inUse(ctrl) { return !!ctrl && (ctrl.isTouched() || ctrl.isBusy() || ctrl.isDone()); }
  function holdsFocus(el) { return !!el && !!doc.activeElement && doc.activeElement !== doc.body && el.contains(doc.activeElement); }
  /* new definitions: every form the visitor has not started on is drawn again (keeping the keyboard where it was) */
  function refreshAll() {
    page.embeds.forEach(function (e) {
      if (inUse(e.ctrl)) return;
      var had = holdsFocus(e.el);
      drawEmbed(e);
      if (had && e.ctrl) e.ctrl.focusFirst();
    });
    var m = page.modal;
    if (m && !inUse(m.ctrl)) {
      var had = holdsFocus(m.layer) || doc.activeElement === doc.body;
      fillModal();
      if (had) { var list = focusables(m.body); focusNode(list[0] || m.close); }
    }
  }
  function embedOf(formId) {
    for (var i = 0; i < page.embeds.length; i++) {
      var e = page.embeds[i];
      if (e.formId === formId && !e.el.hidden && e.el.getClientRects().length) return e;
    }
    return null;
  }

  /* ---------- the pop-up ---------- */
  function focusables(layer) {
    return Array.prototype.filter.call(layer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'), function (n) {
      if (n.getAttribute('tabindex') === '-1') return false;
      if (n.closest('[aria-hidden="true"]')) return false;
      return !n.hidden && n.getClientRects().length > 0;
    });
  }
  function onModalKey(e) {
    var m = page.modal;
    if (!m) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      /* an open list in the form (a country code, a place) closes first, on its own */
      if (e.target && e.target.closest && e.target.closest('[data-rv-esc]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy()) closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    var list = focusables(m.layer);
    if (!list.length) { e.preventDefault(); return; }
    var at = list.indexOf(doc.activeElement);
    if (e.shiftKey && at <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
    else if (!e.shiftKey && (at === -1 || at === list.length - 1)) { e.preventDefault(); list[0].focus(); }
  }
  function busy() { return !!(page.modal && page.modal.ctrl && page.modal.ctrl.isBusy()); }

  function buildModal(opener, formId, fallbackDefault) {
    ensureStyles(doc);
    var n = ++instanceN;
    var layer = mk(doc, 'div', 'rv-form-modal');
    layer.setAttribute('data-rv-form-root', '');
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'rvf-modal-title-' + n);
    var panel = mk(doc, 'div', 'rv-form-modal-panel');
    var head = mk(doc, 'div', 'rv-form-modal-head');
    var title = mk(doc, 'h2', 'rv-form-modal-title');
    title.id = 'rvf-modal-title-' + n;
    var close = mk(doc, 'button', 'rv-form-modal-close');
    close.type = 'button';
    close.setAttribute('aria-label', MSG.close);
    close.appendChild(closeIcon(doc));
    close.addEventListener('click', function () { if (!busy()) closeModal(); });
    head.appendChild(title);
    head.appendChild(close);
    var body = mk(doc, 'div', 'rv-form-modal-body');
    panel.appendChild(head);
    panel.appendChild(body);
    layer.appendChild(panel);
    layer.addEventListener('click', function (e) { if (e.target === layer && !busy()) closeModal(); });
    return { layer: layer, panel: panel, title: title, close: close, body: body, opener: opener, formId: formId, fallbackDefault: !!fallbackDefault, ctrl: null, shownId: '' };
  }

  function fillModal(values, errors) {
    var m = page.modal;
    if (!m) return;
    if (m.ctrl) { m.ctrl.destroy(); m.ctrl = null; }
    clear(m.body);
    if (!page.payload) {
      m.title.textContent = page.failed ? MSG.unavailable : MSG.loading;
      if (page.failed) statusLine(m.body, MSG.loadFailed, false, retryLoad);
      else statusLine(m.body, MSG.loading, true, null);
      return;
    }
    var form = findForm(m.formId);
    if (!form && m.fallbackDefault) form = findForm(defaultFormId());
    if (!form) {
      m.title.textContent = MSG.unavailable;
      var box = mk(doc, 'div', 'rv-form');
      var acts = mk(doc, 'div', 'rv-form-actions');
      var b = mk(doc, 'button', 'rv-form-btn2', MSG.close);
      b.type = 'button';
      b.addEventListener('click', function () { closeModal(); });
      acts.appendChild(b);
      box.appendChild(acts);
      m.body.appendChild(box);
      markTone(box);
      return;
    }
    m.shownId = form.id;
    m.title.textContent = line(str(form.title), 200) || line(str(form.name), 200);
    var keep = values || page.memory[form.id] || null;
    m.ctrl = render(form, m.body, renderOpts({
      showTitle: false,
      values: keep,
      onInput: function (vals) { page.memory[form.id] = vals; },
      onDone: function () { delete page.memory[form.id]; },
      onClose: function () { closeModal(); },
      onBusy: function (on) { m.close.disabled = on; },
      onStale: function (vals, fields) { restale(function () { if (page.modal === m) fillModal(vals, fields); }); }
    }));
    if (errors) m.ctrl.setErrors(errors);
  }

  function openModal(formId, opener, fallbackDefault, fromHash) {
    if (page.modal) closeModal(true);
    /* one pop-up at a time: a speaker's profile or a photo (rv-popups.js) is closed first */
    if (html.hasAttribute('data-rv-modal')) {
      try { if (window.RevampPopups && window.RevampPopups.close) window.RevampPopups.close(); } catch (e) { /* theirs */ }
      if (html.hasAttribute('data-rv-modal')) return false;
    }
    var m = buildModal(opener, formId, fallbackDefault);
    m.fromHash = !!fromHash;
    page.modal = m;
    m.inerted = [];
    Array.prototype.forEach.call(doc.body.children, function (n) {
      if (n === m.layer || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
      var rec = { n: n, inert: n.hasAttribute('inert'), aria: n.getAttribute('aria-hidden') };
      n.setAttribute('inert', '');
      if (!('inert' in n)) n.setAttribute('aria-hidden', 'true');
      m.inerted.push(rec);
    });
    m.pad = doc.body.style.paddingRight;
    var gap = window.innerWidth - html.clientWidth;
    if (gap > 0) doc.body.style.paddingRight = gap + 'px';
    html.setAttribute('data-rv-modal', '');
    doc.body.appendChild(m.layer);
    fillModal();
    doc.addEventListener('keydown', onModalKey, true);
    (window.requestAnimationFrame || setTimeout)(function () { m.layer.classList.add('rv-open'); });
    var first = m.ctrl ? null : m.close;
    if (m.ctrl) {
      var list = focusables(m.body);
      first = list[0] || m.close;
    }
    try { first.focus({ preventScroll: true }); } catch (e) { focusNode(first); }
    return true;
  }

  function closeModal(quick) {
    var m = page.modal;
    if (!m) return;
    page.modal = null;
    doc.removeEventListener('keydown', onModalKey, true);
    if (m.ctrl) { m.ctrl.destroy(); m.ctrl = null; }
    if (m.layer.parentNode) m.layer.parentNode.removeChild(m.layer);
    m.inerted.forEach(function (r) {
      if (!r.inert) r.n.removeAttribute('inert');
      if (r.aria == null) r.n.removeAttribute('aria-hidden'); else r.n.setAttribute('aria-hidden', r.aria);
    });
    doc.body.style.paddingRight = m.pad || '';
    html.removeAttribute('data-rv-modal');
    /* a form opened from the address: the address no longer says so, so the same link opens it again */
    var h = m.fromHash ? hashForm(location.hash) : null;
    if (h) {
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* a page without an address of its own */ }
    }
    if (!quick && m.opener && m.opener.isConnected) { try { m.opener.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
  }

  /* A button whose form has since been deleted opens the default form, as the editor turns such buttons when
     a form is deleted there (a form deleted from the event console with "Delete anyway" leaves them as they
     were): a visitor never meets a dead button. */
  function open(formId, opener) {
    if (!page.started || editing()) return false;
    formId = str(formId);
    var fromButton = !!(opener && opener.hasAttribute);
    if (page.payload && !findForm(formId)) {
      return openModal(fromButton ? defaultFormId() : formId, opener, fromButton);
    }
    return openModal(formId, opener, fromButton);
  }

  /* ---------- buttons ---------- */
  var CTA = '[data-rv-form], [data-register-cta]';
  function ctaFor(target) {
    var t = target && (target.nodeType === 1 ? target : target.parentElement);
    if (!t || !t.closest) return null;
    if (t.closest('[data-rv-form-root]')) return null;
    return t.closest(CTA);
  }
  function formIdOf(el) {
    var id = str(el.getAttribute('data-rv-form')).trim();
    if (id) return id;
    return page.payload ? defaultFormId() : '';
  }
  function onClick(e) {
    if (!page.started || editing() || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = ctaFor(e.target);
    if (!el) return;
    e.preventDefault();
    /* a page saved long ago may still hold its own register pop-up (templates/_library footer): only one opens */
    if (doc.getElementById('revamp-register-modal')) e.stopPropagation();
    var id = formIdOf(el);
    if (!id && !page.payload) {
      // the definitions are still on their way: open the default form once they are here
      openModal('', el, true);
      return;
    }
    open(id, el);
  }
  function onKey(e) {
    if (!page.started || editing() || (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar')) return;
    var t = e.target;
    if (!t || !t.matches || t.tagName === 'A' || t.tagName === 'BUTTON' || !t.matches(CTA)) return;
    e.preventDefault();
    open(formIdOf(t), t);
  }
  function markButtons() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-rv-form]'), function (el) {
      if (el.tagName === 'A' && el.hasAttribute('href')) return;
      if (el.tagName === 'BUTTON') return;
      if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  }

  /* ---------- #register and #rv-form-<id> ---------- */
  function hashForm(hash) {
    var name = str(hash).replace(/^#/, '');
    try { name = decodeURIComponent(name); } catch (e) { /* taken as written */ }
    if (name === 'register') return { name: name, id: '', isDefault: true };
    var m = /^rv-form-(.+)$/.exec(name);
    if (m && FORM_ID_RE.test(m[1])) return { name: name, id: m[1], isDefault: false };
    return null;
  }
  function onHash() {
    if (!page.started || editing() || page.mode === 'ai-view') return;
    var h = hashForm(location.hash);
    if (!h) return;
    // a part of the page by that name: the browser (or the site's own runtime) goes there
    if (doc.getElementById(h.name)) return;
    try {
      if (window.RevampSections && window.RevampSections.resolveHash && window.RevampSections.resolveHash('#' + h.name)) return;
    } catch (e) { /* theirs */ }
    var go = function () {
      var id = h.isDefault ? defaultFormId() : h.id;
      var e = id ? embedOf(id) : null;
      if (e) {
        e.el.scrollIntoView({ behavior: reducedMotion(window) ? 'auto' : 'smooth', block: 'start' });
        if (e.ctrl) e.ctrl.focusFirst(); else e.focusOnDraw = true;
        try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* as above */ }
        return;
      }
      if (page.modal && (page.modal.formId === id || page.modal.shownId === id)) return;
      openModal(id, null, h.isDefault, true);
    };
    if (page.payload || page.failed) go();
    else {
      // wait for the definitions: the default form, and which forms are drawn in place, are known then
      openModal(h.id, null, h.isDefault, true);
      var m = page.modal;
      fetchDefinitions().then(function () {
        if (!m || page.modal !== m || inUse(m.ctrl)) return;
        // the form turned out to be drawn on the page: go to it there instead
        if (embedOf(h.isDefault ? defaultFormId() : h.id)) { closeModal(true); go(); }
      });
    }
  }

  /* ---------- start ---------- */
  function start() {
    if (page.started || !doc.body) return;
    page.eventId = (function () {
      var cfg = readJson('rv-site-config');
      return str((cfg && cfg.eventId) || doc.body.getAttribute('data-rv-event-id')).trim();
    })();
    page.mode = pageMode();
    if (!page.mode) return;
    page.started = true;
    var inline = readJson('rv-forms');
    page.payload = validPayload(inline) ? inline : null;
    ensureStyles(doc);
    markButtons();
    var needFetch = page.mode === 'live' || !page.payload;
    startEmbeds();
    window.addEventListener('hashchange', onHash);
    if (needFetch) fetchDefinitions();
    onHash();
  }

  if (doc && !window.RV_FORMS_NO_AUTO) {
    /* capture, so this runs before the site's own link handling (et-runtime.js skips a link whose click
       was already dealt with) */
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else start();
  }

  window.RevampForms = {
    version: VERSION,
    render: render,
    validate: validate,
    cleanValue: cleanValue,
    ensureStyles: ensureStyles,
    open: open,
    definitions: function () { return page.payload; },
    guessCountry: guessCountry,
    suggestEmail: suggestEmail
  };
})();
