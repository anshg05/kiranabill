// KB-332 (docs/07-DECISIONS.md D84): the shopkeeper's screen in English, हिन्दी and Hinglish - ONE catalog, three languages,
// {placeholders}. Pure data and two pure functions (no browser API, no import): domain/ may hold it (hard rule 3).
//
// Owner rules, 17 Oct 2026: respectful tone (-एं) everywhere; "Bill Banao", "Theek hai" and "Cash" stay exactly as they are
// in every language; English mode is FULLY English (the mic button and the recording text too - the Hindi wording that was
// on the mic is हिन्दी mode's text). Numbers, units, product and customer names, the receipt and Developer mode are not here.
//
// Domain code keeps building its sentences in English (so no domain test and no saved draft carries a language); the screen
// shows them in the chosen language through translateEnglish(), which finds the catalog entry by its English template.
// messages.test.ts reads the domain sources and fails if a sentence there has no entry here.

export type Language = "en" | "hi" | "hl";
export const LANGUAGES: readonly Language[] = ["en", "hi", "hl"];

interface Entry {
  readonly en: string;
  readonly hi: string;
  readonly hl: string;
}
const m = (en: string, hi: string, hl: string): Entry => ({ en, hi, hl });
/** The same words in all three languages - for what must not change. */
const same = (s: string): Entry => ({ en: s, hi: s, hl: s });

