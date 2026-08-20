import { networkInterfaces } from "node:os";

const VIRTUAL_INTERFACE =
  /^(utun|awdl|llw|bridge|docker|br-|veth|tun|tap|vboxnet|vmnet|vmenet|gif|stf|ap\d|zt|tailscale|wg|ipsec|ppp)/i;

export function resolveDevHost(
  address: string | undefined,
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string {
  if (!address || address === "127.0.0.1" || address === "::1") return "localhost";
  if (address !== "0.0.0.0" && address !== "::") return address;
  return pickLanIPv4(interfaces) ?? "localhost";
}

export function pickLanIPv4(
  interfaces: ReturnType<typeof networkInterfaces>,
): string | undefined {
  const candidates: { name: string; address: string }[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        candidates.push({ name, address: info.address });
      }
    }
  }
  const rank = (name: string): number =>
    /^en0$/i.test(name) ? 0 : /^(en|eth)\d+$/i.test(name) ? 1 : 2;
  candidates.sort((a, b) => rank(a.name) - rank(b.name));
  return candidates[0]?.address;
}
