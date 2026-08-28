// PRODUCTS DATABASE
// MERGED: All items from all versions combined.
// Edit prices as per your shop. Add/remove items freely.
// Every product has multiple Hindi + English name variants for better voice recognition.

const PRODUCTS = [

  // ══════════════════════════════════
  // ATTA / GRAINS / FLOUR
  // ══════════════════════════════════
  { id:1,   names:["gehun","gehu","wheat","आटा","गेहूं","गेहुं","गेहू"], displayName:"गेहूं", unit:"kg", price:32 },
  { id:2,   names:["chakki aata","chakki fresh","chakki ka aata","fresh aata","पिसा आटा","चक्की आटा","aata","atta","wheat flour","gehu atta"], displayName:"Chakki Aata", unit:"kg", price:38 },
  { id:3,   names:["maida","refined flour","all purpose flour","मैदा","मेदा"], displayName:"Maida", unit:"kg", price:42 },
  { id:4,   names:["besan","gram flour","chana flour","chickpea flour","बेसन","चने का आटा"], displayName:"Besan", unit:"kg", price:90 },
  { id:5,   names:["suji","sooji","rava","semolina","ravva","रवा","सूजी"], displayName:"Suji", unit:"kg", price:40 },
  { id:6,   names:["makki atta","corn flour","makka atta","cornflour","maize flour","मक्का आटा","मक्की आटा"], displayName:"Makki Atta", unit:"kg", price:30 },
  { id:7,   names:["bajra","bajra flour","pearl millet","बाजरा","बाजरे का आटा","bajara"], displayName:"Bajra Atta", unit:"kg", price:28 },
  { id:8,   names:["jowar","jowar atta","sorghum","ज्वार","ज्वार का आटा","jawar"], displayName:"Jowar Atta", unit:"kg", price:28 },
  { id:9,   names:["ragi","ragi flour","finger millet","nachni","रागी","नाचनी"], displayName:"Ragi Atta", unit:"kg", price:55 },
  { id:10,  names:["sattu","roasted gram flour","सत्तु","सत्तू"], displayName:"Sattu", unit:"kg", price:70 },

  // ══════════════════════════════════
  // RICE / CHAWAL
  // ══════════════════════════════════
  { id:11,  names:["chawal","rice","चावल","सफेद चावल"], displayName:"Chawal", unit:"kg", price:50 },
  { id:12,  names:["basmati","basmati rice","basmati chawal","long grain rice","बासमती","बासमती चावल"], displayName:"Basmati", unit:"kg", price:90 },
  { id:13,  names:["sella rice","sella chawal","parboiled rice","ukda chawal","सेला चावल","उकड़ा चावल"], displayName:"Sella Chawal", unit:"kg", price:55 },
  { id:14,  names:["poha","chivda","flat rice","beaten rice","flattened rice","पोहा","चिवड़ा"], displayName:"Poha", unit:"kg", price:45 },
  { id:15,  names:["murmura","murmure","puffed rice","laai","मुरमुरे","लाई"], displayName:"Murmura", unit:"kg", price:30 },

  // ══════════════════════════════════
  // DALS / PULSES / LEGUMES
  // ══════════════════════════════════
  { id:16,  names:["daal","dal","dhal","lentils","दाल"], displayName:"Toor Daal", unit:"kg", price:90 },
  { id:17,  names:["arhar daal","tur daal","tuvar dal","toor dal","pigeon pea","अरहर दाल","तुअर दाल","तूर दाल"], displayName:"Arhar Daal", unit:"kg", price:140 },
  { id:18,  names:["moong daal","moong dal","green moong","split green gram","मूंग दाल","मूंग की दाल"], displayName:"Moong Daal", unit:"kg", price:110 },
  { id:19,  names:["masoor daal","masoor dal","red lentil","pink lentil","मसूर दाल","मसूर की दाल"], displayName:"Masoor Daal", unit:"kg", price:90 },
  { id:20,  names:["urad daal","urad dal","black gram","white lentil","उड़द दाल","उरद दाल","udad daal"], displayName:"Urad Daal", unit:"kg", price:100 },
  { id:21,  names:["chana daal","chana dal","split chickpea","bengal gram","चना दाल","चने की दाल"], displayName:"Chana Daal", unit:"kg", price:80 },
  { id:22,  names:["rajma","kidney beans","red beans","राजमा","राजमाह"], displayName:"Rajma", unit:"kg", price:120 },
  { id:23,  names:["chhole","kabuli chana","chole","chickpea","white chana","छोले","काबुली चना","चने"], displayName:"Kabuli Chana", unit:"kg", price:100 },
  { id:24,  names:["kala chana","black chana","desi chana","brown chickpea","काला चना","देसी चना","chana","चना"], displayName:"Kala Chana", unit:"kg", price:80 },
  { id:25,  names:["lobiya","black eyed peas","cow pea","लोबिया"], displayName:"Lobiya", unit:"kg", price:85 },
  { id:26,  names:["matki","moth beans","turkish gram","मटकी","मोठ"], displayName:"Matki", unit:"kg", price:90 },

  // ══════════════════════════════════
  // SUGAR / SALT / JAGGERY
  // ══════════════════════════════════
  { id:27,  names:["chini","cheeni","sugar","shakkar","white sugar","चीनी","शक्कर"], displayName:"Chini", unit:"kg", price:45 },
  { id:28,  names:["bura","bura sugar","powdered sugar","pisi cheeni","icing sugar","पिसी चीनी","बूरा"], displayName:"Bura", unit:"kg", price:50 },
  { id:29,  names:["namak","salt","common salt","table salt","नमक"], displayName:"Namak", unit:"kg", price:20 },
  { id:30,  names:["sendha namak","rock salt","senda namak","pink salt","सेंधा नमक","सेंधे का नमक"], displayName:"Sendha Namak", unit:"kg", price:35 },
  { id:31,  names:["gud","gur","jaggery","palm jaggery","गुड़","गुड"], displayName:"Gur", unit:"kg", price:55 },
  { id:32,  names:["shakkar","desi shakkar","khandsari","raw sugar","खांडसारी","देशी शक्कर"], displayName:"Desi Shakkar", unit:"kg", price:48 },

  // ══════════════════════════════════
  // OIL / GHEE / VANASPATI
  // ══════════════════════════════════
  { id:33,  names:["tel","oil","cooking oil","तेल","खाना पकाने का तेल"], displayName:"Tel (1L)", unit:"liter", price:130 },
  { id:34,  names:["sarson tel","mustard oil","sarson","kachi ghani","सरसों का तेल","सरसों तेल"], displayName:"Sarson Tel", unit:"liter", price:145 },
  { id:35,  names:["sunflower oil","sunflower tel","surajmukhi tel","सूरजमुखी तेल","सनफ्लावर तेल"], displayName:"Sunflower Tel", unit:"liter", price:135 },
  { id:36,  names:["soya oil","soyabean oil","soya bean oil","soybean oil","सोयाबीन तेल","सोया तेल"], displayName:"Soya Tel", unit:"liter", price:120 },
  { id:37,  names:["groundnut oil","moongfali tel","peanut oil","मूंगफली तेल","मूंगफली का तेल"], displayName:"Moongfali Tel", unit:"liter", price:150 },
  { id:38,  names:["coconut oil","nariyal tel","नारियल तेल","नारियल का तेल"], displayName:"Nariyal Tel", unit:"ml", price:0.15 },
  { id:39,  names:["oil pouch","tel pouch","pouch","small oil","पाउच तेल","छोटा तेल","पाउच"], displayName:"Tel Pouch", unit:"piece", price:25 },
  { id:40,  names:["ghee","desi ghee","pure ghee","cow ghee","घी","देसी घी","गाय का घी"], displayName:"Ghee", unit:"kg", price:550 },
  { id:41,  names:["amul ghee","amul","अमूल घी","अमूल"], displayName:"Amul Ghee", unit:"piece", price:560 },
  { id:42,  names:["vanaspati","dalda","hydrogenated oil","वनस्पति","डालडा"], displayName:"Vanaspati", unit:"kg", price:100 },
  { id:43,  names:["butter","makhan","white butter","मक्खन","बटर"], displayName:"Butter", unit:"piece", price:55 },

  // ══════════════════════════════════
  // MILK / DAIRY
  // ══════════════════════════════════
  { id:44,  names:["doodh","milk","full cream milk","दूध","गाय का दूध"], displayName:"Doodh", unit:"liter", price:56 },
  { id:45,  names:["milk packet","doodh packet","polybag milk","दूध पैकेट","पाउच दूध"], displayName:"Doodh Packet", unit:"piece", price:28 },
  { id:46,  names:["dahi","curd","yogurt","plain yogurt","दही","देसी दही"], displayName:"Dahi", unit:"kg", price:60 },
  { id:47,  names:["paneer","cottage cheese","chenna","पनीर","घर का पनीर"], displayName:"Paneer", unit:"kg", price:360 },
  { id:48,  names:["chhena","chena","fresh cheese","छेना"], displayName:"Chhena", unit:"kg", price:300 },
  { id:49,  names:["condensed milk","milkmaid","sweetened condensed milk","मिल्कमेड","कंडेंस्ड मिल्क"], displayName:"Milkmaid", unit:"piece", price:60 },
  { id:50,  names:["amul milk","toned milk","amul taaza","अमूल दूध","टोन्ड मिल्क"], displayName:"Amul Milk", unit:"piece", price:28 },
  { id:51,  names:["cream","malai","fresh cream","मलाई","क्रीम"], displayName:"Cream", unit:"piece", price:35 },

  // ══════════════════════════════════
  // BISCUITS / COOKIES
  // ══════════════════════════════════
  { id:52,  names:["parle g","parleg","parle-g","parle","paarle","glucose biscuit","पारले जी","पारले","पारले-जी"], displayName:"Parle-G 10", unit:"piece", price:10 },
  { id:53,  names:["parle g 30","parle 30","bada parle","30 wala parle","parle bada","big parle","पारले बड़ा","बड़ा पारले"], displayName:"Parle-G 30", unit:"piece", price:30 },
  { id:54,  names:["parle g 5","5 wala parle","chota parle","parle 5","chhota parle","पारले 5","छोटा पारले"], displayName:"Parle-G 5", unit:"piece", price:5 },
  { id:55,  names:["monaco","monaco biscuit","salted biscuit","मोनाको","क्रेकर"], displayName:"Monaco", unit:"piece", price:10 },
  { id:56,  names:["marie","marie biscuit","marie gold","tea biscuit","मेरी","मेरी गोल्ड"], displayName:"Marie Gold", unit:"piece", price:10 },
  { id:57,  names:["good day","goodday","butter biscuit","गुड डे","गुड-डे"], displayName:"Good Day", unit:"piece", price:30 },
  { id:58,  names:["hide n seek","hide and seek","hide seek","chocolate biscuit","हाइड एन सीक"], displayName:"Hide & Seek", unit:"piece", price:30 },
  { id:59,  names:["bourbon","bourbon biscuit","cream biscuit","बोर्बन","बोर्बॉन"], displayName:"Bourbon", unit:"piece", price:20 },
  { id:60,  names:["tiger","tiger biscuit","tiger glucose","टाइगर","टाइगर बिस्कुट"], displayName:"Tiger", unit:"piece", price:10 },
  { id:61,  names:["50 50","fifty fifty","5050","नमकीन मीठा","पचास पचास"], displayName:"50-50", unit:"piece", price:10 },
  { id:62,  names:["digestive","nutrichoice","oats biscuit","न्यूट्रीचॉइस","डाइजेस्टिव"], displayName:"NutriChoice", unit:"piece", price:30 },
  { id:63,  names:["oreo","oreo biscuit","cream sandwich","ओरियो","ओरेओ"], displayName:"Oreo", unit:"piece", price:20 },
  { id:64,  names:["krackjack","krack jack","sweet salty biscuit","क्रैकजैक","क्रेकजैक"], displayName:"Krackjack", unit:"piece", price:10 },

  // ══════════════════════════════════
  // BREAD / BAKERY
  // ══════════════════════════════════
  { id:65,  names:["bread","double roti","sandwich bread","white bread","ब्रेड","डबल रोटी"], displayName:"Bread", unit:"piece", price:40 },
  { id:66,  names:["brown bread","whole wheat bread","multigrain bread","ब्राउन ब्रेड","मल्टीग्रेन ब्रेड"], displayName:"Brown Bread", unit:"piece", price:45 },
  { id:67,  names:["pav","pao","ladi pav","dinner roll","पाव","लादी पाव"], displayName:"Pav", unit:"piece", price:30 },
  { id:68,  names:["toast","rusk","milk rusk","रस्क","टोस्ट"], displayName:"Rusk", unit:"piece", price:30 },
  { id:69,  names:["cake","small cake","pastry","cup cake","केक","पेस्ट्री"], displayName:"Cake", unit:"piece", price:20 },

  // ══════════════════════════════════
  // SNACKS / NAMKEEN
  // ══════════════════════════════════
  { id:70,  names:["namkeen","mixture","नमकीन","मिक्सचर"], displayName:"Namkeen", unit:"piece", price:20 },
  { id:71,  names:["chips","lays","potato chips","wafers","चिप्स","आलू चिप्स","वेफर्स"], displayName:"Chips", unit:"piece", price:20 },
  { id:72,  names:["kurkure","cornsticks","kurkuri","कुरकुरे","कुरकुरी"], displayName:"Kurkure", unit:"piece", price:20 },
  { id:73,  names:["uncle chips","uncle","अंकल चिप्स"], displayName:"Uncle Chips", unit:"piece", price:20 },
  { id:74,  names:["bingo","bingo chips","bingo mad angles","बिंगो"], displayName:"Bingo", unit:"piece", price:20 },
  { id:75,  names:["haldiram","haldiram namkeen","haldirams","हल्दीराम","हल्दीराम का"], displayName:"Haldiram Namkeen", unit:"piece", price:30 },
  { id:76,  names:["bhujia","bhujiya","sev bhujia","besan bhujia","भुजिया","सेव भुजिया"], displayName:"Bhujia", unit:"kg", price:160 },
  { id:77,  names:["chana jor garam","chanachur","chana jor","चना जोर गरम","चनाचुर"], displayName:"Chana Jor Garam", unit:"piece", price:10 },
  { id:78,  names:["popcorn","pop corn","पॉपकॉर्न","पॉप कॉर्न"], displayName:"Popcorn", unit:"piece", price:20 },
  { id:79,  names:["mathri","mathiya","khasta mathri","मठरी","मठ्ठी"], displayName:"Mathri", unit:"kg", price:160 },
  { id:80,  names:["sev","nylon sev","gathiya","thin sev","सेव","नायलॉन सेव"], displayName:"Sev", unit:"kg", price:120 },

  // ══════════════════════════════════
  // NOODLES / PASTA / INSTANT FOOD
  // ══════════════════════════════════
  { id:81,  names:["maggi","maggi noodles","instant noodles","मैगी","मैगी नूडल्स"], displayName:"Maggi", unit:"piece", price:14 },
  { id:82,  names:["maggi 70","badi maggi","70g maggi","big maggi","मैगी बड़ी","70 ग्राम मैगी"], displayName:"Maggi 70g", unit:"piece", price:14 },
  { id:83,  names:["yippee","yipee","sunfeast yippee","sunfeast noodles","यिप्पी","यिप्पी नूडल्स"], displayName:"Yippee", unit:"piece", price:14 },
  { id:84,  names:["top ramen","top noodles","ramen","टॉप रामेन","रामेन"], displayName:"Top Ramen", unit:"piece", price:14 },
  { id:85,  names:["pasta","macaroni","पास्ता","मैकरोनी"], displayName:"Pasta", unit:"piece", price:40 },
  { id:86,  names:["hakka noodles","noodles packet","chinese noodles","हक्का नूडल्स","चाइनीज नूडल्स"], displayName:"Hakka Noodles", unit:"piece", price:35 },
  { id:87,  names:["vermicelli","sewai","shevai","सेवइयाँ","सेवई","शेवया"], displayName:"Sewai", unit:"piece", price:25 },

  // ══════════════════════════════════
  // TEA / COFFEE / HEALTH DRINKS
  // ══════════════════════════════════
  { id:89,  names:["chai","chai patti","tea","tea leaves","chay","चाय","चाय पत्ती","चाय के पत्ते"], displayName:"Chai Patti", unit:"gm", price:0.5 },
  { id:90,  names:["brooke bond","red label","ब्रुक बॉन्ड","रेड लेबल","ब्रूक बॉन्ड"], displayName:"Red Label Tea", unit:"piece", price:85 },
  { id:91,  names:["taj mahal","tajmahal tea","taj mahal chai","ताज महल","ताजमहल चाय"], displayName:"Taj Mahal Tea", unit:"piece", price:95 },
  { id:92,  names:["taaza","tata tea","tata chai","tata taaza","ताज़ा","टाटा टी"], displayName:"Tata Tea", unit:"piece", price:80 },
  { id:93,  names:["green tea","green chai","tulsi tea","herbal tea","ग्रीन टी","हर्बल टी"], displayName:"Green Tea", unit:"piece", price:90 },
  { id:94,  names:["coffee","nescafe","instant coffee","नेस्कैफे","कॉफी","इंस्टेंट कॉफी"], displayName:"Nescafe", unit:"piece", price:80 },
  { id:95,  names:["bournvita","brown horlicks","chocolate drink","बॉर्नविटा","चॉकलेट ड्रिंक"], displayName:"Bournvita", unit:"piece", price:120 },
  { id:96,  names:["horlicks","health drink","हॉर्लिक्स","हेल्थ ड्रिंक"], displayName:"Horlicks", unit:"piece", price:130 },
  { id:97,  names:["complan","growth drink","कॉम्प्लान"], displayName:"Complan", unit:"piece", price:120 },
  { id:98,  names:["boost","chocolate malt","बूस्ट","चॉकलेट माल्ट"], displayName:"Boost", unit:"piece", price:120 },
  { id:99,  names:["ovaltine","malt drink","ओवाल्टाइन","माल्ट ड्रिंक"], displayName:"Ovaltine", unit:"piece", price:110 },

  // ══════════════════════════════════
  // SPICES / MASALA
  // ══════════════════════════════════
  { id:100, names:["mirchi","mirch","lal mirch","red chilli","sabut mirch","लाल मिर्च","मिर्च","साबुत मिर्च"], displayName:"Lal Mirch", unit:"kg", price:200 },
  { id:101, names:["mirchi powder","red chilli powder","pisi lal mirch","पिसी मिर्च","मिर्च पाउडर"], displayName:"Mirchi Powder", unit:"kg", price:220 },
  { id:102, names:["haldi","turmeric","haldi powder","हल्दी","पीली मिर्च","हल्दी पाउडर"], displayName:"Haldi", unit:"kg", price:180 },
  { id:103, names:["dhaniya","coriander","coriander powder","dhania","dhaniya powder","धनिया","धनिया पाउडर"], displayName:"Dhaniya Powder", unit:"kg", price:120 },
  { id:104, names:["jeera","jira","jheera","cumin","cumin seeds","sabut jeera","साबुत जीरा","जीरा","जीरे","jara","जरा","जारा","ज़ारा"], displayName:"Jeera", unit:"kg", price:400 },
  { id:105, names:["garam masala","garammasala","mixed spices","masala","गरम मसाला","मसाला"], displayName:"Garam Masala", unit:"piece", price:30 },
  { id:106, names:["chole masala","chana masala","छोले मसाला","चना मसाला"], displayName:"Chole Masala", unit:"piece", price:25 },
  { id:107, names:["sabzi masala","subzi masala","vegetable masala","सब्जी मसाला","वेजिटेबल मसाला"], displayName:"Sabzi Masala", unit:"piece", price:25 },
  { id:108, names:["rajma masala","kidney bean masala","राजमा मसाला"], displayName:"Rajma Masala", unit:"piece", price:25 },
  { id:109, names:["pav bhaji masala","pavbhaji","pavbhaji masala","पाव भाजी मसाला","पावभाजी मसाला"], displayName:"Pav Bhaji Masala", unit:"piece", price:25 },
  { id:110, names:["biryani masala","chicken biryani masala","बिरयानी मसाला","बिरयानी"], displayName:"Biryani Masala", unit:"piece", price:30 },
  { id:111, names:["hing","asafoetida","heeng","हींग","हिंग"], displayName:"Hing", unit:"gm", price:2 },
  { id:112, names:["tejpatta","bay leaf","tej patta","तेजपत्ता","तेजपत"], displayName:"Tejpatta", unit:"piece", price:10 },
  { id:113, names:["elaichi","cardamom","green cardamom","choti elaichi","इलायची","छोटी इलायची"], displayName:"Elaichi", unit:"gm", price:3 },
  { id:114, names:["laung","clove","sabut laung","लौंग","लवंग"], displayName:"Laung", unit:"gm", price:1.5 },
  { id:115, names:["dalchini","cinnamon","दालचीनी","तज"], displayName:"Dalchini", unit:"gm", price:1 },
  { id:116, names:["kali mirch","kalimirch","kali much","kali mirchi","kalimich","black pepper","pepper","काली मिर्च","कालीमिर्च"], displayName:"Kali Mirch", unit:"gm", price:1 },
  { id:117, names:["ajwain","ajvayan","ajvayn","carom seeds","bishop's weed","अजवाइन","अजवाईन"], displayName:"Ajwain", unit:"gm", price:0.5 },
  { id:118, names:["methi dana","fenugreek seeds","methi","मेथी दाना","मेथी"], displayName:"Methi Dana", unit:"gm", price:0.4 },
  { id:119, names:["saunf","saof","sauf","souf","souff","sof","soff","sonf","sanuf","fennel","fennel seeds","variyali","सौंफ","सौंफ़"], displayName:"Saunf", unit:"gm", price:0.4 },
  { id:120, names:["kalonji","nigella","black cumin","कलौंजी","कलोंजी"], displayName:"Kalonji", unit:"gm", price:0.6 },
  { id:121, names:["amchur","dry mango powder","amchoor","अमचूर","खट्टा पाउडर"], displayName:"Amchur", unit:"gm", price:0.8 },
  { id:122, names:["chaat masala","chat masala","snack masala","चाट मसाला"], displayName:"Chaat Masala", unit:"piece", price:25 },
  { id:123, names:["sambhar masala","sambar masala","सांभर मसाला","सांभर"], displayName:"Sambhar Masala", unit:"piece", price:25 },
  { id:124, names:["kitchen king","kitchen king masala","किचन किंग","किचेन किंग"], displayName:"Kitchen King", unit:"piece", price:30 },
  { id:125, names:["everest","everest masala","एवरेस्ट","एवरेस्ट मसाला"], displayName:"Everest Masala", unit:"piece", price:30 },
  { id:126, names:["mdh","mdh masala","एमडीएच","एमडीएच मसाला"], displayName:"MDH Masala", unit:"piece", price:30 },

  // ══════════════════════════════════
  // SAUCE / KETCHUP / PICKLES / PAPAD
  // ══════════════════════════════════
  { id:127, names:["tomato ketchup","tomato sauce","ketchup","टमाटर सॉस","केचप","टमाटर केचप"], displayName:"Tomato Ketchup", unit:"piece", price:80 },
  { id:128, names:["maggi ketchup","maggi sauce","मैगी केचप","मैगी सॉस"], displayName:"Maggi Ketchup", unit:"piece", price:80 },
  { id:129, names:["soya sauce","soy sauce","dark soy","सोया सॉस"], displayName:"Soya Sauce", unit:"piece", price:40 },
  { id:130, names:["chilli sauce","chili sauce","green chilli sauce","चिली सॉस","हरी मिर्च सॉस"], displayName:"Chilli Sauce", unit:"piece", price:40 },
  { id:131, names:["vinegar","sirka","white vinegar","सिरका"], displayName:"Sirka", unit:"piece", price:25 },
  { id:132, names:["achar","pickle","mixed pickle","अचार","मिला जुला अचार"], displayName:"Achar", unit:"piece", price:60 },
  { id:133, names:["mango achar","aam ka achar","aam achar","आम का अचार","आम अचार"], displayName:"Aam Achar", unit:"piece", price:60 },
  { id:134, names:["mixed achar","mix pickle","मिक्स अचार","मिक्स पिकल"], displayName:"Mix Achar", unit:"piece", price:60 },
  { id:135, names:["papad","pappad","papadum","roasted papad","पापड़","पापड"], displayName:"Papad", unit:"piece", price:30 },
  { id:136, names:["lijjat papad","lijjat","लिज्जत","लिज्जत पापड़"], displayName:"Lijjat Papad", unit:"piece", price:30 },
  { id:137, names:["jam","fruit jam","mixed fruit jam","jelly","जैम","फ्रूट जैम"], displayName:"Jam", unit:"piece", price:70 },
  { id:138, names:["peanut butter","moongfali butter","मूंगफली बटर","पीनट बटर"], displayName:"Peanut Butter", unit:"piece", price:120 },

  // ══════════════════════════════════
  // SWEETS / CANDY / CHOCOLATE
  // ══════════════════════════════════
  { id:139, names:["toffee","candy","lollipop","5 wali","5 ka","टॉफी","कैंडी"], displayName:"Toffee", unit:"piece", price:1 },
  { id:140, names:["5 star","five star","fivestar","5star","फाइव स्टार","5 स्टार"], displayName:"5 Star", unit:"piece", price:10 },
  { id:141, names:["kit kat","kitkat","chocolate wafer","किटकैट","किट-कैट"], displayName:"KitKat", unit:"piece", price:20 },
  { id:142, names:["dairy milk","dairymilk","cadbury","milk chocolate","डेयरी मिल्क","कैडबरी"], displayName:"Dairy Milk", unit:"piece", price:20 },
  { id:143, names:["eclairs","eclair","toffee eclairs","एक्लेयर्स","एक्लेयर"], displayName:"Eclairs", unit:"piece", price:1 },
  { id:144, names:["mango bite","mango candy","mango toffee","मैंगो बाइट","मैंगो कैंडी"], displayName:"Mango Bite", unit:"piece", price:1 },
  { id:145, names:["alpenliebe","alpenlibe","caramel candy","अल्पेनलीबे","कैरामेल टॉफी"], displayName:"Alpenliebe", unit:"piece", price:1 },
  { id:146, names:["chewing gum","gum","bubblegum","च्युइंग गम","बबलगम"], displayName:"Chewing Gum", unit:"piece", price:5 },
  { id:147, names:["polo","polo mint","mint candy","पोलो","पोलो मिंट"], displayName:"Polo", unit:"piece", price:5 },
  { id:148, names:["hajmola","digestive candy","हाजमोला"], displayName:"Hajmola", unit:"piece", price:5 },

  // ══════════════════════════════════
  // COLD DRINKS / BEVERAGES
  // ══════════════════════════════════
  { id:149, names:["cold drink","colddrink","soft drink","botal","ठंडा","बोतल","सॉफ्ट ड्रिंक"], displayName:"Cold Drink", unit:"piece", price:40 },
  { id:150, names:["coca cola","coke","pepsi","cola","कोक","पेप्सी","कोका कोला"], displayName:"Cola 600ml", unit:"piece", price:40 },
  { id:151, names:["thumbs up","thums up","thumps up","थम्स अप","थंब्स अप"], displayName:"Thums Up", unit:"piece", price:40 },
  { id:152, names:["sprite","limca","7up","lemon drink","स्प्राइट","लिम्का","7 अप"], displayName:"Sprite/Limca", unit:"piece", price:40 },
  { id:153, names:["frooti","mango drink","mango frooti","फ्रूटी","मैंगो फ्रूटी"], displayName:"Frooti", unit:"piece", price:20 },
  { id:154, names:["maaza","maaza mango","mango slice","माज़ा","माजा"], displayName:"Maaza", unit:"piece", price:20 },
  { id:155, names:["juice","fruit juice","real juice","tropicana","mixed fruit","जूस","फ्रूट जूस"], displayName:"Juice", unit:"piece", price:30 },
  { id:156, names:["water bottle","mineral water","bisleri","kinley","pani ki botal","पानी की बोतल","मिनरल वाटर"], displayName:"Water Bottle", unit:"piece", price:20 },
  { id:157, names:["energy drink","red bull","monster","stamina drink","एनर्जी ड्रिंक","रेड बुल"], displayName:"Energy Drink", unit:"piece", price:110 },
  { id:158, names:["soda","soda water","club soda","carbonated water","सोडा","सोडा वाटर"], displayName:"Soda", unit:"piece", price:20 },
  { id:159, names:["lassi","chhach","buttermilk","chaas","लस्सी","छाछ","चास"], displayName:"Lassi/Chhach", unit:"piece", price:25 },

  // ══════════════════════════════════
  // SOAP / PERSONAL HYGIENE
  // ══════════════════════════════════
  { id:160, names:["sabun","soap","bathing soap","bath soap","साबुन","नहाने का साबुन"], displayName:"Bath Sabun", unit:"piece", price:30 },
  { id:161, names:["lux","lux soap","beauty soap","लक्स","लक्स साबुन"], displayName:"Lux Soap", unit:"piece", price:35 },
  { id:162, names:["lifebuoy","lifebouy","hygiene soap","लाइफबॉय","लाइफबॉय साबुन"], displayName:"Lifebuoy", unit:"piece", price:30 },
  { id:163, names:["dettol soap","dettol bar","antiseptic soap","डेटॉल साबुन","डेटॉल"], displayName:"Dettol Soap", unit:"piece", price:40 },
  { id:164, names:["dove","dove soap","moisturising soap","डव","डव साबुन"], displayName:"Dove Soap", unit:"piece", price:50 },
  { id:165, names:["pears","pears soap","glycerine soap","पियर्स","पियर साबुन"], displayName:"Pears Soap", unit:"piece", price:45 },
  { id:166, names:["margo","neem soap","margo neem","मार्गो","नीम साबुन"], displayName:"Margo Soap", unit:"piece", price:35 },
  { id:167, names:["santoor","sandalwood soap","संतूर","संतूर साबुन"], displayName:"Santoor Soap", unit:"piece", price:35 },
  { id:168, names:["toothpaste","paste","tooth paste","दंत मंजन","पेस्ट","टूथपेस्ट"], displayName:"Toothpaste", unit:"piece", price:50 },
  { id:169, names:["colgate","colgate paste","colgate strong teeth","कोलगेट","कोलगेट पेस्ट"], displayName:"Colgate", unit:"piece", price:55 },
  { id:170, names:["pepsodent","pepso","पेप्सोडेंट"], displayName:"Pepsodent", unit:"piece", price:50 },
  { id:171, names:["closeup","close up","gel toothpaste","क्लोज़ अप","क्लोजअप"], displayName:"Closeup", unit:"piece", price:55 },
  { id:172, names:["toothbrush","brush","dant ka brush","tooth brush","टूथब्रश","दांत का ब्रश"], displayName:"Toothbrush", unit:"piece", price:25 },
  { id:173, names:["shampoo","balo ka shampoo","hair shampoo","शैम्पू","बालों का शैम्पू"], displayName:"Shampoo", unit:"piece", price:60 },
  { id:174, names:["head shoulders","h&s","head and shoulders","dandruff shampoo","हेड एंड शोल्डर्स","डैंड्रफ शैम्पू"], displayName:"Head & Shoulders", unit:"piece", price:90 },
  { id:175, names:["clinic plus","clinic","family shampoo","क्लीनिक प्लस","क्लिनिक"], displayName:"Clinic Plus", unit:"piece", price:70 },
  { id:176, names:["sunsilk","silk shampoo","सनसिल्क","सन सिल्क"], displayName:"Sunsilk", unit:"piece", price:75 },
  { id:177, names:["dove shampoo","dove hair","डव शैम्पू","डव बाल"], displayName:"Dove Shampoo", unit:"piece", price:100 },
  { id:178, names:["hair oil","baalon ka tel","coconut hair oil","बालों का तेल","बाल तेल"], displayName:"Hair Oil", unit:"piece", price:70 },
  { id:179, names:["parachute","parachute oil","parachute coconut","पैराशूट","पैराशूट तेल"], displayName:"Parachute Oil", unit:"piece", price:70 },
  { id:180, names:["dabur amla","amla oil","amla hair oil","आंवला तेल","डाबर आंवला"], displayName:"Amla Oil", unit:"piece", price:60 },
  { id:181, names:["face wash","face cleanser","फेस वॉश","चेहरा धोने का साबुन"], displayName:"Face Wash", unit:"piece", price:80 },
  { id:182, names:["fairness cream","face cream","fair lovely","fair and lovely","गोरापन क्रीम","फेस क्रीम"], displayName:"Face Cream", unit:"piece", price:50 },
  { id:183, names:["vaseline","moisturizer","body lotion","petroleum jelly","वैसलीन","मॉइश्चराइजर"], displayName:"Vaseline", unit:"piece", price:60 },
  { id:184, names:["deodorant","deo","body spray","underarm","डियोडरेंट","बॉडी स्प्रे"], displayName:"Deo Spray", unit:"piece", price:150 },
  { id:185, names:["sanitary pad","whisper","stayfree","lady pad","पैड","सैनिटरी पैड","लेडीज पैड"], displayName:"Sanitary Pad", unit:"piece", price:40 },
  { id:186, names:["razor","shaving blade","blade","gillette razor","रेजर","शेविंग ब्लेड","ब्लेड"], displayName:"Razor/Blade", unit:"piece", price:20 },
  { id:187, names:["shaving cream","shave gel","shaving foam","gillette","शेविंग क्रीम","शेव जेल"], displayName:"Shaving Cream", unit:"piece", price:50 },

  // ══════════════════════════════════
  // WASHING / CLEANING
  // ══════════════════════════════════
  { id:188, names:["detergent","washing powder","laundry powder","kapde dho powder","surf","tide","ariel","कपड़े धोने का पाउडर","डिटर्जेंट"], displayName:"Washing Powder", unit:"piece", price:50 },
  { id:189, names:["surf excel","surf","surf easy wash","सर्फ","सर्फ एक्सेल"], displayName:"Surf Excel", unit:"piece", price:60 },
  { id:190, names:["tide","tide plus","टाइड","टाइड प्लस"], displayName:"Tide", unit:"piece", price:50 },
  { id:191, names:["ariel","ariel matic","एरियल","एरियल मेटिक"], displayName:"Ariel", unit:"piece", price:65 },
  { id:192, names:["rin","rinn","rin advanced","रिन","रिन एडवांस्ड"], displayName:"Rin", unit:"piece", price:45 },
  { id:193, names:["nirma","nirma washing","निर्मा","निर्मा पाउडर"], displayName:"Nirma", unit:"piece", price:40 },
  { id:194, names:["washing bar","detergent bar","kapde dho sabun","कपड़े धोने की बट्टी","वॉशिंग बार"], displayName:"Washing Bar", unit:"piece", price:20 },
  { id:195, names:["vim","vim bar","vim dishwash","विम","विम बार"], displayName:"Vim", unit:"piece", price:30 },
  { id:196, names:["dish wash","dishwash liquid","bartan dho","bartan sabun","बर्तन धोने का साबुन","डिशवॉश","लिक्विड साबुन"], displayName:"Dish Wash", unit:"piece", price:40 },
  { id:197, names:["colin","glass cleaner","mirror cleaner","window cleaner","कोलिन","ग्लास क्लीनर"], displayName:"Colin", unit:"piece", price:50 },
  { id:198, names:["phenyl","floor cleaner","floor liquid","फिनाइल","फ्लोर क्लीनर"], displayName:"Phenyl", unit:"piece", price:50 },
  { id:199, names:["harpic","toilet cleaner","toilet liquid","हार्पिक","टॉयलेट क्लीनर"], displayName:"Harpic", unit:"piece", price:60 },
  { id:200, names:["lizol","disinfectant floor","floor disinfectant","लाइजोल","डिसइनफेक्टेंट"], displayName:"Lizol", unit:"piece", price:80 },

  // ══════════════════════════════════
  // MATCHES / AGARBATTI / PUJA
  // ══════════════════════════════════
  { id:201, names:["matchbox","maachis","matches","safety matches","माचिस","दियासलाई"], displayName:"Maachis", unit:"piece", price:2 },
  { id:202, names:["agarbatti","incense sticks","incense","dhoop batti","अगरबत्ती","धूप बत्ती"], displayName:"Agarbatti", unit:"piece", price:20 },
  { id:203, names:["cycle agarbatti","cycle brand","साइकिल अगरबत्ती","साइकिल ब्रांड"], displayName:"Cycle Agarbatti", unit:"piece", price:25 },
  { id:204, names:["dhoop","dhoop stick","cone dhoop","धूप","धूप बत्ती"], displayName:"Dhoop", unit:"piece", price:20 },
  { id:205, names:["camphor","kapoor","bhimseni kapoor","कपूर","भीमसेनी कपूर"], displayName:"Kapoor", unit:"piece", price:15 },
  { id:206, names:["candle","mombatti","wax candle","मोमबत्ती","कैंडल"], displayName:"Mombatti", unit:"piece", price:15 },
  { id:207, names:["roli","sindur","vermillion","kumkum","रोली","सिंदूर","कुमकुम"], displayName:"Roli/Sindur", unit:"piece", price:10 },

  // ══════════════════════════════════
  // BABY PRODUCTS
  // ══════════════════════════════════
  { id:208, names:["diaper","pampers","baby diaper","nappy","diapers","डायपर","पैम्पर्स","नैपी"], displayName:"Diaper", unit:"piece", price:15 },
  { id:209, names:["baby powder","johnsons","johnson baby","johnson baby powder","बेबी पाउडर","जॉनसन पाउडर"], displayName:"Baby Powder", unit:"piece", price:80 },
  { id:210, names:["baby oil","baby massage oil","infant oil","बेबी ऑयल","मालिश तेल"], displayName:"Baby Oil", unit:"piece", price:70 },
  { id:211, names:["cerelac","baby food","infant food","बेबी फूड","सेरेलक"], displayName:"Baby Food", unit:"piece", price:120 },

  // ══════════════════════════════════
  // STATIONERY / HOUSEHOLD
  // ══════════════════════════════════
  { id:212, names:["pen","ball pen","ballpoint","ballpoint pen","ink pen","कलम","पेन","बॉलपेन"], displayName:"Pen", unit:"piece", price:10 },
  { id:213, names:["pencil","lead pencil","पेंसिल","लेड पेंसिल"], displayName:"Pencil", unit:"piece", price:5 },
  { id:214, names:["notebook","copy","exercise book","writing book","कॉपी","नोटबुक"], displayName:"Copy/Notebook", unit:"piece", price:30 },
  { id:215, names:["rubber band","rubber","elastic band","रबर बैंड","रबर"], displayName:"Rubber Band", unit:"piece", price:5 },
  { id:216, names:["polythene","carry bag","plastic bag","shopping bag","थैली","पॉलीथीन","बैग"], displayName:"Polythene Bag", unit:"piece", price:10 },
  { id:217, names:["newspaper","akhbar","daily news","अखबार","समाचार पत्र"], displayName:"Newspaper", unit:"piece", price:5 },
  { id:218, names:["battery","cell","dry cell","AA battery","बैटरी","सेल"], displayName:"Battery", unit:"piece", price:15 },
  { id:219, names:["glue","fevicol","feviglue","adhesive","गोंद","फेविकोल","चिपकाने वाला"], displayName:"Fevicol", unit:"piece", price:20 },
  { id:220, names:["tape","sellotape","scotch tape","cello tape","टेप","सेलो टेप"], displayName:"Tape", unit:"piece", price:10 },

  // ══════════════════════════════════
  // MEDICINES / FIRST AID (OTC)
  // ══════════════════════════════════
  { id:221, names:["bandage","band aid","plaster","wound plaster","बैंडेज","पट्टी","बैंड-एड"], displayName:"Bandage", unit:"piece", price:15 },
  { id:222, names:["dettol","antiseptic","antiseptic liquid","dettol liquid","डेटॉल","एंटीसेप्टिक","डेटॉल लिक्विड"], displayName:"Dettol Liquid", unit:"piece", price:50 },
  { id:223, names:["ors","electral","electrolyte","oral rehydration","ओआरएस","इलेक्ट्रल"], displayName:"ORS Packet", unit:"piece", price:10 },
  { id:224, names:["vicks","vicks vaporub","chest rub","विक्स","विक्स वेपोरब"], displayName:"Vicks VapoRub", unit:"piece", price:45 },
  { id:225, names:["moov","moov spray","pain relief spray","pain balm","मूव","दर्द स्प्रे"], displayName:"Moov", unit:"piece", price:60 },

  // ══════════════════════════════════
  // EGGS
  // ══════════════════════════════════
  { id:226, names:["anda","egg","eggs","hen egg","अंडा","अंडे","मुर्गी का अंडा"], displayName:"Anda", unit:"piece", price:7 },
  { id:227, names:["anda dozen","dozen eggs","12 anda","ek darjan anda","बारह अंडे","एक दर्जन अंडे"], displayName:"Anda (Dozen)", unit:"piece", price:84 },

  // ══════════════════════════════════
  // DRY FRUITS / NUTS
  // ══════════════════════════════════
  { id:228, names:["moongfali","peanut","groundnut","shengdane","मूंगफली"], displayName:"Moongfali", unit:"kg", price:120 },
  { id:229, names:["kaju","cashew","cashew nut","काजू"], displayName:"Kaju", unit:"kg", price:800 },
  { id:230, names:["badam","almond","raw almond","बादाम"], displayName:"Badam", unit:"kg", price:700 },
  { id:231, names:["kishmish","raisin","dried grapes","किशमिश","किसमिस"], displayName:"Kishmish", unit:"kg", price:300 },
  { id:232, names:["pista","pistachio","roasted pista","पिस्ता"], displayName:"Pista", unit:"kg", price:1200 },
  { id:233, names:["akhrot","walnut","अखरोट"], displayName:"Akhrot", unit:"kg", price:600 },
  { id:234, names:["dates","khajur","dry dates","khajoor","खजूर","खजूरी"], displayName:"Khajur", unit:"kg", price:200 },
  { id:235, names:["chironji","charoli","buchanania","चिरौंजी","चारोली"], displayName:"Chironji", unit:"gm", price:3 },
  { id:236, names:["coconut","nariyal","fresh coconut","khopra","नारियल","खोपरा"], displayName:"Nariyal", unit:"piece", price:30 },

  // ══════════════════════════════════
  // MISC GROCERY
  // ══════════════════════════════════
  { id:237, names:["baking soda","meetha soda","sodium bicarbonate","मीठा सोडा","बेकिंग सोडा"], displayName:"Meetha Soda", unit:"piece", price:10 },
  { id:238, names:["baking powder","leavening agent","बेकिंग पाउडर"], displayName:"Baking Powder", unit:"piece", price:15 },
  { id:239, names:["cocoa powder","chocolate powder","cacao","कोकोआ पाउडर","चॉकलेट पाउडर"], displayName:"Cocoa Powder", unit:"piece", price:60 },
  { id:240, names:["agar agar","china grass","gelatin","veg gelatin","अगर अगर","चाइना ग्रास"], displayName:"Agar Agar", unit:"piece", price:25 },
  { id:241, names:["food color","food colouring","rang","खाद्य रंग","फूड कलर"], displayName:"Food Color", unit:"piece", price:15 },
  { id:242, names:["rose water","gulab jal","rose essence","गुलाब जल","रोज वाटर"], displayName:"Gulab Jal", unit:"piece", price:20 },
  { id:243, names:["kesar","saffron","kashmiri kesar","केसर","जाफरान"], displayName:"Kesar", unit:"piece", price:50 },
  { id:244, names:["tamarind","imli","sour tamarind","इमली","खट्टी इमली"], displayName:"Imli", unit:"kg", price:80 },
  { id:245, names:["jaggery powder","gud powder","powdered jaggery","गुड़ पाउडर","पाउडर गुड़"], displayName:"Gud Powder", unit:"kg", price:60 },
  { id:246, names:["corn starch","cornstarch","corn flour thickener","मकई स्टार्च","कॉर्न स्टार्च"], displayName:"Corn Starch", unit:"piece", price:30 },
  { id:247, names:["yeast","instant yeast","dry yeast","khameer","खमीर","यीस्ट"], displayName:"Yeast", unit:"piece", price:20 },
];


