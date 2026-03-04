/*
 * MLBB DRAFT PICK - BYPASS ERROR VERSION
 */

function solve() {
    const libName = "liblogic.so";
    const mod = Process.findModuleByName(libName);
    if (!mod) return;

    const il2cpp = {
        domain_get: new NativeFunction(mod.findExportByName("il2cpp_domain_get"), 'pointer', []),
        domain_get_assemblies: new NativeFunction(mod.findExportByName("il2cpp_domain_get_assemblies"), 'pointer', ['pointer', 'pointer']),
        assembly_get_image: new NativeFunction(mod.findExportByName("il2cpp_assembly_get_image"), 'pointer', ['pointer']),
        class_from_name: new NativeFunction(mod.findExportByName("il2cpp_class_from_name"), 'pointer', ['pointer', 'pointer', 'pointer']),
        class_get_methods: new NativeFunction(mod.findExportByName("il2cpp_class_get_methods"), 'pointer', ['pointer', 'pointer']),
        method_get_name: new NativeFunction(mod.findExportByName("il2cpp_method_get_name"), 'pointer', ['pointer'])
    };

    console.log("[*] Mencari Metadata...");
    let kChooseHeroMgr = ptr(0);
    const assemblies = il2cpp.domain_get_assemblies(il2cpp.domain_get(), Memory.alloc(8));
    
    for (let i = 0; i < 100; i++) {
        let ass = assemblies.add(i * Process.pointerSize).readPointer();
        if (ass.isNull()) break;
        let img = il2cpp.assembly_get_image(ass);
        kChooseHeroMgr = il2cpp.class_from_name(img, Memory.allocUtf8String(""), Memory.allocUtf8String("ChooseHeroMgr"));
        if (!kChooseHeroMgr.isNull()) break;
    }

    if (kChooseHeroMgr.isNull()) {
        console.log("[-] ChooseHeroMgr tidak ditemukan.");
        return;
    }

    // Ambil alamat ConfirmChooseHero secara manual (alamat yang sebelumnya berhasil di log Anda)
    let confirmMethodAddr = ptr(0);
    let iter = Memory.alloc(Process.pointerSize).writePointer(ptr(0));
    let method;
    while (!(method = il2cpp.class_get_methods(kChooseHeroMgr, iter)).isNull()) {
        if (il2cpp.method_get_name(method).readCString() === "ConfirmChooseHero") {
            confirmMethodAddr = method.readPointer();
            break;
        }
    }

    if (confirmMethodAddr.isNull()) {
        console.log("[-] Method ConfirmChooseHero tidak ditemukan.");
        return;
    }

    console.log("[+] Hook terpasang pada: " + confirmMethodAddr);

    Interceptor.attach(confirmMethodAddr, {
        onEnter: function(args) {
            // args[0] adalah instance ChooseHeroMgr
            const instance = args[0];
            if (instance.isNull() || instance.toInt32() < 0x1000) return;

            console.log("[EVENT] ConfirmChooseHero dipicu!");
            
            try {
                // Offset List Player Kawan (0x2c8)
                let listPtr = instance.add(0x2c8).readPointer();
                if (!listPtr.isNull()) {
                    let size = listPtr.add(0x18).readInt();
                    console.log("[DRAFT] Data terdeteksi. Jumlah Player: " + size);
                    
                    // Kita bisa tambahkan pembacaan ID Hero di sini
                    // heroID biasanya ada di offset 0x4c di dalam RoomData
                }
            } catch (e) {
                console.log("[-] Error saat membaca data: " + e);
            }
        }
    });

    console.log("[!] Silakan masuk ke Draft Pick dan pilih/lock hero untuk melihat log.");
}

setTimeout(solve, 4000);
