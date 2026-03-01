/**
 * MLBB Draft Pick Scraper (STABLE & DIRECT MEMORY READ)
 * Mengabaikan UI Hook yang tidak stabil.
 * Langsung membaca Data Core dari RoomData.
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
        field_static_get_value: n("il2cpp_field_static_get_value", 'void', ['pointer', 'pointer'])
    };

    // --- HELPER BACA MEMORI ---
    function readCsharpString(ptr) {
        if (ptr.isNull()) return "";
        try {
            const len = ptr.add(0x10).readInt();
            if (len <= 0 || len > 200) return "";
            return ptr.add(0x14).readUtf16String(len);
        } catch(e) { return ""; }
    }
    
    function readListInt(listPtr) {
        if (listPtr.isNull()) return [];
        try {
            // Coba List/Array standar
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

    let image, kSystemData, kLogicManager;
    const assemblies = il2cpp.domain_get_assemblies(il2cpp.domain_get(), Memory.alloc(8));
    
    for (let i = 0; i < 100; i++) {
        const assembly = assemblies.add(i * Process.pointerSize).readPointer();
        if (assembly.isNull()) continue;
        const img = il2cpp.assembly_get_image(assembly);
        if (img.isNull()) continue;
        if (il2cpp.image_get_name(img).readCString() === "Assembly-CSharp.dll") { image = img; break; }
    }
    if (!image) return;

    const classCount = Number(il2cpp.image_get_class_count(image));
    for (let j = 0; j < classCount; j++) {
        const k = il2cpp.image_get_class(image, j);
        const name = il2cpp.class_get_name(k).readCString();
        if (name === "SystemData") kSystemData = k;
        if (name === "LogicBattleManager") kLogicManager = k;
    }

    const getInfoFunc = new NativeFunction(il2cpp.class_get_method_from_name(kSystemData, Memory.allocUtf8String("GetBattlePlayerInfo"), 0).readPointer(), 'pointer', ['pointer']);
    const getBattleStateFunc = new NativeFunction(il2cpp.class_get_method_from_name(kLogicManager, Memory.allocUtf8String("GetBattleState"), 0).readPointer(), 'int', ['pointer']);
    const instanceField = il2cpp.class_get_field_from_name(kLogicManager, Memory.allocUtf8String("Instance"));

    // --- LOOP UTAMA ---
    setInterval(() => {
        try {
            const instPtr = Memory.alloc(Process.pointerSize);
            il2cpp.field_static_get_value(instanceField, instPtr);
            const inst = instPtr.readPointer();
            if (inst.isNull()) return;

            // 0=Init, 1=Matching, 2=Draft/Loading, 3=Battle
            const state = getBattleStateFunc(inst); 
            if (state < 2) return; // Belum masuk draft/room, abaikan

            let payload = {
                gameState: state,
                globalBanList: [], // Kita susun dari data per-player
                globalPickList: [], // Kita susun dari data per-player
                players: []
            };

            const listPtr = getInfoFunc(NULL);
            if (!listPtr.isNull()) {
                const listSize = listPtr.add(0x18).readInt();
                const itemsArray = listPtr.add(0x10).readPointer();
                
                for (let i = 0; i < listSize; i++) {
                    const p = itemsArray.add(0x20 + (i * Process.pointerSize)).readPointer();
                    if (p.isNull()) continue;
                    
                    const namePtr = p.add(0x40).readPointer();
                    const isLocked = p.add(0x38).readU8() === 1; // bAutoReadySelect (Biasanya jadi indikator Lock Hero)
                    const heroId = p.add(0x4c).readInt();
                    const banHeroInt = p.add(0xb0).readInt();
                    
                    // Ekstrak List Ban Internal (vOperBanHero = 0x250)
                    const banListInternal = readListInt(p.add(0x250).readPointer()); 

                    // --- PENGUMPULAN DATA GLOBAL ---
                    // Jika player sudah nge-Ban hero
                    if (banHeroInt > 0 && !payload.globalBanList.includes(banHeroInt)) {
                        payload.globalBanList.push(banHeroInt);
                    }
                    banListInternal.forEach(h => {
                        if (h > 0 && !payload.globalBanList.includes(h)) payload.globalBanList.push(h);
                    });

                    // Jika player sudah Lock hero
                    if (isLocked && heroId > 0 && !payload.globalPickList.includes(heroId)) {
                        payload.globalPickList.push(heroId);
                    }

                    // --- DATA PER PLAYER ---
                    payload.players.push({
                        uid: p.add(0x20).readU64().toString(),
                        name: readCsharpString(namePtr),
                        camp: p.add(0x30).readInt(), // Tim 1 atau Tim 2
                        isLocked: isLocked,          // Sudah konfirmasi?
                        heroId: heroId,              // Hero yang di-Hover (jika belum lock) atau di-Pick (jika sudah lock)
                        bannedHeroId: banHeroInt,    // Hero yang diban oleh slot ini
                        banListInternal: banListInternal
                    });
                }
            }

            if (payload.players.length > 0) {
                send({ type: "draft_update_stable", payload: payload });
            }

        } catch (e) {
            // Silent error
        }
    }, 1000);
}

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so");
    if (mod) { clearInterval(check); startScrapingStable(mod.name); }
}, 2000);
