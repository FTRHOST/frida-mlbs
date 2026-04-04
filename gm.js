/**
 * FORCE OPEN GM PANEL SCRIPT (TESTGM BYPASS)
 */

let il2cpp = null;

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
    class_get_namespace: n("il2cpp_class_get_namespace", 'pointer', ['pointer']),
    class_get_methods: n("il2cpp_class_get_methods", 'pointer', ['pointer', 'pointer']),
    method_get_name: n("il2cpp_method_get_name", 'pointer', ['pointer']),
    class_get_method_from_name: n("il2cpp_class_get_method_from_name", 'pointer', ['pointer', 'pointer', 'int'])
  };
}

function findClassPtr(name, nameSpace = "") {
  if (!il2cpp.domain_get) return null;
  const domain = il2cpp.domain_get();
  let size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, size);

  for (let i = 0; i < size.readUInt(); i++) {
    const img = il2cpp.assembly_get_image(assemblies.add(i * Process.pointerSize).readPointer());
    for (let j = 0; j < il2cpp.image_get_class_count(img); j++) {
      const klass = il2cpp.image_get_class(img, j);
      if (!klass.isNull()) {
        const cName = il2cpp.class_get_name(klass).readUtf8String();
        if (cName === name) {
          if (nameSpace === "") return klass;
          if (il2cpp.class_get_namespace) {
            const cNamespace = il2cpp.class_get_namespace(klass).readUtf8String();
            if (cNamespace === nameSpace) return klass;
          } else {
            return klass;
          }
        }
      }
    }
  }
  return null;
}

function getMethod(klass, methodName, argsCount) {
  if (!klass) return null;
  let methodPtr = il2cpp.class_get_method_from_name(klass, Memory.allocUtf8String(methodName), argsCount);
  if (!methodPtr.isNull()) return methodPtr.readPointer();
  return null;
}

function readIl2CppString(strPtr) {
  if (strPtr === null || strPtr.isNull()) return "";
  try {
    let length = strPtr.add(0x10).readInt();
    return strPtr.add(0x14).readUtf16String(length);
  } catch (e) {
    return "";
  }
}

// --- Execution ---
const check = setInterval(() => {
  const mod = Process.findModuleByName("liblogic.so") || Process.findModuleByName("libil2cpp.so");
  if (mod) {
    clearInterval(check);
    initIl2cpp(mod.name);
    console.log("\n[+] Engine Ditemukan. Mempersiapkan Bypass GM Logic...");

    let goKlass = findClassPtr("GameObject", "UnityEngine");
    let objKlass = findClassPtr("Object", "UnityEngine");

    let setActiveAddr = getMethod(goKlass, "SetActive", 1);
    let getNameAddr = getMethod(objKlass, "get_name", 0);

    let GetNameFunc = null;
    if (getNameAddr && !getNameAddr.isNull()) {
      GetNameFunc = new NativeFunction(getNameAddr, 'pointer', ['pointer']);
    }

    // --- BYPASS PENYEMBUNYIAN ---
    if (setActiveAddr && !setActiveAddr.isNull() && GetNameFunc) {
      Interceptor.attach(setActiveAddr, {
        onEnter: function(args) {
          let goPtr = args[0];
          let state = args[1].toInt32();
          if (state === 0 && !goPtr.isNull()) {
            try {
              let namePtr = GetNameFunc(goPtr);
              let name = readIl2CppString(namePtr);
              if (name.includes("GM") || name.includes("UI_GM") || name.includes("m_GM") || name.includes("UI_GMUI")) {
                args[1] = ptr(1); // Paksa True
              }
            } catch (e) { }
          }
        }
      });
    }

    // --- HOOKING TESTGM UNTUK BYPASS FLAG & MELACAK KLIK ---
    let testGMKlass = findClassPtr("TestGM");
    if (testGMKlass) {
      console.log("[+] Melacak dan Membajak Logic TestGM...");
      let iter = Memory.alloc(Process.pointerSize).writePointer(NULL);
      let methodPtr;

      while (!(methodPtr = il2cpp.class_get_methods(testGMKlass, iter)).isNull()) {
        const methodName = il2cpp.method_get_name(methodPtr).readUtf8String();
        const impl = methodPtr.readPointer();

        if (!impl.isNull() && methodName !== ".ctor" && !methodName.includes("Update")) {
          try {
            Interceptor.attach(impl, {
              onEnter: function(args) {
                console.log(`\x1b[35m[TestGM] Dipanggil: ${methodName}\x1b[0m`);
              },
              onLeave: function(retval) {
                // Jika nama fungsi berkaitan dengan pengecekan GM, otorisasi, atau validasi, paksa return True (1)
                let mNameLower = methodName.toLowerCase();
                if (mNameLower.includes("isgm") || mNameLower.includes("check") || mNameLower.includes("enable") || mNameLower.includes("get_")) {
                  // Kita berasumsi fungsi yang dicek mengembalikan boolean
                  if (!retval.isNull() || retval.toInt32() === 0) {
                    console.log(`\x1b[31m[!] Memaksa return TRUE pada validasi: ${methodName}\x1b[0m`);
                    retval.replace(ptr(1));
                  }
                }
              }
            });
          } catch (e) { }
        }
      }
    }

    console.log("[+] Menunggu Interaksi... Silakan tekan tombol GM!");
  }
}, 1000);
