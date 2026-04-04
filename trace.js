/**
 * ==============================================================================
 * MLBB ULTIMATE IL2CPP MULTI-TRACER TOOLKIT
 * ==============================================================================
 * Author   : Muhammad Fathir Al Faruq & Assistant
 * Fitur    : Tracer, Patcher, GG Scanner, UI Tracker, Text Replacer, Data Spider
 * ==============================================================================
 */

let il2cpp = null;
let lastFieldValues = {};

// =========================================================
// INISIALISASI IL2CPP API
// =========================================================

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

    // API Tambahan
    object_new: n("il2cpp_object_new", 'pointer', ['pointer']),
    thread_attach: n("il2cpp_thread_attach", 'pointer', ['pointer']),
    string_new: n("il2cpp_string_new", 'pointer', ['pointer']),
    runtime_invoke: n("il2cpp_runtime_invoke", 'pointer', ['pointer', 'pointer', 'pointer', 'pointer'])
  };
  console.log("[+] Ultimate API IL2CPP Initialized.");
}

// =========================================================
// HELPER FUNCTIONS (BACA/TULIS MEMORI & STRING)
// =========================================================

function readFieldData(instancePtr, offset, fieldName) {
  try {
    let addr = instancePtr.add(offset);
    let name = fieldName.toLowerCase();

    if (name.includes("name") || name.startsWith("s") || name.includes("str")) {
      let strPtr = addr.readPointer();
      return readIl2CppStringSafe(strPtr) || "null";
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

function writeIntField(instancePtr, offset, newValue) {
  try {
    let addr = instancePtr.add(offset);
    addr.writeInt(newValue); // Menulis 4-byte Int32
  } catch (e) { }
}

function readIl2CppStringSafe(strPtr) {
  if (!strPtr || strPtr.isNull() || strPtr.toInt32() === 0) return null;
  try {
    if (Process.findRangeByAddress(strPtr)) {
      return strPtr.add(0x14).readUtf16String();
    }
  } catch (e) { }
  return null;
}

function callUnityMethod(className, methodName, instancePtr) {
  if (!instancePtr || instancePtr.isNull() || !il2cpp.runtime_invoke) return null;

  let klassPtr = findClassPtr(className);
  if (!klassPtr) return null;

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let targetMethod = null;

  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    if (il2cpp.method_get_name(methodPtr).readUtf8String() === methodName) {
      targetMethod = methodPtr;
      break;
    }
  }

  if (!targetMethod) return null;

  let exception = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let result = il2cpp.runtime_invoke(targetMethod, instancePtr, NULL, exception);

  if (!exception.readPointer().isNull()) return null; // Jika terjadi error di Unity
  return result;
}

// =========================================================
// FITUR 1: TRACER (MODE FULL & SIMPLE)
// =========================================================

function traceClassFull(targetClassName) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  let fields = getAllFields(klassPtr);
  console.log(`[*] Full Trace Aktif: ${targetClassName}`);

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

function traceMethodCalls(targetClassName) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  console.log(`[*] Simple Trace Aktif: Memantau '${targetClassName}'`);

  hookAllMethods(klassPtr, (methodName, args) => {
    console.log(`[CALL] ${targetClassName}::${methodName} terpanggil.`);
  });
}

// =========================================================
// FITUR 2: VALUE TRACKER
// =========================================================

function trackFieldChanges(targetClassName, targetFields) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return;

  let allFields = getAllFields(klassPtr);
  let tracked = allFields.filter(f => targetFields.includes(f.name));

  hookAllMethods(klassPtr, (methodName, args) => {
    let instance = args[0];
    if (instance.isNull()) return;

    tracked.forEach(f => {
      let currentVal = readFieldData(instance, f.offset, f.name);
      let key = `${instance}-${f.name}`;

      if (lastFieldValues[key] !== undefined && lastFieldValues[key] !== currentVal) {
        console.log(`\n[CHANGE] ${targetClassName}::${f.name} -> ${lastFieldValues[key]} ke ${currentVal}`);
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
  if (!klassPtr) return;

  let fields = getAllFields(klassPtr);
  let targetField = fields.find(f => f.name === targetFieldName);
  if (!targetField) return;

  hookSpecificMethod(klassPtr, targetMethodName, (args) => {
    if (!args[0].isNull()) writeBooleanField(args[0], targetField.offset, forceValue);
  });
}

function hookMethodReturnBool(targetClassName, targetMethodName, forceReturn) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return;

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    if (il2cpp.method_get_name(methodPtr).readUtf8String() === targetMethodName) {
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        Interceptor.attach(impl, {
          onLeave: function(retval) { retval.replace(ptr(forceReturn ? 1 : 0)); }
        });
      }
      break;
    }
  }
}

function autoPatchInt(targetClassName, targetMethodName, targetFieldName, forceValue) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return;

  let fields = getAllFields(klassPtr);
  let targetField = fields.find(f => f.name === targetFieldName);
  if (!targetField) return;

  hookSpecificMethod(klassPtr, targetMethodName, (args) => {
    if (!args[0].isNull()) writeIntField(args[0], targetField.offset, forceValue);
  });
}

// =========================================================
// FITUR 5: FAKE INSTANCE MAKER
// =========================================================

function createFakeInstance(targetClassName) {
  if (!il2cpp) return null;
  il2cpp.thread_attach(il2cpp.domain_get());
  let klassPtr = findClassPtr(targetClassName);
  return klassPtr ? il2cpp.object_new(klassPtr) : null;
}

// =========================================================
// FITUR 6: METADATA SCANNER
// =========================================================

function searchKeyword(keyword) {
  if (!il2cpp) return;
  const target = keyword.toLowerCase();
  console.log(`\n[*] Memindai metadata untuk: "${keyword}"...`);
  // Logika persis seperti sebelumnya (disederhanakan untuk ruang)
  // ... (Gunakan yang di atas untuk full logikanya jika perlu modifikasi)
}

// =========================================================
// FITUR 7 (ULTIMATE V3): UI TEXT TRACKER + AUTO STACK RESOLVER
// =========================================================

// --- Helper: Menerjemahkan banyak offset sekaligus (1x Sweep agar tidak lag) ---
function resolveCallStack(moduleBase, rawOffsets) {
  console.log(`\n[*] Menerjemahkan ${rawOffsets.length} offset ke IL2CPP... (Tunggu 2-4 detik)`);

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  // Array untuk menyimpan hasil terbaik dari setiap offset
  let bestMatches = new Array(rawOffsets.length).fill(null);
  let minDiffs = new Array(rawOffsets.length).fill(0xFFFFFFFF);

  // Looping membongkar semua class & method di game
  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    let classCount = Number(il2cpp.image_get_class_count(img));

    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let methodPtr;

      while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
        const impl = methodPtr.readPointer();
        if (impl.isNull()) continue;

        let methodOffset = impl.sub(moduleBase).toInt32();

        // Cek method ini terhadap SEMUA target offset di backtrace kita
        for (let k = 0; k < rawOffsets.length; k++) {
          let targetOffset = rawOffsets[k];
          let diff = targetOffset - methodOffset;

          // Jika method start berada SEBELUM target offset, dan jaraknya rasional (< 65KB)
          if (diff >= 0 && diff < 0x10000 && diff < minDiffs[k]) {
            minDiffs[k] = diff;
            bestMatches[k] = {
              className: il2cpp.class_get_name(klass).readUtf8String(),
              methodName: il2cpp.method_get_name(methodPtr).readUtf8String(),
              methodStart: methodOffset.toString(16),
              distance: diff
            };
          }
        }
      }
    }
  }

  console.log(`\n[🔥 HASIL TERJEMAHAN RAW CALL STACK 🔥]`);
  for (let k = 0; k < rawOffsets.length; k++) {
    let match = bestMatches[k];
    let rawHex = rawOffsets[k].toString(16);

    if (match) {
      console.log(`[${k}] Offset: 0x${rawHex} => ${match.className}::${match.methodName}()`);
      console.log(`    |-- Jarak ke pintu masuk: ${match.distance} bytes (Start: 0x${match.methodStart})`);
    } else {
      console.log(`[${k}] Offset: 0x${rawHex} => [!] Gagal (Mungkin fungsi Native C++ murni)`);
    }
  }
}

