/**
 * MLBB Draft Pick Scraper (EVENT-DRIVEN & GLOBAL METHOD SEARCH)
 * Fitur:
 * - Anti-Stuck: Pencarian method dinamis menyapu seluruh class (menembus Nested Class).
 * - Zero Polling: Tidak membebani CPU, data hanya dibaca saat ada event.
 */

function startScrapingStable(libName) {
    const targetLib = Process.getModuleByName(libName);
    
    function n(name, ret, args) {
        const addr = targetLib.findExportByName(name);
        return addr ? new NativeFunction(addr, ret, args) : null;
    }

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

    function getOffset(klass, fieldName) {
        if (klass.isNull()) return -1;
        const field = il2cpp.class_get_field_from_name(klass, Memory.allocUtf8String(fieldName));
        if (field.isNull()) return -1;
        return il2cpp.field_get_offset(field);
    }

    console.log("[+] Mencari metadata dari Assembly-CSharp.dll...");
    let image, kSystemData, kLogicManager;
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
    }

    const getInfoFunc = new NativeFunction(il2cpp.class_get_method_from_name(kSystemData, Memory.allocUtf8String("GetBattlePlayerInfo"), 0).readPointer(), 'pointer', ['pointer']);
    const getBattleStateFunc = new NativeFunction(il2cpp.class_get_method_from_name(kLogicManager, Memory.allocUtf8String("GetBattleState"), 0).readPointer(), 'int', ['pointer']);
    const logicInstanceField = il2cpp.class_get_field_from_name(kLogicManager, Memory.allocUtf8String("Instance"));

    let roomDataOffsets = {};
    let isOffsetsCached = false;

    // FUNGSI UTAMA BACA MEMORI (Hanya dipanggil oleh Event)
    function extractFullRoomData(eventName) {
        try {
            const instPtr = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(logicInstanceField, instPtr);
            const inst = instPtr.readPointer();
            if (inst.isNull()) return;

            const state = getBattleStateFunc(inst); 
            if (state < 2) return; 

            let payload = {
                eventTrigger: eventName,
                gameState: state,
                globalBanList: [], 
                globalPickList: [], 
                players: []
            };

            const listPtr = getInfoFunc(NULL);
            if (!listPtr.isNull()) {
                const listSize = listPtr.add(0x18).readInt();
                const itemsArray = listPtr.add(0x10).readPointer();
                
                for (let i = 0; i < listSize; i++) {
                    const p = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                    if (p.isNull()) continue;

                    if (!isOffsetsCached) {
                        const kRoomData = il2cpp.object_get_class(p);
                        roomDataOffsets = {
                            lUid: getOffset(kRoomData, "lUid"),
                            iCamp: getOffset(kRoomData, "iCamp"),
                            sName: getOffset(kRoomData, "_sName"),
                            heroid: getOffset(kRoomData, "heroid"),
                            banHero: getOffset(kRoomData, "banHero"),
                            vOperBanHero: getOffset(kRoomData, "vOperBanHero"),
                            bIsReady: getOffset(kRoomData, "bIsReady"),             
                            bSelectHero: getOffset(kRoomData, "bSelectHero"),       
                            bAutoReadySelect: getOffset(kRoomData, "bAutoReadySelect"),
                            summonSkillId: getOffset(kRoomData, "summonSkillId"),
                            uiHeroIDChoose: getOffset(kRoomData, "uiHeroIDChoose"),
                        };
                        isOffsetsCached = true;
                    }

                    const uid = roomDataOffsets.lUid > 0 ? p.add(roomDataOffsets.lUid).readU64().toString() : "0";
                    const camp = roomDataOffsets.iCamp > 0 ? p.add(roomDataOffsets.iCamp).readInt() : 0;
                    const namePtr = roomDataOffsets.sName > 0 ? p.add(roomDataOffsets.sName).readPointer() : ptr(0);
                    const heroId = roomDataOffsets.heroid > 0 ? p.add(roomDataOffsets.heroid).readInt() : 0;
                    const summonSkillId = roomDataOffsets.summonSkillId > 0 ? p.add(roomDataOffsets.summonSkillId).readInt() : 0;
                    const uiHeroIDChoose = roomDataOffsets.uiHeroIDChoose > 0 ? p.add(roomDataOffsets.uiHeroIDChoose).readInt() : 0;
                    
                    let isLocked = false;
                    if (roomDataOffsets.bIsReady > 0 && p.add(roomDataOffsets.bIsReady).readU8() === 1) isLocked = true;
                    if (roomDataOffsets.bSelectHero > 0 && p.add(roomDataOffsets.bSelectHero).readU8() === 1) isLocked = true;
                    if (roomDataOffsets.bAutoReadySelect > 0 && p.add(roomDataOffsets.bAutoReadySelect).readU8() === 1) isLocked = true;

                    const banHeroInt = roomDataOffsets.banHero > 0 ? p.add(roomDataOffsets.banHero).readInt() : 0;
                    const banListInternalPtr = roomDataOffsets.vOperBanHero > 0 ? p.add(roomDataOffsets.vOperBanHero).readPointer() : ptr(0);
                    const banListInternal = readListInt(banListInternalPtr); 

                    if (banHeroInt > 0 && !payload.globalBanList.includes(banHeroInt)) payload.globalBanList.push(banHeroInt);
                    banListInternal.forEach(h => {
                        if (h > 0 && !payload.globalBanList.includes(h)) payload.globalBanList.push(h);
                    });

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
                        summonSkillId: summonSkillId,
                        uiHeroIDChoose: uiHeroIDChoose
                    });
                }
            }

            if (payload.players.length > 0) {
                send({ type: "draft_update_event", payload: payload });
            }

        } catch (e) { console.error(e); }
    }

    // ==========================================
    // MASS EVENT HOOKING (Jaring Lebar)
    // ==========================================
    function hookAllMethodsGlobally(methodName, argCount, eventTriggerName) {
        console.log(`[*] Mencari global method: ${methodName}(${argCount} argumen)...`);
        const mName = Memory.allocUtf8String(methodName);
        let count = 0;
        
        for (let j = 0; j < classCount; j++) {
            const k = il2cpp.image_get_class(image, j);
            if (k.isNull()) continue;
            
            const method = il2cpp.class_get_method_from_name(k, mName, argCount);
            if (!method.isNull()) {
                const className = il2cpp.class_get_name(k).readCString();
                count++;
                console.log(`[+] Memasang Hook ${methodName} di class: ${className}`);
                
                try {
                    Interceptor.attach(method.readPointer(), {
                        onEnter: function(args) {
                            console.log(`\n[!!!] EVENT DETECTED: ${eventTriggerName} (Terpicu dari Class: ${className})`);
                            
                            // Ekstrak data
                            extractFullRoomData(eventTriggerName);
                        }
                    });
                } catch (e) {
                    console.log(`[-] Gagal memasang hook pada ${className}::${methodName}`);
                }
            }
        }
        console.log(`[=] Total Hook untuk ${methodName} dipasang di ${count} class berbeda.\n`);
    }

    console.log("\n[+] Menyiapkan Event Hooking Massal...");

    // 1. Hook UI Events
    hookAllMethodsGlobally("OnBanned", 5, "ON_BANNED");
    hookAllMethodsGlobally("OnPicked", 4, "ON_PICKED");
    hookAllMethodsGlobally("OnConfirm", 5, "ON_CONFIRM_LOCK");

    // 2. Tambahan: Hook fungsi Report (Dipanggil saat game mengirim data ke server)
    // Ini sebagai jaring pengaman jika UI Hook gagal
    hookAllMethodsGlobally("ReportBanHero", 2, "REPORT_BAN_TO_SERVER");
    hookAllMethodsGlobally("ReportPickHero", 3, "REPORT_PICK_TO_SERVER");

    console.log("[+] Seluruh Event Hook MASSAL siap! Menunggu aksi player...\n");
}

console.log("[*] Menunggu library liblogic.so termuat...");
const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { 
        clearInterval(check); 
        console.log("[+] liblogic.so ditemukan! Menginisiasi Event Scraper...");
        startScrapingStable(mod.name); 
    }
}, 2000);
