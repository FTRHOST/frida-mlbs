/**
 * MLBB Frame Swapper: Mengganti TeamMatchLua menjadi Contest
 */

// === KONFIGURASI ===
const TARGET_FRAME = "FRAME_GM";
const REPLACE_WITH = "FRAME_BattleGM";      // Frame tersembunyi yang ingin dimunculkan

let il2cpp = null;
let frameMap = {};
let replaceFramePtr = null;

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
    class_get_fields: n("il2cpp_class_get_fields", 'pointer', ['pointer', 'pointer']),
    field_get_name: n("il2cpp_field_get_name", 'pointer', ['pointer']),
    field_static_get_value: n("il2cpp_field_static_get_value", 'void', ['pointer', 'pointer']),
    runtime_class_init: n("il2cpp_runtime_class_init", 'void', ['pointer'])
  };
  console.log("[+] API IL2CPP Initialized untuk Swap Frame.");
}

function findClassPtr(name) {
  if (!il2cpp) return null;
  const domain = il2cpp.domain_get();
  let sizePtr = Memory.alloc(Process.pointerSize);
  const assemblies = il2cpp.domain_get_assemblies(domain, sizePtr);
  let count = Process.pointerSize === 8 ? sizePtr.readU64().toNumber() : sizePtr.readU32();

  for (let i = 0; i < count; i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    if (img.isNull()) continue;
    let classCount = il2cpp.image_get_class_count(img).toNumber();
    for (let j = 0; j < classCount; j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (!klass.isNull()) {
        let className = il2cpp.class_get_name(klass).readUtf8String();
        if (className === name) return klass;
      }
    }
  }
  return null;
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

// --- Execution ---
const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);

    console.log("[*] Menginisialisasi Memory Mapping untuk FrameID...");

    let frameIdClass = findClassPtr("FrameID");
    if (frameIdClass) {
      if (il2cpp.runtime_class_init) {
        il2cpp.runtime_class_init(frameIdClass);
      }

      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let fieldPtr;
      let valuePtr = Memory.alloc(Process.pointerSize);
      let count = 0;

      while (!(fieldPtr = il2cpp.class_get_fields(frameIdClass, iter)).isNull()) {
        let fieldName = il2cpp.field_get_name(fieldPtr).readUtf8String();

        if (fieldName.startsWith("FRAME_") || fieldName.startsWith("UI_")) {
          try {
            il2cpp.field_static_get_value(fieldPtr, valuePtr);
            let objPtr = valuePtr.readPointer();

            if (!objPtr.isNull()) {
              frameMap[objPtr.toString()] = fieldName;
              count++;

              if (fieldName === REPLACE_WITH) {
                replaceFramePtr = objPtr;
              }
            }
          } catch (e) { }
        }
      }
      console.log(`[+] Berhasil memetakan ${count} Frame ke Memory.`);

      if (replaceFramePtr) {
        console.log(`[+] Pointer Pengganti (${REPLACE_WITH}) siap: ${replaceFramePtr}`);
      } else {
        console.log(`[-] Peringatan: Pointer ${REPLACE_WITH} tidak ditemukan.`);
      }

    }

    let uiMgrClass = findClassPtr("UIMgr");
    if (uiMgrClass) {
      console.log("[+] Memasang Hook pada UIMgr::Active...");

      hookAllMethods(uiMgrClass, (methodName, args) => {
        if (methodName === "Active") {
          try {
            let framePtr = args[1];
            let frameName = frameMap[framePtr.toString()];

            if (frameName) {
              console.log(`\n[UI EVENT] Anda membuka: ${frameName}`);

              // ==== LOGIKA HOOK SWAPPING ====
              if (frameName === TARGET_FRAME) {
                console.log(`   [!] Terdeteksi masuk ke menu: ${TARGET_FRAME}`);

                if (replaceFramePtr !== null) {
                  console.log(`   [->] MENGALALIHKAN (HOOK) KE: ${REPLACE_WITH}`);
                  args[1] = replaceFramePtr;
                } else {
                  console.log(`   [X] Gagal Mengalihkan: Pointer ${REPLACE_WITH} belum siap.`);
                }
              }
            }
          } catch (e) { }
        }
      });
    }
  }
}, 1000);