// --- Fungsi Utama Tracker ---
function traceUITextOrigin(searchString) {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");
  console.log(`\n[*] Global UI Tracker + Auto Resolver Aktif untuk: "${searchString}"...`);

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  const targetMethods = ["set_text", "set_Text", "set_content", "SetText"];

  const targetModule = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (!targetModule) return;

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    let classCount = Number(il2cpp.image_get_class_count(img));

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

                  if (textVal && textVal.toLowerCase() === searchString.toLowerCase()) {
                    console.log(`\n=================================================`);
                    console.log(`[🎯] TARGET STRING MUNCUL: "${textVal}"`);
                    console.log(`[-] Dirender oleh UI: ${className}::${methodName}`);

                    try {
                      let backtrace = Thread.backtrace(this.context, Backtracer.FUZZY);
                      let offsetsToResolve = [];
                      let rawStackLog = [];

                      // Ekstrak maksimal 5 tumpukan offset mentah
                      for (let k = 0; k < Math.min(5, backtrace.length); k++) {
                        let addr = backtrace[k];
                        let mod = Process.findModuleByAddress(addr);

                        if (mod && mod.name === targetModule.name) {
                          let offsetInt = addr.sub(mod.base).toInt32();
                          offsetsToResolve.push(offsetInt);
                          rawStackLog.push(`      [${k}] Modul: ${mod.name} | Offset: 0x${offsetInt.toString(16)}`);
                        }
                      }

                      console.log(`\n[*] Raw Stack Ditemukan:`);
                      rawStackLog.forEach(log => console.log(log));

                      // Jalankan Auto Resolver jika ada offset yang didapat
                      if (offsetsToResolve.length > 0) {
                        resolveCallStack(targetModule.base, offsetsToResolve);
                      }

                    } catch (err) {
                      console.log(`      [!] Gagal membaca jejak stack memori.`);
                    }
                    console.log(`=================================================\n`);
                  }
                }
              });
            } catch (e) { }
          }
        }
      }
    }
  }
}
// =========================================================
// FITUR 8: GAME GUARDIAN MODE (MEMORY SCANNER)
// =========================================================

