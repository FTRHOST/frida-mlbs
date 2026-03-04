/**
 * MLBB Draft Pick Scraper (ULTIMATE & DYNAMIC STABLE)
 * Fitur:
 * - Dynamic Field Offsets: Tidak memakai offset manual (0x38, dll), anti-rusak saat ada patch minor.
 * - UIRankHero Instance Stealing: Menjamin Ban terdeteksi di Game State 3 secara Real-time.
 * - Lock Status Akurat: Menggabungkan bIsReady, bSelectHero, dan bAutoReadySelect.
 */

function startScrapingStable(libName) {
    const targetLib = Process.getModuleByName(libName);
    
    function n(name, ret, args) {
        const addr = targetLib.findExportByName(name);
        return addr ? new NativeFunction(addr, ret, args) : null;
    }

    // Mapping API il2cpp
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
        field_static_get_value: n("il2cpp_field_static_get_value", 'void', ['pointer', 'pointer']),
        field_get_offset: n("il2cpp_field_get_offset", 'uint32', ['pointer']),
        object_get_class: n("il2cpp_object_get_class", 'pointer', ['pointer'])
    };

    if (!il2cpp.domain_get) return console.log("[-] Gagal memetakan il2cpp API.");

    // --- HELPER BACA MEMORI STRUKTUR C# ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt();
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len);
        } catch (e) { return ""; }
    }
    
    function readListInt(listPtr) {
        if (listPtr.isNull()) return [];
        try {
            const itemsPtr = listPtr.add(0x10).readPointer();
            if (!itemsPtr.isNull()) {
                const size = listPtr.add(0x18).readInt();
                if (size > 0 && size < 50) {
                    let result = [];
                    for (let i = 0; i < size; i++) result.push(itemsPtr.add(0x20 + (i * 4)).readInt());
                    if (result.length > 0) return result;
                }
            }
        } catch(e) {}
        return [];
    }

    // Fungsi Pembacaan Dynamic Offset
    function getOffset(klass, fieldName) {
        if (klass.isNull()) return -1;
        const field = il2cpp.class_get_field_from_name(klass, Memory.allocUtf8String(fieldName));
        if (field.isNull()) return -1;
        return il2cpp.field_get_offset(field);
    }

    console.log("[+] Mencari metadata dari Assembly-CSharp.dll...");
    let image, kSystemData, kLogicManager, kUIRankHero;
    const assemblies = il2cpp.domain_get_assemblies(il2cpp.domain_get(), Memory.alloc(8));
    
    for (let i = 0; i < 100; i++) {
        const assembly = assemblies.add(i * Process.pointerSize).readPointer();
        if (assembly.isNull()) continue;
        const img = il2cpp.assembly_get_image(assembly);
        if (img.isNull()) continue;
        if (il2cpp.image_get_name(img).readCString() === "Assembly-CSharp.dll") { image = img; break; }
    }

    const classCount = Number(il2cpp.image_get_class_count(image));
    for (let j = 0; j < classCount; j++) {
        const k = il2cpp.image_get_class(image, j);
        const name = il2cpp.class_get_name(k).readCString();
        if (name === "SystemData") kSystemData = k;
        if (name === "LogicBattleManager") kLogicManager = k;
        if (name === "UIRankHero") kUIRankHero = k;
        if (kSystemData && kLogicManager && kUIRankHero) break; 
    }

    const getInfoFunc = new NativeFunction(il2cpp.class_get_method_from_name(kSystemData, Memory.allocUtf8String("GetBattlePlayerInfo"), 0).readPointer(), 'pointer', ['pointer']);
    const getBattleStateFunc = new NativeFunction(il2cpp.class_get_method_from_name(kLogicManager, Memory.allocUtf8String("GetBattleState"), 0).readPointer(), 'int', ['pointer']);
    const logicInstanceField = il2cpp.class_get_field_from_name(kLogicManager, Memory.allocUtf8String("Instance"));

    // ==========================================
    // TRICK: UIRANKHERO INSTANCE STEALING
    // ==========================================
    let uiRankHeroInst = ptr(0);
    const updateMethod = il2cpp.class_get_method_from_name(kUIRankHero, Memory.allocUtf8String("Update"), 0);
    if (!updateMethod.isNull()) {
        Interceptor.attach(updateMethod.readPointer(), {
            onEnter: function(args) {
                uiRankHeroInst = args[0]; // Tangkap instancenya secara real-time tiap frame!
            }
        });
        console.log("[+] Interceptor terpasang di UIRankHero::Update (Siap menangkap Real-time Bans)");
    }

    // Cache Offsets
    let roomDataOffsets = {};
    let uiRankHeroOffsets = {};
    let isOffsetsCached = false;

    console.log("[+] Memulai Scraper Loop tiap 1 detik...\n");

    setInterval(() => {
        try {
            const instPtr = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(logicInstanceField, instPtr);
            const inst = instPtr.readPointer();
            if (inst.isNull()) return;

            const state = getBattleStateFunc(inst); 
            if (state < 2) return; // 2 = Draft, 3 = Drafting Process, 5 = Loading

            let payload = {
                gameState: state,
                globalBanList: [], 
                globalPickList: [], 
                players: []
            };

            // 1. Ambil Real-Time BANS dari instance UIRankHero yang "dicuri"
            if (!uiRankHeroInst.isNull()) {
                if (uiRankHeroOffsets.totalBanOrder === undefined) {
                    uiRankHeroOffsets.totalBanOrder = getOffset(kUIRankHero, "totalBanOrder");
                    uiRankHeroOffsets.banOrder = getOffset(kUIRankHero, "banOrder");
                }
                
                // Coba ambil dari totalBanOrder atau banOrder
                const offsetToUse = uiRankHeroOffsets.totalBanOrder > 0 ? uiRankHeroOffsets.totalBanOrder : uiRankHeroOffsets.banOrder;
                if (offsetToUse > 0) {
                    const banListPtr = uiRankHeroInst.add(offsetToUse).readPointer();
                    const realTimeBans = readListInt(banListPtr);
                    realTimeBans.forEach(h => {
                        if (h > 0 && !payload.globalBanList.includes(h)) payload.globalBanList.push(h);
                    });
                }
            }

            // 2. Ambil Data Pemain & Picks dari RoomData
            const listPtr = getInfoFunc(NULL);
            if (!listPtr.isNull()) {
                const listSize = listPtr.add(0x18).readInt();
                const itemsArray = listPtr.add(0x10).readPointer();
                
                for (let i = 0; i < listSize; i++) {
                    const p = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                    if (p.isNull()) continue;

                    // Dinamis Offset (Hanya dipanggil sekali saat data pertama masuk)
                    if (!isOffsetsCached) {
                        const kRoomData = il2cpp.object_get_class(p);
                        roomDataOffsets = {
                            lUid: getOffset(kRoomData, "lUid"),
                            iCamp: getOffset(kRoomData, "iCamp"),
                            sName: getOffset(kRoomData, "_sName"),
                            heroid: getOffset(kRoomData, "heroid"),
                            banHero: getOffset(kRoomData, "banHero"),
                            vOperBanHero: getOffset(kRoomData, "vOperBanHero"),
                            bIsReady: getOffset(kRoomData, "bIsReady"),             // Indikator Lock
                            bSelectHero: getOffset(kRoomData, "bSelectHero"),       // Indikator Lock 2
                            bAutoReadySelect: getOffset(kRoomData, "bAutoReadySelect"),
                            summonSkillId: getOffset(kRoomData, "summonSkillId"),
                            uiHeroIDChoose: getOffset(kRoomData, "uiHeroIDChoose"),
                        };
                        isOffsetsCached = true;
                        console.log("[+] Offset Dinamis RoomData berhasil di-cache!");
                    }

                    // --- BACA MEMORI DENGAN OFFSET DINAMIS ---
                    const uid = roomDataOffsets.lUid > 0 ? p.add(roomDataOffsets.lUid).readU64().toString() : "0";
                    const camp = roomDataOffsets.iCamp > 0 ? p.add(roomDataOffsets.iCamp).readInt() : 0;
                    const namePtr = roomDataOffsets.sName > 0 ? p.add(roomDataOffsets.sName).readPointer() : ptr(0);
                    const heroId = roomDataOffsets.heroid > 0 ? p.add(roomDataOffsets.heroid).readInt() : 0;
                    const summonSkillId = roomDataOffsets.summonSkillId > 0 ? p.add(roomDataOffsets.summonSkillId).readInt() : 0;
                    const uiHeroIDChoose = roomDataOffsets.uiHeroIDChoose > 0 ? p.add(roomDataOffsets.uiHeroIDChoose).readInt() : 0;
                    
                    // --- LOGIKA ISLOCKED YANG AKURAT ---
                    let isLocked = false;
                    if (roomDataOffsets.bIsReady > 0 && p.add(roomDataOffsets.bIsReady).readU8() === 1) isLocked = true;
                    if (roomDataOffsets.bSelectHero > 0 && p.add(roomDataOffsets.bSelectHero).readU8() === 1) isLocked = true;
                    if (roomDataOffsets.bAutoReadySelect > 0 && p.add(roomDataOffsets.bAutoReadySelect).readU8() === 1) isLocked = true;

                    // Fallback Ban (Dari RoomData untuk Game State 5)
                    const banHeroInt = roomDataOffsets.banHero > 0 ? p.add(roomDataOffsets.banHero).readInt() : 0;
                    const banListInternalPtr = roomDataOffsets.vOperBanHero > 0 ? p.add(roomDataOffsets.vOperBanHero).readPointer() : ptr(0);
                    const banListInternal = readListInt(banListInternalPtr); 

                    if (banHeroInt > 0 && !payload.globalBanList.includes(banHeroInt)) payload.globalBanList.push(banHeroInt);
                    banListInternal.forEach(h => {
                        if (h > 0 && !payload.globalBanList.includes(h)) payload.globalBanList.push(h);
                    });

                    // Global Pick
                    if (isLocked && heroId > 0 && !payload.globalPickList.includes(heroId)) {
                        payload.globalPickList.push(heroId);
                    }

                    payload.players.push({
                        uid: uid,
                        name: readCsharpString(namePtr),
                        camp: camp,
                        isLocked: isLocked,          
                        heroId: heroId,              
                        bannedHeroId: banHeroInt,    
                        banListInternal: banListInternal,
                        summonSkillId: summonSkillId,
                        uiHeroIDChoose: uiHeroIDChoose
                    });
                }
            }

            if (payload.players.length > 0) {
                send({ type: "draft_update_stable", payload: payload });
            }

        } catch (e) { }
    }, 1000); 
}

console.log("[*] Menunggu library liblogic.so termuat...");
const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { 
        clearInterval(check); 
        console.log("[+] liblogic.so ditemukan! Menginisiasi Scraper...");
        startScrapingStable(mod.name); 
    }
}, 2000);