// ══════════════════════════════════
// ADDITIONAL PRODUCTS - EXPANDED SET
// ══════════════════════════════════

// ── BRANDED ATTA / FLOUR ──
PRODUCTS.push(
  { id:301, names:["fortune aata","fortune","फॉर्च्यून आटा"], displayName:"Fortune Aata", unit:"kg", price:35 },
  { id:302, names:["ashirvaad aata","ashirvad","ashirwad","आशीर्वाद आटा"], displayName:"Ashirvaad Aata", unit:"kg", price:38 },
  { id:303, names:["pilsbury aata","pillsbury","पिल्सबरी"], displayName:"Pilsbury Aata", unit:"kg", price:40 },
  { id:304, names:["patanjali aata","patanjali","पतंजलि आटा"], displayName:"Patanjali Aata", unit:"kg", price:33 },
  { id:305, names:["rajdhani aata","rajdhani","राजधानी आटा"], displayName:"Rajdhani Aata", unit:"kg", price:36 }
);

// ── BRANDED RICE ──
PRODUCTS.push(
  { id:310, names:["india gate rice","india gate","इंडिया गेट चावल"], displayName:"India Gate Basmati", unit:"kg", price:95 },
  { id:311, names:["kohinoor rice","kohinoor","कोहिनूर चावल"], displayName:"Kohinoor Basmati", unit:"kg", price:90 },
  { id:312, names:["dawat rice","daawat","दावत चावल"], displayName:"Daawat Basmati", unit:"kg", price:92 },
  { id:313, names:["fortune rice","fortune chawal"], displayName:"Fortune Rice", unit:"kg", price:55 }
);