const GGScanner = {
  results: [],
  search: function(value) {
    this.results = [];
    const ranges = Process.enumerateRanges({ protection: 'rw-', coalesce: true });
    let buf = Memory.alloc(4); buf.writeInt(value);
    let pattern = Array.from(new Uint8Array(buf.readByteArray(4))).map(b => b.toString(16).padStart(2, '0')).join(' ');

    ranges.forEach(r => {
      try { Memory.scanSync(r.base, r.size, pattern).forEach(m => this.results.push(m.address)); } catch (e) { }
    });
    console.log(`[+] GG: Ditemukan ${this.results.length} alamat untuk nilai ${value}.`);
  },
  refine: function(newValue) {
    let newResults = [];
    this.results.forEach(addr => { try { if (addr.readInt() === newValue) newResults.push(addr); } catch (e) { } });
    this.results = newResults;
    console.log(`[+] GG: Disaring menjadi ${this.results.length} alamat.`);
  },
  modify: function(newValue) {
    let count = 0;
    this.results.forEach(addr => { try { addr.writeInt(newValue); count++; } catch (e) { } });
    console.log(`[+] GG: Berhasil mengubah ${count} alamat!`);
  }
};

// =========================================================
// FITUR 9: REAL-TIME UI TEXT REPLACER
// =========================================================

function replaceUIText(searchString, replaceString) {
  if (!il2cpp || !il2cpp.string_new) return;
  il2cpp.thread_attach(il2cpp.domain_get());

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  const targetMethods = ["set_text", "set_Text", "set_content", "SetText"];

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
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
                  let textVal = readIl2CppStringSafe(args[1]);
                  if (textVal && textVal.toLowerCase().includes(searchString.toLowerCase())) {
                    let newCStr = Memory.allocUtf8String(replaceString);
                    args[1] = il2cpp.string_new(newCStr);
                  }
                }
              });
            } catch (e) { }
          }
        }
      }
    }
  }
  console.log(`[*] Text Replacer Siap: "${searchString}" -> "${replaceString}"`);
}

// =========================================================
// FITUR 10: DATA MODEL PROFILER (STRUCTURE SPIDER)
// =========================================================

function findDataModel(keywordsArray) {
  if (!il2cpp) return;
  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  let bestMatches = [];

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      const className = il2cpp.class_get_name(klass).readUtf8String();
      let matchedKeywords = new Set();
      let classFields = [];

      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let fieldPtr;
      while (!(fieldPtr = il2cpp.class_get_fields(klass, iter)).isNull()) {
        const fieldName = il2cpp.field_get_name(fieldPtr).readUtf8String();
        classFields.push({ name: fieldName, offset: il2cpp.field_get_offset(fieldPtr) });
        keywordsArray.forEach(kw => { if (fieldName.toLowerCase().includes(kw.toLowerCase())) matchedKeywords.add(kw.toLowerCase()); });
      }

      if (matchedKeywords.size > 1) {
        bestMatches.push({ className: className, matchCount: matchedKeywords.size, fields: classFields });
      }
    }
  }
  bestMatches.sort((a, b) => b.matchCount - a.matchCount);
  bestMatches.slice(0, 3).forEach((m, idx) => console.log(`[Rank ${idx + 1}] Class ${m.className} cocok ${m.matchCount} keyword.`));
}

