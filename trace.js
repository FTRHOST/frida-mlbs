/**
 * MLBB Multi-Tracer: Full Class Tracer & Value Change Tracker
 */

let il2cpp = null;
let lastFieldValues = {}; // Untuk menyimpan state pada Value Tracker

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
        method_get_name: n("il2cpp_method_get_name", 'pointer', ['pointer']),
        method_get_param_count: n("il2cpp_method_get_param_count", 'uint32', ['pointer']),
        class_get_fields: n("il2cpp_class_get_fields", 'pointer', ['pointer', 'pointer']),
        field_get_name: n("il2cpp_field_get_name", 'pointer', ['pointer']),
        field_get_offset: n("il2cpp_field_get_offset", 'uint32', ['pointer'])
    };
    console.log("[+] API IL2CPP Initialized.");
}

// Helper: Membaca data berdasarkan tipe (Heuristic)
function readFieldData(instancePtr, offset, fieldName) {
    try {
        let addr = instancePtr.add(offset);
        let name = fieldName.toLowerCase();
        
        if (name.includes("name") || name.startsWith("s")) {
            let strPtr = addr.readPointer();
            return strPtr.isNull() ? "null" : strPtr.add(0x14).readUtf16String();
        }
        if (name.startsWith("b") || name.includes("is")) {
            return addr.readU8() === 1 ? "True" : "False";
        }
        return addr.readInt();
    } catch (e) { return "???"; }
}

// 1. FUNGSI FULL TRACE (Melihat Semua Field di Setiap Panggilan)
function traceClassFull(targetClassName) {
    if (!il2cpp) return;
    let klassPtr = findClassPtr(targetClassName);
    if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

    let fields = getAllFields(klassPtr);
    console.log(`[*] Full Trace Aktif: ${targetClassName} (${fields.length} fields)`);

    hookAllMethods(klassPtr, (methodName, args) => {
        console.log(`\n[FULL-LOG] ${targetClassName}::${methodName}`);
        if (args[0] && !args[0].isNull()) {
            fields.forEach(f => {
                let val = readFieldData(args[0], f.offset, f.name);
                if (val !== 0 && val !== "0" && val !== "False") { // Filter data kosong agar tidak spam
                    console.log(`  |-- ${f.name} (0x${f.offset.toString(16)}): ${val}`);
                }
            });
        }
    });
}

// 2. FUNGSI SPECIFIC TRACKER (Hanya Log jika Nilai Berubah)
function trackFieldChanges(targetClassName, targetFields) {
    if (!il2cpp) return;
    let klassPtr = findClassPtr(targetClassName);
    if (!klassPtr) return;

    let allFields = getAllFields(klassPtr);
    let tracked = allFields.filter(f => targetFields.includes(f.name));

    console.log(`[*] Value Tracker Aktif untuk: ${targetFields.join(", ")}`);

    hookAllMethods(klassPtr, (methodName, args) => {
        let instance = args[0];
        if (instance.isNull()) return;

        tracked.forEach(f => {
            let currentVal = readFieldData(instance, f.offset, f.name);
            let key = `${instance}-${f.name}`;

            if (lastFieldValues[key] !== undefined && lastFieldValues[key] !== currentVal) {
                console.log(`\n[CHANGE] ${targetClassName}::${f.name}`);
                console.log(`  |-- Method  : ${methodName}`);
                console.log(`  |-- Instance: ${instance}`);
                console.log(`  |-- Value   : ${lastFieldValues[key]} -> ${currentVal}`);
            }
            lastFieldValues[key] = currentVal;
        });
    });
}

// --- Internal Helpers ---

function findClassPtr(name) {
    const domain = il2cpp.domain_get();
    let size = Memory.alloc(8);
    const assemblies = il2cpp.domain_get_assemblies(domain, size);
    for (let i = 0; i < size.readUInt(); i++) {
        const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
        for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
            const klass = il2cpp.image_get_class(img, j);
            if (!klass.isNull() && il2cpp.class_get_name(klass).readUtf8String() === name) return klass;
        }
    }
    return null;
}

function getAllFields(klassPtr) {
    let results = [];
    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let fieldPtr;
    while (!(fieldPtr = il2cpp.class_get_fields(klassPtr, iter)).isNull()) {
        results.push({
            name: il2cpp.field_get_name(fieldPtr).readUtf8String(),
            offset: il2cpp.field_get_offset(fieldPtr)
        });
    }
    return results;
}

function hookAllMethods(klassPtr, callback) {
    let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
    let methodPtr;
    while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
        const name = il2cpp.method_get_name(methodPtr).readUtf8String();
        const impl = methodPtr.readPointer();
        if (impl.isNull() || name === ".ctor") continue;
        try {
            Interceptor.attach(impl, {
                onEnter: function(args) { callback(name, args); }
            });
        } catch(e) {}
    }
}

// --- Execution ---

const check = setInterval(() => {
    const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
    if (mod) { 
        clearInterval(check); 
        initIl2cpp(mod.name);

        // CONTOH PEMAKAIAN:
        
        // 1. Gunakan ini untuk melihat SEMUA data (Full Trace)
        traceClassFull("RoomData"); 

        // 2. Gunakan ini untuk memantau PERUBAHAN data spesifik saja (Specific Tracker)
        // trackFieldChanges("RoomData", ["lUid", "_sName", "iCamp", "iRoad", "heroid", "summonSkillId", "iRoad"]);
    }
}, 1000);