// ── PULSES / DAL BRANDS ──
PRODUCTS.push(
  { id:320, names:["tata sampann dal","tata dal","टाटा दाल"], displayName:"Tata Sampann Dal", unit:"kg", price:130 },
  { id:321, names:["mdh dal","fortune dal"], displayName:"Fortune Dal", unit:"kg", price:110 },
  { id:322, names:["chana sattu","sattu powder","black sattu"], displayName:"Chana Sattu", unit:"kg", price:75 }
);

// ── EDIBLE OIL BRANDS ──
PRODUCTS.push(
  { id:330, names:["fortune oil","fortune tel","फॉर्च्यून तेल"], displayName:"Fortune Oil", unit:"liter", price:140 },
  { id:331, names:["saffola oil","saffola","सफोला"], displayName:"Saffola Oil", unit:"liter", price:160 },
  { id:332, names:["sundrop oil","sundrop","सनड्रॉप"], displayName:"Sundrop Oil", unit:"liter", price:150 },
  { id:333, names:["dhara oil","dhara","धारा"], displayName:"Dhara Oil", unit:"liter", price:138 },
  { id:334, names:["gemini oil","gemini","जेमिनी"], displayName:"Gemini Oil", unit:"liter", price:132 },
  { id:335, names:["ruchi gold","ruchigold","रुचि गोल्ड"], displayName:"Ruchi Gold Oil", unit:"liter", price:130 },
  { id:336, names:["mahakosh oil","mahakosh","महाकोश","mahakosh tel"], displayName:"Mahakosh Oil", unit:"liter", price:133 },
  { id:337, names:["oil can","tel can","15 liter tel","15 litre oil","tin oil","तेल का टिन","कनस्तर"], displayName:"Tel Can (15L)", unit:"piece", price:2000 },
  { id:338, names:["oil packet","1 liter packet","tel 1 liter","oil 1l"], displayName:"Tel Packet 1L", unit:"piece", price:140 },
  { id:339, names:["oil 5 liter","5 litre oil","5 liter tel"], displayName:"Tel 5L", unit:"piece", price:680 }
);