// =========================================================
// FITUR 11: MULTI-VALUE CATCHER
// =========================================================

function catchInstanceByValues(targetClassName, expectedValues) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return;

  let fields = getAllFields(klassPtr);
  let keysToFind = Object.keys(expectedValues);

  hookAllMethods(klassPtr, (methodName, args) => {
    let instance = args[0];
    if (!instance || instance.isNull()) return;

    let matchCount = 0;
    keysToFind.forEach(targetField => {
      let fInfo = fields.find(f => f.name === targetField);
      if (fInfo && readFieldData(instance, fInfo.offset, fInfo.name).toString() === expectedValues[targetField].toString()) {
        matchCount++;
      }
    });

    if (matchCount === keysToFind.length) {
      console.log(`\n[BINGO!] INSTANCE DITEMUKAN di ${targetClassName}::${methodName}() -> Alamat: ${instance}`);
    }
  });
}

// =========================================================
// FITUR 12: ACTIVE STRING VALUE HUNTER
// =========================================================

function huntStringValueInClass(targetClassName, expectedString) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return;
  let fields = getAllFields(klassPtr);

  hookAllMethods(klassPtr, (methodName, args) => {
    let instance = args[0];
    if (!instance || instance.isNull() || instance.toInt32() === 0) return;

    for (let i = 0; i < fields.length; i++) {
      let f = fields[i];
      let n = f.name.toLowerCase();
      if (n.startsWith("s") || n.includes("name") || n.includes("str") || n.includes("text")) {
        let val = readFieldData(instance, f.offset, f.name);
        if (typeof val === "string" && val.toLowerCase().includes(expectedString.toLowerCase())) {
          console.log(`\n[TARGET TEXT FOUND!] Class: ${targetClassName} | Field: ${f.name} | Isi: "${val}" | Alamat: ${instance}`);
          break;
        }
      }
    }
  });
}

// =========================================================
// INTERNAL IL2CPP SEARCHERS (Helper Pencari Struktur)
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
    results.push({ name: il2cpp.field_get_name(fieldPtr).readUtf8String(), offset: il2cpp.field_get_offset(fieldPtr) });
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
    try { Interceptor.attach(impl, { onEnter: function(args) { callback(name, args); } }); } catch (e) { }
  }
}

function hookSpecificMethod(klassPtr, targetMethodName, callback) {
  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let found = false;
  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    if (il2cpp.method_get_name(methodPtr).readUtf8String() === targetMethodName) {
      found = true;
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) { try { Interceptor.attach(impl, { onEnter: function(args) { callback(args); } }); } catch (e) { } }
      break;
    }
  }
  return found;
}


// =========================================================
// FITUR BANTUAN: NEIGHBORHOOD SCANNER (Mini Dump.cs)
// =========================================================

// =========================================================
// FITUR BANTUAN (PERBAIKAN): NEIGHBORHOOD SCANNER
// =========================================================

function scanNeighborhood(targetHex) {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");

  // [PERBAIKAN]: Bersihkan awalan '0x' secara otomatis jika ada
  let cleanHex = targetHex.toString().toLowerCase().replace("0x", "");

  // Ambil 3 digit pertama dari hex yang sudah bersih (Misal: "b69324" -> "b69")
  let prefix = cleanHex.substring(0, 3);

  console.log(`\n[*] Memindai semua method di area 0x${prefix}000...`);

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  const il2cppModule = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  let foundMethods = [];

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    let classCount = Number(il2cpp.image_get_class_count(img));

    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let methodPtr;

      while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
        const impl = methodPtr.readPointer();
        if (impl.isNull()) continue;

        let methodOffset = impl.sub(il2cppModule.base).toString(16).toLowerCase();

        // Hitung nilai prefix dan prefix sebelumnya (misal 'b69' dan 'b68')
        let prefixDec = parseInt(prefix, 16);
        let prevPrefix = (prefixDec - 1).toString(16).toLowerCase();

        // Cari method yang berawalan b69 atau b68
        if (methodOffset.startsWith(prefix) || methodOffset.startsWith(prevPrefix)) {
          foundMethods.push({
            className: il2cpp.class_get_name(klass).readUtf8String(),
            methodName: il2cpp.method_get_name(methodPtr).readUtf8String(),
            offsetHex: methodOffset,
            offsetDec: parseInt(methodOffset, 16)
          });
        }
      }
    }
  }

  // Urutkan dari offset terkecil ke terbesar
  foundMethods.sort((a, b) => a.offsetDec - b.offsetDec);

  let targetDec = parseInt(cleanHex, 16);

  console.log(`\n[DAFTAR METHOD DI SEKITAR 0x${cleanHex}]`);

  if (foundMethods.length === 0) {
    console.log(`[!] Tidak ada method yang ditemukan di area ini.`);
  } else {
    foundMethods.forEach(m => {
      // Tandai sebagai Kandidat Kuat jika method dimulai SEBELUM offset kita, 
      // dan jaraknya tidak terlalu jauh (< 0x2000 bytes)
      let isSuspect = (m.offsetDec <= targetDec && (targetDec - m.offsetDec) < 0x2000);
      let marker = isSuspect ? "👉 [KANDIDAT KUAT]" : "  ";
      console.log(`${marker} Offset: 0x${m.offsetHex} | Class: ${m.className} | Method: ${m.methodName}()`);
    });
  }
}
// --- Cara Memanggilnya di bagian bawah script ---
// setTimeout(() => {
//     scanNeighborhood("b69324");
// }, 5000);
//
// =========================================================
// FITUR 13: METHOD INVOKER (Auto Clicker / Function Caller)
// =========================================================

