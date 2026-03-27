/**
 * MLBB Full Il2Cpp Dumper
 * Menghasilkan dump.cs lengkap dari memori.
 * Output: /storage/emulated/0/Android/data/com.mobilelegends.taptest/files/dump.cs
 */

function dumpAll() {
  const libName = Process.findModuleByName("libcsharp.so") ? "libcsharp.so" : "libil2cpp.so";
  console.log("[*] Memulai Dump pada: " + libName);

  const lib = Process.getModuleByName(libName);
  const base = lib.base;

  function n(name, ret, args) {
    const addr = lib.findExportByName(name);
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
    class_get_namespace: n("il2cpp_class_get_namespace", 'pointer', ['pointer']),
    class_get_fields: n("il2cpp_class_get_fields", 'pointer', ['pointer', 'pointer']),
    field_get_name: n("il2cpp_field_get_name", 'pointer', ['pointer']),
    field_get_offset: n("il2cpp_field_get_offset", 'uint32', ['pointer']),
    field_get_type: n("il2cpp_field_get_type", 'pointer', ['pointer']),
    class_get_methods: n("il2cpp_class_get_methods", 'pointer', ['pointer', 'pointer']),
    method_get_name: n("il2cpp_method_get_name", 'pointer', ['pointer']),
    method_get_return_type: n("il2cpp_method_get_return_type", 'pointer', ['pointer']),
    type_get_name: n("il2cpp_type_get_name", 'pointer', ['pointer']),
    method_get_param_count: n("il2cpp_method_get_param_count", 'uint32', ['pointer']),
    method_get_param: n("il2cpp_method_get_param", 'pointer', ['pointer', 'uint32']),
    method_get_param_name: n("il2cpp_method_get_param_name", 'pointer', ['pointer', 'uint32'])
  };

  const outPath = "/storage/emulated/0/Android/data/com.mobile.legends/files/dump.cs";
  const file = new File(outPath, "w");

  console.log("[*] Mencari Assembly-CSharp...");
  const domain = il2cpp.domain_get();
  const out_size = Memory.alloc(8);
  const assemblies = il2cpp.domain_get_assemblies(domain, out_size);
  const count = parseInt(out_size.readPointer().toString());

  for (let i = 0; i < count; i++) {
    const assembly = assemblies.add(i * Process.pointerSize).readPointer();
    const img = il2cpp.assembly_get_image(assembly);
    const imgName = il2cpp.image_get_name(img).readCString();

    if (imgName === "Assembly-CSharp.dll") {
      const classCount = Number(il2cpp.image_get_class_count(img));
      console.log(`[V] Dumping ${classCount} kelas ke ${outPath}...`);
      file.write(`// Dumped from ${libName} at ${new Date().toISOString()}

`);

      for (let j = 0; j < classCount; j++) {
        const klass = il2cpp.image_get_class(img, j);
        const name = il2cpp.class_get_name(klass).readCString();
        const ns = il2cpp.class_get_namespace(klass).readCString();

        file.write(`// Namespace: ${ns}
class ${name} {
`);

        // Dump Fields
        const iterField = Memory.alloc(Process.pointerSize).writePointer(NULL);
        let field;
        while (!(field = il2cpp.class_get_fields(klass, iterField)).isNull()) {
          const fName = il2cpp.field_get_name(field).readCString();
          const fOffset = il2cpp.field_get_offset(field);
          file.write(`  [Field] 0x${fOffset.toString(16)} : ${fName}
`);
        }

        // Dump Methods
        const iterMethod = Memory.alloc(Process.pointerSize).writePointer(NULL);
        let method;
        while (!(method = il2cpp.class_get_methods(klass, iterMethod)).isNull()) {
          const mName = il2cpp.method_get_name(method).readCString();
          const mPtr = method.readPointer(); // methodPointer
          let rva = "0x0";
          if (!mPtr.isNull()) {
            rva = "0x" + mPtr.sub(base).toString(16);
          }
          file.write(`  [Method] RVA: ${rva} | Name: ${mName}
`);
        }

        file.write(`}

`);

        if (j % 500 === 0) console.log(`Progress: ${j}/${classCount} classes...`);
      }
      break;
    }
  }

  file.flush();
  file.close();
  console.log("[+] DUMP SELESAI!");
}

setTimeout(dumpAll, 5000);
