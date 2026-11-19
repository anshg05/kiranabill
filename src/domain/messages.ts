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
  // KB-414 step 1 (owner, 16 Nov 2026): the bottom nav that replaces the ≡ menu, and 08-Home
  "nav.label": m("Main", "मुख्य", "Main"),
  "nav.home": m("Home", "होम", "Home"),
  "nav.items": m("Items", "सामान", "Saamaan"),
  // nav "Bills" = history.billsLabel, nav "More" = order.more (one English text, one entry: the catalog test)
  "home.morning": m("Good morning", "सुप्रभात", "Good morning"),
  "home.afternoon": m("Good afternoon", "नमस्ते", "Good afternoon"),
  "home.evening": m("Good evening", "शुभ संध्या", "Good evening"),
  "home.profile": m("Shop profile", "दुकान की जानकारी", "Dukaan ki jaankari"),
  "home.ready": m("Ready for the next order", "अगले ऑर्डर के लिए तैयार", "Agle order ke liye taiyaar"),
  "home.tapToRecord": m("Tap to record · pause any time", "बोलने के लिए दबाएं · कभी भी रोकें", "Bolne ke liye dabayein · kabhi bhi rokein"),
  "home.typeItems": m("Type items", "सामान टाइप करें", "Saamaan type karein"),
  "home.recent": m("Recent bills", "हाल के बिल", "Haal ke bills"),
  "home.seeAll": m("See all", "सब देखें", "Sab dekhein"),
  "home.metaOne": m("1 item · {time}", "1 सामान · {time}", "1 saamaan · {time}"),
  "home.metaMany": m("{n} items · {time}", "{n} सामान · {time}", "{n} saamaan · {time}"),
  // KB-414 step 2: 14's bill card and 15's line under the title, as drawn ("1:18 pm · 4 items", "10 Nov 2026 · 1:02 pm · 38 items · Cash")
  "bills.metaOne": m("{time} · 1 item", "{time} · 1 सामान", "{time} · 1 saamaan"),
  "bills.metaMany": m("{time} · {n} items", "{time} · {n} सामान", "{time} · {n} saamaan"),
  "detail.metaOne": m("{date} · {time} · 1 item · {customer}", "{date} · {time} · 1 सामान · {customer}", "{date} · {time} · 1 saamaan · {customer}"),
  "detail.metaMany": m("{date} · {time} · {n} items · {customer}", "{date} · {time} · {n} सामान · {customer}", "{date} · {time} · {n} saamaan · {customer}"),
  // KB-413 step 4 (13 Bill saved, owner 16 Nov 2026): the line under "Bill 515 saved" - the receipt's own items, customer and time
  "saved.subOne": m("1 item · {customer} · {time}", "1 सामान · {customer} · {time}", "1 saamaan · {customer} · {time}"),
  "saved.subMany": m("{n} items · {customer} · {time}", "{n} सामान · {customer} · {time}", "{n} saamaan · {customer} · {time}"),
  "saved.startNew": m("Start a new bill", "नया बिल शुरू करें", "Naya bill shuru karein"),
  "bill.items": m("Bill items", "बिल का सामान", "Bill ka saaman"),
  // KB-413 step 1 (owner, 15 Nov 2026: new words in all 3 languages, reviewed on the sheets)
  "bill.draftBadge": m("Draft · not saved", "ड्राफ़्ट · सेव नहीं", "Draft · save nahi"),
  "bill.soFarOne": m("Total so far · 1 item", "अब तक कुल · 1 सामान", "Ab tak kul · 1 saaman"),
  "bill.soFarMany": m("Total so far · {n} items", "अब तक कुल · {n} सामान", "Ab tak kul · {n} saaman"),
  "order.more": m("More", "और", "Aur"),
  "heard.label": m("Heard:", "सुना:", "Suna:"),
  "heard.more": m("Show all", "पूरा देखें", "Poora dekhein"),
  "heard.less": m("Show less", "कम दिखाएं", "Kam dikhayein"),
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
  // KB-413 (owner, 15 Nov 2026): the bottom panel names what Bill Banao waits for when it is all one kind (12-BillReview)
  "need.priceOne": m("1 item needs a price", "1 सामान का भाव चाहिए", "1 saaman ka bhaav chahiye"),
  "need.priceMany": m("{n} items need a price", "{n} सामान का भाव चाहिए", "{n} saaman ka bhaav chahiye"),
  "need.qtyOne": m("1 item needs a quantity", "1 सामान की मात्रा चाहिए", "1 saaman ki matra chahiye"),
  "need.qtyMany": m("{n} items need a quantity", "{n} सामान की मात्रा चाहिए", "{n} saaman ki matra chahiye"),
  "flag.missingName": m("This item's name wasn't understood.", "इस सामान का नाम समझ नहीं आया।", "Is saaman ka naam samajh nahi aaya."),
  "flag.missingRate": m("A rate was expected for this line, but none was found.", "इस लाइन का भाव नहीं मिला।", "Is line ka bhav nahi mila."),
  "flag.missingTotal": m("This line's total couldn't be computed.", "इस लाइन का कुल नहीं निकल पाया।", "Is line ka kul nahi nikal paaya."),
  "flag.unknownProduct": m(`"{name}" isn't in your catalog yet — added anyway.`, `“{name}” आपकी सूची में नहीं है — फिर भी जोड़ दिया।`, `“{name}” aapki list mein nahi hai — phir bhi jod diya.`),
  "flag.weakMatch": m(`"{name}" matched more than one product — pick the right one.`, `“{name}” कई सामान से मिलता है — सही वाला चुनें।`, `“{name}” kai saaman se milta hai — sahi wala chunein.`),
  "flag.weakProduct": m(`Check this item — heard "{heard}", chose "{name}".`, `इस सामान को देख लें — सुना “{heard}”, चुना “{name}”।`, `Is saaman ko dekh lein — suna “{heard}”, chuna “{name}”.`),
  "flag.incomplete": m(`"{name}" has no price yet — add one to include it.`, `“{name}” का भाव नहीं है — भाव डालें, तभी बिल में जुड़ेगा।`, `“{name}” ka bhav nahi hai — bhav daalein, tabhi bill mein judega.`),
  "flag.invalidQty": m(`The quantity for "{name}" doesn't look right ({qty}). Check?`, `“{name}” की मात्रा ठीक नहीं लग रही ({qty})। देख लें?`, `“{name}” ki matra theek nahi lag rahi ({qty}). Dekh lein?`),
  "flag.invalidUnit": m(`"{unit}" isn't a recognised unit for "{name}". Check?`, `“{unit}” “{name}” की पहचानी हुई इकाई नहीं। देख लें?`, `“{unit}” “{name}” ki pehchaani hui unit nahi. Dekh lein?`),
  "flag.unitMismatch": m(`"{unit}" doesn't match how "{name}" is usually sold ({usual}). Check?`, `“{name}” आम तौर पर {usual} में बिकता है, “{unit}” में नहीं। देख लें?`, `“{name}” aam taur par {usual} mein bikta hai, “{unit}” mein nahi. Dekh lein?`),
  "flag.rateFar": m("Rate {rate}/{unit} — usually {usual}. Check?", "भाव {rate}/{unit} — आम तौर पर {usual}। देख लें?", "Bhav {rate}/{unit} — aam taur par {usual}. Dekh lein?"),
  "flag.outOfProportion": m("Total {total} — far more than this line should cost (about {expected}). Edit the line before Bill Banao.", "कुल {total} — इस लाइन के लिए बहुत ज़्यादा (लगभग {expected} होना चाहिए)। Bill Banao से पहले लाइन ठीक करें।", "Kul {total} — is line ke liye bahut zyada (lagbhag {expected} hona chahiye). Bill Banao se pehle line theek karein."),
  "flag.perGram": m("Rate {rate} per {unit} — kirana rates are per kilo, litre, piece or packet. Edit the line before Bill Banao.", "भाव {rate} प्रति {unit} — किराना भाव किलो, लीटर, पीस या पैकेट के हिसाब से होते हैं। Bill Banao से पहले लाइन ठीक करें।", "Bhav {rate} prati {unit} — kirana bhav kilo, litre, piece ya packet ke hisaab se hote hain. Bill Banao se pehle line theek karein."),
  "flag.removalUnclear": m('Heard "remove" without the item - should a line be removed? Check.', '"हटा दो" सुना, पर कौन सी चीज़ यह नहीं - हटाना है? देख लें।', '"Hata do" suna, par kaun si cheez yeh nahi - hatana hai? Dekh lein.'),
  "flag.noReference": m("Total {total} with nothing to check it against. Check?", "कुल {total} — जांचने के लिए कोई भाव नहीं। देख लें?", "Kul {total} — jaanchne ke liye koi bhav nahi. Dekh lein?"),
  "flag.totalFar": m("Total {total} — expected around {expected}. Check?", "कुल {total} — लगभग {expected} होना चाहिए। देख लें?", "Kul {total} — lagbhag {expected} hona chahiye. Dekh lein?"),
  "flag.duplicateLine": m(`"{name}" is on the bill twice, same quantity and price — said twice, or heard twice? Check.`, `“{name}” बिल में दो बार है, मात्रा और भाव एक जैसे — दो बार बोला या दो बार सुना? देख लें।`, `“{name}” bill mein do baar hai, matra aur bhav ek jaise — do baar bola ya do baar suna? Dekh lein.`),
  "flag.numberDropped": m(`Heard "{n}" but it doesn't appear on any line. Did you mean to add it?`, `“{n}” सुना, पर किसी लाइन में नहीं है। जोड़ना था?`, `“{n}” suna, par kisi line mein nahi hai. Jodna tha?`),
  "flag.qtyDropped": m("Heard a quantity of {n} but it's missing from the bill. Check?", "मात्रा {n} सुनी, पर बिल में नहीं है। देख लें?", "Matra {n} suni, par bill mein nahi hai. Dekh lein?"),
  "flag.twoNumbers": m(`Two numbers were heard for "{name}" but only one was used. Check?`, `“{name}” के लिए दो संख्याएँ सुनीं, एक ही इस्तेमाल हुई। देख लें?`, `“{name}” ke liye do numbers sune, ek hi use hua. Dekh lein?`),
  "flag.alreadyOnBill": m(`"{name}" is already on the bill with the same quantity and price — added again? Check.`, `“{name}” पहले से बिल में है, वही मात्रा और भाव — दोबारा जोड़ा? देख लें।`, `“{name}” pehle se bill mein hai, wahi matra aur bhav — dobara joda? Dekh lein.`),
  "flag.checkLine": m("Check this line's numbers", "इस लाइन की संख्याएँ देख लें", "Is line ke numbers dekh lein"),
  "flag.checkLines": m("Check these lines' numbers", "इन लाइनों की संख्याएँ देख लें", "In lines ke numbers dekh lein"),
  "flag.checked": m("Checked — {name}", "देख लिया — {name}", "Dekh liya — {name}"),
  "flag.thisOrder": m("this order", "यह ऑर्डर", "yeh order"),
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
  "voice.rate": m("Voice limit reached for now — try again later, or add by hand", "अभी आवाज़ की सीमा पूरी हो गई — बाद में कोशिश करें, या खुद जोड़ें", "Abhi awaaz ki seema poori ho gayi — baad mein koshish karein, ya khud jodein"),
  "voice.session": m("Session expired — sign out and sign in again", "लॉगिन ख़त्म हो गया — साइन आउट करके फिर साइन इन करें", "Login khatam ho gaya — sign out karke phir sign in karein"),
  // KB-413 step 2 (owner, answer 6): inside the Android app the browser's site settings do not exist - say where the app's permission is
  "voice.micDeniedApp": m("Allow the microphone for Kirana Voice Bill — phone Settings → Apps → Kirana Voice Bill → Permissions", "Kirana Voice Bill को माइक की अनुमति दें — फ़ोन की सेटिंग → ऐप्स → Kirana Voice Bill → अनुमतियाँ", "Kirana Voice Bill ko mic ki permission dein — phone ki Settings → Apps → Kirana Voice Bill → Permissions"),
  "voice.micDenied": m("Mic permission denied — allow it in the browser's site settings", "माइक की अनुमति नहीं मिली — ब्राउज़र की साइट सेटिंग में अनुमति दें", "Mic ki permission nahi mili — browser ki site settings mein allow karein"),
  "voice.noMic": m("No microphone found", "माइक नहीं मिला", "Mic nahi mila"),
  "voice.unsupported": m("Voice isn't supported in this browser", "इस ब्राउज़र में बोलना काम नहीं करता", "Is browser mein bolna kaam nahi karta"),
  "voice.micFailed": m("The microphone didn't start — try again", "माइक चालू नहीं हुआ — फिर कोशिश करें", "Mic chalu nahi hua — phir koshish karein"),
  "voice.background": m("Recording stopped — the app went to the background. Tap to try again", "रिकॉर्डिंग रुक गई — ऐप पीछे चला गया था। फिर कोशिश के लिए दबाएं", "Recording ruk gayi — app peeche chala gaya tha. Phir koshish ke liye dabayein"),
  "voice.loadingCatalog": m("Loading your catalog…", "आपकी सूची आ रही है…", "Aapki list aa rahi hai…"),
  "items.unreadable": m("Couldn't read the items", "सामान पढ़ नहीं पाए", "Saaman padh nahi paaye"),
  "items.quotaToday": m("Today's free reading limit is reached — add by hand, or try again tomorrow", "आज की मुफ़्त पढ़ने की सीमा पूरी हो गई — खुद जोड़ें, या कल फिर कोशिश करें", "Aaj ki muft padhne ki seema poori ho gayi — khud jodein, ya kal phir koshish karein"),
  "items.busyRetry": m("Reading service is busy — Retry in a minute, or add by hand", "पढ़ने वाली सेवा व्यस्त है — एक मिनट बाद ‘फिर कोशिश’ दबाएं, या खुद जोड़ें", "Padhne wali service busy hai — ek minute baad ‘Phir koshish’ dabayein, ya khud jodein"),
  "items.slowRetry": m("Took too long — Retry, or add by hand", "देर हो गई — ‘फिर कोशिश’ दबाएं, या खुद जोड़ें", "Der ho gayi — ‘Phir koshish’ dabayein, ya khud jodein"),
  "items.billingProblem": m("AI reading has no credit — add by hand, and tell support", "एआई से पढ़ने का क्रेडिट नहीं है — खुद जोड़ें, और सपोर्ट को बताएं", "AI se padhne ka credit nahi hai — khud jodein, aur support ko batayein"),
  "items.setupProblem": m("AI reading isn't set up right — add by hand, and tell support", "एआई से पढ़ना ठीक से चालू नहीं है — खुद जोड़ें, और सपोर्ट को बताएं", "AI se padhna theek se chalu nahi hai — khud jodein, aur support ko batayein"),
  "items.unreadableRetry": m("Couldn't read the items — Retry below", "सामान पढ़ नहीं पाए — नीचे ‘फिर कोशिश’ दबाएं", "Saaman padh nahi paaye — neeche ‘Phir koshish’ dabayein"),
  "save.failed": m("Couldn't save the bill — try again", "बिल सेव नहीं हो पाया — फिर कोशिश करें", "Bill save nahi ho paaya — phir koshish karein"),
  "notadded.list": m("Not added", "जुड़ा नहीं", "Juda nahi"),
  "notadded.line": m("Not added: “{text}”", "जुड़ा नहीं: “{text}”", "Juda nahi: “{text}”"),
  "retry.button": m("Retry", "फिर कोशिश", "Phir koshish"),
  // KB-413 fix 2 (owner, 16 Nov 2026): the voice recording's button, as design 23 draws it (23 and 12's failed card); "retry.button"
  // stays "Retry" on the app's server-down screen and the typed-order list
  "retry.tryAgain": m("Try again", "फिर कोशिश", "Phir koshish"),
  "retry.reading": m("Reading…", "पढ़ रहे हैं…", "Padh rahe hain…"),
  "retry.label": m("Retry “{text}”", "“{text}” फिर कोशिश करें", "“{text}” phir koshish karein"),
  "byhand.button": m("Add by hand", "खुद जोड़ें", "Khud jodein"),
  "byhand.label": m("Add by hand “{text}”", "“{text}” खुद जोड़ें", "“{text}” khud jodein"),
  "byhand.labelVoice": m("Add “{text}” by hand", "“{text}” खुद जोड़ें", "“{text}” khud jodein"),
  "dismiss.label": m("Dismiss “{text}”", "“{text}” छोड़ दें", "“{text}” chhod dein"),

  // ---- KB-385 (D101, doc 25 §5 and §8): the order recorder, its recordings on the bill, and the "filled, not spoken" mark
  "order.record": m("Record order", "ऑर्डर बोलें", "Order bolein"),
  "order.recordMore": m("Add more by voice", "आवाज़ से और जोड़ें", "Awaaz se aur jodein"),
  "order.pause": m("Pause", "थोड़ा रुकें", "Thoda rukein"),
  "order.resume": m("Resume", "जारी रखें", "Jaari rakhein"),
  "order.paused": m("Paused", "रुका हुआ", "Ruka hua"),
  "order.warn": m("Recording stops at 5:00", "रिकॉर्डिंग 5:00 पर रुक जाएगी", "Recording 5:00 par ruk jaayegi"),
  "order.stoppedLimit": m("Stopped at 5:00", "5:00 पर रुक गई", "5:00 par ruk gayi"),
  "order.stoppedHidden": m("Stopped — the app went to the background", "रुक गई — ऐप पीछे चला गया था", "Ruk gayi — app peeche chala gaya tha"),
  "order.rerecord": m("Re-record", "फिर से बोलें", "Phir se bolein"),
  "order.generate": m("Generate bill", "बिल बनाएं", "Bill banayein"),
  "order.nothing": m("Nothing recorded", "कुछ रिकॉर्ड नहीं हुआ", "Kuch record nahi hua"),
  // KB-413 step 2 (D110 item 9): 09-Recording and 10-Review, full screen
  "rec.title": m("New voice bill", "नया वॉइस बिल", "Naya voice bill"),
  "rec.recording": m("Recording", "रिकॉर्ड हो रहा है", "Record ho raha hai"),
  "rec.of": m("of {max}", "{max} में से", "{max} mein se"),
  "rec.tip": m("Say {what}. Pause if a customer talks.", "{what} बोलें। ग्राहक बात करे तो रोकें।", "{what} bolein. Grahak baat kare to rokein."),
  "rec.tipWhat": m("item · quantity · price", "सामान · मात्रा · भाव", "saaman · matra · bhaav"),
  "rec.saved": m("Saved on this phone when you stop", "रोकने पर इस फ़ोन में सेव होगा", "Rokne par is phone mein save hoga"),
  "rec.discardTitle": m("Discard recording?", "रिकॉर्डिंग हटाएँ?", "Recording hatayein?"),
  "rec.discardLine": m("The {time} recording will be deleted.", "{time} की रिकॉर्डिंग मिट जाएगी।", "{time} ki recording mit jaayegi."),
  "rec.keep": m("Keep recording", "रिकॉर्डिंग रखें", "Recording rakhein"),
  "review.title": m("Check your recording", "अपनी रिकॉर्डिंग जाँचें", "Apni recording jaanchein"),
  "review.ready": m("Recording ready", "रिकॉर्डिंग तैयार है", "Recording taiyaar hai"),
  "review.length": m("{time} · saved on this phone", "{time} · इस फ़ोन में सेव", "{time} · is phone mein save"),
  "review.play": m("Play recording", "रिकॉर्डिंग चलाएँ", "Recording chalayein"),
  "review.pause": m("Pause recording", "रिकॉर्डिंग रोकें", "Recording rokein"),
  "review.tip": m("Listen once if the shop was noisy. You can always re-record — nothing is lost.", "दुकान में शोर था तो एक बार सुन लें। आप कभी भी फिर से बोल सकते हैं — कुछ नहीं खोता।", "Dukaan mein shor tha to ek baar sun lein. Aap kabhi bhi phir se bol sakte hain — kuch nahi khota."),
  "review.typeInstead": m("Type instead", "हाथ से लिखें", "Haath se likhein"),
  "order.list": m("Recordings", "रिकॉर्डिंग", "Recordings"),
  "order.reading": m("Reading the order… {s} s", "ऑर्डर पढ़ रहे हैं… {s} सेकंड", "Order padh rahe hain… {s} second"),
  // KB-413 step 3 (24-Offline): the waiting recording's card, as drawn
  "order.queued": m("Order saved · will send when online", "ऑर्डर सेव है · ऑनलाइन होने पर भेजेंगे", "Order save hai · online hone par bhejenge"),
  "order.queuedSub": m("Recording {time} · the bill appears by itself", "रिकॉर्डिंग {time} · बिल अपने आप आ जाएगा", "Recording {time} · bill apne aap aa jaayega"),
  "order.meanwhile": m("Meanwhile, you can type items:", "तब तक आप सामान टाइप कर सकते हैं:", "Tab tak aap saamaan type kar sakte hain:"),
  "offline.strip": m("No internet · billing still works", "इंटरनेट नहीं · बिलिंग चलती रहेगी", "Internet nahi · billing chalti rahegi"),
  "need.recOne": m("Waiting for 1 recording", "1 रिकॉर्डिंग का इंतज़ार", "1 recording ka intezaar"),
  "need.recMany": m("Waiting for {n} recordings", "{n} रिकॉर्डिंग का इंतज़ार", "{n} recordings ka intezaar"),
  "bill.afterOrder": m("Bill Banao after the order arrives", "ऑर्डर आने के बाद Bill Banao", "Order aane ke baad Bill Banao"),
  "bill.afterOrders": m("Bill Banao after the orders arrive", "सारे ऑर्डर आने के बाद Bill Banao", "Saare order aane ke baad Bill Banao"),
  // KB-413 step 3 (11-Generating): the waiting screen. One fixed tip - the TRUE learning wording (owner, 15 Nov 2026; 26 §0b item 3)
  "gen.title": m("Making your bill", "आपका बिल बन रहा है", "Aapka bill ban raha hai"),
  "gen.reading": m("Reading your order…", "आपका ऑर्डर पढ़ रहे हैं…", "Aapka order padh rahe hain…"),
  "gen.elapsed": m("{s} s · long orders take a little longer", "{s} सेकंड · लंबे ऑर्डर में थोड़ा ज़्यादा समय लगता है", "{s} second · lambe order mein thoda zyaada samay lagta hai"),
  "gen.tipTitle": m("DID YOU KNOW", "क्या आप जानते हैं", "Kya aap jaante hain"),
  "gen.tip": m("It learns your prices. After a few bills it suggests your price; approve it once, and it fills in from then on.", "यह आपके भाव सीखता है। कुछ बिलों के बाद यह आपका भाव सुझाता है; एक बार मंज़ूर करें, फिर यह अपने आप भर देता है।", "Yeh aapke bhaav seekhta hai. Kuch bills ke baad yeh aapka bhaav suggest karta hai; ek baar approve karein, phir yeh apne aap bhar deta hai."),
  "gen.safe": m("Recording safe on this phone", "रिकॉर्डिंग इस फ़ोन में सुरक्षित है", "Recording is phone mein surakshit hai"),
  "gen.byHand": m("Add items by hand meanwhile", "तब तक सामान खुद जोड़ें", "Tab tak saamaan khud jodein"),
  // KB-413 step 3 (23-ReadFailed): one true sentence per reason (the queue's reason - src/data/voiceJob.ts); the recording is in the queue
  "fail.sent": m("The recording couldn't be sent. It's safe on this phone — try again, no need to speak again.", "रिकॉर्डिंग भेज नहीं पाए। वह इस फ़ोन में सुरक्षित है — ‘फिर कोशिश’ करें, दोबारा बोलने की ज़रूरत नहीं।", "Recording bhej nahi paaye. Woh is phone mein surakshit hai — ‘Phir koshish’ karein, dobara bolne ki zaroorat nahi."),
  "fail.busy": m("The reading service is busy right now. Your recording is safe — try again in a moment.", "पढ़ने वाली सेवा अभी व्यस्त है। आपकी रिकॉर्डिंग सुरक्षित है — थोड़ी देर में ‘फिर कोशिश’ करें।", "Padhne wali service abhi busy hai. Aapki recording surakshit hai — thodi der mein ‘Phir koshish’ karein."),
  "fail.limit": m("Too many orders this hour. Your recording is safe — try again later.", "इस घंटे बहुत ऑर्डर हो गए। आपकी रिकॉर्डिंग सुरक्षित है — बाद में ‘फिर कोशिश’ करें।", "Is ghante bahut order ho gaye. Aapki recording surakshit hai — baad mein ‘Phir koshish’ karein."),
  "fail.session": m("You were signed out. Sign in again, then try again — your recording is safe.", "आप साइन आउट हो गए। फिर से साइन इन करें, फिर ‘फिर कोशिश’ — आपकी रिकॉर्डिंग सुरक्षित है।", "Aap sign out ho gaye. Phir se sign in karein, phir ‘Phir koshish’ — aapki recording surakshit hai."),
  "fail.read": m("This order couldn't be read. Your recording is safe — try again, no need to speak again.", "यह ऑर्डर पढ़ा नहीं जा सका। आपकी रिकॉर्डिंग सुरक्षित है — ‘फिर कोशिश’ करें, दोबारा बोलने की ज़रूरत नहीं।", "Yeh order padha nahi ja saka. Aapki recording surakshit hai — ‘Phir koshish’ karein, dobara bolne ki zaroorat nahi."),
  "fail.recording": m("Recording {time}", "रिकॉर्डिंग {time}", "Recording {time}"),
  "fail.saved": m("Saved on this phone", "इस फ़ोन में सेव है", "Is phone mein save hai"),
  "fail.recordAgain": m("Record again", "फिर से रिकॉर्ड करें", "Phir se record karein"),
  "order.couldntSend": m("Couldn't send the recording", "रिकॉर्डिंग भेज नहीं पाए", "Recording bhej nahi paaye"),
  "order.session": m("Signed out — sign in again, then try again", "साइन आउट हो गया — फिर से साइन इन करें, फिर ‘फिर कोशिश’", "Sign out ho gaya — phir se sign in karein, phir ‘Phir koshish’"),
  "order.limit": m("Too many orders this hour — try again later", "इस घंटे बहुत ऑर्डर हो गए — थोड़ी देर बाद ‘फिर कोशिश’", "Is ghante bahut order ho gaye — thodi der baad ‘Phir koshish’"),
  "order.couldntRead": m("Couldn't read the order", "ऑर्डर पढ़ नहीं पाए", "Order padh nahi paaye"),
  "order.noItems": m("No items found", "कोई सामान नहीं मिला", "Koi saamaan nahi mila"),
  "order.remove": m("Remove this recording", "यह रिकॉर्डिंग हटाएं", "Yeh recording hatayein"),
  "filled.shop": m("your price", "आपका भाव", "aapka bhaav"), // owner, 15 Nov 2026 (26 §5): was "shop price"
  "filled.repeat": m("price said earlier", "पहले बोला भाव", "pehle bola bhaav"),

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
  // D116 (owner, 19 Nov 2026): "Please update" - the app is below app_min_version
  "update.title": m("Please update", "कृपया अपडेट करें", "Kripya update karein"),
  "update.body": m("This version of Kirana Voice Bill is too old. Install the new version to keep billing.", "Kirana Voice Bill का यह वर्ज़न पुराना हो गया है। बिलिंग जारी रखने के लिए नया वर्ज़न इंस्टॉल करें।", "Kirana Voice Bill ka yeh version purana ho gaya hai. Billing jaari rakhne ke liye naya version install karein."),
  "update.button": m("Update", "अपडेट करें", "Update karein"),
  "update.ask": m("Ask for the new version.", "नया वर्ज़न मांगें।", "Naya version maangein."),
  "update.checkAgain": m("Check again", "फिर से जाँचें", "Phir se jaanchein"),
  "update.checking": m("Checking…", "जाँच रहे हैं…", "Jaanch rahe hain…"),
  "update.keepOpen": m("Keep the app open with internet so they upload.", "इन्हें भेजने के लिए ऐप इंटरनेट के साथ खुला रखें।", "Inhe bhejne ke liye app internet ke saath khula rakhein."),
  "update.allUploaded": m("All bills have reached the server.", "सारे बिल सर्वर तक पहुँच गए।", "Saare bill server tak pahunch gaye."),
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
  /** KB-413 step 4: 13's tile - the phone's share sheet with the bill image (downloads it where the phone cannot share files) */
  "share.share": m("Share", "शेयर करें", "Share karein"),
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
  "install.ios": m("On iPhone, keep your bills safe: tap Share, then “Add to Home Screen”.", "iPhone पर बिल सुरक्षित रखने के लिए: शेयर दबाएं, फिर “होम स्क्रीन पर जोड़ें” चुनें।", "iPhone par bill surakshit rakhne ke liye: Share dabayein, phir “Add to Home Screen” chunein."), // KB-346
  "share.copy": m("Copy message", "संदेश कॉपी करें", "Message copy karein"),
  "share.copied": m("Copied", "कॉपी हो गया", "Copy ho gaya"),
  // KB-414 (phone check, 17 Nov 2026): the Android app's notes under the share buttons
  "share.savedDownloads": m("Saved to Downloads", "डाउनलोड में सेव हो गया", "Downloads mein save ho gaya"),
  // KB-414 step 3 phone check: "Open" after a save - the saved PDF / CSV in the phone's own viewer
  "share.open": m("Open", "खोलें", "Kholein"),
  "share.noViewer": m("No app on this phone can open this file", "इस फ़ोन पर इस फ़ाइल को खोलने वाला कोई ऐप नहीं है", "Is phone par is file ko kholne wala koi app nahi hai"),
  "share.failed": m("Couldn't open sharing — try again", "शेयर नहीं खुल पाया — फिर कोशिश करें", "Share nahi khul paaya — phir koshish karein"),
  "signin.error": m("Couldn't start sign-in — check the internet and try again", "साइन इन शुरू नहीं हो पाया — इंटरनेट देखें और फिर कोशिश करें", "Sign in shuru nahi ho paya — internet dekhein aur phir koshish karein"), // KB-343
  "onboard.error": m("Couldn't set up the shop — check the internet and try again", "दुकान सेट नहीं हो पाई — इंटरनेट देखें और फिर कोशिश करें", "Dukaan set nahi ho payi — internet dekhein aur phir koshish karein"),
  "voice.noItem": m("Couldn't find an item — add it manually", "कोई सामान नहीं मिला — खुद जोड़ें", "Koi saaman nahi mila — khud jodein"),
  "voice.understanding": m("Understanding…", "समझ रहे हैं…", "Samajh rahe hain…"),
  "discard.title": m("Discard changes?", "बदलाव छोड़ें?", "Badlav chhodein?"),
  "discard.line": m("What you typed here will be lost.", "यहाँ जो आपने लिखा है वह नहीं रहेगा।", "Yahan jo aapne likha hai woh nahi rahega."),
  "discard.confirm": m("Discard", "छोड़ दें", "Chhod dein"),
  "reason.noChanges": m("No changes to save yet", "अभी सेव करने के लिए कोई बदलाव नहीं", "Abhi save karne ke liye koi badlav nahi"),
  "reason.preparing": m("Preparing the receipt…", "रसीद तैयार हो रही है…", "Receipt taiyaar ho rahi hai…"),
  "reason.smsNumber": m("Enter the 10-digit mobile number to send", "भेजने के लिए 10 अंकों का मोबाइल नंबर डालें", "Bhejne ke liye 10 ankon ka mobile number daalein"),
  "reason.cancelReason": m("Choose a reason first", "पहले कारण चुनें", "Pehle karan chunein"),
  "reason.emptyBill": m("Add an item first", "पहले सामान जोड़ें", "Pehle saaman jodein"),
  "reason.saving": m("Saving the bill…", "बिल सेव हो रहा है…", "Bill save ho raha hai…"),
  "signin.opening": m("Opening Google…", "Google खुल रहा है…", "Google khul raha hai…"), // KB-342
  "signin.refused": m("This account isn't set up for the pilot", "यह खाता पायलट के लिए सेट नहीं है", "Yeh account pilot ke liye set nahi hai"),
  "signin.unfinished": m("Sign-in didn't finish — tap Sign in with Google again", "साइन इन पूरा नहीं हुआ — फिर से ‘Google से साइन इन करें’ दबाएं", "Sign in poora nahi hua — phir se ‘Google se sign in karein’ dabayein"),

  // ---- History tags used on the billing screen's neighbours (the History screen itself is Checkpoint B)
  "history.cancelled": m("Cancelled", "रद्द", "Radd"),

  // ---- Settings
  // ---- KB-408 (D111): printing to a Bluetooth thermal printer - inside the Android app only; printing never blocks a bill
  "print.bill": m("Print bill", "बिल प्रिंट करें", "Bill print karein"),
  // KB-414 step 2: 15-BillDetail's button - every copy from a saved bill prints REPRINT
  "print.reprint": m("Reprint", "दोबारा प्रिंट करें", "Dobara print karein"),
  "print.printing": m("Printing… {percent}%", "प्रिंट हो रहा है… {percent}%", "Print ho raha hai… {percent}%"),
  "print.done": m("Printed", "प्रिंट हो गया", "Print ho gaya"),
  "print.noPrinter": m("No printer chosen — choose one in More → Printer.", "कोई प्रिंटर नहीं चुना — और → प्रिंटर में चुनें।", "Koi printer nahi chuna — Aur → Printer mein chunein."),
  "print.unreachable": m(
    "Printer not connected — switch it on, keep it close and tap Print again. You can still share the bill.",
    "प्रिंटर से जुड़ नहीं पाए — उसे चालू करें, पास रखें और फिर से प्रिंट दबाएं। बिल अब भी शेयर कर सकते हैं।",
    "Printer se jud nahi paaye — use chalu karein, paas rakhein aur phir se Print dabayein. Bill ab bhi share kar sakte hain.",
  ),
  "print.bluetoothOff": m("Bluetooth is off — turn it on and tap Print again.", "ब्लूटूथ बंद है — उसे चालू करें और फिर से प्रिंट दबाएं।", "Bluetooth band hai — use chalu karein aur phir se Print dabayein."),
  "print.permission": m(
    "Allow “Nearby devices” to print: phone Settings → Apps → Kirana Voice Bill → Permissions.",
    "प्रिंट के लिए “आस-पास के डिवाइस” की अनुमति दें: फ़ोन की सेटिंग्स → ऐप्स → Kirana Voice Bill → अनुमतियां।",
    "Print ke liye “Nearby devices” ki permission dein: phone Settings → Apps → Kirana Voice Bill → Permissions.",
  ),
  "print.disconnected": m("The printer stopped mid-print — tap Print to print the whole bill again.", "प्रिंटर बीच में रुक गया — पूरा बिल फिर से छापने के लिए प्रिंट दबाएं।", "Printer beech mein ruk gaya — poora bill phir se chhapne ke liye Print dabayein."),
  "print.noBluetooth": m("This phone has no Bluetooth.", "इस फ़ोन में ब्लूटूथ नहीं है।", "Is phone mein Bluetooth nahi hai."),
  "settings.printer": m("Printer", "प्रिंटर", "Printer"),
  "settings.printerHelp": m(
    "A Bluetooth thermal printer. Pair it once in the phone's Bluetooth settings (PIN 0000 or 1234), then choose it here.",
    "ब्लूटूथ थर्मल प्रिंटर। उसे एक बार फ़ोन की ब्लूटूथ सेटिंग्स में जोड़ें (PIN 0000 या 1234), फिर यहां चुनें।",
    "Bluetooth thermal printer. Use ek baar phone ki Bluetooth settings mein jodein (PIN 0000 ya 1234), phir yahan chunein.",
  ),
  "settings.printerNone": m("No printer chosen", "कोई प्रिंटर नहीं चुना", "Koi printer nahi chuna"),
  "settings.printerChoose": m("Choose printer", "प्रिंटर चुनें", "Printer chunein"),
  "settings.printerPaired": m("Paired with this phone", "इस फ़ोन से जुड़े हुए", "Is phone se jude hue"),
  "settings.printerSearch": m("Search for Bluetooth LE printers", "ब्लूटूथ LE प्रिंटर खोजें", "Bluetooth LE printer khojein"),
  "settings.printerSearching": m("Searching…", "खोज रहे हैं…", "Khoj rahe hain…"),
  "settings.printerNoneFound": m("No printer found. Pair it in the phone's Bluetooth settings, then come back.", "कोई प्रिंटर नहीं मिला। उसे फ़ोन की ब्लूटूथ सेटिंग्स में जोड़ें, फिर वापस आएं।", "Koi printer nahi mila. Use phone ki Bluetooth settings mein jodein, phir wapas aayein."),
  "settings.paper": m("Paper size", "कागज़ का साइज़", "Kagaz ka size"),
  "settings.paper58": m("58 mm (2 inch)", "58 mm (2 इंच)", "58 mm (2 inch)"),
  "settings.paper80": m("80 mm (3 inch)", "80 mm (3 इंच)", "80 mm (3 inch)"),
  "settings.testPrint": m("Test print", "टेस्ट प्रिंट", "Test print"),
  "settings.compatMode": m("Compatible mode (for older printers)", "कम्पैटिबल मोड (पुराने प्रिंटर के लिए)", "Compatible mode (purane printer ke liye)"),
  "settings.compatHint": m("Turn on if your printer prints strange symbols.", "अगर प्रिंटर अजीब निशान छापे, तो इसे चालू करें।", "Agar printer ajeeb nishaan chhaape, to ise chalu karein."),
  "settings.longTestPrint": m("Long test print (60 lines)", "लंबा टेस्ट प्रिंट (60 लाइन)", "Lamba test print (60 line)"),
  "settings.printerChecking": m("Checking the printer…", "प्रिंटर जाँच रहे हैं…", "Printer check kar rahe hain…"),
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
  // ======== Checkpoint B (KB-332): Catalog, History and Cancel, product sheets, import, set-up, shop-load error ========
  "common.add": m("Add", "जोड़ें", "Jodein"),

  // ---- History
  "history.search": m("Search bills", "बिल खोजें", "Bill khojein"),
  "history.placeholder": m("Name, amount, date (4/10), item, bill no.", "नाम, रकम, तारीख (4/10), सामान, बिल नं.", "Naam, rakam, tareekh (4/10), saaman, bill no."),
  "history.scopeAll": m("Searching all bills on this phone", "इस फ़ोन के सभी बिलों में खोज रहे हैं", "Is phone ke sabhi bills mein khoj rahe hain"),
  "history.scopeRecent": m("Searching the last 90 days", "पिछले 90 दिनों में खोज रहे हैं", "Pichhle 90 dinon mein khoj rahe hain"),
  "history.scopeLoading": m("Loading the last 90 days…", "पिछले 90 दिन आ रहे हैं…", "Pichhle 90 din aa rahe hain…"),
  "history.loadingServer": m("Loading bills from the server…", "सर्वर से बिल आ रहे हैं…", "Server se bill aa rahe hain…"),
  "history.needInternet": m("Connect to the internet to load your earlier bills.", "पुराने बिल लाने के लिए इंटरनेट चालू करें।", "Purane bill laane ke liye internet chalu karein."),
  "history.empty": m("No bills on this phone yet.", "इस फ़ोन में अभी कोई बिल नहीं है।", "Is phone mein abhi koi bill nahi hai."),
  "history.emptyHelp": m("History shows the bills saved on this phone.", "यहाँ इस फ़ोन में सेव हुए बिल दिखते हैं।", "Yahan is phone mein save hue bill dikhte hain."),
  "history.none": m("No bills found.", "कोई बिल नहीं मिला।", "Koi bill nahi mila."),
  "history.today": m("Today", "आज", "Aaj"),
  "history.yesterday": m("Yesterday", "कल", "Kal"),
  "history.notSynced": m("Not synced", "सिंक नहीं हुआ", "Sync nahi hua"),
  "history.showMore": m("Show more", "और दिखाएं", "Aur dikhayein"),
  "history.searchOlder": m("Search older bills", "पुराने बिलों में खोजें", "Purane bills mein khojein"),
  "history.loadingOlder": m("Loading older bills…", "पुराने बिल आ रहे हैं…", "Purane bill aa rahe hain…"),
  "history.billsLabel": m("Bills", "बिल", "Bills"),
  "history.cancellation": m("Cancellation", "रद्द करने की जानकारी", "Radd karne ki jaankari"),
  "history.cancelledReason": m("Cancelled — {reason}", "रद्द — {reason}", "Radd — {reason}"),
  "history.billNo": m("Bill {n}", "बिल {n}", "Bill {n}"), // KB-341 (D87): a number on its own gets its label, so it is not read as an amount
  "history.replacedBy": m("Replaced by Bill {n}", "बिल नं. {n} से बदला गया", "Bill no. {n} se badla gaya"),
  "history.noReplacement": m("No replacement bill made", "नया बिल नहीं बनाया गया", "Naya bill nahi banaya gaya"),
  "history.conflictNote": m("This bill couldn't be saved to the server, so its cancellation is on this phone only.", "यह बिल सर्वर पर सेव नहीं हो पाया, इसलिए इसका रद्द होना सिर्फ़ इस फ़ोन में है।", "Yeh bill server par save nahi ho paaya, isliye iska radd hona sirf is phone mein hai."),
  "history.willReach": m("Will reach your other phones when this one is online", "यह फ़ोन ऑनलाइन होते ही आपके दूसरे फ़ोन तक पहुँच जाएगा", "Yeh phone online hote hi aapke doosre phone tak pahunch jayega"),
  "history.replaces": m("Replaces Bill {n}", "बिल नं. {n} की जगह", "Bill no. {n} ki jagah"),
  "history.cancelButton": m("Cancel bill", "बिल रद्द करें", "Bill radd karein"),

  // ---- Cancel a bill
  "cancel.title": m("Cancel Bill {n}?", "बिल नं. {n} रद्द करें?", "Bill no. {n} radd karein?"),
  "cancel.note": m("The bill stays in History, marked Cancelled. Its number is not used again. This cannot be undone.", "बिल पुराने बिलों में रहेगा, ‘रद्द’ लिखा हुआ। उसका नंबर दोबारा इस्तेमाल नहीं होगा। इसे वापस नहीं किया जा सकता।", "Bill purane bills mein rahega, ‘radd’ likha hua. Uska number dobara istemaal nahi hoga. Ise wapas nahi kiya ja sakta."),
  "cancel.reasonLabel": m("Reason", "कारण", "Karan"),
  "cancel.wrongItem": m("Wrong item", "गलत सामान", "Galat saaman"),
  "cancel.wrongPrice": m("Wrong price", "गलत भाव", "Galat bhav"),
  "cancel.wrongQuantity": m("Wrong quantity", "गलत मात्रा", "Galat matra"),
  "cancel.customerCancelled": m("Customer cancelled", "ग्राहक ने मना किया", "Grahak ne mana kiya"),
  "cancel.other": m("Other", "कुछ और", "Kuch aur"),
  "cancel.inProgress": m("A bill is in progress — finish it or clear it first to make the new bill.", "एक बिल बन रहा है — नया बिल बनाने के लिए पहले उसे पूरा करें या हटा दें।", "Ek bill ban raha hai — naya bill banane ke liye pehle use poora karein ya hata dein."),
  "cancel.andNew": m("Cancel & make corrected bill", "रद्द करें और सही बिल बनाएं", "Radd karein aur sahi bill banayein"),
  "cancel.only": m("Cancel only", "सिर्फ़ रद्द करें", "Sirf radd karein"),
  "cancel.keep": m("Keep Bill {n}", "बिल नं. {n} रहने दें", "Bill no. {n} rehne dein"),
  // KB-414 step 2: 25-CancelBill's card - hard rule 2 (a saved bill is never edited) in the shopkeeper's words
  "cancel.whyNotTitle": m("Why not just edit?", "सीधे बदल क्यों नहीं सकते?", "Seedhe badal kyon nahi sakte?"),
  "cancel.whyNotEdit": m("Saved bills are never changed quietly — your records always match what the customer got.", "सेव हुए बिल चुपचाप कभी नहीं बदलते — आपका हिसाब हमेशा वही रहता है जो ग्राहक को मिला।", "Save hue bill chupchaap kabhi nahi badalte — aapka hisaab hamesha wahi rehta hai jo grahak ko mila."),
  "cancel.failed": m("Couldn't cancel the bill — try again", "बिल रद्द नहीं हो पाया — फिर कोशिश करें", "Bill radd nahi ho paaya — phir koshish karein"),
  "cancel.notSaved": m("Only a saved bill can be cancelled", "सिर्फ़ सेव हुआ बिल ही रद्द हो सकता है", "Sirf save hua bill hi radd ho sakta hai"),
  "cancel.already": m("This bill is already cancelled", "यह बिल पहले ही रद्द हो चुका है", "Yeh bill pehle hi radd ho chuka hai"),
  "cancel.chooseReason": m("Choose a reason", "कारण चुनें", "Karan chunein"),
  "cancel.notHere": m("That bill isn't on this phone", "वह बिल इस फ़ोन में नहीं है", "Woh bill is phone mein nahi hai"),

  // ---- Catalog
  "catalog.all": m("All", "सभी", "Sabhi"),
  "catalog.custom": m("Custom", "अपने जोड़े", "Apne jode"),
  "catalog.learned": m("Learned", "सीखे हुए", "Seekhe hue"),
  "catalog.base": m("From base catalog", "तैयार सूची से", "Taiyaar list se"),
  "catalog.archived": m("Archived", "आर्काइव", "Archived"),
  "catalog.show": m("Show", "दिखाएं", "Dikhayein"),
  "catalog.offline": m("Needs internet to change the catalog", "सूची बदलने के लिए इंटरनेट चाहिए", "List badalne ke liye internet chahiye"),
  "catalog.saveFailed": m("Couldn't save — check the internet and try again", "सेव नहीं हो पाया — इंटरनेट देखें और फिर कोशिश करें", "Save nahi ho paaya — internet dekhein aur phir koshish karein"),
  "catalog.usedOnce30": m("Used once in the last 30 days", "पिछले 30 दिनों में एक बार बिका", "Pichhle 30 dinon mein ek baar bika"),
  "catalog.usedMany30": m("Used {n} times in the last 30 days", "पिछले 30 दिनों में {n} बार बिका", "Pichhle 30 dinon mein {n} baar bika"),
  "catalog.notUsed": m("Not used yet", "अभी तक नहीं बिका", "Abhi tak nahi bika"),
  "catalog.usedOnce": m("Used once", "एक बार बिका", "Ek baar bika"),
  "catalog.usedMany": m("Used {n} times", "{n} बार बिका", "{n} baar bika"),
  // KB-414 step 3 (owner, 17 Nov 2026): 16's own search words
  "catalog.searchPlaceholder": m("Search items or what customers say", "सामान या ग्राहक जो बोलते हैं, खोजें", "Saamaan ya grahak jo bolte hain, khojein"),
  "catalog.addReady": m("Add from ready catalog", "तैयार सूची से जोड़ें", "Taiyaar list se jodein"),
  "catalog.import": m("Import from file", "फ़ाइल से लाएं", "File se laayein"),
  "catalog.hideFailed": m("Couldn't hide that suggestion — try again", "यह सुझाव छिपा नहीं पाए — फिर कोशिश करें", "Yeh sujhaav chhipa nahi paaye — phir koshish karein"),
  "catalog.learnedNames": m("Learned names", "सीखे हुए नाम", "Seekhe hue naam"),
  "catalog.learnedRow": m("“{alias}” → {name} · {state} ({pct}%)", "“{alias}” → {name} · {state} ({pct}%)", "“{alias}” → {name} · {state} ({pct}%)"),
  "catalog.inUse": m("In use", "इस्तेमाल में", "Istemaal mein"),
  "catalog.stillLearning": m("Still learning", "अभी सीख रहे हैं", "Abhi seekh rahe hain"),
  "catalog.removeLabel": m("Remove “{alias}” ({name})", "“{alias}” ({name}) हटाएं", "“{alias}” ({name}) hatayein"),
  "catalog.priceDrift": m("{name}: {price} / {unit} on {bills} bills (now {now})", "{name}: {bills} बिलों में {price} / {unit} (अभी {now})", "{name}: {bills} bills mein {price} / {unit} (abhi {now})"),
  "catalog.use": m("Use {price}", "{price} रखें", "{price} rakhein"),
  "catalog.useLabel": m("Use {price} for {name}", "{name} के लिए {price} रखें", "{name} ke liye {price} rakhein"),
  "catalog.ignore": m("Ignore", "छोड़ें", "Chhodein"),
  "catalog.ignoreLabel": m("Ignore the suggestion for {name}", "{name} का सुझाव छोड़ें", "{name} ka sujhaav chhodein"),
  "catalog.provisional": m("“{name}” — said {n} times, not in the catalog", "“{name}” — {n} बार बोला गया, सूची में नहीं है", "“{name}” — {n} baar bola gaya, list mein nahi hai"),
  "catalog.hidden90": m("Suggestion for {name} hidden for 90 days", "{name} का सुझाव 90 दिन के लिए छिपा दिया", "{name} ka sujhaav 90 din ke liye chhipa diya"),
  "catalog.noneArchived": m("No archived products.", "कोई आर्काइव किया सामान नहीं है।", "Koi archive kiya saaman nahi hai."),
  "catalog.noneFound": m("No products found.", "कोई सामान नहीं मिला।", "Koi saaman nahi mila."),
  "catalog.noneOfKind": m("No products of this kind.", "इस तरह का कोई सामान नहीं है।", "Is tarah ka koi saaman nahi hai."),
  "catalog.noneYet": m("No products yet — add them from the ready catalog or import a file.", "अभी कोई सामान नहीं है — तैयार सूची से जोड़ें या फ़ाइल से लाएं।", "Abhi koi saaman nahi hai — taiyaar list se jodein ya file se laayein."),
  "catalog.changedElsewhere": m("Changed on another phone: now {now}", "दूसरे फ़ोन पर बदला गया: अब {now}", "Dusre phone par badla gaya: ab {now}"),
  "catalog.nowArchived": m("archived", "आर्काइव किया गया", "archive kiya gaya"),
  "catalog.saving": m("Saving…", "सेव हो रहा है…", "Save ho raha hai…"),
  "catalog.restore": m("Restore", "वापस लाएं", "Wapas laayein"),
  "catalog.restoreLabel": m("Restore {name}", "{name} वापस लाएं", "{name} wapas laayein"),
  "catalog.editLabel": m("Edit {name}", "{name} बदलें", "{name} badlein"),
  "catalog.archivedNote": m("“{name}” archived", "“{name}” आर्काइव हुआ", "“{name}” archive hua"),
  "catalog.addedNote": m("{name} added — {price}", "{name} जुड़ गया — {price}", "{name} jud gaya — {price}"),

  // ---- Ready catalog
  "ready.title": m("Ready catalog", "तैयार सूची", "Taiyaar list"),
  "ready.products": m("Ready products", "तैयार सामान", "Taiyaar saaman"),
  "ready.search": m("Search ready catalog", "तैयार सूची में खोजें", "Taiyaar list mein khojein"),
  "ready.adding": m("Adding…", "जुड़ रहा है…", "Jud raha hai…"),
  "ready.addLabel": m("Add {name}", "{name} जोड़ें", "{name} jodein"),
  "ready.already": m("{name} is already in your catalog", "{name} आपकी सूची में पहले से है", "{name} aapki list mein pehle se hai"),
  "ready.addFailed": m("Couldn't add — check the internet and try again", "जुड़ नहीं पाया — इंटरनेट देखें और फिर कोशिश करें", "Jud nahi paaya — internet dekhein aur phir koshish karein"),
  "ready.notOnPhone": m("The ready catalog isn't on this phone yet.", "तैयार सूची अभी इस फ़ोन में नहीं आई है।", "Taiyaar list abhi is phone mein nahi aayi hai."),
  "ready.hasAll": m("Your shop already has every product in the ready catalog.", "तैयार सूची का हर सामान आपकी दुकान में पहले से है।", "Taiyaar list ka har saaman aapki dukaan mein pehle se hai."),
  "ready.alreadyQ": m("“{q}” is already in your catalog.", "“{q}” आपकी सूची में पहले से है।", "“{q}” aapki list mein pehle se hai."),
  "ready.noMatch": m("No ready product matches “{q}”. Add it from a bill: Add item → + Add “{q}” as a new product.", "तैयार सूची में “{q}” नहीं मिला। बिल से जोड़ें: सामान जोड़ें → + “{q}” को नया सामान बनाएं।", "Taiyaar list mein “{q}” nahi mila. Bill se jodein: Saaman jodein → + “{q}” ko naya saaman banayein."),

  // ---- Add product / Edit product (and the rules the catalog and the import share)
  // KB-414 step 3: 19's own words (Add item / Edit item)
  "product.editTitle": m("Edit item", "सामान बदलें", "Saaman badlein"),
  "product.name": m("Item name", "सामान का नाम", "Saamaan ka naam"),
  "product.price": m("Price", "भाव", "Bhav"),
  "product.unitPlaceholder": same("kg, gm, liter, ml, piece…"),
  "product.unitUnknown": m("“{unit}” isn't one of {list} — it is saved as typed.", "“{unit}” इनमें से नहीं है: {list} — जैसा लिखा, वैसा ही सेव होगा।", "“{unit}” inmein se nahi hai: {list} — jaisa likha, waisa hi save hoga."),
  "product.archive": m("Archive", "आर्काइव करें", "Archive karein"),
  "product.archiveLabel": m("Archive product", "सामान आर्काइव करें", "Saaman archive karein"),
  "product.keepName": m("Keep as another name", "दूसरे नाम के रूप में रखें", "Doosre naam ke roop mein rakhein"),
  "product.keepNameLabel": m("Keep “{name}” as another name", "“{name}” को दूसरे नाम के रूप में रखें", "“{name}” ko doosre naam ke roop mein rakhein"),
  "product.otherNames": m("Other names customers say", "ग्राहक जो दूसरे नाम बोलते हैं", "Grahak jo doosre naam bolte hain"),
  // KB-414 step 3 (owner + reviewer, 17 Nov 2026): Items (16), the "+ Add" sheet, "From your bills", Add / Edit item (19)
  // KB-414 step 4 (owner + reviewer, 18 Nov 2026): More (17) and its inner pages, Bill design (21)
  "more.editShop": m("Edit shop details", "दुकान की जानकारी बदलें", "Dukaan ki jaankari badlein"),
  "more.billing": m("Billing", "बिलिंग", "Billing"),
  "more.app": m("App", "ऐप", "App"),
  "more.billDesign": m("Bill design", "बिल का डिज़ाइन", "Bill ka design"),
  "more.receiptIn": m("Receipt in {lang}", "रसीद {lang} में", "Receipt {lang} mein"),
  "more.items": m("Items & prices", "सामान और भाव", "Saamaan aur bhav"),
  "more.itemOne": m("1 item", "1 सामान", "1 saamaan"),
  "more.itemMany": m("{n} items", "{n} सामान", "{n} saamaan"),
  "more.appLanguage": m("App language", "ऐप की भाषा", "App ki bhasha"),
  "more.sync": m("Sync", "सिंक", "Sync"),
  "more.synced": m("Synced", "सिंक हो गया", "Sync ho gaya"),
  "more.waitingOne": m("1 bill waiting to sync", "1 बिल सिंक होना बाकी", "1 bill sync hona baaki"),
  "more.waitingMany": m("{n} bills waiting to sync", "{n} बिल सिंक होने बाकी", "{n} bill sync hone baaki"),
  "more.privacy": m("Privacy", "गोपनीयता", "Privacy"),
  "more.preview": m("Receipt preview", "रसीद का नमूना", "Receipt ka namoona"),
  "more.namesOnBill": m("Item names on bill", "बिल पर सामान के नाम", "Bill par saamaan ke naam"),
  // the truth (owner + reviewer, 18 Nov 2026; pinned by itemNamesOnBill.test.tsx): a voice line keeps the name SAID (D102, the V3 path
  // useVoiceOrders); Add item puts the item's name from the shop's items
  "more.namesAsSaid": m("As you said them", "जैसे आपने बोले", "Jaise aapne bole"),
  "more.namesHelp": m(
    "Voice orders print the name you said. Items you add by hand print the name from your items.",
    "बोलकर दिए ऑर्डर में वही नाम छपता है जो आपने बोला। हाथ से जोड़े सामान पर आपकी सूची वाला नाम छपता है।",
    "Bolkar diye order mein wahi naam chhapta hai jo aapne bola. Haath se jode saamaan par aapki list wala naam chhapta hai.",
  ),
  "items.all": m("All {n}", "सब {n}", "Sab {n}"),
  "items.fromBills": m("From your bills", "आपके बिलों से", "Aapke bills se"),
  "items.pricesOne": m("1 price to check", "1 भाव देखना है", "1 bhav dekhna hai"),
  "items.pricesMany": m("{n} prices to check", "{n} भाव देखने हैं", "{n} bhav dekhne hain"),
  "items.newNameOne": m("1 new name", "1 नया नाम", "1 naya naam"),
  "items.newNameMany": m("{n} new names", "{n} नए नाम", "{n} naye naam"),
  "items.learnedOne": m("1 learned name", "1 सीखा हुआ नाम", "1 seekha hua naam"),
  "items.learnedMany": m("{n} learned names", "{n} सीखे हुए नाम", "{n} seekhe hue naam"),
  "items.pricesHead": m("Prices you charged", "आपने जो भाव लिए", "Aapne jo bhav liye"),
  "items.saidHead": m("Said, not in your items", "बोला गया, आपके सामान में नहीं", "Bola gaya, aapke saamaan mein nahi"),
  "items.nothing": m("Nothing to check right now.", "अभी देखने को कुछ नहीं है।", "Abhi dekhne ko kuch nahi hai."),
  "items.addTitle": m("Add items", "सामान जोड़ें", "Saamaan jodein"),
  "items.newItem": m("New item", "नया सामान", "Naya saamaan"),
  "items.newItemSub": m("Type its name, unit and price", "नाम, इकाई और भाव लिखें", "Naam, ikai aur bhav likhein"),
  "items.readySub": m("Pick from common kirana items", "आम किराना सामान में से चुनें", "Aam kirana saamaan mein se chunein"),
  "items.importSub": m("A list from Excel or a CSV file", "Excel या CSV फ़ाइल से सूची", "Excel ya CSV file se list"),
  "items.otherNamesHelp": m("Helps the app match what you say to this item.", "इससे ऐप आपकी बोली बात को इस सामान से मिलाता है।", "Isse app aapki boli baat ko is saamaan se milata hai."),
  "items.addName": m("Add name", "नाम जोड़ें", "Naam jodein"),
  "items.otherName": m("Other name", "दूसरा नाम", "Doosra naam"),
  "items.soldBy": m("Sold by", "किसमें बिकता है", "Kismein bikta hai"),
  "items.otherUnit": m("Other…", "दूसरा…", "Doosra…"),
  "items.pricePer": m("Price per {unit}", "प्रति {unit} भाव", "Per {unit} bhav"),
  "items.perUnit": m("per {unit}", "प्रति {unit}", "per {unit}"),
  "items.priceHelp": m("Fills in when you don’t say a price.", "जब आप भाव नहीं बोलते, यह भर जाता है।", "Jab aap bhav nahi bolte, yeh bhar jaata hai."),
  "items.save": m("Save item", "सामान सेव करें", "Saamaan save karein"),
  "items.learned": m("learned", "सीखा", "seekha"),
  // KB-414 step 3 phone check (owner + reviewer, 17 Nov 2026): the Learned chip shows the learned names. The empty text says how learning
  // really happens (domain/learning.ts learnBillLessons): a SAVED bill's VOICE lines teach the names said; typed lines never do.
  "items.learnedHead": m("Names learned from your bills", "आपके बिलों से सीखे नाम", "Aapke bills se seekhe naam"),
  "items.learnedItems": m("Items added from your bills", "आपके बिलों से जोड़ा गया सामान", "Aapke bills se joda gaya saamaan"),
  "items.learnedEmptyTitle": m("Nothing learned yet", "अभी कुछ नहीं सीखा", "Abhi kuch nahi seekha"),
  "items.learnedEmpty": m(
    "When you save a bill made by voice, the app learns the names you said for your items, like “cheeni” → चीनी. They show here, and you can remove any of them.",
    "जब आप आवाज़ से बना बिल सेव करते हैं, ऐप आपके बोले गए नाम सीखता है, जैसे “cheeni” → चीनी। वे यहाँ दिखते हैं, और आप कोई भी हटा सकते हैं।",
    "Jab aap awaaz se bana bill save karte hain, app aapke bole gaye naam seekhta hai, jaise “cheeni” → चीनी. Woh yahan dikhte hain, aur aap koi bhi hata sakte hain.",
  ),
  "product.notSaved": m("These will not be saved:", "ये सेव नहीं होंगे:", "Yeh save nahi honge:"),
  "product.notSavedLabel": m("Not saved", "सेव नहीं होंगे", "Save nahi honge"),
  "product.unitFixed": m("Unit: {unit}. A unit can't be changed here — it decides what the price means. To change it, archive this product and add it again with the right unit.", "इकाई: {unit}। यहाँ इकाई नहीं बदली जा सकती — भाव का मतलब उसी से तय होता है। बदलने के लिए इस सामान को आर्काइव करें और सही इकाई के साथ फिर जोड़ें।", "Unit: {unit}. Yahan unit nahi badli ja sakti — bhav ka matlab usi se tay hota hai. Badalne ke liye is saaman ko archive karein aur sahi unit ke saath phir jodein."),
  "product.aliasRow": same("“{alias}” — {why}"),
  "product.nameNeeded": m("Name needed", "नाम चाहिए", "Naam chahiye"),
  "product.nameLong": m("Name is longer than {max} characters", "नाम {max} अक्षरों से लंबा है", "Naam {max} akshar se lamba hai"),
  "product.dup": m("Another product is already called “{name}”", "“{name}” नाम का दूसरा सामान पहले से है", "“{name}” naam ka doosra saaman pehle se hai"),
  "product.dupArchived": m("Another product is already called “{name}” (archived)", "“{name}” नाम का दूसरा सामान पहले से है (आर्काइव में)", "“{name}” naam ka doosra saaman pehle se hai (archive mein)"),
  "product.lostNote": m("“{name}” will stop matching when spoken.", "बोलने पर “{name}” अब नहीं मिलेगा।", "Bolne par “{name}” ab nahi milega."),
  "product.catalogFull": m("The catalog holds at most {max} products", "सूची में ज़्यादा से ज़्यादा {max} सामान आ सकते हैं", "List mein zyada se zyada {max} saaman aa sakte hain"),
  "product.unitNeeded": m("Unit needed", "इकाई चाहिए", "Unit chahiye"),
  "product.unitLong": m("Unit is longer than {max} characters", "इकाई {max} अक्षरों से लंबी है", "Unit {max} akshar se lambi hai"),
  "product.aliasShort": m("shorter than {min} characters", "{min} अक्षर से छोटा है", "{min} akshar se chhota hai"),
  "product.aliasLong": m("longer than {max} characters", "{max} अक्षर से लंबा है", "{max} akshar se lamba hai"),
  "product.aliasTaken": m("same as another product's name or alias", "किसी दूसरे सामान के नाम जैसा ही है", "Kisi doosre saaman ke naam jaisa hi hai"),

    "import.priceUnclear": m("Price unclear — use digits like 45 or 1,250.50", "भाव साफ़ नहीं है — 45 या 1,250.50 जैसे अंक डालें", "Bhav saaf nahi hai — 45 ya 1,250.50 jaise ank daalein"),

  // ---- First-time shop set-up and the shop-load error
  // KB-415 (owner + reviewer, 18 Nov 2026): the first-time flow - splash (01), onboarding 1-3 (02-04), sign in (05), shop setup (06)
  "welcome.tagline1": m("Speak the order.", "ऑर्डर बोलिए।", "Order boliye."),
  "welcome.tagline2": m("Get the bill.", "बिल पाइए।", "Bill paiye."),
  "welcome.chipLang": m("Hindi · Hinglish", "हिन्दी · Hinglish", "Hindi · Hinglish"),
  "welcome.start": m("Get started", "शुरू करें", "Shuru karein"),
  "welcome.madeFor": m("Made for kirana shops in India", "भारत की किराना दुकानों के लिए बना", "Bharat ki kirana dukaanon ke liye bana"),
  "welcome.step": m("{n} of 3", "3 में से {n}", "{n} of 3"),
  "welcome.skip": m("Skip", "छोड़ें", "Skip karein"),
  "welcome.next": m("Next", "आगे", "Aage"),
  "onb1.youSay": m("You say", "आप बोलते हैं", "Aap bolte hain"),
  "onb1.title": m("Speak the whole order", "पूरा ऑर्डर बोलिए", "Poora order boliye"),
  "onb1.text": m("Say items, quantity and price in Hindi or Hinglish — just like you tell a customer.", "सामान, मात्रा और भाव हिन्दी या Hinglish में बोलिए — जैसे ग्राहक को बताते हैं।", "Saamaan, maatra aur bhav Hindi ya Hinglish mein boliye — jaise customer ko batate hain."),
  "onb2.title": m("Get a clear bill", "साफ़ बिल पाइए", "Saaf bill paiye"),
  "onb2.text": m("Check it in seconds, then print on your Bluetooth printer or send it on WhatsApp.", "पल में जाँचिए, फिर ब्लूटूथ प्रिंटर पर छापिए या WhatsApp पर भेजिए।", "Pal mein jaanchiye, phir Bluetooth printer par chhapiye ya WhatsApp par bhejiye."),
  // default 7: printing only in the Android app - in a browser the sentence leaves it out
  "onb2.textWeb": m("Check it in seconds, then send it on WhatsApp.", "पल में जाँचिए, फिर WhatsApp पर भेजिए।", "Pal mein jaanchiye, phir WhatsApp par bhejiye."),
  "onb2.print": m("Print", "प्रिंट", "Print"),
  // default 2: the learning engine's true words (26 §0b item 3) - never "Say a price once" / "remembered"
  "onb3.title": m("It learns your prices", "यह आपके भाव सीखता है", "Yeh aapke bhav seekhta hai"),
  "onb3.said": m("On a few bills you said", "कुछ बिलों में आपने कहा", "Kuch bills mein aapne kaha"),
  "onb3.approve": m("Approve once", "एक बार मंज़ूर करें", "Ek baar manzoor karein"),
  "onb3.next": m("Next time, just say", "अगली बार बस बोलिए", "Agli baar bas boliye"), // + the order as said, “2 किलो चीनी”
  "onb3.price": m("Your price ₹45/kg", "आपका भाव ₹45/kg", "Aapka bhav ₹45/kg"),
  "signin.title": m("Sign in to your shop", "अपनी दुकान में साइन इन करें", "Apni dukaan mein sign in karein"),
  "signin.sub": m("One tap. No password to remember.", "एक टैप। कोई पासवर्ड याद नहीं रखना।", "Ek tap. Koi password yaad nahi rakhna."),
  "signin.speak": m("Speak", "बोलें", "Bolein"),
  "signin.trust1": m("Bills saved safely to your shop", "बिल आपकी दुकान में सुरक्षित सेव", "Bill aapki dukaan mein surakshit save"),
  "signin.trust2": m("Bill from more than one phone", "एक से ज़्यादा फ़ोन से बिल बनाएं", "Ek se zyada phone se bill banayein"),
  "signin.trust3": m("We never post to your Google account", "हम आपके Google खाते पर कभी कुछ पोस्ट नहीं करते", "Hum aapke Google account par kabhi kuch post nahi karte"),
  "signin.privacy": m("Privacy policy", "गोपनीयता नीति", "Privacy policy"),
  "onboard.almost": m("Almost done", "बस हो गया", "Bas ho gaya"),
  "onboard.phoneLabel": m("Phone", "फ़ोन", "Phone"),
  "onboard.phoneNote": m("· optional, printed on bills", "· ज़रूरी नहीं, बिल पर छपता है", "· zaroori nahi, bill par chhapta hai"),
  "onboard.preview": m("Your bill will look like this", "आपका बिल ऐसा दिखेगा", "Aapka bill aisa dikhega"),
  "onboard.yourShop": m("Your shop", "आपकी दुकान", "Aapki dukaan"),
  "onboard.title": m("Set up your shop", "अपनी दुकान सेट करें", "Apni dukaan set karein"),
  "onboard.question": m("Ready catalog, or start empty?", "तैयार सूची लें, या खाली शुरू करें?", "Taiyaar list lein, ya khaali shuru karein?"),
  "onboard.ready": m("Use ready catalog", "तैयार सूची लें", "Taiyaar list lein"),
  "onboard.empty": m("Start empty", "खाली शुरू करें", "Khaali shuru karein"),
  "onboard.offline": m("Setting up a shop needs an internet connection.", "दुकान सेट करने के लिए इंटरनेट चाहिए।", "Dukaan set karne ke liye internet chahiye."),
  "app.serverDown": m("Couldn't reach the server", "सर्वर से जुड़ नहीं पाए", "Server se connect nahi ho paaya"),
  "app.loading": m("Loading…", "खुल रहा है…", "Khul raha hai…"),

  // ---- Spoken commands (KB-339, D86): the one-line answers; "Bill Banao" stays exactly as it is
  "cmd.finish": m("Tap Bill Banao to finish", "खत्म करने के लिए Bill Banao दबाएं", "Khatam karne ke liye Bill Banao dabayein"),
  // KB-414 step 1: the ≡ menu is gone - Clear bill is the text button under the items
  "cmd.clear": m("To clear the whole bill, tap Clear bill under the items", "पूरा बिल हटाने के लिए सामान के नीचे बिल हटाएं दबाएं", "Poora bill hatane ke liye saamaan ke neeche Bill hatayein dabayein"),
  "cmd.nothing": m("Nothing to remove", "हटाने के लिए कुछ नहीं है", "Hatane ke liye kuch nahi hai"),
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