function invokeMethod(instancePtr, className, methodName, argsArray = []) {
  if (!il2cpp || !il2cpp.runtime_invoke) return console.log("[!] API Invoke belum siap!");

  let klassPtr = findClassPtr(className);
  if (!klassPtr) return;

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let targetMethod = null;

  // Cari pointer method-nya
  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    if (il2cpp.method_get_name(methodPtr).readUtf8String() === methodName) {
      targetMethod = methodPtr;
      break;
    }
  }

  if (!targetMethod) return console.log(`[!] Method ${methodName} tidak ditemukan di ${className}`);

  // Siapkan argumen (jika ada)
  let params = NULL;
  if (argsArray.length > 0) {
    params = Memory.alloc(argsArray.length * Process.pointerSize);
    for (let i = 0; i < argsArray.length; i++) {
      params.add(i * Process.pointerSize).writePointer(argsArray[i]);
    }
  }

  // EKSEKUSI KLIK!
  try {
    let exception = Memory.alloc(Process.pointerSize).writePointer(NULL);
    il2cpp.runtime_invoke(targetMethod, instancePtr, params, exception);
    console.log(`[🚀] SUCCESS: Berhasil memanggil (Klik) ${className}::${methodName}`);
  } catch (e) {
    console.log(`[!] Gagal melakukan invoke: ${e}`);
  }
}

// =========================================================
// FITUR 14: CLICK SNIFFER (Pelacak Tombol Asli)
// =========================================================

function sniffButtonClicks() {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");
  console.log(`\n[*] Click Sniffer Aktif! Silakan sentuh tombol apapun di dalam game...`);

  // Daftar nama class yang biasanya menangani sentuhan di Unity / NGUI / FairyGUI
  const buttonClasses = ["UIButton", "Button", "EventDelegate", "UIEventListener", "PointerClickEvent"];
  // Daftar nama method saat tombol ditekan
  const clickMethods = ["OnClick", "Execute", "Invoke", "OnPointerClick"];

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  let hookedCount = 0;

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    let classCount = Number(il2cpp.image_get_class_count(img));

    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (klass.isNull()) continue;

      const className = il2cpp.class_get_name(klass).readUtf8String();

      // Saring hanya class yang berbau tombol / event
      if (buttonClasses.some(bc => className.includes(bc))) {
        let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
        let methodPtr;

        while (!(methodPtr = il2cpp.class_get_methods(klass, iter)).isNull()) {
          const methodName = il2cpp.method_get_name(methodPtr).readUtf8String();

          if (clickMethods.includes(methodName)) {
            const impl = methodPtr.readPointer();
            if (!impl.isNull()) {
              try {
                Interceptor.attach(impl, {
                  onEnter: function(args) {
                    // args[0] adalah pointer / alamat memori tombol yang sedang ditekan
                    let instanceAddr = args[0];
                    if (instanceAddr.isNull()) return;

                    console.log(`\n[👆 DETEKSI SENTUHAN JARI!]`);
                    console.log(`[-] Class Tombol : ${className}`);
                    console.log(`[-] Method Klik  : ${methodName}()`);
                    console.log(`[-] Alamat Memori: ${instanceAddr}`);
                    console.log(`[*] Simpan alamat di atas. Kamu bisa menggunakannya di Fitur 13 (Invoker)!`);
                  }
                });
                hookedCount++;
              } catch (e) { }
            }
          }
        }
      }
    }
  }
  console.log(`[*] Radar Sentuhan siap di ${hookedCount} fungsi tombol.`);
}

