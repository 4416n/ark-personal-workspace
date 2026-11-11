import JSZip from "jszip";

// Read with an independent ZIP implementation and verify every entry's CRC.
// This works on Windows without an external unzip binary and does not share
// the application's encoder or CRC calculation.
export async function readVerifiedZip(bytes) {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  return new Map(await Promise.all(
    Object.values(archive.files)
      .filter((entry) => !entry.dir)
      .map(async (entry) => [entry.name, await entry.async("string")]),
  ));
}