// ── SUGAR / NAMKEEN BRANDS ──
PRODUCTS.push(
  { id:340, names:["madhur sugar","madhur chini","मधुर चीनी"], displayName:"Madhur Chini", unit:"kg", price:46 },
  { id:341, names:["tata salt","tata namak","टाटा नमक","टाटा साल्ट"], displayName:"Tata Salt", unit:"kg", price:22 },
  { id:342, names:["annapurna salt","annapurna namak","अन्नपूर्णा नमक"], displayName:"Annapurna Salt", unit:"kg", price:20 },
  { id:343, names:["captain cook salt","captain cook","कैप्टन कुक"], displayName:"Captain Cook Salt", unit:"kg", price:20 }
);

// ── DAIRY BRANDS ──
PRODUCTS.push(
  { id:350, names:["amul butter","amul makhan","अमूल मक्खन"], displayName:"Amul Butter", unit:"piece", price:60 },
  { id:351, names:["amul cheese","cheese slice","चीज़","cheese"], displayName:"Amul Cheese", unit:"piece", price:120 },
  { id:352, names:["amul dahi","curd packet","दही पैकेट"], displayName:"Amul Dahi", unit:"piece", price:50 },
  { id:353, names:["nestle milk","nestle doodh","नेस्ले दूध"], displayName:"Nestle Milk", unit:"piece", price:30 },
  { id:354, names:["mother dairy milk","mother dairy","मदर डेयरी"], displayName:"Mother Dairy Milk", unit:"piece", price:28 },
  { id:355, names:["go cheese","go paneer","गो पनीर"], displayName:"Go Cheese/Paneer", unit:"piece", price:120 },
  { id:356, names:["kusum ghee","kusum","कुसुम घी"], displayName:"Kusum Ghee", unit:"kg", price:520 },
  { id:357, names:["patanjali ghee","patanjali cow ghee","पतंजलि घी"], displayName:"Patanjali Ghee", unit:"kg", price:530 }
);