export const MESSAGES = {
  // ---- Billing screen: the mic and the recording (English mode is fully English; the old Hindi wording is हिन्दी's)
  "mic.idle": m("Tap to speak", "बोलने के लिए दबाएं", "Bolne ke liye dabayein"),
  "mic.stop": m("Stop", "रोकें", "Rokein"),
  "mic.stopLabel": m("Stop recording", "रिकॉर्डिंग रोकें", "Recording rokein"),
  "mic.permission": m("Mic permission…", "माइक की अनुमति…", "Mic ki permission…"),
  "voice.listening": m("Listening…", "सुन रहे हैं…", "Sun rahe hain…"),

  // ---- Billing screen: the bill
  "bill.finalise": same("Bill Banao"),
  "bill.total": m("TOTAL", "कुल", "Kul"),
  "bill.savedBefore": m("Bill", "बिल", "Bill"),
  "bill.savedAfter": m("saved", "सेव हो गया", "save ho gaya"),
  "bill.savedLabel": m("Bill saved", "बिल सेव हुआ", "Bill save hua"),
  "bill.new": m("New bill", "नया बिल", "Naya bill"),
  "bill.items": m("Bill items", "बिल का सामान", "Bill ka saaman"),
  "customer.label": m("Customer", "ग्राहक", "Grahak"),
  "customer.name": m("Customer name", "ग्राहक का नाम", "Grahak ka naam"),
  "customer.mobile": m("Customer mobile", "ग्राहक का मोबाइल", "Grahak ka mobile"),
  "customer.addMobile": m("+ Mobile", "+ मोबाइल", "+ Mobile"),
  "col.item": m("Item", "सामान", "Item"),
  "col.qty": m("Qty", "मात्रा", "Qty"),
  "col.unit": m("Unit", "इकाई", "Unit"),
  "col.rate": m("Rate", "भाव", "Rate"),
  "col.amount": m("Amount", "रकम", "Amount"),
  "col.remove": m("Remove", "हटाएं", "Hatayein"),
  "line.quantity": m("{name} quantity", "{name} की मात्रा", "{name} ki matra"),
  "line.unit": m("{name} unit", "{name} की इकाई", "{name} ki unit"),
  "line.rate": m("{name} rate", "{name} का भाव", "{name} ka bhav"),
  "line.amount": m("{name} amount", "{name} की रकम", "{name} ki rakam"),
  "line.remove": m("Remove {name}", "{name} हटाएं", "{name} hatayein"),
  "line.change": m("Change item {name}", "{name} का सामान बदलें", "{name} ka saaman badlein"),
  "undo.removed": m("{name} removed", "{name} हटाया", "{name} hata diya"),
  "undo.button": m("Undo", "वापस करें", "Wapas"),
  "review.badge": m("Review mode", "रिव्यू मोड", "Review mode"),

  // ---- Menu
  "menu.label": m("Menu", "मेन्यू", "Menu"),
  "menu.history": m("History", "पुराने बिल", "Purane bill"),
  "menu.catalog": m("Catalog", "सामान की सूची", "Saaman ki list"),
  "menu.settings": m("Settings", "सेटिंग", "Settings"),
  "menu.clear": m("Clear bill", "बिल हटाएं", "Bill hatayein"),
  "menu.signout": m("Sign out", "साइन आउट", "Sign out"),

  // ---- Checks and flags (the app asking the shopkeeper to look at a number)
  "checks.one": m("{n} check pending", "{n} जाँच बाकी", "{n} check baaki"),
  "checks.many": m("{n} checks pending", "{n} जाँच बाकी", "{n} check baaki"),
  "checks.checked": m("Checked.", "जाँच हो गई।", "Check ho gaya."),
  "flag.heard": m("Heard: “{text}”", "सुना: “{text}”", "Suna: “{text}”"),
  "flag.mustCheck": m("Must check:", "ज़रूर देखें:", "Zaroor dekhein:"),
  "flag.ok": same("✓ Theek hai"),
  "flag.okButton": same("Theek hai"),
  "flag.okLabel": same("Theek hai — {text}"),
  "flag.review": m("REVIEW", "जाँचें", "Check karein"),
  "flag.reviewLabel": m("REVIEW — {name}", "जाँचें — {name}", "Check karein — {name}"),
  "flag.noteLabel": m("Note — {name}", "नोट — {name}", "Note — {name}"),
  "need.price": m("Price needed", "भाव चाहिए", "Bhav chahiye"),
  "need.quantity": m("Quantity needed", "मात्रा चाहिए", "Matra chahiye"),
  "flag.missingName": m("This item's name wasn't understood.", "इस सामान का नाम समझ नहीं आया।", "Is saaman ka naam samajh nahi aaya."),
  "flag.missingRate": m("A rate was expected for this line, but none was found.", "इस लाइन का भाव नहीं मिला।", "Is line ka bhav nahi mila."),
  "flag.missingTotal": m("This line's total couldn't be computed.", "इस लाइन का कुल नहीं निकल पाया।", "Is line ka kul nahi nikal paaya."),
  "flag.unknownProduct": m(`"{name}" isn't in your catalog yet — added anyway.`, `“{name}” आपकी सूची में नहीं है — फिर भी जोड़ दिया।`, `“{name}” aapki list mein nahi hai — phir bhi jod diya.`),
  "flag.weakMatch": m(`"{name}" matched more than one product — pick the right one.`, `“{name}” कई सामान से मिलता है — सही वाला चुनें।`, `“{name}” kai saaman se milta hai — sahi wala chunein.`),
  "flag.incomplete": m(`"{name}" has no price yet — add one to include it.`, `“{name}” का भाव नहीं है — भाव डालें, तभी बिल में जुड़ेगा।`, `“{name}” ka bhav nahi hai — bhav daalein, tabhi bill mein judega.`),
  "flag.invalidQty": m(`The quantity for "{name}" doesn't look right ({qty}). Check?`, `“{name}” की मात्रा ठीक नहीं लग रही ({qty})। देख लें?`, `“{name}” ki matra theek nahi lag rahi ({qty}). Dekh lein?`),
  "flag.invalidUnit": m(`"{unit}" isn't a recognised unit for "{name}". Check?`, `“{unit}” “{name}” की पहचानी हुई इकाई नहीं। देख लें?`, `“{unit}” “{name}” ki pehchaani hui unit nahi. Dekh lein?`),
  "flag.unitMismatch": m(`"{unit}" doesn't match how "{name}" is usually sold ({usual}). Check?`, `“{name}” आम तौर पर {usual} में बिकता है, “{unit}” में नहीं। देख लें?`, `“{name}” aam taur par {usual} mein bikta hai, “{unit}” mein nahi. Dekh lein?`),
  "flag.rateFar": m("Rate {rate}/{unit} — usually {usual}. Check?", "भाव {rate}/{unit} — आम तौर पर {usual}। देख लें?", "Bhav {rate}/{unit} — aam taur par {usual}. Dekh lein?"),
  "flag.totalFar": m("Total {total} — expected around {expected}. Check?", "कुल {total} — लगभग {expected} होना चाहिए। देख लें?", "Kul {total} — lagbhag {expected} hona chahiye. Dekh lein?"),
  "flag.duplicateLine": m(`"{name}" is on the bill twice, same quantity and price — said twice, or heard twice? Check.`, `“{name}” बिल में दो बार है, मात्रा और भाव एक जैसे — दो बार बोला या दो बार सुना? देख लें।`, `“{name}” bill mein do baar hai, matra aur bhav ek jaise — do baar bola ya do baar suna? Dekh lein.`),
  "flag.numberDropped": m(`Heard "{n}" but it doesn't appear on any line. Did you mean to add it?`, `“{n}” सुना, पर किसी लाइन में नहीं है। जोड़ना था?`, `“{n}” suna, par kisi line mein nahi hai. Jodna tha?`),
  "flag.qtyDropped": m("Heard a quantity of {n} but it's missing from the bill. Check?", "मात्रा {n} सुनी, पर बिल में नहीं है। देख लें?", "Matra {n} suni, par bill mein nahi hai. Dekh lein?"),
  "flag.twoNumbers": m(`Two numbers were heard for "{name}" but only one was used. Check?`, `“{name}” के लिए दो संख्याएँ सुनीं, एक ही इस्तेमाल हुई। देख लें?`, `“{name}” ke liye do numbers sune, ek hi use hua. Dekh lein?`),
  "flag.alreadyOnBill": m(`"{name}" is already on the bill with the same quantity and price — added again? Check.`, `“{name}” पहले से बिल में है, वही मात्रा और भाव — दोबारा जोड़ा? देख लें।`, `“{name}” pehle se bill mein hai, wahi matra aur bhav — dobara joda? Dekh lein.`),
  "flag.cantMatch": m("Couldn't match every number to its item in what was said — check each line's numbers.", "सब संख्याएँ सामान से मिल नहीं पाईं — हर लाइन की संख्या देख लें।", "Saare numbers saaman se mil nahi paaye — har line ke numbers dekh lein."),

  // ---- Learned names (KB-323)
  "learned.note": m("Learned: “{alias}” → {name}", "सीखा हुआ: “{alias}” → {name}", "Seekha hua: “{alias}” → {name}"),
  "learned.notThis": m("Not this", "यह नहीं", "Yeh nahi"),
  "learned.notThisLabel": m("Not this — {name}", "यह नहीं — {name}", "Yeh nahi — {name}"),
  "learned.forgotten": m("Forgotten. Check that {name} is the right item.", "भूल गए। देख लें कि {name} सही सामान है।", "Bhool gaye. Dekh lein ki {name} sahi saaman hai."),

  // ---- What the voice could not do, and the lines kept after a failure
  "voice.noSpeech": m("Didn't catch anything — try again", "कुछ सुनाई नहीं दिया — फिर बोलें", "Kuch sunai nahi diya — phir bolein"),
  "voice.noHear": m("Couldn't hear that — try again", "समझ नहीं आया — फिर बोलें", "Samajh nahi aaya — phir bolein"),
  "voice.slow": m("Took too long — try again", "देर हो गई — फिर कोशिश करें", "Der ho gayi — phir koshish karein"),
  "voice.noNet": m("No internet — voice needs a connection", "इंटरनेट नहीं है — बोलकर बिल के लिए नेट चाहिए", "Internet nahi hai — bolkar bill ke liye net chahiye"),
  "voice.offline": m("Offline — voice needs internet", "ऑफ़लाइन — बोलने के लिए इंटरनेट चाहिए", "Offline — bolne ke liye internet chahiye"),
  "voice.busy": m("Voice service busy — try again in a minute", "आवाज़ सेवा व्यस्त है — एक मिनट बाद कोशिश करें", "Awaaz service busy hai — ek minute baad koshish karein"),
  "voice.rate": m("Too many voice requests — wait a minute and try again", "बहुत बार बोला — एक मिनट रुकें, फिर कोशिश करें", "Bahut baar bola — ek minute rukein, phir koshish karein"),
  "voice.session": m("Session expired — sign out and sign in again", "लॉगिन ख़त्म हो गया — साइन आउट करके फिर साइन इन करें", "Login khatam ho gaya — sign out karke phir sign in karein"),
  "voice.micDenied": m("Mic permission denied — allow it in the browser's site settings", "माइक की अनुमति नहीं मिली — ब्राउज़र की साइट सेटिंग में अनुमति दें", "Mic ki permission nahi mili — browser ki site settings mein allow karein"),
  "voice.noMic": m("No microphone found", "माइक नहीं मिला", "Mic nahi mila"),
  "voice.unsupported": m("Voice isn't supported in this browser", "इस ब्राउज़र में बोलना काम नहीं करता", "Is browser mein bolna kaam nahi karta"),
  "voice.micFailed": m("The microphone didn't start — try again", "माइक चालू नहीं हुआ — फिर कोशिश करें", "Mic chalu nahi hua — phir koshish karein"),
  "voice.background": m("Recording stopped — the app went to the background. Tap to try again", "रिकॉर्डिंग रुक गई — ऐप पीछे चला गया था। फिर कोशिश के लिए दबाएं", "Recording ruk gayi — app peeche chala gaya tha. Phir koshish ke liye dabayein"),
  "voice.loadingCatalog": m("Loading your catalog…", "आपकी सूची आ रही है…", "Aapki list aa rahi hai…"),
  "items.unreadable": m("Couldn't read the items", "सामान पढ़ नहीं पाए", "Saaman padh nahi paaye"),
  "items.unreadableRetry": m("Couldn't read the items — Retry below", "सामान पढ़ नहीं पाए — नीचे ‘फिर कोशिश’ दबाएं", "Saaman padh nahi paaye — neeche ‘Phir koshish’ dabayein"),
  "save.failed": m("Couldn't save the bill — try again", "बिल सेव नहीं हो पाया — फिर कोशिश करें", "Bill save nahi ho paaya — phir koshish karein"),
  "notadded.list": m("Not added", "जुड़ा नहीं", "Juda nahi"),
  "notadded.line": m("Not added: “{text}”", "जुड़ा नहीं: “{text}”", "Juda nahi: “{text}”"),
  "retry.button": m("Retry", "फिर कोशिश", "Phir koshish"),
  "retry.reading": m("Reading…", "पढ़ रहे हैं…", "Padh rahe hain…"),
  "retry.label": m("Retry “{text}”", "“{text}” फिर कोशिश करें", "“{text}” phir koshish karein"),
  "byhand.button": m("Add by hand", "खुद जोड़ें", "Khud jodein"),
  "byhand.label": m("Add by hand “{text}”", "“{text}” खुद जोड़ें", "“{text}” khud jodein"),
  "byhand.labelVoice": m("Add “{text}” by hand", "“{text}” खुद जोड़ें", "“{text}” khud jodein"),
  "dismiss.label": m("Dismiss “{text}”", "“{text}” छोड़ दें", "“{text}” chhod dein"),

  // ---- Sync chip, its details, and the dialogs
  "sync.offline": m("Offline", "ऑफ़लाइन", "Offline"),
  "sync.syncing": m("Syncing…", "सिंक हो रहा है…", "Sync ho raha hai…"),
  "sync.failing": m("Sync failing", "सिंक नहीं हो रहा", "Sync nahi ho raha"),
  "sync.nosession": m("Not syncing — sign in again", "सिंक बंद — फिर साइन इन करें", "Sync band — phir sign in karein"),
  "sync.label": m("Sync details", "सिंक की जानकारी", "Sync ki jaankari"),
  "sync.pending.one": m("{n} bill hasn't reached the server yet.", "{n} बिल अभी सर्वर तक नहीं पहुँचा।", "{n} bill abhi server tak nahi pahuncha."),
  "sync.pending.many": m("{n} bills haven't reached the server yet.", "{n} बिल अभी सर्वर तक नहीं पहुँचे।", "{n} bill abhi server tak nahi pahunche."),
  "sync.conflict.one": m("{n} bill couldn't be saved to the server. It stays on this phone.", "{n} बिल सर्वर पर सेव नहीं हो पाया। वह इस फ़ोन में रहेगा।", "{n} bill server par save nahi ho paaya. Woh is phone mein rahega."),
  "sync.conflict.many": m("{n} bills couldn't be saved to the server. They stay on this phone.", "{n} बिल सर्वर पर सेव नहीं हो पाए। वे इस फ़ोन में रहेंगे।", "{n} bill server par save nahi ho paaye. Woh is phone mein rahenge."),
  "sync.lastTried": m("Last tried at {time}.", "आख़िरी कोशिश {time}।", "Aakhri koshish {time}."),
  "sync.continues": m("Billing continues.", "बिलिंग चलती रहेगी।", "Billing chalti rahegi."),
  "common.close": m("Close", "बंद करें", "Band karein"),
  "common.cancel": m("Cancel", "रहने दें", "Rehne dein"),
  "signout.title": m("Sign out?", "साइन आउट करें?", "Sign out karein?"),
  "signout.pending.one": m("{n} bill hasn't reached the server yet — it'll stay on this phone and sync when you sign back in.", "{n} बिल अभी सर्वर तक नहीं पहुँचा — वह इस फ़ोन में रहेगा और दोबारा साइन इन करने पर सिंक होगा।", "{n} bill abhi server tak nahi pahuncha — woh is phone mein rahega aur dobara sign in karne par sync hoga."),
  "signout.pending.many": m("{n} bills haven't reached the server yet — they'll stay on this phone and sync when you sign back in.", "{n} बिल अभी सर्वर तक नहीं पहुँचे — वे इस फ़ोन में रहेंगे और दोबारा साइन इन करने पर सिंक होंगे।", "{n} bill abhi server tak nahi pahunche — woh is phone mein rahenge aur dobara sign in karne par sync honge."),
  "signout.conflict.one": m("{n} bill couldn't be saved to the server and won't sync on its own — it stays on this phone.", "{n} बिल सर्वर पर सेव नहीं हो पाया और अपने-आप सिंक नहीं होगा — वह इस फ़ोन में रहेगा।", "{n} bill server par save nahi ho paaya aur apne-aap sync nahi hoga — woh is phone mein rahega."),
  "signout.conflict.many": m("{n} bills couldn't be saved to the server and won't sync on their own — they stay on this phone.", "{n} बिल सर्वर पर सेव नहीं हो पाए और अपने-आप सिंक नहीं होंगे — वे इस फ़ोन में रहेंगे।", "{n} bill server par save nahi ho paaye aur apne-aap sync nahi honge — woh is phone mein rahenge."),
  "signout.inProgress": m("Your bill in progress stays on this phone too.", "आपका अधूरा बिल भी इस फ़ोन में रहेगा।", "Aapka adhoora bill bhi is phone mein rahega."),
  "signout.anyway": m("Sign out anyway", "फिर भी साइन आउट करें", "Phir bhi sign out karein"),
  "clear.title": m("Clear this bill?", "यह बिल हटाएं?", "Yeh bill hatayein?"),
  "clear.one": m("{n} line will be removed — nothing is saved.", "{n} लाइन हट जाएगी — कुछ सेव नहीं होगा।", "{n} line hat jayegi — kuch save nahi hoga."),
  "clear.many": m("{n} lines will be removed — nothing is saved.", "{n} लाइनें हट जाएँगी — कुछ सेव नहीं होगा।", "{n} lines hat jayengi — kuch save nahi hoga."),

  // ---- Share
  "share.image": m("Image", "तस्वीर", "Image"),
  "share.pdf": same("PDF"),
  "share.whatsapp": same("WhatsApp"),
  "share.sms": same("SMS"),
  "share.mobile": m("Mobile", "मोबाइल", "Mobile"),
  "share.send": m("Send", "भेजें", "Bhejein"),
  "share.sendLabel": m("Send SMS", "SMS भेजें", "SMS bhejein"),
  "share.mobileLabel": m("Mobile for SMS", "SMS के लिए मोबाइल", "SMS ke liye mobile"),

  // ---- Add item / Change item panel
  "add.title": m("Add item", "सामान जोड़ें", "Saaman jodein"),
  "add.close": m("Close add item", "सामान जोड़ना बंद करें", "Saaman jodna band karein"),
  "add.search": m("Search products", "सामान खोजें", "Saaman khojein"),
  "add.placeholder": m("Search — chini, चीनी…", "खोजें — chini, चीनी…", "Khojein — chini, चीनी…"),
  "add.products": m("Products", "सामान", "Saaman"),
  "add.new": m("+ Add “{typed}” as a new product", "+ “{typed}” को नया सामान बनाएं", "+ “{typed}” ko naya saaman banayein"),
  "add.billSoFar.one": m("Bill so far · {total} · {n} item", "अब तक का बिल · {total} · {n} सामान", "Ab tak ka bill · {total} · {n} saaman"),
  "add.billSoFar.many": m("Bill so far · {total} · {n} items", "अब तक का बिल · {total} · {n} सामान", "Ab tak ka bill · {total} · {n} saaman"),
  "change.title": m("Change item", "सामान बदलें", "Saaman badlein"),
  "change.to": m("Change “{name}” to…", "“{name}” को बदलें…", "“{name}” ko badlein…"),
  "change.close": m("Close change item", "सामान बदलना बंद करें", "Saaman badalna band karein"),

  // ---- Typing a value, and what is refused
  "err.amountFormat": m("Enter an amount like 45 or 12.50", "45 या 12.50 जैसी रकम डालें", "45 ya 12.50 jaisi rakam daalein"),
  "err.amountDecimals": m("At most 2 digits after the point", "दशमलव के बाद ज़्यादा से ज़्यादा 2 अंक", "Point ke baad zyada se zyada 2 digit"),
  "err.amountPositive": m("Must be more than ₹0", "₹0 से ज़्यादा होना चाहिए", "₹0 se zyada hona chahiye"),
  "err.tooLarge": m("Too large — at most {limit}", "बहुत बड़ा — ज़्यादा से ज़्यादा {limit}", "Bahut bada — zyada se zyada {limit}"),
  "err.qtyFormat": m("Enter a quantity like 2 or 0.5", "2 या 0.5 जैसी मात्रा डालें", "2 ya 0.5 jaisi matra daalein"),
  "err.qtyDecimals": m("At most 3 digits after the point", "दशमलव के बाद ज़्यादा से ज़्यादा 3 अंक", "Point ke baad zyada se zyada 3 digit"),
  "err.qtyPositive": m("Must be more than 0", "0 से ज़्यादा होनी चाहिए", "0 se zyada honi chahiye"),
  "err.chooseUnit": m("Choose a unit", "इकाई चुनें", "Unit chunein"),
  "err.unitRate": m("Can't use {unit} with a rate per {rateUnit}", "{rateUnit} के भाव के साथ {unit} नहीं चल सकता", "{rateUnit} ke bhav ke saath {unit} nahi chal sakta"),
  "err.qtyFirst": m("Enter the quantity first", "पहले मात्रा डालें", "Pehle matra daalein"),
  "err.amountFollows": m("The amount follows qty × rate — change the rate instead", "रकम मात्रा × भाव से बनती है — भाव बदलें", "Rakam matra × bhav se banti hai — bhav badlein"),
  "err.notAUnit": m(`"{unit}" isn't a unit`, `“{unit}” कोई इकाई नहीं है`, `“{unit}” koi unit nahi hai`),
  "err.unitChange": m("Can't change {a} to {b}", "{a} को {b} में नहीं बदल सकते", "{a} ko {b} mein nahi badal sakte"),
  "err.nameLong": m("Name is too long — {max} characters at most", "नाम बहुत लंबा है — ज़्यादा से ज़्यादा {max} अक्षर", "Naam bahut lamba hai — zyada se zyada {max} akshar"),
  "err.mobileDigits": m("Enter a 10-digit mobile number", "10 अंकों का मोबाइल नंबर डालें", "10 digit ka mobile number daalein"),
  "err.mobileStart": m("Mobile numbers start with 6, 7, 8 or 9", "मोबाइल नंबर 6, 7, 8 या 9 से शुरू होते हैं", "Mobile number 6, 7, 8 ya 9 se shuru hote hain"),
  "err.mobileIndian": m("Only Indian mobile numbers (+91)", "सिर्फ़ भारतीय मोबाइल नंबर (+91)", "Sirf Indian mobile number (+91)"),
  "err.shopNameRequired": m("Shop name is required.", "दुकान का नाम ज़रूरी है।", "Dukaan ka naam zaroori hai."),
  "err.shopNameLong": m("Shop name is too long — {max} characters at most", "दुकान का नाम बहुत लंबा है — ज़्यादा से ज़्यादा {max} अक्षर", "Dukaan ka naam bahut lamba hai — zyada se zyada {max} akshar"),
  "err.shopPhone": m("Enter the 10-digit mobile number without a leading 0 (landline numbers aren't supported yet)", "10 अंकों का मोबाइल नंबर बिना शुरुआती 0 के डालें (लैंडलाइन अभी नहीं चलते)", "10 digit ka mobile number bina shuruaati 0 ke daalein (landline abhi nahi chalte)"),

  // ---- Sign-in (KB-335)
  "signin.google": m("Sign in with Google", "Google से साइन इन करें", "Google se sign in karein"),
  "signin.refused": m("This account isn't set up for the pilot", "यह खाता पायलट के लिए सेट नहीं है", "Yeh account pilot ke liye set nahi hai"),
  "signin.unfinished": m("Sign-in didn't finish — tap Sign in with Google again", "साइन इन पूरा नहीं हुआ — फिर से ‘Google से साइन इन करें’ दबाएं", "Sign in poora nahi hua — phir se ‘Google se sign in karein’ dabayein"),

  // ---- History tags used on the billing screen's neighbours (the History screen itself is Checkpoint B)
  "history.cancelled": m("Cancelled", "रद्द", "Radd"),

  // ---- Settings
  "settings.back": m("Back", "वापस", "Wapas"),
  "settings.shopDetails": m("Shop details", "दुकान की जानकारी", "Dukaan ki jaankari"),
  "settings.shopName": m("Shop name", "दुकान का नाम", "Dukaan ka naam"),
  "settings.shopPhone": m("Shop phone (optional)", "दुकान का फ़ोन (ज़रूरी नहीं)", "Dukaan ka phone (zaroori nahi)"),
  "settings.shopPhoneLabel": m("Shop phone", "दुकान का फ़ोन", "Dukaan ka phone"),
  "settings.save": m("Save", "सेव करें", "Save karein"),
  "settings.saved": m("Saved", "सेव हो गया", "Save ho gaya"),
  "settings.savedOffline": m("Saved on this phone — it will sync when you're online", "इस फ़ोन में सेव हुआ — ऑनलाइन होने पर सिंक होगा", "Is phone mein save hua — online hone par sync hoga"),
  "settings.receiptLanguage": m("Receipt language", "रसीद की भाषा", "Receipt ki bhasha"),
  "settings.receiptLanguageHelp": m("What your customer's receipt is printed in.", "ग्राहक की रसीद किस भाषा में छपेगी।", "Customer ki receipt kis bhasha mein chhapegi."),
  "settings.receiptNote": m("A receipt opened from History shows today's shop name, phone and language, not the ones it was first printed with.", "पुराने बिल से खोली गई रसीद में आज का दुकान का नाम, फ़ोन और भाषा दिखती है, न कि जब वह पहली बार छपी थी।", "Purane bill se kholi gayi receipt mein aaj ka dukaan ka naam, phone aur bhasha dikhti hai, na ki jab woh pehli baar chhapi thi."),
  "settings.receiptBoth": m("Both", "दोनों", "Dono"),
  "settings.screenLanguage": m("Screen language", "स्क्रीन की भाषा", "Screen ki bhasha"),
  "settings.screenLanguageHelp": m("The language of the buttons and messages on this phone only.", "सिर्फ़ इस फ़ोन के बटन और संदेशों की भाषा।", "Sirf is phone ke button aur sandesh ki bhasha."),
} as const satisfies Record<string, Entry>;

