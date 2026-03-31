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
    thread_attach: n("il2cpp_thread_attach", 'pointer', ['pointer']),
    string_new: n("il2cpp_string_new", 'pointer', ['pointer'])
  };
  console.log("[+] API IL2CPP Initialized.");
}

// =========================================================
// HELPER FUNCTIONS (BACA & TULIS MEMORI)
// =========================================================


// Membaca objek System.String dari memori IL2CPP
function readIl2CppString(strPtr) {
  if (strPtr == null || strPtr.isNull() || strPtr.toInt32() === 0) return null;
  try {
    // Pada arsitektur IL2CPP, teks aslinya (UTF-16) disimpan pada offset 0x14 dari pointer string
    return strPtr.add(0x14).readUtf16String();
  } catch (e) {
    return null;
  }
}

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
    console.log(`[CALL] ${targetClassName}::${methodName} terpanggil.`);
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
// FITUR 6: METADATA SCANNER (Mencari Class/Method/Field)
// =========================================================

function searchKeyword(keyword) {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");

  const target = keyword.toLowerCase();
  console.log(`\n[*] Memulai pemindaian metadata untuk kata kunci: "${keyword}"...`);
  console.log(`[*] Proses ini mungkin membuat game freeze selama beberapa detik. Harap tunggu...\n`);

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  let foundClassesCount = 0;

  // 1. Looping semua Assemblies di dalam Game
  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    const classCount = il2cpp.image_get_class_count(img);

    // 2. Looping semua Classes di dalam Assembly
    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      const className = il2cpp.class_get_name(klass).readUtf8String();
      const classNameLower = className.toLowerCase();

      let isClassMatch = classNameLower.includes(target);
      let matchedMethods = [];
      let matchedFields = [];

      // 3. Scan Methods di dalam Class
      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let methodPtr;
      while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
        const methodName = il2cpp.method_get_name(methodPtr).readUtf8String();
        if (methodName.toLowerCase().includes(target)) {
          matchedMethods.push(methodName);
        }
      }

      // 4. Scan Fields di dalam Class
      iter.writePointer(NULL); // Reset iterator
      let fieldPtr;
      while (!(fieldPtr = il2cpp.class_get_fields(klass, iter)).isNull()) {
        const fieldName = il2cpp.field_get_name(fieldPtr).readUtf8String();
        const offset = il2cpp.field_get_offset(fieldPtr);
        if (fieldName.toLowerCase().includes(target)) {
          matchedFields.push({ name: fieldName, offset: offset });
        }
      }

      // 5. Jika ada kecocokan pada Class, Method, atau Field, print hasilnya
      if (isClassMatch || matchedMethods.length > 0 || matchedFields.length > 0) {
        foundClassesCount++;
        console.log(`[+] Class: ${className}`);

        if (matchedFields.length > 0) {
          console.log(`    |-- Fields:`);
          matchedFields.forEach(f => console.log(`        --> ${f.name} (Offset: 0x${f.offset.toString(16)})`));
        }

        if (matchedMethods.length > 0) {
          console.log(`    |-- Methods:`);
          matchedMethods.forEach(m => console.log(`        --> ${m}()`));
        }
        console.log(`---------------------------------------------------`);
      }
    }
  }

  console.log(`\n[*] Pemindaian selesai! Ditemukan ${foundClassesCount} class yang mengandung unsur "${keyword}".`);
}

// =========================================================
// FITUR 7 (UPDATE): UI TEXT GLOBAL TRACKER (ANTI-CRASH)
// =========================================================

function readIl2CppStringSafe(strPtr) {
  if (!strPtr || strPtr.isNull() || strPtr.toInt32() === 0) return null;
  try {
    if (Process.findRangeByAddress(strPtr)) {
      return strPtr.add(0x14).readUtf16String();
    }
  } catch (e) { }
  return null;
}