// ── INSTANT FOOD / READY TO EAT ──
PRODUCTS.push(
  { id:360, names:["ching's noodles","chings","चिंग्स नूडल्स"], displayName:"Ching's Noodles", unit:"piece", price:25 },
  { id:361, names:["knorr soup","knorr","नॉर सूप"], displayName:"Knorr Soup", unit:"piece", price:35 },
  { id:362, names:["maggi masala","maggi masala pack","मैगी मसाला"], displayName:"Maggi Masala", unit:"piece", price:10 },
  { id:363, names:["poha ready mix","poha mix","इंस्टेंट पोहा"], displayName:"Instant Poha Mix", unit:"piece", price:30 },
  { id:364, names:["upma mix","instant upma","उपमा मिक्स"], displayName:"Upma Mix", unit:"piece", price:30 },
  { id:365, names:["idli mix","instant idli","इडली मिक्स"], displayName:"Idli Mix", unit:"piece", price:50 },
  { id:366, names:["dosa mix","instant dosa","डोसा मिक्स"], displayName:"Dosa Mix", unit:"piece", price:50 },
  { id:367, names:["halwa mix","sheera mix","हलवा मिक्स"], displayName:"Halwa Mix", unit:"piece", price:40 },
  { id:368, names:["khichdi mix","dal khichdi","खिचड़ी मिक्स"], displayName:"Khichdi Mix", unit:"piece", price:35 }
);

// ── BREAD / BAKERY BRANDS ──
PRODUCTS.push(
  { id:370, names:["britannia bread","britannia","ब्रिटानिया ब्रेड"], displayName:"Britannia Bread", unit:"piece", price:42 },
  { id:371, names:["harvest gold","harvest gold bread","हार्वेस्ट गोल्ड"], displayName:"Harvest Gold Bread", unit:"piece", price:42 },
  { id:372, names:["modern bread","modern","मॉडर्न ब्रेड"], displayName:"Modern Bread", unit:"piece", price:40 },
  { id:373, names:["britannia cake","little hearts","लिटल हार्ट्स"], displayName:"Little Hearts", unit:"piece", price:20 },
  { id:374, names:["tiger cake","tiger bun","टाइगर केक"], displayName:"Tiger Cake", unit:"piece", price:10 },
  { id:375, names:["britannia treat","treat biscuit"], displayName:"Britannia Treat", unit:"piece", price:20 }
);

// ── TEA / COFFEE BRANDS ──
PRODUCTS.push(
  { id:380, names:["wagh bakri","wagh bakri tea","वाघ बकरी"], displayName:"Wagh Bakri Tea", unit:"piece", price:90 },
  { id:381, names:["society tea","society chai","सोसाइटी चाय"], displayName:"Society Tea", unit:"piece", price:85 },
  { id:382, names:["lipton tea","lipton","लिप्टन"], displayName:"Lipton Tea", unit:"piece", price:80 },
  { id:383, names:["bru coffee","bru","ब्रू कॉफी"], displayName:"Bru Coffee", unit:"piece", price:75 },
  { id:384, names:["glucon d","glucon-d","ग्लूकोन डी"], displayName:"Glucon-D", unit:"piece", price:90 },
  { id:385, names:["tang powder","tang","टैंग"], displayName:"Tang", unit:"piece", price:30 },
  { id:386, names:["rasna","rasna powder","रसना"], displayName:"Rasna", unit:"piece", price:20 },
  { id:387, names:["rooh afza","rooh-afza","रूह अफ़ज़ा"], displayName:"Rooh Afza", unit:"piece", price:180 }
);