// =========================================================
// FITUR 14 (V2): UI TRACKER + RAW MEMORY HIERARCHY SNIFFER
// =========================================================

// Helper: Membaca nama GameObject langsung dari memori Unity (C++ struct)
function readGameObjectName(gameObjectPtr) {
  if (!gameObjectPtr || gameObjectPtr.isNull()) return "Unknown";
  try {
    // Pada Unity (ARM64), pointer ke nama biasanya ada di offset 0x60 dari GameObject
    let namePtr = gameObjectPtr.add(0x60).readPointer();
    if (!namePtr.isNull()) {
      return namePtr.readCString(); // Nama GameObject biasanya disimpan sebagai C-String
    }
  } catch (e) { }
  return "Unknown_GO";
}

// Helper: Mendapatkan Transform parent langsung dari memori
function getParentTransform(transformPtr) {
  if (!transformPtr || transformPtr.isNull()) return null;
  try {
    // Offset parent transform bervariasi, tapi kita akan coba memanggil metode internal engine
    // Jika gagal, kita kembalikan null
    let parentMethod = Module.findExportByName("libunity.so", "_ZN9Transform13GetParentBasaEv"); // Nama symbol C++ Unity untuk GetParent
    if (parentMethod) {
      let getParent = new NativeFunction(parentMethod, 'pointer', ['pointer']);
      return getParent(transformPtr);
    }
  } catch (e) { }
  return null;
}

// Fungsi Utama: Melacak asal usul teks dan memanjat pohon secara kasar
function traceUITextOrigin(searchString) {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");
  console.log(`\n[*] Raw Memory Hierarchy Sniffer Aktif untuk: "${searchString}"...`);

  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);
  const targetMethods = ["set_text", "set_Text", "set_content", "SetText"];

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    let classCount = Number(il2cpp.image_get_class_count(img));

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

                  if (textVal && textVal.toLowerCase() === searchString.toLowerCase()) {
                    console.log(`\n=================================================`);
                    console.log(`[🎯] TARGET STRING MUNCUL: "${textVal}"`);
                    console.log(`[-] Dipegang oleh komponen: ${className}`);

                    let componentInstance = args[0]; // Ini adalah pointer ke UILabel/Text

                    if (componentInstance && !componentInstance.isNull()) {
                      console.log(`\n[*] Mengekstrak Info GameObject secara langsung...`);

                      try {
                        // Di Unity, class Component selalu mewarisi Object.
                        // Struktur memorinya: [ClassInfo] [Monitor] [GameObject Pointer]
                        // Biasanya pointer ke GameObject ada di offset 0x10 atau 0x18 dari Component.

                        // Coba baca offset 0x10 dulu (64-bit Unity biasanya di sini untuk GameObject)
                        let gameObjectPtr = componentInstance.add(0x10).readPointer();

                        // Jika pointernya aneh, coba 0x18
                        if (gameObjectPtr.toInt32() === 0 || !Process.findRangeByAddress(gameObjectPtr)) {
                          gameObjectPtr = componentInstance.add(0x18).readPointer();
                        }

                        if (gameObjectPtr && !gameObjectPtr.isNull() && Process.findRangeByAddress(gameObjectPtr)) {
                          let goName = readGameObjectName(gameObjectPtr);
                          console.log(`[+] Nama GameObject: [${goName}]`);

                          // Karena memanjat hierarki via memori C++ ("libunity.so") sangat rawan crash dan
                          // symbol C++ sering di-strip (dihapus) oleh developer, kita hentikan pemanjatan di sini.
                          // Mendapatkan nama GameObject-nya saja sudah 80% menyelesaikan masalah!

                          console.log(`\n[*] KESIMPULAN: GameObject yang menempel pada teks ini bernama "${goName}".`);
                          console.log(`[*] Gunakan FindDataModel() untuk mencari Class yang berhubungan dengan "${goName}".`);

                        } else {
                          console.log(`[!] Gagal menemukan pointer GameObject yang valid.`);
                        }

                      } catch (err) {
                        console.log(`[!] Gagal membaca memori GameObject: ${err}`);
                      }
                    }
                    console.log(`=================================================\n`);
                  }
                }
              });
            } catch (e) { }
          }
        }
      }
    }
  }
}

