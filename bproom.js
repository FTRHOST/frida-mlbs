/**
 * MLBB Drafting Phase Tracer: Ban & Pick Hero
 * Mode: Ringan, Bersih, Anti-Lag & Auto-Reset Match Baru
 */

let il2cpp = null;

// --- Fungsi Dasar IL2CPP ---
function initIl2cpp(libName) {
    const targetLib = Process.getModuleByName(libName);
    const n = (name, ret, args) => {
        const addr = targetLib.findExportByName(name);
        return addr ? new NativeFunction(addr, ret, args) : null;
    };
    
    il2cpp = {
        domain_get: n("il2cpp_domain_get", 'pointer', []),
        domain_get_assemblies: n("il2cpp_domain_get_assemblies", 'pointer', ['pointer', 'pointer']),
        assembly_get_image: n("il2cpp_assembly_get_image", 'pointer', ['pointer']),
        image_get_class_count: n("il2cpp_image_get_class_count", 'uint64', ['pointer']),
        image_get_class: n("il2cpp_image_get_class", 'pointer', ['pointer', 'uint64']),
        class_get_name: n("il2cpp_class_get_name", 'pointer', ['pointer']),
        class_get_methods: n("il2cpp_class_get_methods", 'pointer', ['pointer', 'pointer']),
        method_get_name: n("il2cpp_method_get_name", 'pointer', ['pointer'])
    };
}

// --- Fungsi Hook Method ---
function hookAllMethods(klassPtr, callback) {
    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtr;
    while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
        const name = il2cpp.method_get_name(methodPtr).readUtf8String();
        const impl = methodPtr.readPointer(); 
        if (impl.isNull() || name === ".ctor") continue;
        
        try {
            Interceptor.attach(impl, {
                onEnter: function(args) { 
                    callback(name, args); 
                }
            });
        } catch(e) {}
    }
}

// --- Eksekusi Utama ---
const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
    
    if (mod) { 
        clearInterval(check); 
        initIl2cpp(mod.name);

        console.log("\n[+] API IL2CPP Initialized.");
        console.log("[*] Memulai proses tracing fase Drafting / Ban Pick...");
        console.log("[!] Menggunakan mode Trace Method yang Ringan & Bersih.");

        let domain = il2cpp.domain_get();
        let sizePtr = Memory.alloc(Process.pointerSize);
        let assemblies = il2cpp.domain_get_assemblies(domain, sizePtr);
        let count = Process.pointerSize === 8 ? sizePtr.readU64().toNumber() : sizePtr.readU32();

        let UIRankHeroClass = NULL;

        console.log(`[*] Mencari UIRankHero di ${count} assemblies...`);
        for (let i = 0; i < count; i++) {
            let assembly = assemblies.add(i * Process.pointerSize).readPointer();
            let image = il2cpp.assembly_get_image(assembly);
            
            if (image.isNull()) continue;

            let classCount = il2cpp.image_get_class_count(image).toNumber();
            for (let j = 0; j < classCount; j++) {
                let cls = il2cpp.image_get_class(image, j);
                if (cls.isNull()) continue;

                let namePtr = il2cpp.class_get_name(cls);
                if (namePtr.isNull()) continue;

                let name = namePtr.readUtf8String();
                if (name === "UIRankHero") {
                    UIRankHeroClass = cls;
                    break; 
                }
            }
            if (!UIRankHeroClass.isNull()) break; 
        }

        if(!UIRankHeroClass.isNull()){
            console.log("[+] Berhasil menemukan UIRankHero! Memasang Hook...\n");
            
            let processedBans = new Set();
            let processedPicks = new Set();
            let lastEventTime = 0;

            // Fungsi untuk mereset log jika ada match baru
            function checkResetMatch() {
                let currentTime = Date.now();
                // Reset jika jarak event sebelumnya lebih dari 3 menit (180.000 ms)
                if (currentTime - lastEventTime > 180000) {
                    processedBans.clear();
                    processedPicks.clear();
                    console.log("\n==================================================");
                    console.log("          DRAFTING PHASE DIMULAI                  ");
                    console.log("==================================================\n");
                }
                lastEventTime = currentTime;
            }

            // Panggil sekali untuk memunculkan header saat pertama kali skrip jalan
            checkResetMatch();

            hookAllMethods(UIRankHeroClass, (methodName, args) => {
                const targetMethods = [
                    "ReceBanHero",      
                    //"RecePickHero",     
                    // "SendBanHero",      
                    // "SendPickHero",     
                    "ConfirmHero"       
                ];
                
                if (targetMethods.includes(methodName)) {
                    try {
                        let heroId = args[1].toInt32();
                        
                        // 1. FILTER MEMORY POINTER (Hanya ambil ID 1 - 500)
                        if (heroId > 0 && heroId <= 500) {
                            
                            // Cek apakah ini match baru
                            checkResetMatch();
                            
                            // 2. TAMPILAN LOG BERWARNA & ANTI-DUPLIKASI
                            if (methodName.includes("Ban")) {
                                if (!processedBans.has(heroId)) {
                                    console.log(`🔴 [ BAN HERO ]  -> Hero yang di-ban  : ID ${heroId}`);
                                    processedBans.add(heroId); 
                                }
                            } else if (methodName.includes("Pick") || methodName === "ConfirmHero") {
                                if (!processedPicks.has(heroId)) {
                                    console.log(`🟢 [ PICK HERO ] -> Hero yang di-pick : ID ${heroId}`);
                                    processedPicks.add(heroId); 
                                }
                            }

                        }
                    } catch(e) {
                         // Abaikan error pembacaan
                    }
                }
            });
        } else {
            console.log("[-] GAGAL: Class UIRankHero tidak ditemukan di assembly manapun.");
        }
    }
}, 1000);
