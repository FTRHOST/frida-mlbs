/**
 * MLBB Draft Pick Scraper (STABLE & DIRECT MEMORY READ)
 * Target: liblogic.so
 * Fitur: 
 * - Membaca Player Info (Nama, UID, Camp) dari SystemData.RoomData
 * - Membaca Real-time Pick/Hover dari SystemData.RoomData
 * - Membaca Real-time Bans dari UIRankHero (Mengatasi blank ban di Game State 3)
 */

function startScrapingStable(libName) {
    const targetLib = Process.getModuleByName(libName);
    
    // Helper untuk memetakan fungsi C bawaan (il2cpp API)
    function n(name, ret, args) {
        const addr = targetLib.findExportByName(name);
        return addr ? new NativeFunction(addr, ret, args) : null;
    }

    // Mapping API il2cpp yang dibutuhkan
    const il2cpp = {
        domain_get: n("il2cpp_domain_get", 'pointer', []),
        domain_get_assemblies: n("il2cpp_domain_get_assemblies", 'pointer', ['pointer', 'pointer']),
        assembly_get_image: n("il2cpp_assembly_get_image", 'pointer', ['pointer']),
        image_get_name: n("il2cpp_image_get_name", 'pointer', ['pointer']),
        image_get_class_count: n("il2cpp_image_get_class_count", 'uint64', ['pointer']),
        image_get_class: n("il2cpp_image_get_class", 'pointer', ['pointer', 'uint64']),
        class_get_name: n("il2cpp_class_get_name", 'pointer', ['pointer']),
        class_get_method_from_name: n("il2cpp_class_get_method_from_name", 'pointer', ['pointer', 'pointer', 'int']),
        class_get_field_from_name: n("il2cpp_class_get_field_from_name", 'pointer', ['pointer', 'pointer']),
        field_static_get_value: n("il2cpp_field_static_get_value", 'void', ['pointer', 'pointer'])
    };

    if (!il2cpp.domain_get) {
        console.log("[-] Gagal memetakan il2cpp API. Apakah nama modul benar liblogic.so?");
        return;
    }

    // --- HELPER BACA MEMORI STRUKTUR C# ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt(); // Offset panjang string
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len); // Offset array karakter
        } catch (e) { return ""; }
    }
    
    function readListInt(listPtr) {
        if (listPtr.isNull()) return [];
        try {
            const itemsPtr = listPtr.add(0x10).readPointer(); // Pointer ke array internal (_items)
            if (!itemsPtr.isNull()) {
                const size = listPtr.add(0x18).readInt();     // Ukuran list (_size)
                if (size > 0 && size < 50) {
                    let result = [];
                    // Mulai dari 0x20 karena 0x10-0x1F adalah header objek array
                    for (let i = 0; i < size; i++) {
                        result.push(itemsPtr.add(0x20 + (i * 4)).readInt());
                    }
                    if (result.length > 0) return result;
                }
            }
        } catch(e) {}
        return [];
    }

    console.log("[+] Mencari metadata Assembly-CSharp.dll...");
    let image, kSystemData, kLogicManager, kUIRankHero;
    const assemblies = il2cpp.domain_get_assemblies(il2cpp.domain_get(), Memory.alloc(8));
    
    for (let i = 0; i < 100; i++) {
        const assembly = assemblies.add(i * Process.pointerSize).readPointer();
        if (assembly.isNull()) continue;
        const img = il2cpp.assembly_get_image(assembly);
        if (img.isNull()) continue;
        
        if (il2cpp.image_get_name(img).readCString() === "Assembly-CSharp.dll") { 
            image = img; 
            break; 
        }
    }
    
    if (!image) {
        console.log("[-] Assembly-CSharp.dll tidak ditemukan!");
        return;
    }

    console.log("[+] Mencari class SystemData, LogicBattleManager, dan UIRankHero...");
    const classCount = Number(il2cpp.image_get_class_count(image));
    for (let j = 0; j < classCount; j++) {
        const k = il2cpp.image_get_class(image, j);
        const name = il2cpp.class_get_name(k).readCString();
        if (name === "SystemData") kSystemData = k;
        if (name === "LogicBattleManager") kLogicManager = k;
        if (name === "UIRankHero") kUIRankHero = k;
        
        // Break jika ketiganya sudah ketemu
        if (kSystemData && kLogicManager && kUIRankHero) break; 
    }

    // Memetakan Method & Field Pointer
    const getInfoFunc = new NativeFunction(
        il2cpp.class_get_method_from_name(kSystemData, Memory.allocUtf8String("GetBattlePlayerInfo"), 0).readPointer(), 
        'pointer', ['pointer']
    );
    const getBattleStateFunc = new NativeFunction(
        il2cpp.class_get_method_from_name(kLogicManager, Memory.allocUtf8String("GetBattleState"), 0).readPointer(), 
        'int', ['pointer']
    );
    
    const logicInstanceField = il2cpp.class_get_field_from_name(kLogicManager, Memory.allocUtf8String("Instance"));
    const uiRankHeroInstanceField = il2cpp.class_get_field_from_name(kUIRankHero, Memory.allocUtf8String("Instance"));

    console.log("[+] Memulai Scraper Loop tiap 1 detik...\n");

    // --- LOOP UTAMA ---
    setInterval(() => {
        try {
            // 1. Ambil Game State
            const instPtr = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(logicInstanceField, instPtr);
            const inst = instPtr.readPointer();
            if (inst.isNull()) return;

            // 0=Init, 1=Matching, 2=Draft/Loading, 3=Battle
            const state = getBattleStateFunc(inst); 
            if (state < 2) return; 

            let payload = {
                gameState: state,
                globalBanList: [], 
                globalPickList: [], 
                players: []
            };

            // 2. Ambil Real-Time BANS dari UIRankHero (Khususnya berguna di State 2/3)
            try {
                const uiRankInstPtr = Memory.alloc(Process.pointerSize);
                il2cpp.field_static_get_value(uiRankHeroInstanceField, uiRankInstPtr);
                const uiRankInst = uiRankInstPtr.readPointer();

                if (!uiRankInst.isNull()) {
                    // Baca totalBanOrder (List<uint32>) di offset 0x1d0
                    const totalBanOrderPtr = uiRankInst.add(0x1d0).readPointer();
                    const realTimeBans = readListInt(totalBanOrderPtr);
                    
                    realTimeBans.forEach(h => {
                        if (h > 0 && !payload.globalBanList.includes(h)) {
                            payload.globalBanList.push(h);
                        }
                    });
                }
            } catch (e) {
                // Abaikan error UIRankHero (bisa jadi UI sedang ditutup saat loading/in-game)
            }

            // 3. Ambil Data Pemain & Picks dari RoomData
            const listPtr = getInfoFunc(NULL);
            if (!listPtr.isNull()) {
                const listSize = listPtr.add(0x18).readInt();
                const itemsArray = listPtr.add(0x10).readPointer();
                
                for (let i = 0; i < listSize; i++) {
                    const p = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                    if (p.isNull()) continue;
                    
                    const uid = p.add(0x20).readU64().toString();
                    const camp = p.add(0x30).readInt();
                    const isLocked = p.add(0x38).readU8() === 1; // bAutoReadySelect
                    const namePtr = p.add(0x40).readPointer();
                    const heroId = p.add(0x4c).readInt();
                    
                    // Ban data dari RoomData (Hanya terisi penuh saat masuk Loading State 5)
                    const banHeroInt = p.add(0xb0).readInt();
                    const banListInternalPtr = p.add(0x250).readPointer();
                    const banListInternal = readListInt(banListInternalPtr); 

                    // Sinkronisasi Backup Ban (Jika UIRankHero gagal, fallback ke RoomData)
                    if (banHeroInt > 0 && !payload.globalBanList.includes(banHeroInt)) {
                        payload.globalBanList.push(banHeroInt);
                    }
                    banListInternal.forEach(h => {
                        if (h > 0 && !payload.globalBanList.includes(h)) {
                            payload.globalBanList.push(h);
                        }
                    });

                    // Lock Pick
                    if (isLocked && heroId > 0 && !payload.globalPickList.includes(heroId)) {
                        payload.globalPickList.push(heroId);
                    }

                    // Tambahkan ke info pemain
                    payload.players.push({
                        uid: uid,
                        name: readCsharpString(namePtr),
                        camp: camp,
                        isLocked: isLocked,          
                        heroId: heroId,              
                        bannedHeroId: banHeroInt,    
                        banListInternal: banListInternal
                    });
                }
            }

            // Kirim payload via Socket Frida
            if (payload.players.length > 0) {
                send({ 
                    type: "draft_update_stable", 
                    payload: payload 
                });
            }

        } catch (e) {
            // Silent error agar tidak spam terminal
        }
    }, 1000); 
}

// --- BOOTSTRAP / PENGECEKAN MODUL ---
console.log("[*] Menunggu library liblogic.so termuat...");
const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { 
        clearInterval(check); 
        console.log("[+] liblogic.so ditemukan! Menginisiasi Scraper...");
        startScrapingStable(mod.name); 
    }
}, 2000);