function traceSpecificMethod(targetClassName, targetMethodName) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let found = false;

  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    const methodName = il2cpp.method_get_name(methodPtr).readUtf8String();

    if (methodName === targetMethodName) {
      found = true;
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        Interceptor.attach(impl, {
          onEnter: function(args) {
            console.log(`\n[🎯 TARGET HIT] ${targetClassName}::${methodName} terpanggil!`);
            // Jika method ini punya argumen, Anda bisa membacanya di sini
            // console.log(`Arg 1: ${args[1]}`); 
          },
          onLeave: function(retval) {
            console.log(`[RET] ${targetClassName}::${methodName} mengembalikan nilai: ${retval}`);
          }
        });
        console.log(`[*] Berhasil memasang hook khusus pada: ${targetMethodName}`);
      }
      break;
    }
  }
  if (!found) console.log(`[!] Method ${targetMethodName} tidak ditemukan di class ${targetClassName}`);
}


function peekClassData(targetClassName) {
  if (!il2cpp) return console.log("[!] IL2CPP belum siap!");

  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  // Ambil semua definisi field (nama & offset)
  let fields = getAllFields(klassPtr);

  // Mencari Static Instance (Biasanya tersimpan di vtable atau static fields)
  // Catatan: Ini mencoba menebak pointer instance jika class memiliki field 'instance' atau 'm_Instance'
  console.log(`\n[*] Membedah Data Aktif di Class: ${targetClassName}`);

  hookAllMethods(klassPtr, (methodName, args) => {
    let instance = args[0]; // Kita pinjam pointer dari pemanggilan method pertama kali
    if (instance && !instance.isNull() && !lastFieldValues[targetClassName]) {
      console.log(`[+] Instance ditemukan di: ${instance}`);
      console.log(`[+] Nilai Data Saat Ini:`);

      fields.forEach(f => {
        let val = readFieldData(instance, f.offset, f.name);
        console.log(`    |-- ${f.name} (0x${f.offset.toString(16)}): ${val}`);
      });

      // Simpan agar tidak spam log
      lastFieldValues[targetClassName] = instance;
    }
  });

  console.log(`[*] SIlakan buka menu/fitur terkait di game agar instance terdeteksi...`);
}

// =========================================================
// FITUR TAMBAHAN: INT32 MODIFIER (FIELD & METHOD)
// =========================================================

// 1. Helper untuk menulis nilai Int32 ke field memori
function writeIntField(instancePtr, offset, newValue) {
  try {
    let addr = instancePtr.add(offset);
    addr.writeInt(newValue); // Menulis 4 byte integer (Int32)
  } catch (e) {
    console.log(`[!] Gagal menulis Int32 di offset 0x${offset.toString(16)}: ${e}`);
  }
}

// 2. Mengubah nilai field Int32 secara otomatis setiap kali method trigger terpanggil
function autoPatchInt(targetClassName, targetMethodName, targetFieldName, forceValue) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  let fields = getAllFields(klassPtr);
  let targetField = fields.find(f => f.name === targetFieldName);
  if (!targetField) return console.log(`[!] Field ${targetFieldName} tidak ditemukan di class ${targetClassName}.`);

  hookSpecificMethod(klassPtr, targetMethodName, (args) => {
    if (!args[0].isNull()) {
      writeIntField(args[0], targetField.offset, forceValue);
    }
  });
  console.log(`[*] AutoPatch Int32 Aktif: ${targetClassName}::${targetFieldName} di-force ke ${forceValue}`);
}

// 3. Memaksa method untuk selalu mengembalikan (return) nilai Int32 tertentu
function hookMethodReturnInt(targetClassName, targetMethodName, forceReturn) {
  if (!il2cpp) return;
  let klassPtr = findClassPtr(targetClassName);
  if (!klassPtr) return console.log(`[!] Class ${targetClassName} tidak ditemukan.`);

  let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
  let methodPtr;
  let found = false;

  while (!(methodPtr = il2cpp.class_get_methods(klassPtr, iter)).isNull()) {
    if (il2cpp.method_get_name(methodPtr).readUtf8String() === targetMethodName) {
      found = true;
      const impl = methodPtr.readPointer();
      if (!impl.isNull()) {
        Interceptor.attach(impl, {
          onLeave: function(retval) {
            // Menimpa nilai return asli dengan forceReturn
            retval.replace(ptr(forceReturn));
          }
        });
        console.log(`[*] Hook Return Int32 Aktif: ${targetClassName}::${targetMethodName}() selalu return ${forceReturn}`);
      }
      break;
    }
  }
  if (!found) console.log(`[!] Method ${targetMethodName} tidak ditemukan di class ${targetClassName}.`);
}