export type MessageId = keyof typeof MESSAGES;

/** {name} -> value. A placeholder with no value is a bug, never a blank on a shopkeeper's screen. */
export function render(id: MessageId, params: Readonly<Record<string, string | number>>, lang: Language): string {
  const entry = (MESSAGES as Record<string, Entry | undefined>)[id];
  if (!entry) throw new Error(`unknown message id: ${id}`);
  return entry[lang].replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) throw new Error(`message ${id}: no value for {${key}}`);
    return String(v);
  });
}

// ---- Domain sentences: find the catalog entry by its English template, keep the parts exactly as they were -----------

interface Matcher {
  readonly id: MessageId;
  readonly names: readonly string[];
  readonly re: RegExp;
  readonly literal: boolean;
}
let index: { exact: Map<string, MessageId>; templates: Matcher[] } | null = null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function build() {
  const exact = new Map<string, MessageId>();
  const templates: Matcher[] = [];
  for (const id of Object.keys(MESSAGES) as MessageId[]) {
    const en = MESSAGES[id].en;
    if (!/\{\w+\}/.test(en)) {
      exact.set(en, id);
      continue;
    }
    const names: string[] = [];
    const source = en
      .split(/(\{\w+\})/)
      .map((part) => {
        const ph = /^\{(\w+)\}$/.exec(part);
        if (!ph) return escapeRe(part);
        names.push(ph[1]!);
        return "(.+?)";
      })
      .join("");
    templates.push({ id, names, re: new RegExp(`^${source}$`, "s"), literal: false });
  }
  // The most specific template (the most fixed text) is tried first, so "Can't change X to Y" never loses to a looser one.
  templates.sort((a, b) => b.re.source.replace(/\(\.\+\?\)/g, "").length - a.re.source.replace(/\(\.\+\?\)/g, "").length);
  return { exact, templates };
}

/** An English sentence the domain or a hook built, said in `lang`; anything with no entry stays as it is (never blank). */
export function translateEnglish(text: string, lang: Language): string {
  if (lang === "en") return text;
  index ??= build();
  const exact = index.exact.get(text);
  if (exact) return MESSAGES[exact][lang];
  for (const t of index.templates) {
    const hit = t.re.exec(text);
    if (!hit) continue;
    const params: Record<string, string> = {};
    t.names.forEach((n, i) => {
      params[n] = hit[i + 1]!;
    });
    return render(t.id, params, lang);
  }
  return text;
}
