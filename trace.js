/**
 * MLBB Ultimate Multi-Tracer Toolkit
 * Fitur: Full Tracer, Simple Tracer, Value Tracker, Memory Patcher, Return Value Patcher, Instantiator
 */

let il2cpp = null;
let lastFieldValues = {};

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
    field_get_offset: n("il2cpp_field_get_offset", 'uint32', ['pointer']),

    object_new: n("il2cpp_object_new", 'pointer', ['pointer']),
    thread_attach: n("il2cpp_thread_attach", 'pointer', ['pointer'])
  };
  console.log("[+] API IL2CPP Initialized.");
}

// =========================================================
// HELPER FUNCTIONS (BACA & TULIS MEMORI)
// =========================================================

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

function writeBooleanField(instancePtr, offset, newValue) {
  try {
    let addr = instancePtr.add(offset);
    addr.writeU8(newValue ? 1 : 0);
  } catch (e) { }
}

// =========================================================
// FITUR 1: TRACER (MODE FULL & SIMPLE)
// =========================================================

// Mode 1A: Tampilkan semua isi data (Full Dump)
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
        if (val !== 0 && val !== "0" && val !== "False" && val !== "???") {
          console.log(`  |-- ${f.name} (0x${f.offset.toString(16)}): ${val}`);
        }
      });
    }
  });
}

// Mode 1B: HANYA tampilkan method yang dipanggil (Simple Trace)
function traceMethodCalls(targetClassName) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  console.log(`[*] Simple Trace Aktif: Memantau alur method pada class '${targetClassName}'`);

  hookAllMethods(klassPtr, (methodName, args) => {
    // SEBELUMNYA:
    // console.log(`[CALL] ${targetClassName}::${methodName} terpanggil.`);

    // UBAH MENJADI:
    send({ type: 'log', message: `[CALL] ${targetClassName}::${methodName} terpanggil.` });
  });
}

// =========================================================
// FITUR 2: VALUE TRACKER (Pantau Perubahan Variabel)
// =========================================================

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
        console.log(`  |-- Value   : ${lastFieldValues[key]} -> ${currentVal}`);
      }
      lastFieldValues[key] = currentVal;
    });
  });
}

// =========================================================
// FITUR 3 & 4: MEMORY PATCHER & RETURN PATCHER
// =========================================================

function autoPatchBoolean(targetClassName, targetMethodName, targetFieldName, forceValue) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan!`);

  let targetOffset = -1;
  let fields = getAllFields(klassPtr);
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].name === targetFieldName) {
      targetOffset = fields[i].offset;
      break;
    }
  }

  if (targetOffset === -1) return console.log(`[!] Field ${targetFieldName} tidak ditemukan!`);

  let isFound = hookSpecificMethod(klassPtr, targetMethodName, (args) => {
    let instance = args[0];
    if (!instance.isNull()) writeBooleanField(instance, targetOffset, forceValue);
  });

  if (isFound) console.log(`[+] AutoPatch: Memaksa ${targetClassName}::${targetFieldName} menjadi ${forceValue}`);
}

function hookMethodReturnBool(targetClassName, targetMethodName, forceReturn) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan!`);

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let found = false;

  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    const name = il2cpp.method_get_name(methodPtr).readUtf8String();
    if (name === targetMethodName) {
      found = true;
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        try {
          Interceptor.attach(impl, {
            onLeave: function(retval) {
              retval.replace(ptr(forceReturn ? 1 : 0));
            }
          });
          console.log(`[+] Return Patcher: ${targetClassName}::${targetMethodName} sekarang return ${forceReturn}!`);
        } catch (e) { }
      }
      break;
    }
  }
}

// =========================================================
// FITUR 5: FAKE INSTANCE MAKER
// =========================================================

function createFakeInstance(targetClassName) {
  if (!il2cpp) return null;
  const domain = il2cpp.domain_get();
  il2cpp.thread_attach(domain);

  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return null;

  let newInst = il2cpp.object_new(klassPtr);
  console.log(newInst.isNull() ? `[!] Gagal membuat fake ${targetClassName}` : `[+] Fake Instance ${targetClassName}: ${newInst}`);
  return newInst;
}

// =========================================================
// INTERNAL IL2CPP SEARCHERS
// =========================================================

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
    } catch (e) { }
  }
}

function hookSpecificMethod(klassPtr, targetMethodName, callback) {
  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let found = false;
  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    const name = il2cpp.method_get_name(methodPtr).readUtf8String();
    if (name === targetMethodName) {
      found = true;
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        try {
          Interceptor.attach(impl, {
            onEnter: function(args) { callback(args); }
          });
        } catch (e) { }
      }
      break;
    }
  }
  return found;
}

// =========================================================
// EXECUTION BLOCK (TULIS PERINTAHMU DI SINI)
// =========================================================

const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);

    // Beri jeda agar game loading terlebih dahulu
    setTimeout(() => {

      // 1A. Mode Full (Melihat isi field saat method dipanggil)
      // traceClassFull("SystemData");

      // 1B. Mode Simple (Hanya melihat log "Method terpanggil")
      traceMethodCalls("SystemData");

      // 2. Track perubahan isi field tertentu saja
      // trackFieldChanges("SystemData", ["bIsForbidSkin"]);
      // trackFieldChanges("RoomData", ["heroid", "_sName", "iCamp", "uiRankLevel"]);

      // 3. Auto Patch Return Value Method (Permintaanmu sebelumnya)
      hookMethodReturnBool("SystemData", "IsForbidSkin", false);

    }, 5000); // 5000 ms = 5 detik delay

  }
}, 1000);