// =========================================================
// EKSEKUSI UTAMA (Tulis Perintahmu Di Dalam setTimeout)
// =========================================================

const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);
    hookMethodReturnBool("LoginCLibraryUtils", "mStaticIsSandBox", true);
    hookMethodReturnBool("BattleStaticInit", "IsAdjustSandBox", true);
    hookMethodReturnBool("FrameTimeRecorder", "mIsSandBoxMode", true);
    hookMethodReturnBool("GameInit", "IsSandBoxIp", true);
    hookMethodReturnBool("GameServerConfig", "m_bGSDKSandBox", true);
    hookMethodReturnBool("GameServerConfig", "m_bAdjustSandBox", true);
    hookMethodReturnBool("SDKCommon", "IsSandBox", true);
    hookMethodReturnBool("TableStreamBase`5", "m_bCheckSandboxSubThreadParseData", true);
    hookMethodReturnBool("TableStreamBase`5", "m_bAdjustSandBox", true);
    hookMethodReturnBool("TableStreamGroupMgr", "m_bAdjustSandBox", true);
    hookMethodReturnBool("LogicExtension", "IsAdjustSandBox", true);
    hookMethodReturnBool("SDKReportModel", "isSandBox", true);
    hookMethodReturnBool("CommonDownloadMgr", "IsSandBoxEnv", true);
    hookMethodReturnBool("CommonDownloadMgr", "get_IsDebug", true);
    hookMethodReturnBool("ModeVersionData", "CheckVersionInSandBox", true);
    hookMethodReturnBool("GSDKCore", "bSandbox", true);
    hookMethodReturnBool("SdkInit", "IsSandBox", true);
    hookMethodReturnBool("RankHeroMgr", "bAllRoadSelectedAutoSandboxExchange", true);
    hookMethodReturnBool("RankHeroMgr", " bOpenSandboxRoadExchangeAddition", true);
    hookMethodReturnBool("Cmd_Account_ByteDance_Login_CS", "bSandbox", true);
    hookMethodReturnBool("ModelControlInBattle", "IsEsportRuneEnable", true);
    hookMethodReturnBool("SystemData", "m_bEsportPlayer", true);
    hookMethodReturnBool("SystemData", "BUseEsportsEmblem", true);
    hookMethodReturnBool("SystemSwitchData", "BEsportsEmblemOpen", true);
    hookMethodReturnBool("ModelControlInBattle", "SystemSwitchData", true);
    hookMethodReturnBool("LuaHelper", "IsGmServerRunning", true);
    hookMethodReturnBool("LuaHelper", "IsGmServerForceOnline", true);



    hookMethodReturnBool("ChooseHeroMgr", "IsSkinUseable", true);
    hookMethodReturnBool("ChooseHeroMgr", "BAutoTestMode", true);
    hookMethodReturnBool("UIChooseHero", "CanSelectSkin", true);
    hookMethodReturnBool("SystemData", "IsForbidSkin", false);



    hookMethodReturnBool("NLLoadingUIAtlas", "_bGmLogin", true);
    hookMethodReturnBool("IMobaPluginBridge", "IsForbidAssets", false);
    hookMethodReturnBool("IMobaPluginBridge", "IsSkipMd5Check", false);








    // Beri jeda 5 detik agar game loading terlebih dahulu
    setTimeout(() => {

      console.log("[*] Memulai Eksekusi Fitur...");



      // ==========================================
      // AREA KERJA KAMU (Buka comment untuk memakai)
      // ==========================================
      //






      // 1. Trace Method di Class
      // traceMethodCalls("SystemData");

      // 2. Lacak asal usul teks "Ranked" di layar
      // scanNeighborhood("b69324");
      // Masukkan data yang kamu dapat dari Sniffer

      // Panggil Fitur 13
      // 3. Ubah teks yang muncul di layar (Visual Only)
      // replaceUIText("Not enough Gold", "Uang Kurang Bos");

      // 4. Detektif: Cari class yang punya Gold dan Diamond
      // findDataModel(["gold", "diamond"]);

      // 5. Pemburu Teks: Cari tahu class RoomData lagi megang teks apa
      // huntStringValueInClass("RoomData", "Ranked");

      // 6. Game Guardian: Cari angka Gold kamu (misal 500)
      // GGScanner.search(500);

      // (Untuk GG Scanner refine dan modify, panggil lewat console frida REPL, 
      //  atau buat setTimeout berantai seperti contoh sebelumnya).

    }, 5000);

  }
}, 1200);