// ── SPICES / MASALA BRANDS ──
PRODUCTS.push(
  { id:390, names:["catch masala","catch","कैच मसाला"], displayName:"Catch Masala", unit:"piece", price:30 },
  { id:391, names:["maggi masala mix","maggi masale"], displayName:"Maggi Masala Mix", unit:"piece", price:25 },
  { id:392, names:["nutrela soya chunks","soya chunks","soya badi","सोया बड़ी","सोया चंक्स"], displayName:"Soya Chunks", unit:"kg", price:100 },
  { id:393, names:["soya granules","soya keema","सोया कीमा"], displayName:"Soya Granules", unit:"kg", price:100 },
  { id:394, names:["kasuri methi","kasoori methi","dried fenugreek","कसूरी मेथी"], displayName:"Kasuri Methi", unit:"gm", price:0.8 },
  { id:395, names:["sabut dhaniya","whole coriander","साबुत धनिया"], displayName:"Sabut Dhaniya", unit:"gm", price:0.5 },
  { id:396, names:["kali elaichi","black cardamom","badi elaichi","बड़ी इलायची"], displayName:"Badi Elaichi", unit:"gm", price:4 },
  { id:397, names:["star anise","chakriphool","chakra phool","चक्री फूल"], displayName:"Chakri Phool", unit:"gm", price:1.5 },
  { id:398, names:["javitri","mace spice","जावित्री"], displayName:"Javitri", unit:"gm", price:5 },
  { id:399, names:["jaiphal","nutmeg","जायफल"], displayName:"Jaiphal", unit:"gm", price:3 }
);

// ── SAUCE / CONDIMENT BRANDS ──
PRODUCTS.push(
  { id:400, names:["kissan ketchup","kissan","किसान केचप"], displayName:"Kissan Ketchup", unit:"piece", price:85 },
  { id:401, names:["dr oetker","fun foods","dr. oetker"], displayName:"Dr Oetker Sauce", unit:"piece", price:80 },
  { id:402, names:["heinz ketchup","heinz","हाइंज"], displayName:"Heinz Ketchup", unit:"piece", price:120 },
  { id:403, names:["veeba sauce","veeba"], displayName:"Veeba Sauce", unit:"piece", price:80 },
  { id:404, names:["chutney","green chutney","pudina chutney","चटनी","पुदीना चटनी"], displayName:"Chutney", unit:"piece", price:40 },
  { id:405, names:["mustard sauce","mustard","सरसों सॉस"], displayName:"Mustard Sauce", unit:"piece", price:40 },
  { id:406, names:["mayo","mayonnaise","मेयोनेज़"], displayName:"Mayonnaise", unit:"piece", price:80 }
);

// ── SWEETS / MITHAI / NAMKEEN BRANDS ──
PRODUCTS.push(
  { id:410, names:["haldiram mixture","haldiram mix","हल्दीराम मिक्सचर"], displayName:"Haldiram Mixture", unit:"piece", price:30 },
  { id:411, names:["haldiram aloo bhujia","aloo bhujia","आलू भुजिया"], displayName:"Aloo Bhujia", unit:"kg", price:200 },
  { id:412, names:["haldiram sev","moong dal haldiram","मूंग दाल नमकीन"], displayName:"Moong Dal Namkeen", unit:"piece", price:30 },
  { id:413, names:["bikaji bhujia","bikaji","बीकाजी"], displayName:"Bikaji Bhujia", unit:"piece", price:30 },
  { id:414, names:["balaji wafers","balaji chips","बालाजी चिप्स"], displayName:"Balaji Chips", unit:"piece", price:20 },
  { id:415, names:["act ii popcorn","act 2","एक्ट 2 पॉपकॉर्न"], displayName:"Act II Popcorn", unit:"piece", price:20 },
  { id:416, names:["poppins","pop pins","poppins candy","पॉपिन्स"], displayName:"Poppins", unit:"piece", price:5 },
  { id:417, names:["dairy milk silk","silk chocolate","सिल्क चॉकलेट"], displayName:"Dairy Milk Silk", unit:"piece", price:50 },
  { id:418, names:["kitkat chunky","kitkat big","किटकैट बड़ा"], displayName:"KitKat Chunky", unit:"piece", price:40 },
  { id:419, names:["munch","nestle munch","मंच"], displayName:"Munch", unit:"piece", price:10 },
  { id:420, names:["gems","cadbury gems","जेम्स"], displayName:"Gems", unit:"piece", price:10 },
  { id:421, names:["melody","melody toffee","मेलोडी"], displayName:"Melody", unit:"piece", price:1 },
  { id:422, names:["perk chocolate","perk","पर्क"], displayName:"Perk", unit:"piece", price:10 },
  { id:423, names:["bounty","bounty chocolate","बाउंटी"], displayName:"Bounty", unit:"piece", price:40 }
);

// ── COLD DRINK / BEVERAGES BRANDS ──
PRODUCTS.push(
  { id:430, names:["mountain dew","dew","माउंटेन ड्यू"], displayName:"Mountain Dew", unit:"piece", price:40 },
  { id:431, names:["mirinda","orange drink","मिरिंडा"], displayName:"Mirinda", unit:"piece", price:40 },
  { id:432, names:["appy fizz","appy","एपी फिज़"], displayName:"Appy Fizz", unit:"piece", price:30 },
  { id:433, names:["paper boat","paper boat drink","पेपर बोट"], displayName:"Paper Boat", unit:"piece", price:30 },
  { id:434, names:["real fruit juice","real juice packet","रियल जूस"], displayName:"Real Juice", unit:"piece", price:30 },
  { id:435, names:["b natural","b natural juice","बी नेचुरल"], displayName:"B Natural Juice", unit:"piece", price:35 },
  { id:436, names:["limca","limca bottle","लिम्का बोतल"], displayName:"Limca Bottle", unit:"piece", price:40 },
  { id:437, names:["shikanjvi","nimbu pani","lemonade","शिकंजवी","नींबू पानी"], displayName:"Shikanjvi", unit:"piece", price:20 },
  { id:438, names:["kokum sharbat","kokum","कोकम"], displayName:"Kokum Sharbat", unit:"piece", price:25 },
  { id:439, names:["amul lassi","amul butter milk","अमूल लस्सी"], displayName:"Amul Lassi", unit:"piece", price:25 },
  { id:440, names:["cow milk packet","full cream packet","फुल क्रीम दूध"], displayName:"Full Cream Milk Packet", unit:"piece", price:32 }
);

// ── SOAP / HYGIENE BRANDS ──
PRODUCTS.push(
  { id:450, names:["dettol handwash","dettol liquid wash","डेटॉल हैंडवॉश"], displayName:"Dettol Handwash", unit:"piece", price:80 },
  { id:451, names:["lifebuoy handwash","lifebuoy liquid","लाइफबॉय हैंडवॉश"], displayName:"Lifebuoy Handwash", unit:"piece", price:70 },
  { id:452, names:["savlon","savlon antiseptic","सेवलॉन"], displayName:"Savlon", unit:"piece", price:60 },
  { id:453, names:["godrej no 1","godrej soap","गोदरेज नंबर 1"], displayName:"Godrej No.1 Soap", unit:"piece", price:28 },
  { id:454, names:["hamam soap","hamam","हमाम"], displayName:"Hamam Soap", unit:"piece", price:30 },
  { id:455, names:["nivea cream","nivea","निविया"], displayName:"Nivea Cream", unit:"piece", price:90 },
  { id:456, names:["boroline","बोरोलिन"], displayName:"Boroline", unit:"piece", price:40 },
  { id:457, names:["burnol","burn cream","बर्नोल"], displayName:"Burnol", unit:"piece", price:35 },
  { id:458, names:["nycil powder","prickly heat powder","नाइसिल"], displayName:"Nycil Powder", unit:"piece", price:60 },
  { id:459, names:["mediker shampoo","mediker","मेडिकर"], displayName:"Mediker Shampoo", unit:"piece", price:50 },
  { id:460, names:["kesh kala oil","kesh kala","केश काला"], displayName:"Kesh Kala Oil", unit:"piece", price:60 },
  { id:461, names:["mamaearth","mama earth","ममाअर्थ"], displayName:"Mamaearth Product", unit:"piece", price:150 },
  { id:462, names:["himalaya face wash","himalaya","हिमालया"], displayName:"Himalaya Face Wash", unit:"piece", price:80 },
  { id:463, names:["clean and clear","clean clear","क्लीन एंड क्लियर"], displayName:"Clean & Clear", unit:"piece", price:80 },
  { id:464, names:["garnier face wash","garnier","गार्नियर"], displayName:"Garnier Face Wash", unit:"piece", price:90 }
);

// ── WASHING / CLEANING BRANDS ──
PRODUCTS.push(
  { id:470, names:["wheel detergent","wheel","व्हील"], displayName:"Wheel Detergent", unit:"piece", price:35 },
  { id:471, names:["ghadi detergent","ghadi","घड़ी डिटर्जेंट"], displayName:"Ghadi Detergent", unit:"piece", price:40 },
  { id:472, names:["fena detergent","fena","फेना"], displayName:"Fena Detergent", unit:"piece", price:38 },
  { id:473, names:["ezee liquid","ezee","ईज़ी"], displayName:"Ezee Liquid Detergent", unit:"piece", price:70 },
  { id:474, names:["pril dishwash","pril","प्रिल"], displayName:"Pril Dish Wash", unit:"piece", price:45 },
  { id:475, names:["scotch brite","scrubber","स्क्रबर"], displayName:"Scotch Brite Scrubber", unit:"piece", price:25 },
  { id:476, names:["domex","toilet domex","डोमेक्स"], displayName:"Domex Toilet Cleaner", unit:"piece", price:65 },
  { id:477, names:["hit spray","hit cockroach","हिट स्प्रे"], displayName:"Hit Spray", unit:"piece", price:120 },
  { id:478, names:["good knight","goodknight","mosquito repellent","गुड नाइट","मच्छर क्वाइल"], displayName:"Good Knight", unit:"piece", price:40 },
  { id:479, names:["allout","all out","ऑलआउट"], displayName:"All Out Refill", unit:"piece", price:80 },
  { id:480, names:["mortein","mosquito killer","मोर्टेन"], displayName:"Mortein", unit:"piece", price:120 },
  { id:481, names:["odonil","bathroom freshener","ओडोनिल","odournil"], displayName:"Odonil", unit:"piece", price:30 },
  { id:482, names:["odomos","mosquito cream","ओडोमोस","mosquito lotion"], displayName:"Odomos", unit:"piece", price:50 },
  { id:483, names:["lal tikki","naphthalene balls","नेफ्थलीन","camphor balls"], displayName:"Naphthalene Balls", unit:"piece", price:20 }
);

