// WHATWG Fetch/Chromium reject these ports even when the OS allocates one for
// listen(0). Some Windows ephemeral ranges include the IRC block (6665–6669).
export const blockedHttpPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

export async function waitForHttp(server, rejected = blockedHttpPorts) {
  if (!server.listening)
    await new Promise((resolve, reject) => {
      const ready = () => {
        server.off("error", failed);
        resolve();
      };
      const failed = (error) => {
        server.off("listening", ready);
        reject(error);
      };
      server.once("listening", ready);
      server.once("error", failed);
    });
  for (let attempt = 0; attempt < 100; attempt++) {
    const address = server.address();
    if (!rejected.has(address.port)) return server;
    const host = address.address;
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise((resolve, reject) => {
      const ready = () => {
        server.off("error", failed);
        resolve();
      };
      const failed = (error) => {
        server.off("listening", ready);
        reject(error);
      };
      server.once("listening", ready);
      server.once("error", failed);
      server.listen(0, host);
    });
  }
  await new Promise((resolve) => server.close(resolve));
  throw new Error("Unable to allocate a Fetch-compatible HTTP test port");
}
