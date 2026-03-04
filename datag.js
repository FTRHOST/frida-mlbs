/**
 * MLBB Draft Pick Extractor - DYNAMIC OFFSET + GAME STATE TRACKER
 */

function startDraftExtractorDynamic(libName) {
    const targetLib = Process.getModuleByName(libName);
    
    // Variabel global untuk melacak Game State saat ini
    // Default kita set 0, akan berubah saat event terpicu
    let currentGameState = 0; 
    
    function getIl2cppApi() {
        const n = (name, ret, args) => {
            const addr = targetLib.findExportByName(name);
            return addr ? new NativeFunction(addr, ret, args) : null;
        };
        
        return {
            domain_get: n("il2cpp_domain_get", 'pointer', []),
            domain_get_assemblies: n("il2cpp_domain_get_assemblies", 'pointer', ['pointer', 'pointer']),
            assembly_get_image: n("il2cpp_assembly_get_image", 'pointer', ['pointer']),
            image_get_class_count: n("il2cpp_image_get_class_count", 'uint64', ['pointer']),
            image_get_class: n("il2cpp_image_get_class", 'pointer', ['pointer', 'uint64']),
            class_get_name: n("il2cpp_class_get_name", 'pointer', ['pointer']),
            class_get_method_from_name: n("il2cpp_class_get_method_from_name", 'pointer', ['pointer', 'pointer', 'int']),
            class_get_fields: n("il2cpp_class_get_fields", 'pointer', ['pointer', 'pointer']),
            field_get_name: n("il2cpp_field_get_name", 'pointer', ['pointer']),
            field_get_offset: n("il2cpp_field_get_offset", 'uint32', ['pointer'])
        };
    }

    const il2cpp = getIl2cppApi();
    
    const DynamicOffsets = {
        CompetitionData: {},
        ReportPlayerInfo: {} 
    };

    function resolveFieldOffset(klassPtr, targetFieldName) {
        let iter = Memory.alloc(Process.pointerSize);
        iter.writePointer(NULL);
        let fieldPtr;
        
        while (!(fieldPtr = il2cpp.class_get_fields(klassPtr, iter)).isNull()) {
            let namePtr = il2cpp.field_get_name(fieldPtr);
            let fieldName = namePtr.readUtf8String();
            
            if (fieldName.toLowerCase() === targetFieldName.toLowerCase()) {
                return il2cpp.field_get_offset(fieldPtr);
            }
        }
        return -1; 
    }

    function initializeDynamicOffsets() {
        console.log("[*] Memulai pemindaian struktur dinamis...");
        const domain = il2cpp.domain_get();
        let size = Memory.alloc(8);
        const assemblies = il2cpp.domain_get_assemblies(domain, size);
        const count = size.readUInt();

        let foundCompData = false;
        let foundPlayerInfo = false;

        for (let i = 0; i < count; i++) {
            if (foundCompData && foundPlayerInfo) break; 

            const assembly = assemblies.add(i * Process.pointerSize).readPointer();
            const image = il2cpp.assembly_get_image(assembly);
            const classCount = il2cpp.image_get_class_count(image);

            for (let j = 0; j < classCount; j++) {
                const klass = il2cpp.image_get_class(image, j);
                if (klass.isNull()) continue;

                const className = il2cpp.class_get_name(klass).readUtf8String();

                if (className === "CompetitionData") {
                    DynamicOffsets.CompetitionData.m_reportPlayerInfos = resolveFieldOffset(klass, "m_reportPlayerInfos");
                    foundCompData = true;
                }
                
                if (className === "ReportPlayerInfo" || className === "PlayerInfo") {
                    const fieldsToFind = ["uid", "name", "iCamp", "heroId", "banHero", "summonSkillId"];
                    fieldsToFind.forEach(f => {
                        let off = resolveFieldOffset(klass, f);
                        if(off !== -1) {
                            DynamicOffsets.ReportPlayerInfo[f] = off;
                        } else {
                            let fallback = f === "iCamp" ? "camp" : (f === "banHero" ? "bannedHeroId" : f);
                            let offFallback = resolveFieldOffset(klass, fallback);
                            if(offFallback !== -1) DynamicOffsets.ReportPlayerInfo[f] = offFallback;
                        }
                    });
                    foundPlayerInfo = true;
                }
            }
        }
        console.log("[+] Struktur Dinamis berhasil di-resolve.");
    }

    function extractPlayerData(competitionDataPtr) {
        if (!competitionDataPtr || competitionDataPtr.isNull()) return null;

        const off_reportPlayers = DynamicOffsets.CompetitionData.m_reportPlayerInfos;
        if (!off_reportPlayers || off_reportPlayers === -1) return "Offset list pemain gagal diresolve.";

        try {
            const listPtr = competitionDataPtr.add(off_reportPlayers).readPointer();
            if (listPtr.isNull()) return null;

            const arrayPtr = listPtr.add(0x10).readPointer();
            const listSize = listPtr.add(0x18).readInt();

            let players = [];
            const pOffsets = DynamicOffsets.ReportPlayerInfo;

            if (listSize > 0 && listSize <= 10) {
                const itemsBase = arrayPtr.add(0x20); 
                
                for (let i = 0; i < listSize; i++) {
                    const playerObjPtr = itemsBase.add(i * Process.pointerSize).readPointer();
                    if (playerObjPtr.isNull()) continue;

                    let uid = "";
                    let name = "";
                    
                    if (pOffsets.uid) {
                        let uidPtr = playerObjPtr.add(pOffsets.uid).readPointer();
                        uid = uidPtr.isNull() ? "" : uidPtr.add(0x14).readUtf16String(); 
                    }
                    
                    if (pOffsets.name) {
                        let namePtr = playerObjPtr.add(pOffsets.name).readPointer();
                        name = namePtr.isNull() ? "" : namePtr.add(0x14).readUtf16String();
                    }
                    
                    players.push({
                        uid: uid,
                        name: name,
                        camp: pOffsets.iCamp ? playerObjPtr.add(pOffsets.iCamp).readInt() : 0,
                        heroId: pOffsets.heroId ? playerObjPtr.add(pOffsets.heroId).readInt() : 0,
                        bannedHeroId: pOffsets.banHero ? playerObjPtr.add(pOffsets.banHero).readInt() : 0,
                        summonSkillId: pOffsets.summonSkillId ? playerObjPtr.add(pOffsets.summonSkillId).readInt() : 0
                    });
                }
            }
            return players;
        } catch (e) {
            return null;
        }
    }

    function findAndHookMethod(classNameToFind, methodNameToFind, eventName, onEnterCallback) {
        const domain = il2cpp.domain_get();
        let size = Memory.alloc(8);
        const assemblies = il2cpp.domain_get_assemblies(domain, size);
        const count = size.readUInt();

        for (let i = 0; i < count; i++) {
            const assembly = assemblies.add(i * Process.pointerSize).readPointer();
            const image = il2cpp.assembly_get_image(assembly);
            const classCount = il2cpp.image_get_class_count(image);

            for (let j = 0; j < classCount; j++) {
                const klass = il2cpp.image_get_class(image, j);
                if (klass.isNull()) continue;

                const cNamePtr = il2cpp.class_get_name(klass);
                if (cNamePtr.readUtf8String() === classNameToFind) {
                    const methodPtr = il2cpp.class_get_method_from_name(klass, Memory.allocUtf8String(methodNameToFind), -1);
                    if (!methodPtr.isNull()) {
                        const methodAddress = methodPtr.readPointer();
                        
                        Interceptor.attach(methodAddress, {
                            onEnter: function(args) {
                                if (args[0] && !args[0].isNull()) {
                                    let heroActionData = null;
                                    if (onEnterCallback) heroActionData = onEnterCallback(args);
                                    
                                    // Ekstrak player data HANYA jika bukan event EndBattle
                                    let playersData = (eventName !== "BATTLE_ENDED") ? extractPlayerData(args[0]) : [];

                                    send({
                                        type: "draft_update_event", // Disesuaikan dengan format log lamamu
                                        payload: {
                                            eventTrigger: eventName,
                                            gameState: currentGameState, // <-- GAME STATE DISISIPKAN DI SINI
                                            heroAction: heroActionData,
                                            players: playersData
                                        }
                                    });
                                }
                            }
                        });
                        return true;
                    }
                }
            }
        }
        return false;
    }

    initializeDynamicOffsets();

    console.log("\n[+] Menyiapkan Event Hooking & Game State Tracker...");

    // 1. Hook State 3: Fase Draft Dimulai
    findAndHookMethod("CompetitionData", "ReportBanStart", "DRAFT_START", function(args) {
        currentGameState = 3; // Update state ke Draft
        console.log(`[*] Game State Berubah: ${currentGameState} (Draft Pick)`);
        return { status: "Drafting_Initiated" };
    });

    // 2. Hook Aksi Draft (Ban & Pick)
    findAndHookMethod("CompetitionData", "ReportBanHero", "REPORT_BAN_TO_SERVER", function(args) {
        currentGameState = 3; // Pastikan state tetap 3
        try { return { heroId: args[2].toInt32() }; } catch(e) { return null; }
    });

    findAndHookMethod("CompetitionData", "ReportPickHero", "REPORT_PICK_TO_SERVER", function(args) {
        currentGameState = 3; // Pastikan state tetap 3
        try { return { heroId: args[2].toInt32() }; } catch(e) { return null; }
    });
    
    // 3. Hook State 4: Masuk ke Land of Dawn (Battle)
    findAndHookMethod("CompetitionData", "OnStartBattle", "BATTLE_STARTED", function(args) {
        currentGameState = 4; // Update state ke In-Game/Battle
        console.log(`[*] Game State Berubah: ${currentGameState} (Battle Started)`);
        return { status: "Welcome to Mobile Legends" };
    });

    // 4. Hook State 5: Pertandingan Selesai
    findAndHookMethod("CompetitionData", "OnEndBattle", "BATTLE_ENDED", function(args) {
        currentGameState = 5; // Update state ke Post-Match
        console.log(`[*] Game State Berubah: ${currentGameState} (Battle Ended)`);
        return { status: "Match Finished" };
    });

    console.log("[+] Seluruh Event Hook siap!\n");
}

console.log("[*] Menunggu library termuat...");
const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
    if (mod) { 
        clearInterval(check); 
        console.log(`[+] ${mod.name} ditemukan! Menginisiasi Scraper...`);
        startDraftExtractorDynamic(mod.name); 
    }
}, 1000);