// ── BABY / CHILD PRODUCTS ──
PRODUCTS.push(
  { id:490, names:["pampers xl","pampers large","pampers xxl","पैम्पर्स एक्सएल"], displayName:"Pampers XL", unit:"piece", price:20 },
  { id:491, names:["huggies diaper","huggies","हगीज़"], displayName:"Huggies Diaper", unit:"piece", price:18 },
  { id:492, names:["mamy poko","mamypoko","मैमी पोको"], displayName:"Mamy Poko Pants", unit:"piece", price:18 },
  { id:493, names:["lactogen","lactogen milk","लैक्टोजन"], displayName:"Lactogen", unit:"piece", price:150 },
  { id:494, names:["nan pro","nan powder","नैन प्रो"], displayName:"NAN Pro", unit:"piece", price:180 },
  { id:495, names:["farex","farex cereal","फारेक्स"], displayName:"Farex Baby Cereal", unit:"piece", price:100 }
);

// ── STATIONERY / GENERAL ──
PRODUCTS.push(
  { id:500, names:["fevistick","fevi stick","फेवीस्टिक"], displayName:"Fevistick", unit:"piece", price:15 },
  { id:501, names:["m seal","mseal","एम सील","epoxy"], displayName:"M-Seal", unit:"piece", price:30 },
  { id:502, names:["white ink pen","whitener","व्हाइटनर"], displayName:"Whitener", unit:"piece", price:15 },
  { id:503, names:["stapler","stapler pin","स्टेपलर"], displayName:"Stapler", unit:"piece", price:80 },
  { id:504, names:["scissor","kaichi","कैंची"], displayName:"Kaichi (Scissor)", unit:"piece", price:40 },
  { id:505, names:["rubber eraser","eraser","रबर इरेजर"], displayName:"Eraser", unit:"piece", price:5 },
  { id:506, names:["sharpener","pencil sharpener","शार्पनर"], displayName:"Sharpener", unit:"piece", price:5 },
  { id:507, names:["cello tape","big tape","transparent tape","सेलो टेप"], displayName:"Cello Tape (Big)", unit:"piece", price:25 },
  { id:508, names:["writing pad","notepad","likhne ka pad","लिखने का पैड"], displayName:"Writing Pad", unit:"piece", price:20 },
  { id:509, names:["scale","ruler","पैमाना","स्केल"], displayName:"Scale/Ruler", unit:"piece", price:10 }
);

// ── MEDICINES / FIRST AID (OTC) ──
PRODUCTS.push(
  { id:510, names:["crocin","paracetamol","fever tablet","क्रोसिन"], displayName:"Crocin", unit:"piece", price:15 },
  { id:511, names:["disprin","dispirin","दिस्प्रीन"], displayName:"Disprin", unit:"piece", price:10 },
  { id:512, names:["gelusil","antacid","जेलुसिल"], displayName:"Gelusil", unit:"piece", price:30 },
  { id:513, names:["digene","digene tablet","डाइजीन"], displayName:"Digene", unit:"piece", price:25 },
  { id:514, names:["pudin hara","pudina hara","पुदीन हारा"], displayName:"Pudin Hara", unit:"piece", price:30 },
  { id:515, names:["zandu balm","zandu","ज़ंडू बाम","balm"], displayName:"Zandu Balm", unit:"piece", price:40 },
  { id:516, names:["tiger balm","tiger baam","टाइगर बाम"], displayName:"Tiger Balm", unit:"piece", price:45 },
  { id:517, names:["volini spray","volini","वोलिनी"], displayName:"Volini Spray", unit:"piece", price:120 },
  { id:518, names:["betadine","betadene","बेटाडीन"], displayName:"Betadine", unit:"piece", price:45 },
  { id:519, names:["cotton","cotton roll","रुई","रुई की गोली"], displayName:"Cotton Roll", unit:"piece", price:20 },
  { id:520, names:["thermometer","bukhar naapne wala","थर्मामीटर"], displayName:"Thermometer", unit:"piece", price:80 }
);

// ── HOUSEHOLD / KITCHEN ──
PRODUCTS.push(
  { id:530, names:["utensil cleaner","bartan cleaner","बर्तन साफ करने का पाउडर"], displayName:"Bartan Powder", unit:"piece", price:20 },
  { id:531, names:["aluminium foil","al foil","एल्युमीनियम फॉयल"], displayName:"Aluminium Foil", unit:"piece", price:50 },
  { id:532, names:["cling wrap","food wrap","क्लिंग रैप"], displayName:"Cling Wrap", unit:"piece", price:40 },
  { id:533, names:["zip lock bag","ziplock","ज़िप बैग"], displayName:"Zip Lock Bag", unit:"piece", price:30 },
  { id:534, names:["garbage bag","dustbin bag","कचरा बैग","garbage bag"], displayName:"Garbage Bag", unit:"piece", price:30 },
  { id:535, names:["tissue paper","tissue box","टिशू पेपर"], displayName:"Tissue Paper", unit:"piece", price:60 },
  { id:536, names:["toilet paper","toilet roll","टॉयलेट पेपर","toilet tissue"], displayName:"Toilet Roll", unit:"piece", price:40 },
  { id:537, names:["floor mop","pocha","pochha","पोछा"], displayName:"Pocha/Mop", unit:"piece", price:60 },
  { id:538, names:["broom","jhadu","झाड़ू"], displayName:"Jhadu (Broom)", unit:"piece", price:50 },
  { id:539, names:["brush jhadu","brush broom","dust brush","डस्ट ब्रश"], displayName:"Dust Brush", unit:"piece", price:40 },
  { id:540, names:["bucket","balti","बाल्टी"], displayName:"Balti (Bucket)", unit:"piece", price:80 },
  { id:541, names:["mug","lota","plastic mug","लोटा"], displayName:"Mug/Lota", unit:"piece", price:30 }
);

// ── AGRI / SEASONAL / REGIONAL ──
PRODUCTS.push(
  { id:550, names:["holi colour","holi rang","gulal","गुलाल","होली रंग"], displayName:"Gulal (Holi Rang)", unit:"piece", price:20 },
  { id:551, names:["pichkari","water gun","पिचकारी"], displayName:"Pichkari", unit:"piece", price:30 },
  { id:552, names:["rakhi","rakshabandhan","राखी"], displayName:"Rakhi", unit:"piece", price:20 },
  { id:553, names:["diya","clay diya","मिट्टी का दीया","दिया"], displayName:"Diya (Clay)", unit:"piece", price:2 },
  { id:554, names:["puja thali","pooja thali","पूजा थाली"], displayName:"Puja Thali", unit:"piece", price:50 },
  { id:555, names:["nariyal pani","coconut water","नारियल पानी"], displayName:"Nariyal Pani", unit:"piece", price:30 }
);

// ── ELECTRONICS / ACCESSORIES ──
PRODUCTS.push(
  { id:560, names:["earphones","earbuds","earbud","ईयरफोन"], displayName:"Earphones", unit:"piece", price:150 },
  { id:561, names:["mobile charger","charger","चार्जर","फोन चार्जर"], displayName:"Mobile Charger", unit:"piece", price:200 },
  { id:562, names:["usb cable","data cable","यूएसबी केबल"], displayName:"USB Cable", unit:"piece", price:80 },
  { id:563, names:["led bulb","bulb","बल्ब","9w bulb"], displayName:"LED Bulb", unit:"piece", price:60 },
  { id:564, names:["cfl bulb","fluorescent bulb","सीएफएल बल्ब"], displayName:"CFL Bulb", unit:"piece", price:50 },
  { id:565, names:["torch","flashlight","torch light","टॉर्च"], displayName:"Torch", unit:"piece", price:100 },
  { id:566, names:["extension cord","extension box","बोर्ड","plug board"], displayName:"Extension Board", unit:"piece", price:150 }
);

// ── FOOTWEAR / MISC ──
PRODUCTS.push(
  { id:570, names:["chappal","slipper","slippers","चप्पल"], displayName:"Chappal", unit:"piece", price:80 },
  { id:571, names:["umbrella","chhata","छाता","barish wala chhata"], displayName:"Chhata (Umbrella)", unit:"piece", price:150 },
  { id:572, names:["safety pin","safetypin","सेफ्टी पिन"], displayName:"Safety Pin", unit:"piece", price:5 },
  { id:573, names:["thread","dhaga","needle thread","धागा"], displayName:"Dhaga (Thread)", unit:"piece", price:10 },
  { id:574, names:["comb","kanghi","कंघी"], displayName:"Kanghi (Comb)", unit:"piece", price:15 },
  { id:575, names:["mirror","aaina","आईना","dressing mirror"], displayName:"Aaina (Mirror)", unit:"piece", price:50 }
);

// ── REGIONAL FOOD ITEMS ──
PRODUCTS.push(
  { id:580, names:["chikki","groundnut chikki","peanut chikki","चिक्की"], displayName:"Chikki", unit:"piece", price:10 },
  { id:581, names:["chakli","murukku","चकली"], displayName:"Chakli", unit:"kg", price:200 },
  { id:582, names:["ribbon pakoda","ribbon","रिबन पकोड़ा"], displayName:"Ribbon Pakoda", unit:"kg", price:180 },
  { id:583, names:["kara sev","karasev","करा सेव"], displayName:"Kara Sev", unit:"kg", price:160 },
  { id:584, names:["dal moth","dalmoth","दाल मोठ"], displayName:"Dal Moth", unit:"kg", price:180 },
  { id:585, names:["khakhra","khakra","खाखरा"], displayName:"Khakhra", unit:"piece", price:40 },
  { id:586, names:["murukku","murkoo","मुरुक्कू"], displayName:"Murukku", unit:"kg", price:200 },
  { id:587, names:["goli soda","banta","banta soda","गोली सोडा","बंटा"], displayName:"Banta Soda", unit:"piece", price:10 },
  { id:588, names:["sugarcane juice","ganna juice","गन्ने का रस"], displayName:"Ganna Juice", unit:"piece", price:20 },
  { id:589, names:["mishri","rock candy","मिश्री"], displayName:"Mishri", unit:"kg", price:120 },
  { id:590, names:["murabba","amla murabba","आंवला मुरब्बा"], displayName:"Murabba", unit:"piece", price:80 },
  { id:591, names:["churan","digestive churan","पाचक चूर्ण"], displayName:"Pachak Churan", unit:"piece", price:10 },
  { id:592, names:["saunth","sonth","dry ginger","सोंठ"], displayName:"Saunth (Dry Ginger)", unit:"gm", price:1 },
  { id:593, names:["kalimirch powder","kali mirch powder","काली मिर्च पाउडर"], displayName:"Kali Mirch Powder", unit:"gm", price:1.5 },
  { id:594, names:["dhania jeera powder","coriander cumin","धनिया जीरा पाउडर"], displayName:"Dhania Jeera Powder", unit:"kg", price:150 }
);