function traceUITextOrigin(searchString) {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");

  console.log(`\n[*] Global UI Tracker Aktif untuk teks: "${searchString}"...`);
  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  let hookedCount = 0;
  // Memasukkan variasi nama method UI dari berbagai engine (Unity, FairyGUI, NGUI)
  const targetMethods = ["set_text", "set_Text", "set_content", "set_htmlText", "SetText"];

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    const classCount = il2cpp.image_get_class_count(img);

    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      const className = il2cpp.class_get_name(klass).readUtf8String();
      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let methodPtr;

      while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
        const methodName = il2cpp.method_get_name(methodPtr).readUtf8String();

        if (targetMethods.includes(methodName)) {
          const impl = methodPtr.readPointer();
          if (!impl.isNull()) {
            try {
              Interceptor.attach(impl, {
                onEnter: function(args) {
                  let textVal = readIl2CppStringSafe(args[1]);
                  if (textVal && textVal.toLowerCase().includes(searchString.toLowerCase())) {
                    console.log(`\n[!] STRING MUNCUL DI LAYAR: "${textVal}"`);
                    console.log(`    => Dihasilkan oleh Class: ${className} | Method: ${methodName}`);
                  }
                }
              });
              hookedCount++;
            } catch (e) { }
          }
        }
      }
    }
  }
  console.log(`[*] Berhasil memasang pemantau pada ${hookedCount} method UI di seluruh game.`);
}

// =========================================================
// FITUR 9: REAL-TIME UI TEXT REPLACER (PENGUBAH TEKS)
// =========================================================

function replaceUIText(searchString, replaceString) {
  if (!il2cpp || !il2cpp.string_new) return console.log("[!] IL2CPP / string_new belum siap!");

  console.log(`\n[*] Text Replacer Aktif: Mengubah "${searchString}" menjadi "${replaceString}"...`);

  // Attach thread agar kita bisa membuat object string baru dengan aman
  const domain = il2cpp.domain_get();
  il2cpp.thread_attach(domain);

  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  let hookedCount = 0;
  const targetMethods = ["set_text", "set_Text", "set_content", "SetText"];

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    const classCount = il2cpp.image_get_class_count(img);

    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let methodPtr;

      while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
        const methodName = il2cpp.method_get_name(methodPtr).readUtf8String();

        if (targetMethods.includes(methodName)) {
          const impl = methodPtr.readPointer();
          if (!impl.isNull()) {
            try {
              Interceptor.attach(impl, {
                onEnter: function(args) {
                  // args[1] adalah pointer ke teks asli yang mau ditampilkan
                  let textVal = readIl2CppStringSafe(args[1]);

                  if (textVal && textVal.toLowerCase().includes(searchString.toLowerCase())) {

                    // 1. Buat string C standar dari teks pengganti kita
                    let newCStr = Memory.allocUtf8String(replaceString);

                    // 2. Ubah string C tersebut menjadi IL2CPP String Object resmi
                    let newIl2cppStr = il2cpp.string_new(newCStr);

                    // 3. TUKAR POINTERNYA! (Manipulasi argumen)
                    // Game sekarang berpikir ia sedang merender teks aslinya, 
                    // padahal kita sudah menukar pointernya ke teks palsu kita.
                    args[1] = newIl2cppStr;

                    console.log(`[+] Teks Berhasil Diubah: "${textVal}" -> "${replaceString}"`);
                  }
                }
              });
              hookedCount++;
            } catch (e) { }
          }
        }
      }
    }
  }
  console.log(`[*] Replacer siap pada ${hookedCount} fungsi UI.`);
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
      // traceClassFull("UILabel");

      // 1B. Mode Simple (Hanya melihat log "Method terpanggil")
      // traceMethodCalls("SystemData");

      // 2. Track perubahan isi field tertentu saja
      // trackFieldChanges("UILabel", ["set_text"]);

      // 3. Auto Patch Return Value Method (Permintaanmu sebelumnya)
      hookMethodReturnBool("SystemData", "IsForbidHeros", false);
      hookMethodReturnBool("SystemData", "IsActivityForbidHeros", false);
      hookMethodReturnBool("DownloadInfoGroup", "IsForbidDownload", false);
      hookMethodReturnBool("DownloadInfoGroup", "IsManualDownload", false);
      hookMethodReturnBool("MobaScriptToMobaPlgBridge", "IsForbidAsset", false);
      hookMethodReturnBool("SystemData", "IsForbidRoomBorder", false);
      hookMethodReturnBool("ModelControlActivity", "CheckAniEmojiForbid", false);
      //hookMethodReturnBool("UIChooseHero", "CanSelectSkin", true);


      // traceMethodCalls("UIChooseHero");
      // trackFieldChanges("UIChooseHero", ["SelectSkin"]);
      traceMethodCalls("UIChooseHero", "SelectSkin");

      // searchKeyword("PetwirKepo")
      // traceUITextOrigin("PetwirKepo")
      replaceUIText("PetwirKepo", "")
      // replaceUIText("Regen", "Nambah Nyowo")
    }, 5000); // 5000 ms = 5 detik delay

  }
}, 1000);