// ── GRAINS / SEEDS ──
PRODUCTS.push(
  { id:600, names:["kala til","black sesame","काला तिल"], displayName:"Kala Til", unit:"kg", price:150 },
  { id:601, names:["safed til","white sesame","सफेद तिल"], displayName:"Safed Til", unit:"kg", price:140 },
  { id:602, names:["alsi","flaxseed","linseed","अलसी"], displayName:"Alsi (Flaxseed)", unit:"kg", price:100 },
  { id:603, names:["sunflower seeds","suraj mukhi beej","सूरजमुखी के बीज"], displayName:"Sunflower Seeds", unit:"kg", price:200 },
  { id:604, names:["chia seeds","sabja","basil seeds","चिया सीड्स","सब्जा"], displayName:"Chia/Sabja Seeds", unit:"gm", price:0.8 },
  { id:605, names:["quinoa","quinoa grain","क्विनोआ"], displayName:"Quinoa", unit:"kg", price:300 },
  { id:606, names:["barley","jau","जौ"], displayName:"Jau (Barley)", unit:"kg", price:40 },
  { id:607, names:["makka","maize","corn","मक्का"], displayName:"Makka (Corn)", unit:"kg", price:25 },
  { id:608, names:["sorghum whole","jowar sabut","साबुत ज्वार"], displayName:"Jowar Sabut", unit:"kg", price:30 },
  { id:609, names:["Futana","फ़ुटाना","फ़ुटना","Futna"], displayName:"फ़ुटाना", unit:"kg", price:90 },
  { id:610, names:["Bhagar","Bagar","Bagat","भगड़","बगड़","भगर"], displayName:"Bhagar", unit:"kg", price:130 },
  { id:611, names:["Gulab jamun","गुलाब जामुन","गुलाब जामुन पैकेट"], displayName:"गुलाब जामुन पैकेट", unit:"kg", price:370},
  { id:612, names:["jira powder","jeera powder","cumin powder","जीरा पाउडर","जिरा पाउडर"], displayName:"Jeera Powder", unit:"kg", price:320},
  { id:613, names:["Daaliya","Daliya","दलिया","डालिया","दालिया"], displayName:"दालिया", unit:"kg", price:320},
  { id:614, names:["Fena sabun","Tanman sabun","Fena","Tanman","Surfexcel sabun","Wheel sabun","फेना","तनमन", "सर्फ एक्सेल साबुन", "व्हील साबुन"], displayName:"Sabun", unit:"piece", price:10},
  { id:615, names:["Vim set","Vim bundle","Nip bundle", "Nip Set","Vim","Nip"], displayName:"Bartan bar", unit:"piece", price:35},
  { id:616, names:["Dhoop","Incense sticks","Agarbatti","धूप","अगरबत्ती"], displayName:"Agarbatti", unit:"piece", price:50 },
  { id:617, names:["Sandalwood","Chandan","चंदन"], displayName:"Chandan (Sandalwood)", unit:"piece", price:50 },
  { id:618, names:["Kesar","Saffron","केसर"], displayName:"Kesar (Saffron)", unit:"gm", price:500 },
  { id:619, names:["Mogra","Jasmine","मोगरा"], displayName:"Mogra (Jasmine)", unit:"piece", price:20 },
  { id:620, names:["Kanki","Kanaki","kanki chawal","broken rice","कनकी","कनकी चावल"], displayName:"Kanki", unit:"kg", price:36 },
  { id:621, names:["khada dhaniya","kada dhaniya","खड़ा धनिया","खडी धनिया"], displayName:"Khada Dhaniya", unit:"kg", price:140 },
  { id:622,  names:["dhuli moong daal","dhuli moong","duli moong","duli moong daal","moong mogar","moong moongar","moong moger","moong magar","moong moghar","धुली मूंग दाल","धुली मूंग की दाल","मूंग मोगर","मूंग मगर"], displayName:"Moong Mogar", unit:"kg", price:110 },
  { id:623,  names:["khadi masoor daal","khadi masoor","खड़ा मसूर दाल","खड़ा मसूर","खडी मसूर", "खडी मसूर दाल" ], displayName:"Masoor Daal", unit:"kg", price:90 },
  { id:624,  names:["dhuli urad daal","dhuli urad","duli urad","duli urad daal","dhuli udad daal","duli udad daal","urad mogar","urad moongar","udad mogar","urad moger","urad magar","udad magar","urad moghar","धुली उड़द दाल","धुली उरद दाल","उड़द मोगर","उड़द मगर","उरद मोगर", "उरद मगर"], displayName:"Urad Mogar", unit:"kg", price:120 },
  { id:625,  names:["khadi moong daal","khadi moong","खड़ा मूंग दाल","खड़ा मूंग ","खडी मूंग", "खडी मूंग दाल" ], displayName:"Moong", unit:"kg", price:92 },
);

// ── REGIONAL VEGETABLES / PULSES ──
PRODUCTS.push(
  { id:626, names:["hara batana","हरा बटाना","green potato","hara aloo"], displayName:"हरा बटाना", unit:"kg", price:70 },
  { id:627, names:["chapta batana","चप्टा बटाना","flat potato","chapta aloo"], displayName:"चप्टा बटाना", unit:"kg", price:50 },
  { id:628, names:["safed batana","सफेद बटाना"], displayName:"सफेद बटाना", unit:"kg", price:50 },
  { id:629, names:["barbati dal","barbati daal","बरबटी दाल","barbati pulse"], displayName:"बरबटी दाल", unit:"kg", price:80 },
  { id:630, names:["kultha","कुलथा","horse gram","kulthi"], displayName:"कुलथा", unit:"kg", price:120 },
  { id:631, names:["tilli","तिल्ली","sesame","til"], displayName:"तिल्ली", unit:"kg", price:140 },
  { id:632, names:["khanda dal","khanda daal","खंडा दाल","khanda pulse"], displayName:"खंडा दाल", unit:"kg", price:60 },
  { id:633, names:["batana dal","batana daal","बटाना दाल","batana pulse"], displayName:"बटाना दाल", unit:"kg", price:50 },
  { id:634, names:["haldi gath","हल्दी गाठ","turmeric root","haldi gath"], displayName:"हल्दी गाठ", unit:"kg", price:320 }
);

// ══════════════════════════════════
// HINDI NUMBER WORDS → DIGITS
// ══════════════════════════════════
const HINDI_NUMBERS = {
  "ek":1,"एक":1,"do":2,"दो":2,"teen":3,"तीन":3,"char":4,"chaar":4,"चार":4,
  "paanch":5,"panch":5,"पांच":5,"paach":5,"chhe":6,"chhah":6,"छह":6,
  "saat":7,"सात":7,"aath":8,"आठ":8,"nau":9,"nav":9,"नौ":9,"das":10,"दस":10,
  "gyarah":11,"ग्यारह":11,"barah":12,"बारह":12,"terah":13,"तेरह":13,
  "chaudah":14,"चौदह":14,"pandrah":15,"पंद्रह":15,"solah":16,"सोलह":16,
  "satrah":17,"सत्रह":17,"atharah":18,"अठारह":18,"unnees":19,"उन्नीस":19,
  "bees":20,"बीस":20,"pachees":25,"पचीस":25,"tees":30,"तीस":30,
  "chaalees":40,"चालीस":40,"pachaas":50,"पचास":50,
  "saath":60,"साठ":60,"sattar":70,"सत्तर":70,"assi":80,"अस्सी":80,
  "nabbe":90,"नब्बे":90,"sau":100,"सौ":100,
};

// ══════════════════════════════════
// HINDI FRACTION WORDS
// ══════════════════════════════════
const HINDI_FRACTIONS = {
  "aadha":0.5,"आधा":0.5,"adha":0.5,
  "paav":0.25,"पाव":0.25,"pav":0.25,
  "sawa":1.25,"सवा":1.25,
  "dedh":1.5,"डेढ़":1.5,"deedh":1.5,
  "dhai":2.5,"ढाई":2.5,"dhaai":2.5,
  "paune":0.75,"पौने":0.75,
};

var PRODUCT_RUNTIME_FIXES = {
  89: { names: ["chai pati", "cha patti", "chaipatti"] },
  116: { names: ["kalimirch", "kali much", "kali mirchi", "kalimich"] },
  117: { names: ["ajvayan", "ajvayn"] },
  119: { names: ["soff", "sonf", "sanuf"] },
  614: { names: ["bath sabun", "bathing sabun", "bath soap"] },
  615: { names: ["bartanbar", "bartan sabun", "vim bar", "nip bar"] },
  620: { displayName: "Kanki", unit: "kg", names: ["kanki chawal", "broken rice", "कनकी", "कनकी चावल"] },
  622: { displayName: "Moong Mogar", names: ["moong moongar", "moong moger", "मूंग मोगर", "मूंग मगर", "धुली मूंग", "धुली मूंग दाल"] },
  624: { displayName: "Urad Mogar", names: ["urad moongar", "urad moger", "उड़द मोगर", "उरद मोगर", "उड़द मगर", "धुली उड़द दाल"] },
  609: { displayName: "Futana" },
  611: { displayName: "Gulab Jamun Packet" },
  613: { displayName: "Daaliya" }
};

function isUsefulCatalogText(value) {
  var text = String(value || "").trim();

  if (!text) {
    return false;
  }

  if (/\?{4,}/.test(text)) {
    return false;
  }

  return !(/[\u00e0\u00e2\u00f0]/.test(text) && !(/[\u0900-\u097f]/.test(text)));
}

function titleCaseCatalogText(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function pickRuntimeDisplayName(product) {
  if (isUsefulCatalogText(product.displayName)) {
    return String(product.displayName).trim();
  }

  var aliases = [product.displayName].concat(product.names || []);
  for (var i = 0; i < aliases.length; i++) {
    var alias = String(aliases[i] || "").trim();
    if (!isUsefulCatalogText(alias)) {
      continue;
    }
    if (/^[a-z0-9\s()&/-]+$/i.test(alias)) {
      return titleCaseCatalogText(alias);
    }
    return alias;
  }

  return "Item " + product.id;
}

function cleanupProductsCatalog() {
  PRODUCTS.forEach(function(product) {
    var fix = PRODUCT_RUNTIME_FIXES[product.id] || {};
    var aliases = [product.displayName].concat(product.names || []).concat(fix.names || []);
    var uniqueAliases = {};

    product.displayName = fix.displayName || pickRuntimeDisplayName(product);
    product.unit = String(fix.unit || product.unit || "piece").toLowerCase();

    aliases.forEach(function(alias) {
      var cleaned = String(alias || "").trim();
      if (isUsefulCatalogText(cleaned)) {
        uniqueAliases[cleaned] = true;
      }
    });

    uniqueAliases[product.displayName] = true;
    product.names = Object.keys(uniqueAliases);
  });
}

cleanupProductsCatalog();

